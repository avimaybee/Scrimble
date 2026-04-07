import type { LedgerTask, VerificationResult, VerificationStatus } from '@scrimble/shared';
import { runVerification, type VerificationInput } from '../verify/engine.js';

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

