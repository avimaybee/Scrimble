import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LedgerEvent, LedgerEventType, TaskExecutionRecord, WorkerKind } from '@scrimble/shared';
import { ensureLedgerDirs, getLedgerPaths, writeJsonAtomic } from './storage.js';

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function appendLedgerEvent(
  type: LedgerEventType,
  data: Record<string, unknown> = {},
  cwd: string = process.cwd(),
): Promise<LedgerEvent> {
  await ensureLedgerDirs(cwd);
  const paths = getLedgerPaths(cwd);

  const event: LedgerEvent = {
    id: randomUUID(),
    type,
    timestamp: nowIso(),
    data,
  };

  await fs.appendFile(paths.events, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

export async function readLedgerEvents(options: {
  limit?: number;
  types?: LedgerEventType[];
  since?: string;
  cwd?: string;
} = {}): Promise<LedgerEvent[]> {
  const cwd = options.cwd ?? process.cwd();
  const paths = getLedgerPaths(cwd);

  try {
    const content = await fs.readFile(paths.events, 'utf8');
    let events = content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as LedgerEvent);

    if (options.types && options.types.length > 0) {
      const typeSet = new Set(options.types);
      events = events.filter((event) => typeSet.has(event.type));
    }

    if (options.since) {
      events = events.filter((event) => event.timestamp >= options.since!);
    }

    events.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    if (options.limit && options.limit > 0) {
      return events.slice(0, options.limit);
    }
    return events;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function saveExecutionRecord(
  record: TaskExecutionRecord,
  cwd: string = process.cwd(),
): Promise<void> {
  await ensureLedgerDirs(cwd);
  const paths = getLedgerPaths(cwd);
  const recordPath = path.join(paths.attempts, `${record.attemptId}.json`);
  await writeJsonAtomic(recordPath, record);
}

export async function loadExecutionRecord(
  attemptId: string,
  cwd: string = process.cwd(),
): Promise<TaskExecutionRecord | null> {
  const paths = getLedgerPaths(cwd);
  const recordPath = path.join(paths.attempts, `${attemptId}.json`);
  try {
    const content = await fs.readFile(recordPath, 'utf8');
    return JSON.parse(content) as TaskExecutionRecord;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function listExecutionRecords(options: {
  taskId?: string;
  worker?: WorkerKind;
  limit?: number;
  cwd?: string;
} = {}): Promise<TaskExecutionRecord[]> {
  const cwd = options.cwd ?? process.cwd();
  const paths = getLedgerPaths(cwd);

  try {
    const entries = await fs.readdir(paths.attempts);
    const records: TaskExecutionRecord[] = [];

    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      const recordPath = path.join(paths.attempts, entry);
      const content = await fs.readFile(recordPath, 'utf8');
      const record = JSON.parse(content) as TaskExecutionRecord;

      if (options.taskId && record.taskId !== options.taskId) {
        continue;
      }
      if (options.worker && record.worker !== options.worker) {
        continue;
      }
      records.push(record);
    }

    records.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    if (options.limit && options.limit > 0) {
      return records.slice(0, options.limit);
    }
    return records;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function startExecutionRecord(
  input: {
    taskId: string;
    worker: WorkerKind;
    promptHash: string;
  },
  cwd: string = process.cwd(),
): Promise<TaskExecutionRecord> {
  const startedAt = nowIso();
  const record: TaskExecutionRecord = {
    attemptId: randomUUID(),
    taskId: input.taskId,
    worker: input.worker,
    promptHash: input.promptHash,
    startedAt,
    endedAt: startedAt,
    exitCode: null,
    stdout: '',
    stderr: '',
    touchedFiles: [],
    verificationResult: 'skipped',
    timedOut: false,
    stalled: false,
    durationMs: 0,
  };

  await saveExecutionRecord(record, cwd);
  await appendLedgerEvent('task_started', {
    taskId: input.taskId,
    attemptId: record.attemptId,
    worker: input.worker,
  }, cwd);

  return record;
}

export async function completeExecutionRecord(
  attemptId: string,
  updates: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    touchedFiles: string[];
    verificationResult: 'pass' | 'fail' | 'skipped';
    verificationError?: string;
    timedOut: boolean;
    stalled: boolean;
  },
  cwd: string = process.cwd(),
): Promise<TaskExecutionRecord> {
  const existing = await loadExecutionRecord(attemptId, cwd);
  if (!existing) {
    throw new Error(`Execution record not found: ${attemptId}`);
  }

  const endedAt = nowIso();
  const durationMs = new Date(endedAt).getTime() - new Date(existing.startedAt).getTime();
  const updated: TaskExecutionRecord = {
    ...existing,
    endedAt,
    durationMs: Math.max(durationMs, 0),
    exitCode: updates.exitCode,
    stdout: updates.stdout,
    stderr: updates.stderr,
    touchedFiles: [...updates.touchedFiles],
    verificationResult: updates.verificationResult,
    timedOut: updates.timedOut,
    stalled: updates.stalled,
    ...(updates.verificationError ? { verificationError: updates.verificationError } : {}),
  };

  await saveExecutionRecord(updated, cwd);

  if (updates.verificationResult === 'pass') {
    await appendLedgerEvent('task_completed', {
      taskId: updated.taskId,
      attemptId: updated.attemptId,
      worker: updated.worker,
      exitCode: updated.exitCode,
    }, cwd);
  } else if (updates.verificationResult === 'fail') {
    await appendLedgerEvent('verification_failed', {
      taskId: updated.taskId,
      attemptId: updated.attemptId,
      worker: updated.worker,
      ...(updates.verificationError ? { error: updates.verificationError } : {}),
    }, cwd);
  }

  return updated;
}

