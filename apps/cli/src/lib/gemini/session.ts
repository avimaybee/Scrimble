/**
 * Gemini CLI session control.
 * Manages headless Gemini execution for autonomous task completion.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export interface GeminiSessionConfig {
  /** Gemini CLI path (default: 'gemini') */
  geminiPath?: string;
  /** Approval mode (default: 'yolo') */
  approvalMode?: 'yolo' | 'interactive';
  /** Enable checkpointing (default: true) */
  checkpointing?: boolean;
  /** Output format (default: 'json') */
  outputFormat?: 'json' | 'text';
  /** Working directory */
  cwd?: string;
  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number;
  /** Additional environment variables */
  env?: Record<string, string>;
}

export interface GeminiResponse {
  /** Unique session ID */
  sessionId: string;
  /** Exit code (null if timed out or killed) */
  exitCode: number | null;
  /** Whether the session timed out */
  timedOut: boolean;
  /** Whether the session was killed */
  killed: boolean;
  /** Raw stdout */
  stdout: string;
  /** Raw stderr */
  stderr: string;
  /** Parsed JSON response (if outputFormat is 'json') */
  json: GeminiJsonOutput | null;
  /** Duration in milliseconds */
  durationMs: number;
  /** Timestamp when session started */
  startedAt: string;
  /** Timestamp when session ended */
  endedAt: string;
}

export interface GeminiJsonOutput {
  response?: string;
  stats?: {
    tokensIn?: number;
    tokensOut?: number;
    totalTokens?: number;
    durationMs?: number;
  };
  tools?: {
    name: string;
    count: number;
  }[];
  error?: string;
}

export interface GeminiSession {
  id: string;
  process: ChildProcess;
  config: GeminiSessionConfig;
  startedAt: string;
}

const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const DEFAULT_GEMINI_PATH = 'gemini';

/**
 * Start a headless Gemini session with the given prompt.
 */
export async function runGeminiHeadless(
  prompt: string,
  config: GeminiSessionConfig = {},
): Promise<GeminiResponse> {
  const sessionId = randomUUID();
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const geminiPath = config.geminiPath ?? DEFAULT_GEMINI_PATH;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;
  const approvalMode = config.approvalMode ?? 'yolo';
  const checkpointing = config.checkpointing ?? true;
  const outputFormat = config.outputFormat ?? 'json';
  const cwd = config.cwd ?? process.cwd();

  const args: string[] = [
    '-p',
    prompt,
    `--approval-mode=${approvalMode}`,
    `--output-format=${outputFormat}`,
  ];

  if (checkpointing) {
    args.push('--checkpointing');
  }

  return new Promise<GeminiResponse>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const proc = spawn(geminiPath, args, {
      cwd,
      env: {
        ...process.env,
        ...config.env,
        // Ensure non-interactive mode
        GEMINI_NONINTERACTIVE: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Set up timeout
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
        // Force kill after 5 seconds if still running
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
        }, 5000);
      }, timeout);
    }

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      stderr += `\nProcess error: ${error.message}`;
    });

    proc.on('close', (code, signal) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        killed = true;
      }

      let json: GeminiJsonOutput | null = null;
      if (outputFormat === 'json' && stdout.trim()) {
        try {
          json = parseGeminiJsonOutput(stdout);
        } catch {
          // Failed to parse JSON, leave as null
        }
      }

      resolve({
        sessionId,
        exitCode: code,
        timedOut,
        killed,
        stdout,
        stderr,
        json,
        durationMs,
        startedAt,
        endedAt,
      });
    });
  });
}

/**
 * Parse Gemini JSON output, handling potential multi-line or wrapped formats.
 */
function parseGeminiJsonOutput(raw: string): GeminiJsonOutput | null {
  const trimmed = raw.trim();

  // Try direct parse first
  try {
    return JSON.parse(trimmed) as GeminiJsonOutput;
  } catch {
    // Continue to try other formats
  }

  // Try to find JSON object in output (might have leading text)
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as GeminiJsonOutput;
    } catch {
      // Continue
    }
  }

  // Try NDJSON (take last valid JSON line)
  const lines = trimmed.split('\n').filter((line) => line.trim().startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const line = lines[i];
      if (line) {
        return JSON.parse(line) as GeminiJsonOutput;
      }
    } catch {
      // Try previous line
    }
  }

  return null;
}

