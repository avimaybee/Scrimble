/**
 * Conductor verification adapter.
 * Adapts existing verification logic to Conductor task model.
 */
import { spawn } from 'node:child_process';
import type { ConductorTask } from '@scrimble/shared';

export interface VerificationResult {
  passed: boolean;
  checks: VerificationCheck[];
  summary: string;
  durationMs: number;
  timestamp: string;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

export interface VerificationConfig {
  cwd?: string;
  timeout?: number; // Per-check timeout in ms
}

const DEFAULT_TIMEOUT = 60_000; // 1 minute per check

/**
 * Run verification for a Conductor task.
 */
export async function verifyTask(
  task: ConductorTask,
  config: VerificationConfig = {},
): Promise<VerificationResult> {
  const startMs = Date.now();
  const timestamp = new Date().toISOString();
  const cwd = config.cwd ?? process.cwd();
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  const checks: VerificationCheck[] = [];

  // Extract verification hints from task
  const hints = extractVerificationHints(task);

  if (hints.length === 0) {
    // No verification hints, run default checks
    const defaultChecks = await runDefaultChecks(cwd, timeout);
    checks.push(...defaultChecks);
  } else {
    // Run each verification hint as a check
    for (const hint of hints) {
      const check = await runVerificationCheck(hint, cwd, timeout);
      checks.push(check);
    }
  }

  const passed = checks.every((c) => c.passed);
  const passedCount = checks.filter((c) => c.passed).length;
  const summary = `${passedCount}/${checks.length} checks passed`;

  return {
    passed,
    checks,
    summary,
    durationMs: Date.now() - startMs,
    timestamp,
  };
}

/**
 * Extract verification hints from a Conductor task.
 */
function extractVerificationHints(task: ConductorTask): string[] {
  const hints: string[] = [];

  // Check substeps for verification-like items
  for (const substep of task.substeps) {
    const lower = substep.text.toLowerCase();
    if (
      lower.includes('test') ||
      lower.includes('verify') ||
      lower.includes('check') ||
      lower.includes('lint') ||
      lower.includes('build') ||
      lower.includes('run ')
    ) {
      // Extract command if present
      const command = extractCommand(substep.text);
      if (command) {
        hints.push(command);
      }
    }
  }

  // Check task description for commands
  if (task.rawMarkdown) {
    const codeBlocks = extractCodeBlocks(task.rawMarkdown);
    for (const block of codeBlocks) {
      if (isVerificationCommand(block)) {
        hints.push(block);
      }
    }
  }

  return hints;
}

/**
 * Extract a command from a verification hint text.
 */
function extractCommand(text: string): string | null {
  // Look for backtick-wrapped commands
  const backtickMatch = text.match(/`([^`]+)`/);
  if (backtickMatch) {
    const cmd = backtickMatch[1];
    if (cmd) return cmd;
  }

  // Look for common command patterns
  const patterns = [
    /(?:run|execute|verify with|check with|test with)\s+[`']?([a-z0-9_-]+(?:\s+[a-z0-9_-]+)*)[`']?/i,
    /(npm\s+(?:run\s+)?(?:test|lint|build|check))/i,
    /(pnpm\s+(?:run\s+)?(?:test|lint|build|check))/i,
    /(yarn\s+(?:run\s+)?(?:test|lint|build|check))/i,
    /(go\s+(?:test|build|vet)(?:\s+\.\/\.\.\.)?)/i,
    /(cargo\s+(?:test|build|clippy))/i,
    /(pytest|python\s+-m\s+pytest)/i,
    /(jest|vitest|mocha)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const cmd = match[1];
      if (cmd) return cmd;
    }
  }

  return null;
}

/**
 * Extract code blocks from markdown.
 */
function extractCodeBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:bash|sh|shell|console)?\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const block = match[1]?.trim();
    if (block) {
      blocks.push(block);
    }
  }
  return blocks;
}

/**
 * Check if a code block looks like a verification command.
 */
function isVerificationCommand(block: string): boolean {
  const lower = block.toLowerCase();
  return (
    lower.includes('test') ||
    lower.includes('lint') ||
    lower.includes('build') ||
    lower.includes('check') ||
    lower.includes('verify')
  );
}

/**
 * Run default verification checks.
 */
async function runDefaultChecks(cwd: string, timeout: number): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = [];

  // Try to detect and run appropriate default checks based on project type

  // Check for package.json (Node.js project)
  const npmChecks = ['npm run lint', 'npm run build', 'npm test'];
  const pnpmChecks = ['pnpm run lint', 'pnpm run build', 'pnpm test'];

  // Try pnpm first (common in modern projects)
  for (const cmd of pnpmChecks) {
    const check = await runVerificationCheck(cmd, cwd, timeout);
    // If pnpm doesn't exist, stop trying pnpm commands
    if (check.error?.includes('command not found') || check.error?.includes('not recognized')) {
      break;
    }
    checks.push(check);
    // Stop on first failure
    if (!check.passed) break;
  }

  // If no checks ran or pnpm not available, try npm
  if (checks.length === 0) {
    for (const cmd of npmChecks) {
      const check = await runVerificationCheck(cmd, cwd, timeout);
      checks.push(check);
      if (!check.passed) break;
    }
  }

  return checks;
}

/**
 * Run a single verification check.
 */
async function runVerificationCheck(
  command: string,
  cwd: string,
  timeout: number,
): Promise<VerificationCheck> {
  const startMs = Date.now();

  return new Promise<VerificationCheck>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Parse command into executable and args
    const parts = command.split(/\s+/);
    const executable = parts[0] || '';
    const args = parts.slice(1);

    const proc = spawn(executable, args, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);
    }, timeout);

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      stderr += `\nProcess error: ${error.message}`;
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);

      const durationMs = Date.now() - startMs;
      const passed = code === 0 && !timedOut;

      let errorMessage: string | undefined;
      if (timedOut) {
        errorMessage = `Check timed out after ${timeout}ms`;
      } else if (code !== 0) {
        errorMessage = stderr.trim().slice(0, 500) || `Exit code ${code}`;
      }

      resolve({
        name: command,
        passed,
        output: stdout.trim().slice(0, 1000),
        ...(errorMessage ? { error: errorMessage } : {}),
        durationMs,
      });
    });
  });
}

/**
 * Format verification result for display.
 */
export function formatVerificationResult(result: VerificationResult): string {
  const lines: string[] = [];

  const icon = result.passed ? '✓' : '✗';
  lines.push(`${icon} Verification ${result.passed ? 'passed' : 'failed'} (${result.summary})`);
  lines.push('');

  for (const check of result.checks) {
    const checkIcon = check.passed ? '✓' : '✗';
    lines.push(`  ${checkIcon} ${check.name} (${check.durationMs}ms)`);
    if (check.error) {
      lines.push(`    Error: ${check.error}`);
    }
  }

  lines.push('');
  lines.push(`Duration: ${result.durationMs}ms`);

  return lines.join('\n');
}
