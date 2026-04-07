import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import {
  CONDUCTOR_DIR,
  CONDUCTOR_GUIDELINES_FILE,
  CONDUCTOR_PRODUCT_FILE,
  CONDUCTOR_TECH_STACK_FILE,
  CONDUCTOR_TRACKS_FILE,
} from '@scrimble/shared';
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
import { detectGemini, detectHeadlessAuth } from '../gemini/preflight.js';
import type { DriverExecutionSession } from './types.js';

interface GeminiDriverOptions {
  cwd?: string;
  geminiPath?: string;
}

const CHECKPOINTING_FLAG = '--checkpointing';

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

async function execCapture(
  command: string,
  args: string[],
  cwd: string,
  timeout = 10_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      shell: true,
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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

export function buildGeminiExecutionArgs(
  prompt: string,
  options: Pick<ExecutionOptions, 'approvalMode' | 'outputFormat' | 'checkpointing'>,
  checkpointingSupported: boolean,
): string[] {
  const args: string[] = [
    '-p',
    prompt,
    `--approval-mode=${options.approvalMode ?? 'yolo'}`,
    `--output-format=${options.outputFormat ?? 'json'}`,
  ];

  if (options.checkpointing !== false && checkpointingSupported) {
    args.push(CHECKPOINTING_FLAG);
  }

  return args;
}

function parseJsonObject(raw: string): ParsedOutput | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = [
    trimmed,
    ...trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{')),
  ];

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (!candidate) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const rawStats =
        parsed['stats'] && typeof parsed['stats'] === 'object'
          ? (parsed['stats'] as Record<string, unknown>)
          : undefined;
      const rawTools = Array.isArray(parsed['tools']) ? parsed['tools'] : [];
      const tokensIn = rawStats ? readNumber(rawStats['tokensIn']) : undefined;
      const tokensOut = rawStats ? readNumber(rawStats['tokensOut']) : undefined;
      const totalTokens = rawStats ? readNumber(rawStats['totalTokens']) : undefined;
      const durationMs = rawStats ? readNumber(rawStats['durationMs']) : undefined;
      return {
        ...(typeof parsed['response'] === 'string' ? { response: parsed['response'] } : {}),
        ...(typeof parsed['error'] === 'string' ? { error: parsed['error'] } : {}),
        ...(rawStats
          ? {
              stats: {
                ...(tokensIn !== undefined ? { tokensIn } : {}),
                ...(tokensOut !== undefined ? { tokensOut } : {}),
                ...(totalTokens !== undefined ? { totalTokens } : {}),
                ...(durationMs !== undefined ? { durationMs } : {}),
              },
            }
          : {}),
        ...(rawTools.length > 0
          ? {
              tools: rawTools
                .map((tool) => {
                  if (!tool || typeof tool !== 'object') {
                    return null;
                  }
                  const candidateTool = tool as Record<string, unknown>;
                  if (typeof candidateTool['name'] !== 'string') {
                    return null;
                  }
                  const count = readNumber(candidateTool['count']);
                  return {
                    name: candidateTool['name'],
                    count: count ?? 1,
                  };
                })
                .filter((tool): tool is { name: string; count: number } => tool !== null),
            }
          : {}),
        metadata: parsed,
      };
    } catch {
      // continue
    }
  }

  return null;
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

export class GeminiDriver implements WorkerDriver {
  readonly kind = 'gemini' as const;
  private readonly cwd: string;
  private readonly geminiPath: string;
  private readonly sessions = new Map<string, DriverExecutionSession>();
  private checkpointingSupported = true;
  private checkpointingProbed = false;

  constructor(options: GeminiDriverOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.geminiPath = options.geminiPath ?? 'gemini';
  }

  private async resolveCheckpointingSupport(): Promise<boolean> {
    if (this.checkpointingProbed) {
      return this.checkpointingSupported;
    }

    const helpResult = await execCapture(this.geminiPath, ['--help'], this.cwd);
    const helpOutput = `${helpResult.stdout}\n${helpResult.stderr}`;
    this.checkpointingSupported = helpResult.exitCode === 0 && helpOutput.includes(CHECKPOINTING_FLAG);
    this.checkpointingProbed = true;
    return this.checkpointingSupported;
  }

  async preflight(): Promise<WorkerPreflightResult> {
    const [gemini, auth] = await Promise.all([detectGemini(), detectHeadlessAuth()]);
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!gemini.available) {
      errors.push(gemini.error ?? 'Gemini CLI is unavailable');
    }
    if (!auth.available) {
      errors.push(auth.error ?? 'Gemini auth is not configured');
    }

    if (gemini.available && gemini.path !== this.geminiPath) {
      warnings.push(`Configured path "${this.geminiPath}" differs from detected path "${gemini.path}".`);
    }
    if (gemini.available) {
      const checkpointingSupported = await this.resolveCheckpointingSupport();
      if (!checkpointingSupported) {
        warnings.push('Gemini CLI help did not advertise --checkpointing; running without checkpointing flag.');
      }
    }

