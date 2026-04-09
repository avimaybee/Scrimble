import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  INTENT_FILE,
  LEDGER_ASSIGNMENTS_FILE,
  LEDGER_DIR,
  LEDGER_FILE_LEASES_FILE,
  LEDGER_TASKS_FILE,
  RUNTIME_ATTEMPTS_DIR,
  RUNTIME_DIR,
  RUNTIME_EVENTS_FILE,
  RUNTIME_WORKERS_FILE,
  SCRIMBLE_DIR,
} from '@scrimble/shared';
import type {
  ActiveExecutionPhase,
  IntentState,
  LedgerApprovalState,
  LedgerDocument,
  OrchestrationState,
  RuntimeState,
  TasksState,
  WorkerKind,
  WorkersState,
} from '@scrimble/shared';

const SCHEMA_VERSION = 1;
const LEDGER_FILE_NAME = 'ledger.json';

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface LedgerPaths {
  scrimble: string;
  runtime: string;
  ledgerFile: string;
  events: string;
  attempts: string;
  legacyLedgerDir: string;
  legacyTasks: string;
  legacyAssignments: string;
  legacyFileLeases: string;
  legacyIntent: string;
  legacyWorkers: string;
}

interface LoadLegacyResult {
  foundAny: boolean;
  tasks: TasksState;
  runtime: RuntimeState;
  workers: WorkersState;
  intent: IntentState;
  approval: LedgerApprovalState;
  orchestration: OrchestrationState;
}

export function getLedgerPaths(cwd: string = process.cwd()): LedgerPaths {
  const scrimbleDir = path.join(cwd, SCRIMBLE_DIR);
  const runtimeDir = path.join(scrimbleDir, RUNTIME_DIR);
  const legacyLedgerDir = path.join(scrimbleDir, LEDGER_DIR);

  return {
    scrimble: scrimbleDir,
    runtime: runtimeDir,
    ledgerFile: path.join(scrimbleDir, LEDGER_FILE_NAME),
    events: path.join(runtimeDir, RUNTIME_EVENTS_FILE),
    attempts: path.join(runtimeDir, RUNTIME_ATTEMPTS_DIR),
    legacyLedgerDir,
    legacyTasks: path.join(legacyLedgerDir, LEDGER_TASKS_FILE),
    legacyAssignments: path.join(legacyLedgerDir, LEDGER_ASSIGNMENTS_FILE),
    legacyFileLeases: path.join(legacyLedgerDir, LEDGER_FILE_LEASES_FILE),
    legacyIntent: path.join(scrimbleDir, INTENT_FILE),
    legacyWorkers: path.join(runtimeDir, RUNTIME_WORKERS_FILE),
  };
}

export async function ensureLedgerDirs(cwd: string = process.cwd()): Promise<void> {
  const paths = getLedgerPaths(cwd);
  await fs.mkdir(paths.scrimble, { recursive: true });
  await fs.mkdir(paths.runtime, { recursive: true });
  await fs.mkdir(paths.attempts, { recursive: true });
}