/**
 * Build a Gemini prompt for task execution.
 */
export function buildTaskPrompt(options: {
  task: {
    title: string;
    description?: string;
    substeps?: string[];
    phase?: string;
  };
  trackContext: {
    productDescription?: string;
    techStack?: string;
    guidelines?: string;
  };
  doNotTouch?: string[];
  verificationHints?: string[];
  previousAttempt?: {
    summary: string;
    error?: string;
  };
}): string {
  const lines: string[] = [];

  // Task header
  lines.push(`# Task: ${options.task.title}`);
  lines.push('');

  // Phase context
  if (options.task.phase) {
    lines.push(`**Phase:** ${options.task.phase}`);
    lines.push('');
  }

  // Task description
  if (options.task.description) {
    lines.push('## Description');
    lines.push(options.task.description);
    lines.push('');
  }

  // Substeps
  if (options.task.substeps && options.task.substeps.length > 0) {
    lines.push('## Substeps');
    for (const substep of options.task.substeps) {
      lines.push(`- [ ] ${substep}`);
    }
    lines.push('');
  }

  // Track context
  if (options.trackContext.productDescription) {
    lines.push('## Product Context');
    lines.push(options.trackContext.productDescription);
    lines.push('');
  }

  if (options.trackContext.techStack) {
    lines.push('## Tech Stack');
    lines.push(options.trackContext.techStack);
    lines.push('');
  }

  if (options.trackContext.guidelines) {
    lines.push('## Guidelines');
    lines.push(options.trackContext.guidelines);
    lines.push('');
  }

  // Do not touch
  if (options.doNotTouch && options.doNotTouch.length > 0) {
    lines.push('## Do Not Modify');
    lines.push('The following files/patterns should not be modified:');
    for (const pattern of options.doNotTouch) {
      lines.push(`- ${pattern}`);
    }
    lines.push('');
  }

  // Verification hints
  if (options.verificationHints && options.verificationHints.length > 0) {
    lines.push('## Verification');
    lines.push('After completing the task, ensure:');
    for (const hint of options.verificationHints) {
      lines.push(`- ${hint}`);
    }
    lines.push('');
  }

  // Previous attempt context
  if (options.previousAttempt) {
    lines.push('## Previous Attempt');
    lines.push(`Summary: ${options.previousAttempt.summary}`);
    if (options.previousAttempt.error) {
      lines.push(`Error: ${options.previousAttempt.error}`);
    }
    lines.push('');
    lines.push('Please address the issues from the previous attempt and complete the task.');
    lines.push('');
  }

  // Instructions
  lines.push('## Instructions');
  lines.push('1. Analyze the current repository state');
  lines.push('2. Implement the required changes');
  lines.push('3. Verify your changes work correctly');
  lines.push('4. Ensure all tests pass');
  lines.push('');

  return lines.join('\n');
}

/**
 * Check if a Gemini response indicates success.
 */
export function isGeminiSuccess(response: GeminiResponse): boolean {
  // Success: exit code 0, not timed out, not killed, no error in JSON
  if (response.exitCode !== 0) return false;
  if (response.timedOut) return false;
  if (response.killed) return false;
  if (response.json?.error) return false;
  return true;
}

/**
 * Extract error message from Gemini response.
 */
export function getGeminiError(response: GeminiResponse): string | undefined {
  if (response.timedOut) {
    return 'Gemini session timed out';
  }
  if (response.killed) {
    return 'Gemini session was killed';
  }
  if (response.json?.error) {
    return response.json.error;
  }
  if (response.exitCode !== 0) {
    const stderrSummary = response.stderr.trim().slice(0, 500);
    return `Gemini exited with code ${response.exitCode}${stderrSummary ? `: ${stderrSummary}` : ''}`;
  }
  return undefined;
}
