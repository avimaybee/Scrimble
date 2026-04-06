/**
 * Scrimble runtime state management.
 * Manages .scrimble/runtime/ directory for execution state, approvals, and events.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  SCRIMBLE_DIR,
  RUNTIME_DIR,
  RUNTIME_STATE_FILE,
  RUNTIME_APPROVALS_FILE,
  RUNTIME_EVENTS_FILE,
  RUNTIME_ATTEMPTS_DIR,
} from '@scrimble/shared';
import type {
  RuntimeState,
  RunStatus,
  ApprovalsState,
  TrackApproval,
  RuntimeEvent,
  RuntimeEventType,
  TaskAttempt,
} from '@scrimble/shared';

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/** Get runtime directory paths. */
export function getRuntimePaths(cwd: string = process.cwd()) {
  const scrimbleDir = path.join(cwd, SCRIMBLE_DIR);
  const runtimeDir = path.join(scrimbleDir, RUNTIME_DIR);
  return {
    root: runtimeDir,
    state: path.join(runtimeDir, RUNTIME_STATE_FILE),
    approvals: path.join(runtimeDir, RUNTIME_APPROVALS_FILE),
    events: path.join(runtimeDir, RUNTIME_EVENTS_FILE),
    attempts: path.join(runtimeDir, RUNTIME_ATTEMPTS_DIR),
  };
}

/** Ensure runtime directories exist. */
export async function ensureRuntimeDirs(cwd: string = process.cwd()): Promise<void> {
  const paths = getRuntimePaths(cwd);
  await fs.mkdir(paths.root, { recursive: true });
  await fs.mkdir(paths.attempts, { recursive: true });
}

// --- Runtime State ---

const DEFAULT_RUNTIME_STATE: RuntimeState = {
  status: 'idle',
  attemptCount: 0,
  lastActivityAt: new Date().toISOString(),
};

/** Load current runtime state. */
export async function loadRuntimeState(cwd: string = process.cwd()): Promise<RuntimeState> {
  const paths = getRuntimePaths(cwd);
  try {
    const content = await fs.readFile(paths.state, 'utf8');
    return { ...DEFAULT_RUNTIME_STATE, ...JSON.parse(content) } as RuntimeState;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return DEFAULT_RUNTIME_STATE;
    }
    throw error;
  }
}