async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${Date.now()}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, content, 'utf8');
    try {
      await fs.rename(tempPath, filePath);
    } catch (error) {
      if (isNodeError(error) && (error.code === 'EEXIST' || error.code === 'EPERM')) {
        await fs.rm(filePath, { force: true });
        await fs.rename(tempPath, filePath);
      } else {
        throw error;
      }
    }
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeJsonAtomic<T>(filePath: string, value: T): Promise<void> {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

function defaultTasksState(): TasksState {
  return {
    version: SCHEMA_VERSION,
    tasks: [],
    updatedAt: nowIso(),
  };
}

function defaultRuntimeState(): RuntimeState {
  return {
    version: SCHEMA_VERSION,
    updatedAt: nowIso(),
  };
}

function defaultWorkersState(): WorkersState {
  return {
    version: SCHEMA_VERSION,
    workers: [],
    updatedAt: nowIso(),
  };
}

function defaultIntentState(): IntentState {
  return {
    version: SCHEMA_VERSION,
    intent: null,
    discovery: {
      status: 'not_started',
      updatedAt: nowIso(),
    },
    history: [],
    updatedAt: nowIso(),
  };
}

function defaultApprovalState(): LedgerApprovalState {
  return {
    version: SCHEMA_VERSION,
    approved: false,
    updatedAt: nowIso(),
  };
}

function defaultOrchestrationState(): OrchestrationState {
  return {
    version: SCHEMA_VERSION,
    sessionId: randomUUID(),
    updatedAt: nowIso(),
  };
}

function defaultLedgerDocument(): LedgerDocument {
  return {
    version: SCHEMA_VERSION,
    updatedAt: nowIso(),
    tasks: defaultTasksState(),
    runtime: defaultRuntimeState(),
    workers: defaultWorkersState(),
    intent: defaultIntentState(),
    approval: defaultApprovalState(),
    orchestration: defaultOrchestrationState(),
  };
}

function normalizeLedgerDocument(input: Partial<LedgerDocument>): LedgerDocument {
  const defaults = defaultLedgerDocument();
  return {
    version: input.version ?? defaults.version,
    updatedAt: input.updatedAt ?? nowIso(),
    tasks: {
      ...defaults.tasks,
      ...(input.tasks ?? {}),
      updatedAt: input.tasks?.updatedAt ?? defaults.tasks.updatedAt,
    },
    runtime: {
      ...defaults.runtime,
      ...(input.runtime ?? {}),
      updatedAt: input.runtime?.updatedAt ?? defaults.runtime.updatedAt,
    },
    workers: {
      ...defaults.workers,
      ...(input.workers ?? {}),
      updatedAt: input.workers?.updatedAt ?? defaults.workers.updatedAt,
    },
    intent: {
      ...defaults.intent,
      ...(input.intent ?? {}),
      updatedAt: input.intent?.updatedAt ?? defaults.intent.updatedAt,
    },
    approval: {
      ...defaults.approval,
      ...(input.approval ?? {}),
      updatedAt: input.approval?.updatedAt ?? defaults.approval.updatedAt,
    },
    orchestration: {
      ...defaults.orchestration,
      ...(input.orchestration ?? {}),
      updatedAt: input.orchestration?.updatedAt ?? defaults.orchestration.updatedAt,
    },
  };
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

function isWorkerKind(value: string | undefined): value is WorkerKind {
  return value === 'gemini' || value === 'copilot';
}

function toLegacyPhase(status: string | undefined): ActiveExecutionPhase {
  if (status === 'assigned' || status === 'unassigned') {
    return 'dispatching';
  }
  if (status === 'in_progress' || status === 'needs_retry') {
    return 'executing';
  }
  return 'executing';
}

function runtimeFromLegacyAssignments(
  assignmentsState: LegacyAssignmentsState | undefined,
  tasksState: TasksState,
): RuntimeState {
  const defaultRuntime = defaultRuntimeState();
  const assignments = assignmentsState?.assignments ?? [];
  const active = assignments.find((entry) => isWorkerKind(entry.worker) && typeof entry.taskId === 'string');
  if (!active || !active.taskId || !isWorkerKind(active.worker)) {
    return defaultRuntime;
  }

  const task = tasksState.tasks.find((entry) => entry.id === active.taskId);
  if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'blocked') {
    return defaultRuntime;
  }

  const startedAt = active.startedAt ?? active.leasedAt ?? nowIso();
  return {
    version: SCHEMA_VERSION,
    activeExecution: {
      taskId: active.taskId,
      workerId: active.worker,
      startedAt,
      attempt: Math.max(task.attemptCount, 1),
      phase: toLegacyPhase(active.status),
    },
    updatedAt: nowIso(),
  };
}

async function loadLegacyDocument(cwd: string): Promise<LoadLegacyResult> {
  const paths = getLedgerPaths(cwd);
  const [tasks, assignments, workers, intent, fileLeases] = await Promise.all([
    readJsonOptional<TasksState>(paths.legacyTasks),
    readJsonOptional<LegacyAssignmentsState>(paths.legacyAssignments),
    readJsonOptional<WorkersState>(paths.legacyWorkers),
    readJsonOptional<IntentState>(paths.legacyIntent),
    readJsonOptional<unknown>(paths.legacyFileLeases),
  ]);
  const foundAny = tasks.found || assignments.found || workers.found || intent.found || fileLeases.found;
  const taskState = tasks.value ?? defaultTasksState();
  return {
    foundAny,
    tasks: taskState,
    runtime: runtimeFromLegacyAssignments(assignments.value, taskState),
    workers: workers.value ?? defaultWorkersState(),
    intent: intent.value ?? defaultIntentState(),
    approval: defaultApprovalState(),
    orchestration: defaultOrchestrationState(),
  };
}

export async function readLedger(cwd: string = process.cwd()): Promise<LedgerDocument> {
  const paths = getLedgerPaths(cwd);
  const current = await readJsonOptional<LedgerDocument>(paths.ledgerFile);
  if (current.found && current.value) {
    return normalizeLedgerDocument(current.value);
  }

  const legacy = await loadLegacyDocument(cwd);
  if (legacy.foundAny) {
    const migrated = normalizeLedgerDocument({
      version: SCHEMA_VERSION,
      updatedAt: nowIso(),
      tasks: legacy.tasks,
      runtime: legacy.runtime,
      workers: legacy.workers,
      intent: legacy.intent,
      approval: legacy.approval,
      orchestration: legacy.orchestration,
    });
    await writeLedger(migrated, cwd);
    return migrated;
  }

  return defaultLedgerDocument();
}

export async function writeLedger(document: LedgerDocument, cwd: string = process.cwd()): Promise<void> {
  await ensureLedgerDirs(cwd);
  const paths = getLedgerPaths(cwd);
  const normalized = normalizeLedgerDocument({
    ...document,
    updatedAt: nowIso(),
  });
  await writeJsonAtomic(paths.ledgerFile, normalized);
}

export async function mutateLedger<T>(
  cwd: string,
  mutator: (ledger: LedgerDocument) => T | Promise<T>,
): Promise<T> {
  const ledger = await readLedger(cwd);
  const result = await mutator(ledger);
  await writeLedger(ledger, cwd);
  return result;
}

