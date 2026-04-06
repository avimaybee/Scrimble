/**
 * Conductor recovery and retry logic.
 * Handles stall detection, retry, and failure recovery.
 */
import type { TaskAttempt, RuntimeState } from '@scrimble/shared';
import type { GeminiResponse } from '../gemini/session.js';

export interface RecoveryDecision {
  action: 'retry' | 'stop' | 'continue';
  reason: string;
  continuationPrompt?: string;
}

export interface RecoveryConfig {
  maxRetries?: number;
  stallThresholdMs?: number;
}

const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_STALL_THRESHOLD_MS = 60_000; // 1 minute with no output

/**
 * Determine recovery action based on task attempt result.
 */
export function determineRecoveryAction(
  response: GeminiResponse,
  attempt: TaskAttempt,
  runtimeState: RuntimeState,
  config: RecoveryConfig = {},
): RecoveryDecision {
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const attemptCount = runtimeState.attemptCount ?? 0;

  // If session was successful, continue to next task
  if (response.exitCode === 0 && !response.timedOut && !response.killed) {
    return {
      action: 'continue',
      reason: 'Task execution completed successfully',
    };
  }

  // Check if we've exceeded retry limit
  if (attemptCount >= maxRetries) {
    return {
      action: 'stop',
      reason: `Maximum retries (${maxRetries}) exceeded`,
    };
  }

  // Determine if we should retry based on failure type
  if (response.timedOut) {
    return {
      action: 'retry',
      reason: 'Session timed out - attempting continuation',
      continuationPrompt: buildContinuationPrompt('timeout', attempt, response),
    };
  }

  if (response.killed) {
    return {
      action: 'retry',
      reason: 'Session was killed - attempting continuation',
      continuationPrompt: buildContinuationPrompt('killed', attempt, response),
    };
  }

  // Check for recoverable error patterns
  const errorType = classifyError(response);
  if (errorType === 'recoverable') {
    return {
      action: 'retry',
      reason: 'Recoverable error detected - attempting retry',
      continuationPrompt: buildContinuationPrompt('error', attempt, response),
    };
  }

  // Non-recoverable error
  return {
    action: 'stop',
    reason: `Non-recoverable error: ${getErrorSummary(response)}`,
  };
}

/**
 * Classify an error as recoverable or non-recoverable.
 */
function classifyError(response: GeminiResponse): 'recoverable' | 'non-recoverable' {
  const stderr = response.stderr.toLowerCase();
  const stdout = response.stdout.toLowerCase();

  // Recoverable patterns
  const recoverablePatterns = [
    'rate limit',
    'timeout',
    'connection reset',
    'network error',
    'temporary failure',
    'try again',
    'service unavailable',
    '503',
    '504',
    'econnreset',
    'etimedout',
  ];

  for (const pattern of recoverablePatterns) {
    if (stderr.includes(pattern) || stdout.includes(pattern)) {
      return 'recoverable';
    }
  }

  // Non-recoverable patterns
  const nonRecoverablePatterns = [
    'authentication failed',
    'permission denied',
    'not found',
    '401',
    '403',
    '404',
    'invalid api key',
    'quota exceeded',
  ];

  for (const pattern of nonRecoverablePatterns) {
    if (stderr.includes(pattern) || stdout.includes(pattern)) {
      return 'non-recoverable';
    }
  }

  // Default to non-recoverable for unknown errors
  return 'non-recoverable';
}

/**
 * Build a continuation prompt for retry attempts.
 */
function buildContinuationPrompt(
  failureType: 'timeout' | 'killed' | 'error',
  attempt: TaskAttempt,
  response: GeminiResponse,
): string {
  const lines: string[] = [];

  lines.push('# Continuation Request');
  lines.push('');
  lines.push('The previous attempt did not complete successfully. Please continue from where you left off.');
  lines.push('');

  // Failure context
  lines.push('## Previous Attempt Status');
  switch (failureType) {
    case 'timeout':
      lines.push('The session timed out before completion.');
      break;
    case 'killed':
      lines.push('The session was terminated before completion.');
      break;
    case 'error':
      lines.push(`The session encountered an error: ${getErrorSummary(response)}`);
      break;
  }
  lines.push('');

  // Task context
  lines.push('## Task');
  lines.push(`Task ID: ${attempt.taskId}`);
  lines.push('');

  // Last output context (if any)
  if (response.json?.response) {
    lines.push('## Last Response');
    const lastResponse = response.json.response.slice(0, 500);
    lines.push(lastResponse);
    if (response.json.response.length > 500) {
      lines.push('...[truncated]');
    }
    lines.push('');
  }

  // Instructions
  lines.push('## Instructions');
  lines.push('1. Review the current state of the repository');
  lines.push('2. Identify what work was completed in the previous attempt');
  lines.push('3. Continue from where you left off');
  lines.push('4. Complete the remaining work');
  lines.push('5. Verify your changes work correctly');
  lines.push('');

  return lines.join('\n');
}

/**
 * Get a summary of the error from a Gemini response.
 */
function getErrorSummary(response: GeminiResponse): string {
  if (response.json?.error) {
    return response.json.error;
  }

  if (response.stderr.trim()) {
    return response.stderr.trim().slice(0, 200);
  }

  if (response.exitCode !== 0) {
    return `Exit code ${response.exitCode}`;
  }

  return 'Unknown error';
}

/**
 * Check if a task attempt is stalled (no output for threshold period).
 */
export function isStalled(
  lastOutputAt: string | null,
  config: RecoveryConfig = {},
): boolean {
  if (!lastOutputAt) {
    return false;
  }

  const stallThresholdMs = config.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
  const lastOutputTime = new Date(lastOutputAt).getTime();
  const now = Date.now();

  return now - lastOutputTime > stallThresholdMs;
}

/**
 * Build a summary of a failed task attempt for logging/display.
 */
export function buildAttemptSummary(
  attempt: TaskAttempt,
  response: GeminiResponse,
  decision: RecoveryDecision,
): string {
  const lines: string[] = [];

  lines.push(`Attempt for task ${attempt.taskId}`);
  lines.push(`  Stalled: ${attempt.stalled}`);
  lines.push(`  Duration: ${response.durationMs}ms`);

  if (response.timedOut) {
    lines.push('  Result: Timed out');
  } else if (response.killed) {
    lines.push('  Result: Killed');
  } else if (response.exitCode !== 0) {
    lines.push(`  Result: Exit code ${response.exitCode}`);
  } else {
    lines.push('  Result: Success');
  }

  lines.push(`  Recovery: ${decision.action} - ${decision.reason}`);

  if (response.json?.stats) {
    const stats = response.json.stats;
    lines.push(`  Tokens: ${stats.tokensIn ?? 0} in, ${stats.tokensOut ?? 0} out`);
  }

  return lines.join('\n');
}
