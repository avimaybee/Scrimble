import { promisify } from 'node:util';
import { exec as execCallback } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  LedgerTask,
  VerificationCheck,
  VerificationResult,
  VerificationStatus,
} from '@scrimble/shared';

const exec = promisify(execCallback);

export interface VerificationPatternCheck {
  file: string;
  pattern: string | RegExp;
  name?: string;
}

export interface VerificationInput {
  cwd?: string;
  expectedFiles?: string[];
  expectedPatterns?: VerificationPatternCheck[];
  commands?: string[];
}

function formatStatusFromChecks(checks: VerificationCheck[]): VerificationStatus {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warn' || check.status === 'manual_review')) return 'warn';
  return 'pass';
}

function computeConfidence(checks: VerificationCheck[]): number {
  if (checks.length === 0) return 0;

  const score = checks.reduce((sum, check) => {
    if (check.status === 'pass') return sum + 1;
    if (check.status === 'warn') return sum + 0.5;
    if (check.status === 'manual_review') return sum + 0.25;
    return sum;
  }, 0);

  return Number((score / checks.length).toFixed(2));
}

function trimOutput(value: string, maxLength = 220): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

async function checkPathExists(cwd: string, targetPath: string): Promise<VerificationCheck> {
  const absolutePath = path.resolve(cwd, targetPath);
  try {
    await fs.access(absolutePath);
    return {
      name: `File exists: ${targetPath}`,
      status: 'pass',
      evidence: absolutePath,
    };
  } catch {
    return {
      name: `File exists: ${targetPath}`,
      status: 'fail',
      message: 'Expected file was not found.',
      evidence: absolutePath,
    };
  }
}

async function checkPattern(cwd: string, patternCheck: VerificationPatternCheck): Promise<VerificationCheck> {
  const absolutePath = path.resolve(cwd, patternCheck.file);

  let content: string;
  try {
    content = await fs.readFile(absolutePath, 'utf8');
  } catch {
    return {
      name: patternCheck.name ?? `Pattern check: ${patternCheck.file}`,
      status: 'fail',
      message: 'Target file could not be read.',
      evidence: absolutePath,
    };
  }

  const regex =
    patternCheck.pattern instanceof RegExp ? patternCheck.pattern : new RegExp(patternCheck.pattern, 'm');
  const matched = regex.test(content);

  return {
    name: patternCheck.name ?? `Pattern check: ${patternCheck.file}`,
    status: matched ? 'pass' : 'fail',
    message: matched ? 'Pattern found.' : 'Pattern not found.',
    ...(matched ? { evidence: trimOutput(regex.toString()) } : {}),
  };
}

async function checkCommand(cwd: string, command: string): Promise<VerificationCheck> {
  try {
    const { stdout } = await exec(command, { cwd, windowsHide: true });
    return {
      name: `Command: ${command}`,
      status: 'pass',
      evidence: trimOutput(stdout.trim() || 'Command succeeded with no output.'),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: `Command: ${command}`,
      status: 'fail',
      message: trimOutput(message),
    };
  }
}

export async function runVerification(input: VerificationInput = {}): Promise<VerificationResult> {
  const cwd = input.cwd ?? process.cwd();
  const checks: VerificationCheck[] = [];

  checks.push(await checkPathExists(cwd, '.git'));

  if (input.expectedFiles) {
    const fileChecks = await Promise.all(input.expectedFiles.map((targetPath) => checkPathExists(cwd, targetPath)));
    checks.push(...fileChecks);
  }

  if (input.expectedPatterns) {
    const patternChecks = await Promise.all(
      input.expectedPatterns.map((patternCheck) => checkPattern(cwd, patternCheck)),
    );
    checks.push(...patternChecks);
  }

  if (input.commands) {
    const commandChecks = await Promise.all(input.commands.map((command) => checkCommand(cwd, command)));
    checks.push(...commandChecks);
  }

  const status = formatStatusFromChecks(checks);
  const confidence = computeConfidence(checks);

  return {
    status,
    confidence,
    checks,
    timestamp: new Date().toISOString(),
  };
}

export interface TaskVerificationInput {
  task: LedgerTask;
  cwd?: string;
  touchedFiles?: string[];
}

export interface TaskVerificationResult {
  passed: boolean;
  status: VerificationStatus;
  confidence: number;
  summary: string;
  raw: VerificationResult;
}

function summarize(result: VerificationResult): string {
  const failed = result.checks.filter((check) => check.status === 'fail').map((check) => check.name);
  if (failed.length > 0) {
    return `Failed checks: ${failed.join(', ')}`;
  }
  if (result.status === 'warn' || result.status === 'manual_review') {
    const warnings = result.checks.filter((check) => check.status !== 'pass').map((check) => check.name);
    return warnings.length > 0 ? `Warnings: ${warnings.join(', ')}` : 'Verification reported warnings.';
  }
  return 'Verification passed.';
}

function fallbackVerificationInput(task: LedgerTask, touchedFiles: string[] = []): VerificationInput {
  const expectedFiles = task.ownedFiles
    .filter((entry) => !entry.includes('*') && !entry.includes('?'))
    .slice(0, 10);
  const additionalTouched = touchedFiles.filter((entry) => !entry.includes('*') && !entry.includes('?')).slice(0, 10);
  const commands = task.verificationCommands.length > 0 ? task.verificationCommands : undefined;

  return {
    expectedFiles: [...new Set([...expectedFiles, ...additionalTouched])],
    ...(commands ? { commands } : {}),
  };
}

export async function verifyTaskExecution(input: TaskVerificationInput): Promise<TaskVerificationResult> {
  const raw = await runVerification({
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...fallbackVerificationInput(input.task, input.touchedFiles),
  });
  const passed = raw.status === 'pass' || raw.status === 'warn';
  return {
    passed,
    status: raw.status,
    confidence: raw.confidence,
    summary: summarize(raw),
    raw,
  };
}

