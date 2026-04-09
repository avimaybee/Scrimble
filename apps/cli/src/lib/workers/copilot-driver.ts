import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ContextArtifact,
  ExecutionHandle,
  ExecutionOptions,
  ExecutionResult,
  FailureClassification,
  LedgerState,
  LedgerTask,
  ParsedOutput,
  WorkerCapabilities,
  WorkerDriver,
  WorkerPreflightResult,
} from '@scrimble/shared';
import { readTextIfExists } from '../fs/index.js';
import type { DriverExecutionSession } from './types.js';

interface CopilotDriverOptions {
  cwd?: string;
  copilotPath?: string;
}

const AUTH_CONFIGURED_PATTERN = /logged in|authenticated|authorization successful|active session|token loaded/i;
const AUTH_MISSING_PATTERN =
  /not logged in|not authenticated|authentication required|login required|run\s+[`'"]?copilot\s+login/i;

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

async function resolveWindowsCopilotShim(
  command: string,
  args: string[],
): Promise<{ command: string; args: string[] } | null> {
  if (process.platform !== 'win32' || command !== 'copilot') {
    return null;
  }
  const appData = process.env['APPDATA'];
  if (!appData) {
    return null;
  }
  const loader = path.join(appData, 'npm', 'node_modules', '@github', 'copilot', 'npm-loader.js');
  try {
    await fs.access(loader);
    return {
      command: process.execPath,
      args: [loader, ...args],
    };
  } catch {
    return null;
  }
}

async function execCapture(
  command: string,
  args: string[],
  cwd: string,
  timeout = 10_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const windowsShim = await resolveWindowsCopilotShim(command, args);
  return new Promise((resolve) => {
    const spawnCommand = windowsShim?.command ?? command;
    const spawnArgs = windowsShim?.args ?? args;

    let proc: ChildProcess;
    try {
      proc = spawn(spawnCommand, spawnArgs, {
        cwd,
        timeout,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const err = error as Error;
      resolve({ stdout: '', stderr: err.message, exitCode: 1 });
      return;
    }

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('error', (error) => {
      stderr += `\n${error.message}`;
    });
    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

function combinedOutput(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}\n${result.stderr}`;
}

function resolveCopilotAuthEnvSource(): string | undefined {
  for (const name of ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim().length > 0) {
      return `env:${name}`;
    }
  }
  return undefined;
}

function parseTokenOutput(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim();
  if (!firstLine || firstLine.length < 10) {
    return undefined;
  }
  if (firstLine.toLowerCase().includes('login') || firstLine.toLowerCase().includes('auth')) {
    return undefined;
  }
  return firstLine;
}

async function detectCopilotAuthSource(cwd: string, copilotPath: string): Promise<string | undefined> {
  const envSource = resolveCopilotAuthEnvSource();
  if (envSource) {
    return envSource;
  }

  const copilotTokenCommands: Array<string[]> = [
    ['auth', 'token'],
    ['token'],
  ];
  for (const args of copilotTokenCommands) {
    const result = await execCapture(copilotPath, args, cwd);
    if (result.exitCode === 0 && parseTokenOutput(result.stdout)) {
      return 'copilot_login';
    }
  }

  const ghToken = await execCapture('gh', ['auth', 'token'], cwd);
  if (ghToken.exitCode === 0 && parseTokenOutput(ghToken.stdout)) {
    return 'gh_cli';
  }

  return undefined;
}

export function classifyCopilotAuthProbe(
  probeResult: { stdout: string; stderr: string; exitCode: number },
  authEnvConfigured: boolean,
): { authConfigured: boolean; authMissing: boolean } {
  const probeOutput = combinedOutput(probeResult);
  const authMissing = AUTH_MISSING_PATTERN.test(probeOutput);
  const authConfigured =
    (probeResult.exitCode === 0 && !authMissing) || AUTH_CONFIGURED_PATTERN.test(probeOutput) || authEnvConfigured;
  return { authConfigured, authMissing };
}

export function buildCopilotExecutionArgs(prompt: string): string[] {
  return [
    '-p',
    prompt,
    '--output-format=json',
    '--no-ask-user',
    '--autopilot',
    '--allow-all-tools',
  ];
}

