import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  RUNTIME_ATTEMPTS_DIR,
  RUNTIME_DIR,
  RUNTIME_EVENTS_FILE,
  SCRIMBLE_DIR,
} from '@scrimble/shared';
import type {
  IntentState,
  LedgerApprovalState,
  LedgerDocument,
  OrchestrationState,
  RuntimeState,
  TasksState,
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
}

export function getLedgerPaths(cwd: string = process.cwd()): LedgerPaths {
  const scrimbleDir = path.join(cwd, SCRIMBLE_DIR);
  const runtimeDir = path.join(scrimbleDir, RUNTIME_DIR);

  return {
    scrimble: scrimbleDir,
    runtime: runtimeDir,
    ledgerFile: path.join(scrimbleDir, LEDGER_FILE_NAME),
    events: path.join(runtimeDir, RUNTIME_EVENTS_FILE),
    attempts: path.join(runtimeDir, RUNTIME_ATTEMPTS_DIR),
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

export async function readLedger(cwd: string = process.cwd()): Promise<LedgerDocument> {
  const paths = getLedgerPaths(cwd);
  const current = await readJsonOptional<LedgerDocument>(paths.ledgerFile);
  if (current.found && current.value) {
    return normalizeLedgerDocument(current.value);
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

