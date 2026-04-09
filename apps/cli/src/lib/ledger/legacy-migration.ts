import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  INTENT_FILE,
  LEDGER_DIR,
  LEDGER_TASKS_FILE,
  RUNTIME_DIR,
  RUNTIME_WORKERS_FILE,
  SCRIMBLE_DIR,
} from '@scrimble/shared';
import type {
  ActiveExecutionPhase,
  IntentState,
  LedgerDocument,
  RuntimeState,
  TasksState,
  WorkerKind,
  WorkersState,
} from '@scrimble/shared';
import { readLedger, writeLedger } from './storage.js';

const LEGACY_LEDGER_ASSIGNMENTS_FILE = 'assignments.json';
const LEGACY_LEDGER_FILE_LEASES_FILE = 'file-leases.json';

interface LegacyLedgerPaths {
  ledgerFile: string;
  legacyTasks: string;
  legacyAssignments: string;
  legacyFileLeases: string;
  legacyIntent: string;
  legacyWorkers: string;
}

interface LegacyAssignmentEntry {
  taskId?: string;
  worker?: string;
  status?: string;
  leasedAt?: string;
  startedAt?: string;
}

interface LegacyAssignmentsState {
  assignments?: LegacyAssignmentEntry[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonOptional<T>(filePath: string): Promise<{ found: boolean; value?: T }> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return { found: true, value: JSON.parse(content) as T };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { found: false };
    }
    throw error;
  }
}

function isWorkerKind(value: string | undefined): value is WorkerKind {
  return value === 'gemini' || value === 'copilot';
}

function toLegacyPhase(status: string | undefined): ActiveExecutionPhase {
  if (status === 'assigned' || status === 'unassigned') {
    return 'dispatching';
  }
  return 'executing';
}

function runtimeFromLegacyAssignments(
  assignmentsState: LegacyAssignmentsState | undefined,
  tasksState: TasksState,
  fallback: RuntimeState,
): RuntimeState {
  const assignments = assignmentsState?.assignments ?? [];
  const active = assignments.find((entry) => isWorkerKind(entry.worker) && typeof entry.taskId === 'string');
  if (!active || !active.taskId || !isWorkerKind(active.worker)) {
    return fallback;
  }

  const task = tasksState.tasks.find((entry) => entry.id === active.taskId);
  if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'blocked') {
    return fallback;
  }

  const startedAt = active.startedAt ?? active.leasedAt ?? nowIso();
  return {
    version: fallback.version,
    activeExecution: {
      taskId: active.taskId,
      workerId: active.worker,
      startedAt,
      attempt: Math.max(task.attemptCount ?? 0, 1),
      phase: toLegacyPhase(active.status),
    },
    updatedAt: nowIso(),
  };
}

function getLegacyLedgerPaths(cwd: string): LegacyLedgerPaths {
  const scrimbleDir = path.join(cwd, SCRIMBLE_DIR);
  const runtimeDir = path.join(scrimbleDir, RUNTIME_DIR);
  const legacyLedgerDir = path.join(scrimbleDir, LEDGER_DIR);
  return {
    ledgerFile: path.join(scrimbleDir, 'ledger.json'),
    legacyTasks: path.join(legacyLedgerDir, LEDGER_TASKS_FILE),
    legacyAssignments: path.join(legacyLedgerDir, LEGACY_LEDGER_ASSIGNMENTS_FILE),
    legacyFileLeases: path.join(legacyLedgerDir, LEGACY_LEDGER_FILE_LEASES_FILE),
    legacyIntent: path.join(scrimbleDir, INTENT_FILE),
    legacyWorkers: path.join(runtimeDir, RUNTIME_WORKERS_FILE),
  };
}

export type LegacyMigrationStatus = 'already_current' | 'migrated' | 'not_needed';

export async function migrateLegacyLedgerIfPresent(cwd: string = process.cwd()): Promise<LegacyMigrationStatus> {
  const paths = getLegacyLedgerPaths(cwd);
  if (await pathExists(paths.ledgerFile)) {
    return 'already_current';
  }

  const [tasks, assignments, workers, intent, fileLeases] = await Promise.all([
    readJsonOptional<TasksState>(paths.legacyTasks),
    readJsonOptional<LegacyAssignmentsState>(paths.legacyAssignments),
    readJsonOptional<WorkersState>(paths.legacyWorkers),
    readJsonOptional<IntentState>(paths.legacyIntent),
    readJsonOptional<unknown>(paths.legacyFileLeases),
  ]);
  const foundAnyLegacy = tasks.found || assignments.found || workers.found || intent.found || fileLeases.found;
  if (!foundAnyLegacy) {
    return 'not_needed';
  }

  const baseline = await readLedger(cwd);
  const migratedTasks = tasks.value ?? baseline.tasks;
  const migrated: LedgerDocument = {
    ...baseline,
    updatedAt: nowIso(),
    tasks: migratedTasks,
    runtime: runtimeFromLegacyAssignments(assignments.value, migratedTasks, baseline.runtime),
    workers: workers.value ?? baseline.workers,
    intent: intent.value ?? baseline.intent,
  };
  await writeLedger(migrated, cwd);
  return 'migrated';
}