function parseCopilotJsonl(raw: string): ParsedOutput | null {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'));
  if (lines.length === 0) {
    return null;
  }

  const events: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // ignore malformed line
    }
  }

  if (events.length === 0) {
    return null;
  }

  let responseText: string | undefined;
  let errorText: string | undefined;
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;
  let totalTokens: number | undefined;
  const tools = new Map<string, number>();
  const touchedFiles = new Set<string>();

  for (const event of events) {
    const kind = typeof event['type'] === 'string' ? event['type'].toLowerCase() : '';
    if (!responseText) {
      const candidateResponse =
        typeof event['response'] === 'string'
          ? event['response']
          : typeof event['message'] === 'string'
            ? event['message']
            : typeof event['content'] === 'string'
              ? event['content']
              : typeof event['text'] === 'string'
                ? event['text']
                : undefined;
      if (candidateResponse) {
        responseText = candidateResponse;
      }
    }
    if (typeof event['error'] === 'string') {
      errorText = event['error'];
    }

    const usage =
      event['usage'] && typeof event['usage'] === 'object'
        ? (event['usage'] as Record<string, unknown>)
        : null;
    if (usage) {
      tokensIn = readNumber(usage['inputTokens']) ?? readNumber(usage['tokensIn']) ?? tokensIn;
      tokensOut = readNumber(usage['outputTokens']) ?? readNumber(usage['tokensOut']) ?? tokensOut;
      totalTokens = readNumber(usage['totalTokens']) ?? totalTokens;
    }

    const toolName =
      typeof event['tool'] === 'string'
        ? event['tool']
        : typeof event['toolName'] === 'string'
          ? event['toolName']
          : kind.includes('tool')
            ? 'tool'
            : undefined;
    if (toolName) {
      tools.set(toolName, (tools.get(toolName) ?? 0) + 1);
    }

    if (Array.isArray(event['touchedFiles'])) {
      for (const touched of event['touchedFiles']) {
        if (typeof touched === 'string') {
          touchedFiles.add(touched);
        }
      }
    }
  }

  return {
    ...(responseText ? { response: responseText } : {}),
    ...(errorText ? { error: errorText } : {}),
    ...(tokensIn !== undefined || tokensOut !== undefined || totalTokens !== undefined
      ? {
          stats: {
            ...(tokensIn !== undefined ? { tokensIn } : {}),
            ...(tokensOut !== undefined ? { tokensOut } : {}),
            ...(totalTokens !== undefined ? { totalTokens } : {}),
          },
        }
      : {}),
    ...(tools.size > 0
      ? {
          tools: [...tools.entries()].map(([name, count]) => ({ name, count })),
        }
      : {}),
    metadata: {
      events,
      touchedFiles: [...touchedFiles],
    },
  };
}

function touchedFilesFromParsed(parsed: ParsedOutput | null): string[] {
  if (!parsed || !parsed.metadata || typeof parsed.metadata !== 'object') {
    return [];
  }
  const metadata = parsed.metadata as Record<string, unknown>;
  const touched = metadata['touchedFiles'];
  if (!Array.isArray(touched)) {
    return [];
  }
  return touched.filter((entry): entry is string => typeof entry === 'string');
}

export class CopilotDriver implements WorkerDriver {
  readonly kind = 'copilot' as const;
  private readonly cwd: string;
  private readonly copilotPath: string;
  private readonly sessions = new Map<string, DriverExecutionSession>();

  constructor(options: CopilotDriverOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.copilotPath = options.copilotPath ?? 'copilot';
  }

