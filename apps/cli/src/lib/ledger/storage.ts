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
  AssignmentsState,
  FileLeasesState,
  IntentState,
  TasksState,
  WorkersState,
} from '@scrimble/shared';

const SCHEMA_VERSION = 1;
const LEDGER_FILE_NAME = 'ledger.json';
const ledgerWriteLocks = new Map<string, Promise<void>>();

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
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

interface LedgerDocument {
  version: number;
  updatedAt: string;
  tasks: TasksState;
  assignments: AssignmentsState;
  fileLeases: FileLeasesState;
  workers: WorkersState;
  intent: IntentState;
}

interface LoadLegacyResult {
  foundAny: boolean;
  tasks: TasksState;
  assignments: AssignmentsState;
  fileLeases: FileLeasesState;
  workers: WorkersState;
  intent: IntentState;
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

async function withLedgerWriteLock<T>(ledgerFilePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = ledgerWriteLocks.get(ledgerFilePath) ?? Promise.resolve();
  let releaseCurrent: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.then(() => current);
  ledgerWriteLocks.set(ledgerFilePath, tail);

  await previous;
  try {
    return await operation();
  } finally {
    releaseCurrent?.();
    if (ledgerWriteLocks.get(ledgerFilePath) === tail) {
      ledgerWriteLocks.delete(ledgerFilePath);
    }
  }
}

export async function writeJsonAtomic<T>(filePath: string, value: T): Promise<void> {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJsonOptional<T>(filePath: string): Promise<{ found: boolean; value?: T }> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return {
      found: true,
      value: JSON.parse(content) as T,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { found: false };
    }
    throw error;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultTasksState(): TasksState {
  return {
    version: SCHEMA_VERSION,
    tasks: [],
    updatedAt: nowIso(),
  };
}

function defaultAssignmentsState(): AssignmentsState {
  return {
    version: SCHEMA_VERSION,
    assignments: [],
    updatedAt: nowIso(),
  };
}

function defaultFileLeasesState(): FileLeasesState {
  return {
    version: SCHEMA_VERSION,
    leases: [],
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
    history: [],
    updatedAt: nowIso(),
  };
}

function defaultLedgerDocument(): LedgerDocument {
  return {
    version: SCHEMA_VERSION,
    updatedAt: nowIso(),
    tasks: defaultTasksState(),
    assignments: defaultAssignmentsState(),
    fileLeases: defaultFileLeasesState(),
    workers: defaultWorkersState(),
    intent: defaultIntentState(),
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
    assignments: {
      ...defaults.assignments,
      ...(input.assignments ?? {}),
      updatedAt: input.assignments?.updatedAt ?? defaults.assignments.updatedAt,
    },
    fileLeases: {
      ...defaults.fileLeases,
      ...(input.fileLeases ?? {}),
      updatedAt: input.fileLeases?.updatedAt ?? defaults.fileLeases.updatedAt,
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
  };
}

async function loadLegacyDocument(cwd: string): Promise<LoadLegacyResult> {
  const paths = getLedgerPaths(cwd);
  const [tasks, assignments, fileLeases, workers, intent] = await Promise.all([
    readJsonOptional<TasksState>(paths.legacyTasks),
    readJsonOptional<AssignmentsState>(paths.legacyAssignments),
    readJsonOptional<FileLeasesState>(paths.legacyFileLeases),
    readJsonOptional<WorkersState>(paths.legacyWorkers),
    readJsonOptional<IntentState>(paths.legacyIntent),
  ]);

  const foundAny = tasks.found || assignments.found || fileLeases.found || workers.found || intent.found;
  return {
    foundAny,
    tasks: tasks.value ?? defaultTasksState(),
    assignments: assignments.value ?? defaultAssignmentsState(),
    fileLeases: fileLeases.value ?? defaultFileLeasesState(),
    workers: workers.value ?? defaultWorkersState(),
    intent: intent.value ?? defaultIntentState(),
  };
}

async function saveLedgerDocument(document: LedgerDocument, cwd: string = process.cwd()): Promise<void> {
  await ensureLedgerDirs(cwd);
  const paths = getLedgerPaths(cwd);
  await writeJsonAtomic(paths.ledgerFile, {
    ...document,
    updatedAt: nowIso(),
  });
}

async function loadLedgerDocument(cwd: string = process.cwd()): Promise<LedgerDocument> {
  const paths = getLedgerPaths(cwd);
  const current = await readJsonOptional<LedgerDocument>(paths.ledgerFile);
  if (current.found && current.value) {
    return normalizeLedgerDocument(current.value);
  }

  const legacy = await loadLegacyDocument(cwd);
  if (legacy.foundAny) {
    const migrated: LedgerDocument = normalizeLedgerDocument({
      version: SCHEMA_VERSION,
      updatedAt: nowIso(),
      tasks: legacy.tasks,
      assignments: legacy.assignments,
      fileLeases: legacy.fileLeases,
      workers: legacy.workers,
      intent: legacy.intent,
    });
    await saveLedgerDocument(migrated, cwd);
    return migrated;
  }

  return defaultLedgerDocument();
}

export async function loadTasksState(cwd: string = process.cwd()): Promise<TasksState> {
  const document = await loadLedgerDocument(cwd);
  return document.tasks;
}

export async function saveTasksState(state: TasksState, cwd: string = process.cwd()): Promise<void> {
  const paths = getLedgerPaths(cwd);
  await withLedgerWriteLock(paths.ledgerFile, async () => {
    const document = await loadLedgerDocument(cwd);
    await saveLedgerDocument(
      {
        ...document,
        tasks: {
          ...state,
          updatedAt: nowIso(),
        },
      },
      cwd,
    );
  });
}

export async function loadAssignmentsState(cwd: string = process.cwd()): Promise<AssignmentsState> {
  const document = await loadLedgerDocument(cwd);
  return document.assignments;
}

export async function saveAssignmentsState(
  state: AssignmentsState,
  cwd: string = process.cwd(),
): Promise<void> {
  const paths = getLedgerPaths(cwd);
  await withLedgerWriteLock(paths.ledgerFile, async () => {
    const document = await loadLedgerDocument(cwd);
    await saveLedgerDocument(
      {
        ...document,
        assignments: {
          ...state,
          updatedAt: nowIso(),
        },
      },
      cwd,
    );
  });
}

export async function loadFileLeasesState(cwd: string = process.cwd()): Promise<FileLeasesState> {
  const document = await loadLedgerDocument(cwd);
  return document.fileLeases;
}

export async function saveFileLeasesState(
  state: FileLeasesState,
  cwd: string = process.cwd(),
): Promise<void> {
  const paths = getLedgerPaths(cwd);
  await withLedgerWriteLock(paths.ledgerFile, async () => {
    const document = await loadLedgerDocument(cwd);
    await saveLedgerDocument(
      {
        ...document,
        fileLeases: {
          ...state,
          updatedAt: nowIso(),
        },
      },
      cwd,
    );
  });
}

export async function loadWorkersState(cwd: string = process.cwd()): Promise<WorkersState> {
  const document = await loadLedgerDocument(cwd);
  return document.workers;
}

export async function saveWorkersState(state: WorkersState, cwd: string = process.cwd()): Promise<void> {
  const paths = getLedgerPaths(cwd);
  await withLedgerWriteLock(paths.ledgerFile, async () => {
    const document = await loadLedgerDocument(cwd);
    await saveLedgerDocument(
      {
        ...document,
        workers: {
          ...state,
          updatedAt: nowIso(),
        },
      },
      cwd,
    );
  });
}

export async function loadIntentState(cwd: string = process.cwd()): Promise<IntentState> {
  const document = await loadLedgerDocument(cwd);
  return document.intent;
}

export async function saveIntentState(state: IntentState, cwd: string = process.cwd()): Promise<void> {
  const paths = getLedgerPaths(cwd);
  await withLedgerWriteLock(paths.ledgerFile, async () => {
    const document = await loadLedgerDocument(cwd);
    await saveLedgerDocument(
      {
        ...document,
        intent: {
          ...state,
          updatedAt: nowIso(),
        },
      },
      cwd,
    );
  });
}

export async function loadLedgerState(cwd: string = process.cwd()): Promise<{
  tasks: TasksState;
  assignments: AssignmentsState;
  fileLeases: FileLeasesState;
  workers: WorkersState;
  intent: IntentState;
}> {
  const document = await loadLedgerDocument(cwd);
  return {
    tasks: document.tasks,
    assignments: document.assignments,
    fileLeases: document.fileLeases,
    workers: document.workers,
    intent: document.intent,
  };
}