/** Save runtime state. */
export async function saveRuntimeState(
  state: RuntimeState,
  cwd: string = process.cwd(),
): Promise<void> {
  await ensureRuntimeDirs(cwd);
  const paths = getRuntimePaths(cwd);
  await fs.writeFile(paths.state, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/** Update runtime state with partial changes. */
export async function updateRuntimeState(
  updates: Partial<RuntimeState>,
  cwd: string = process.cwd(),
): Promise<RuntimeState> {
  const current = await loadRuntimeState(cwd);
  const updated: RuntimeState = {
    ...current,
    ...updates,
    lastActivityAt: new Date().toISOString(),
  };
  await saveRuntimeState(updated, cwd);
  return updated;
}

/** Set run status and optionally track/task. */
export async function setRunStatus(
  status: RunStatus,
  options: {
    trackId?: string;
    taskId?: string;
    error?: string;
    cwd?: string;
  } = {},
): Promise<RuntimeState> {
  const updates: Partial<RuntimeState> = { status };

  if (options.trackId !== undefined) {
    updates.activeTrackId = options.trackId;
  }
  if (options.taskId !== undefined) {
    updates.activeTaskId = options.taskId;
  }
  if (options.error !== undefined) {
    updates.error = options.error;
  }

  // Set timestamps based on status
  const now = new Date().toISOString();
  if (status === 'running' || status === 'bootstrapping') {
    updates.startedAt = now;
    delete updates.completedAt;
    delete updates.error;
  } else if (status === 'completed' || status === 'failed') {
    updates.completedAt = now;
  }

  return updateRuntimeState(updates, options.cwd);
}

// --- Approvals ---

const DEFAULT_APPROVALS: ApprovalsState = { approvals: [] };

/** Load track approvals. */
export async function loadApprovals(cwd: string = process.cwd()): Promise<ApprovalsState> {
  const paths = getRuntimePaths(cwd);
  try {
    const content = await fs.readFile(paths.approvals, 'utf8');
    return { ...DEFAULT_APPROVALS, ...JSON.parse(content) } as ApprovalsState;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return DEFAULT_APPROVALS;
    }
    throw error;
  }
}

/** Save track approvals. */
export async function saveApprovals(
  state: ApprovalsState,
  cwd: string = process.cwd(),
): Promise<void> {
  await ensureRuntimeDirs(cwd);
  const paths = getRuntimePaths(cwd);
  await fs.writeFile(paths.approvals, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/** Check if a track is approved for autonomous execution. */
export async function isTrackApproved(
  trackId: string,
  cwd: string = process.cwd(),
): Promise<boolean> {
  const state = await loadApprovals(cwd);
  return state.approvals.some((a) => a.trackId === trackId);
}

/** Approve a track for autonomous execution. */
export async function approveTrack(
  trackId: string,
  options: { approvedBy?: string; scope?: 'full' | 'current_phase'; cwd?: string } = {},
): Promise<TrackApproval> {
  const cwd = options.cwd ?? process.cwd();
  const state = await loadApprovals(cwd);

  // Remove existing approval for this track
  state.approvals = state.approvals.filter((a) => a.trackId !== trackId);

  const approval: TrackApproval = {
    trackId,
    approvedAt: new Date().toISOString(),
    ...(options.approvedBy ? { approvedBy: options.approvedBy } : {}),
    scope: options.scope ?? 'full',
  };

  state.approvals.push(approval);
  await saveApprovals(state, cwd);

  // Emit approval event
  await appendRuntimeEvent('track_approved', { trackId, scope: approval.scope }, cwd);

  return approval;
}

/** Revoke approval for a track. */
export async function revokeTrackApproval(
  trackId: string,
  cwd: string = process.cwd(),
): Promise<void> {
  const state = await loadApprovals(cwd);
  state.approvals = state.approvals.filter((a) => a.trackId !== trackId);
  await saveApprovals(state, cwd);
}

// --- Events ---

/** Append a runtime event to the events log. */
export async function appendRuntimeEvent(
  type: RuntimeEventType,
  data: Record<string, unknown> = {},
  cwd: string = process.cwd(),
): Promise<RuntimeEvent> {
  await ensureRuntimeDirs(cwd);
  const paths = getRuntimePaths(cwd);

  const event: RuntimeEvent = {
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    data,
  };

  await fs.appendFile(paths.events, JSON.stringify(event) + '\n', 'utf8');
  return event;
}

/** Read runtime events, optionally filtered by type and limit. */
export async function readRuntimeEvents(
  options: { limit?: number; types?: RuntimeEventType[]; since?: string; cwd?: string } = {},
): Promise<RuntimeEvent[]> {
  const cwd = options.cwd ?? process.cwd();
  const paths = getRuntimePaths(cwd);

  try {
    const content = await fs.readFile(paths.events, 'utf8');
    let events = content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as RuntimeEvent);

    // Filter by type
    if (options.types && options.types.length > 0) {
      events = events.filter((e) => options.types?.includes(e.type));
    }

    // Filter by timestamp
    if (options.since) {
      events = events.filter((e) => e.timestamp >= options.since!);
    }

    // Sort by timestamp descending (newest first)
    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // Limit
    if (options.limit && options.limit > 0) {
      events = events.slice(0, options.limit);
    }

    return events;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// --- Attempts ---

/** Save a task attempt. */
export async function saveTaskAttempt(
  attempt: TaskAttempt,
  cwd: string = process.cwd(),
): Promise<void> {
  await ensureRuntimeDirs(cwd);
  const paths = getRuntimePaths(cwd);
  const attemptPath = path.join(paths.attempts, `${attempt.id}.json`);
  await fs.writeFile(attemptPath, JSON.stringify(attempt, null, 2) + '\n', 'utf8');
}

/** Load a specific task attempt. */
export async function loadTaskAttempt(
  attemptId: string,
  cwd: string = process.cwd(),
): Promise<TaskAttempt | null> {
  const paths = getRuntimePaths(cwd);
  const attemptPath = path.join(paths.attempts, `${attemptId}.json`);
  try {
    const content = await fs.readFile(attemptPath, 'utf8');
    return JSON.parse(content) as TaskAttempt;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/** List all attempts for a task. */
export async function listTaskAttempts(
  taskId: string,
  cwd: string = process.cwd(),
): Promise<TaskAttempt[]> {
  const paths = getRuntimePaths(cwd);
  try {
    const entries = await fs.readdir(paths.attempts);
    const attempts: TaskAttempt[] = [];

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const attemptPath = path.join(paths.attempts, entry);
      const content = await fs.readFile(attemptPath, 'utf8');
      const attempt = JSON.parse(content) as TaskAttempt;
      if (attempt.taskId === taskId) {
        attempts.push(attempt);
      }
    }

    // Sort by startedAt ascending
    attempts.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    return attempts;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/** Create a new task attempt. */
export async function createTaskAttempt(
  taskId: string,
  trackId: string,
  promptHash: string,
  cwd: string = process.cwd(),
): Promise<TaskAttempt> {
  const attempt: TaskAttempt = {
    id: randomUUID(),
    taskId,
    trackId,
    startedAt: new Date().toISOString(),
    stalled: false,
    promptHash,
  };

  await saveTaskAttempt(attempt, cwd);

  // Update runtime state
  await updateRuntimeState(
    {
      lastAttemptId: attempt.id,
      attemptCount: (await loadRuntimeState(cwd)).attemptCount + 1,
    },
    cwd,
  );

  // Emit event
  await appendRuntimeEvent('task_started', { taskId, trackId, attemptId: attempt.id }, cwd);

  return attempt;
}

/** Mark an attempt as completed. */
export async function completeTaskAttempt(
  attemptId: string,
  result: { exitCode: number; verificationResult?: 'pass' | 'fail' | 'skipped'; outputPath?: string },
  cwd: string = process.cwd(),
): Promise<TaskAttempt> {
  const attempt = await loadTaskAttempt(attemptId, cwd);
  if (!attempt) {
    throw new Error(`Attempt not found: ${attemptId}`);
  }

  const updated: TaskAttempt = {
    ...attempt,
    completedAt: new Date().toISOString(),
    exitCode: result.exitCode,
    ...(result.verificationResult ? { verificationResult: result.verificationResult } : {}),
    ...(result.outputPath ? { outputPath: result.outputPath } : {}),
  };

  await saveTaskAttempt(updated, cwd);

  // Emit appropriate event
  if (result.verificationResult === 'pass') {
    await appendRuntimeEvent(
      'task_completed',
      { taskId: attempt.taskId, attemptId, exitCode: result.exitCode },
      cwd,
    );
  } else if (result.verificationResult === 'fail') {
    await appendRuntimeEvent(
      'verification_failed',
      { taskId: attempt.taskId, attemptId, exitCode: result.exitCode },
      cwd,
    );
  }

  return updated;
}

/** Mark an attempt as stalled. */
export async function markAttemptStalled(
  attemptId: string,
  cwd: string = process.cwd(),
): Promise<TaskAttempt> {
  const attempt = await loadTaskAttempt(attemptId, cwd);
  if (!attempt) {
    throw new Error(`Attempt not found: ${attemptId}`);
  }

  const updated: TaskAttempt = {
    ...attempt,
    stalled: true,
  };

  await saveTaskAttempt(updated, cwd);
  await appendRuntimeEvent('task_stalled', { taskId: attempt.taskId, attemptId }, cwd);

  return updated;
}