  async preflight(): Promise<WorkerPreflightResult> {
    const [versionResult, helpResult, loginHelpResult] = await Promise.all([
      execCapture(this.copilotPath, ['--version'], this.cwd),
      execCapture(this.copilotPath, ['--help'], this.cwd),
      execCapture(this.copilotPath, ['login', '--help'], this.cwd),
    ]);

    const warnings: string[] = [];
    const errors: string[] = [];
    const cliAvailable = versionResult.exitCode === 0;
    const authSource = await detectCopilotAuthSource(this.cwd, this.copilotPath);
    const authConfigured = Boolean(authSource);
    const available = cliAvailable;
    if (!cliAvailable) {
      errors.push(`Copilot CLI unavailable: ${versionResult.stderr || versionResult.stdout || 'unknown error'}`);
    }
    if (loginHelpResult.exitCode !== 0) {
      warnings.push('Copilot CLI did not expose `copilot login`; auth remediation instructions may vary.');
    }
    if (!authConfigured) {
      warnings.push(
        'Copilot auth readiness could not be confirmed; run `copilot login`, set env token, or use `gh auth login`.',
      );
    }

    const helpOutput = combinedOutput(helpResult);
    if (!helpOutput.includes('--output-format')) {
      warnings.push('Copilot CLI help did not advertise --output-format; JSON parsing may degrade.');
    }
    if (!helpOutput.includes('--no-ask-user')) {
      warnings.push('Copilot CLI help did not advertise --no-ask-user; unattended mode may be limited.');
    }
    if (!helpOutput.includes('--allow-all-tools') && !helpOutput.includes('--allow-all') && !helpOutput.includes('--yolo')) {
      warnings.push('Copilot CLI help did not advertise unattended permission flags; prompt mode may block tool usage.');
    }

    const version = versionResult.stdout.trim() || undefined;
    return {
      worker: 'copilot',
      available,
      cliPath: this.copilotPath,
      ...(version ? { version } : {}),
      authConfigured,
      ...(authSource ? { authSource } : {}),
      capabilities: this.capabilities(),
      warnings,
      errors,
    };
  }

  async discoverContextArtifacts(): Promise<ContextArtifact[]> {
    const candidates: Array<{ relativePath: string; kind: ContextArtifact['kind'] }> = [
      { relativePath: 'AGENTS.md', kind: 'agents_md' },
      { relativePath: '.github/copilot/settings.json', kind: 'copilot_settings' },
      { relativePath: '.github/copilot/settings.local.json', kind: 'copilot_settings_local' },
      { relativePath: '.github/copilot/plan.md', kind: 'copilot_plan' },
      { relativePath: '.github/copilot/plans.md', kind: 'copilot_plan' },
    ];

    const artifacts: ContextArtifact[] = [];
    for (const candidate of candidates) {
      const absolutePath = path.join(this.cwd, candidate.relativePath);
      const content = await readTextIfExists(absolutePath);
      if (!content) {
        continue;
      }

      const maxLength = 20_000;
      const truncated = content.length > maxLength;
      artifacts.push({
        path: candidate.relativePath.replaceAll('\\', '/'),
        kind: candidate.kind,
        content: truncated ? `${content.slice(0, maxLength)}\n...[truncated]` : content,
        truncated,
        relevantTo: 'copilot',
      });
    }

    return artifacts;
  }

  buildPrompt(task: LedgerTask, context: ContextArtifact[], ledgerState: LedgerState): string {
    const lines: string[] = [];
    lines.push(`# Task: ${task.title}`);
    lines.push('');
    lines.push('Objective:');
    lines.push(task.objective);
    lines.push('');
    lines.push('Done Criteria:');
    lines.push(task.doneCriteria);
    lines.push('');
    lines.push('Owned files:');
    lines.push(...task.ownedFiles.map((entry) => `- ${entry}`));
    if (task.verificationCommands.length > 0) {
      lines.push('');
      lines.push('Run these verification commands after edits:');
      lines.push(...task.verificationCommands.map((entry) => `- ${entry}`));
    }
    lines.push('');
    lines.push('Constraints:');
    lines.push('- Do not edit files outside owned files.');
    lines.push('- If additional files are required, stop and report conflict.');
    lines.push('');
    lines.push('Ledger state:');
    lines.push(`- Tasks: ${ledgerState.tasks.tasks.length}`);
    lines.push(`- Active execution: ${ledgerState.runtime.activeExecution?.taskId ?? 'none'}`);

    if (context.length > 0) {
      lines.push('');
      lines.push('Supplemental context:');
      for (const artifact of context) {
        lines.push(`### ${artifact.path}`);
        lines.push(artifact.content);
      }
    }

    lines.push('');
    lines.push('Return:');
    lines.push('1. What changed');
    lines.push('2. Verification command outputs');
    lines.push('3. Exact touched files');
    return lines.join('\n');
  }