    return {
      worker: 'gemini',
      available: gemini.available && auth.available,
      ...(gemini.path ? { cliPath: gemini.path } : {}),
      ...(gemini.version ? { version: gemini.version } : {}),
      authConfigured: auth.available,
      capabilities: this.capabilities(),
      warnings,
      errors,
    };
  }

  async discoverContextArtifacts(): Promise<ContextArtifact[]> {
    const candidates: Array<{ relativePath: string; kind: ContextArtifact['kind'] }> = [
      { relativePath: 'GEMINI.md', kind: 'gemini_md' },
      { relativePath: path.join(CONDUCTOR_DIR, CONDUCTOR_PRODUCT_FILE), kind: 'conductor_product' },
      { relativePath: path.join(CONDUCTOR_DIR, CONDUCTOR_GUIDELINES_FILE), kind: 'conductor_guidelines' },
      { relativePath: path.join(CONDUCTOR_DIR, CONDUCTOR_TECH_STACK_FILE), kind: 'conductor_tech_stack' },
      { relativePath: path.join(CONDUCTOR_DIR, CONDUCTOR_TRACKS_FILE), kind: 'conductor_tracks' },
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
        relevantTo: 'gemini',
      });
    }

    return artifacts;
  }

  buildPrompt(task: LedgerTask, context: ContextArtifact[], ledgerState: LedgerState): string {
    const lines: string[] = [];
    lines.push(`# Task: ${task.title}`);
    lines.push('');
    lines.push('## Objective');
    lines.push(task.objective);
    lines.push('');
    lines.push('## Done Criteria');
    lines.push(task.doneCriteria);
    lines.push('');
    lines.push('## Owned Files');
    lines.push(...task.ownedFiles.map((entry) => `- ${entry}`));
    if (task.allowedFiles.length > 0) {
      lines.push('');
      lines.push('## Allowed Read-Only Files');
      lines.push(...task.allowedFiles.map((entry) => `- ${entry}`));
    }
    if (task.verificationCommands.length > 0) {
      lines.push('');
      lines.push('## Verification Commands');
      lines.push(...task.verificationCommands.map((entry) => `- ${entry}`));
    }
    lines.push('');
    lines.push('## Constraints');
    lines.push('- Modify only owned files.');
    lines.push('- Stop and report if you need files outside the lease.');
    lines.push('');
    lines.push('## Ledger Context');
    lines.push(`- Total tasks: ${ledgerState.tasks.tasks.length}`);
    lines.push(`- Active assignments: ${ledgerState.assignments.assignments.length}`);
    lines.push(`- Active file leases: ${ledgerState.fileLeases.leases.length}`);

    if (context.length > 0) {
      lines.push('');
      lines.push('## Supplemental Context');
      for (const artifact of context) {
        lines.push(`### ${artifact.path}`);
        lines.push(artifact.content);
        lines.push('');
      }
    }

    lines.push('## Instructions');
    lines.push('1. Implement only what is needed for this task.');
    lines.push('2. Keep changes minimal and focused.');
    lines.push('3. Return a concise summary of touched files and outcome.');

    return lines.join('\n');
  }

  async startExecution(prompt: string, options: ExecutionOptions): Promise<ExecutionHandle> {
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();
    const timeout = options.timeout > 0 ? options.timeout : 300_000;
    const checkpointingSupported = await this.resolveCheckpointingSupport();
    const args = buildGeminiExecutionArgs(prompt, options, checkpointingSupported);

    let settled = false;
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let stdout = '';
    let stderr = '';

    const proc = spawn(this.geminiPath, args, {
      cwd: options.cwd || this.cwd,
      env: {
        ...process.env,
        ...options.env,
        GEMINI_NONINTERACTIVE: '1',
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
      throw new Error(`Unknown Gemini session: ${handle.sessionId}`);
    }
    try {
      return await session.completion;
    } finally {
      this.sessions.delete(handle.sessionId);
    }
  }

  parseOutput(raw: string): ParsedOutput | null {
    return parseJsonObject(raw);
  }

  classifyFailure(result: ExecutionResult): FailureClassification {
    if (result.timedOut) {
      return { kind: 'timeout', message: 'Gemini execution timed out', retryable: true };
    }
    if (result.killed) {
      return { kind: 'crash', message: 'Gemini process was terminated', retryable: true };
    }
    const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (output.includes('auth') || output.includes('login')) {
      return { kind: 'auth_error', message: 'Gemini authentication is required', retryable: false };
    }
    if (output.includes('rate limit') || output.includes('429')) {
      return { kind: 'rate_limit', message: 'Gemini rate limit reached', retryable: true, retryDelayMs: 30_000 };
    }
    if (result.parsedOutput?.error) {
      return {
        kind: 'unknown',
        message: result.parsedOutput.error,
        retryable: false,
      };
    }
    return {
      kind: 'unknown',
      message: result.failureReason ?? `Gemini exited with code ${result.exitCode ?? -1}`,
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
      checkpointing: true,
    };
    const continuationHandle = await this.startExecution(continuationPrompt, options);
    return this.waitForCompletion(continuationHandle);
  }

  extractTouchedFiles(result: ExecutionResult): string[] {
    if (result.touchedFiles.length > 0) {
      return result.touchedFiles;
    }
    const parsedTouched = touchedFilesFromParsed(result.parsedOutput);
    return parsedTouched;
  }

  capabilities(): WorkerCapabilities {
    return {
      supportedTaskTypes: [
        'code_generation',
        'code_modification',
        'test_generation',
        'refactoring',
        'debugging',
        'documentation',
      ],
      maxParallelTasks: 1,
      supportsCheckpointing: this.checkpointingSupported,
      supportsContinuation: true,
      supportsJsonOutput: true,
    };
  }
}