  async startExecution(prompt: string, options: ExecutionOptions): Promise<ExecutionHandle> {
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();
    const timeout = options.timeout > 0 ? options.timeout : 300_000;

    const args = buildCopilotExecutionArgs(prompt);

    let settled = false;
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let stdout = '';
    let stderr = '';

    const proc = spawn(this.copilotPath, args, {
      cwd: options.cwd || this.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const completion = new Promise<ExecutionResult>((resolve) => {
      if (timeout > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          proc.kill('SIGTERM');
          setTimeout(() => {
            if (!proc.killed) {
              proc.kill('SIGKILL');
            }
          }, 5000);
        }, timeout);
      }

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (error) => {
        stderr += `\nProcess error: ${error.message}`;
      });

      proc.on('close', (code, signal) => {
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        const parsed = this.parseOutput(stdout);
        const touchedFiles = touchedFilesFromParsed(parsed);
        const killed = signal === 'SIGTERM' || signal === 'SIGKILL';
        const success = code === 0 && !timedOut && !killed && !parsed?.error;

        resolve({
          success,
          exitCode: code,
          stdout,
          stderr,
          touchedFiles,
          parsedOutput: parsed,
          ...(success ? {} : { failureReason: this.classifyFailure({
            success,
            exitCode: code,
            stdout,
            stderr,
            touchedFiles,
            parsedOutput: parsed,
            timedOut,
            killed,
            durationMs: Math.max(Date.now() - new Date(startedAt).getTime(), 0),
          }).message }),
          timedOut,
          killed,
          durationMs: Math.max(Date.now() - new Date(startedAt).getTime(), 0),
        });
      });
    });

    const handle: ExecutionHandle = {
      sessionId,
      worker: this.kind,
      ...(proc.pid ? { pid: proc.pid } : {}),
      startedAt,
      kill: () => {
        if (!settled && !proc.killed) {
          proc.kill('SIGTERM');
        }
      },
      isRunning: () => !settled,
    };

    this.sessions.set(sessionId, {
      handle,
      process: proc as ChildProcess,
      completion,
      options,
    });

    return handle;
  }

  async waitForCompletion(handle: ExecutionHandle): Promise<ExecutionResult> {
    const session = this.sessions.get(handle.sessionId);
    if (!session) {
      throw new Error(`Unknown Copilot session: ${handle.sessionId}`);
    }
    try {
      return await session.completion;
    } finally {
      this.sessions.delete(handle.sessionId);
    }
  }

  parseOutput(raw: string): ParsedOutput | null {
    return parseCopilotJsonl(raw);
  }

  classifyFailure(result: ExecutionResult): FailureClassification {
    if (result.timedOut) {
      return { kind: 'timeout', message: 'Copilot execution timed out', retryable: true };
    }
    if (result.killed) {
      return { kind: 'crash', message: 'Copilot process was terminated', retryable: true };
    }
    const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (output.includes('auth') || output.includes('login')) {
      return { kind: 'auth_error', message: 'Copilot authentication is required', retryable: false };
    }
    if (output.includes('rate limit') || output.includes('429')) {
      return { kind: 'rate_limit', message: 'Copilot rate limit reached', retryable: true, retryDelayMs: 30_000 };
    }
    if (!result.parsedOutput && result.stdout.trim().length > 0) {
      return { kind: 'parse_error', message: 'Failed to parse Copilot JSONL output', retryable: false };
    }
    return {
      kind: 'unknown',
      message: result.failureReason ?? `Copilot exited with code ${result.exitCode ?? -1}`,
      retryable: result.exitCode !== 0,
    };
  }

  async continueExecution(handle: ExecutionHandle, continuationPrompt: string): Promise<ExecutionResult> {
    const session = this.sessions.get(handle.sessionId);
    const options = session?.options ?? {
      timeout: 300_000,
      cwd: this.cwd,
      outputFormat: 'json' as const,
      approvalMode: 'yolo' as const,
      checkpointing: false,
    };
    const continuationHandle = await this.startExecution(continuationPrompt, options);
    return this.waitForCompletion(continuationHandle);
  }

  extractTouchedFiles(result: ExecutionResult): string[] {
    if (result.touchedFiles.length > 0) {
      return result.touchedFiles;
    }
    return touchedFilesFromParsed(result.parsedOutput);
  }

  capabilities(): WorkerCapabilities {
    return {
      supportedTaskTypes: [
        'code_generation',
        'code_modification',
        'code_review',
        'test_generation',
        'documentation',
        'debugging',
      ],
      maxParallelTasks: 1,
      supportsCheckpointing: false,
      supportsContinuation: true,
      supportsJsonOutput: true,
    };
  }
}

