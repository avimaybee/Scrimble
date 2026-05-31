import type {
  ActiveExecutionPhase,
  ActiveExecutionState,
  LedgerTask,
  TaskStatus,
  WorkerKind,
} from '@scrimble/shared';
import { mutateLedger, readLedger } from './storage.js';

export interface CreateLedgerTaskInput {
  id: string;
  title: string;
  objective: string;
  doneCriteria: string;
  ownedFiles: string[];
  allowedFiles?: string[];
  verificationCommands?: string[];
  dependencies?: string[];
  preferredWorker?: WorkerKind;
  fallbackWorker?: WorkerKind;
  riskScore?: number;
  maxRetries?: number;
}

export interface StartNextReadyTaskOptions {
  worker: WorkerKind;
  taskId?: string;
  phase?: ActiveExecutionPhase;
  statusMessage?: string;
  cwd?: string;
}

export interface CompleteActiveTaskOptions {
  taskId?: string;
  cwd?: string;
}

export interface FailActiveTaskOptions extends CompleteActiveTaskOptions {
  toStatus?: Extract<TaskStatus, 'failed' | 'ready' | 'pending'>;
  error: string;
}

export interface BlockActiveTaskOptions extends CompleteActiveTaskOptions {
  error: string;
}

export interface UpdateActiveExecutionOptions {
  phase?: ActiveExecutionPhase;
  statusMessage?: string | null;
  cwd?: string;
}

export interface ClearActiveExecutionOptions {
  taskId?: string;
  cwd?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function taskIndex(tasks: LedgerTask[]): Map<string, LedgerTask> {
  return new Map(tasks.map((task) => [task.id, task]));
}

function areDependenciesMet(task: LedgerTask, index: Map<string, LedgerTask>): boolean {
  return task.dependencies.every((dependencyId) => index.get(dependencyId)?.status === 'completed');
}

function isReadyTask(task: LedgerTask, index: Map<string, LedgerTask>): boolean {
  return task.status === 'ready' || (task.status === 'pending' && areDependenciesMet(task, index));
}

function refreshReadyTaskStatuses(tasks: LedgerTask[]): void {
  const index = taskIndex(tasks);
  const timestamp = nowIso();
  for (const task of tasks) {
    if (task.status === 'pending' && areDependenciesMet(task, index)) {
      task.status = 'ready';
      task.updatedAt = timestamp;
      continue;
    }
    if (task.status === 'ready' && !areDependenciesMet(task, index)) {
      task.status = 'pending';
      task.updatedAt = timestamp;
    }
  }
}

function requireTask(tasks: LedgerTask[], taskId: string): LedgerTask {
  const task = tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return task;
}

function requireActiveTask(
  tasks: LedgerTask[],
  activeExecution: ActiveExecutionState | undefined,
  expectedTaskId?: string,
): LedgerTask {
  if (!activeExecution) {
    throw new Error('No active execution to transition.');
  }
  if (expectedTaskId && activeExecution.taskId !== expectedTaskId) {
    throw new Error(`Active execution task mismatch: expected ${expectedTaskId}, got ${activeExecution.taskId}`);
  }
  return requireTask(tasks, activeExecution.taskId);
}

export async function createTask(
  input: CreateLedgerTaskInput,
  cwd: string = process.cwd(),
): Promise<LedgerTask> {
  return mutateLedger(cwd, (ledger) => {
    const tasksState = ledger.tasks;
    if (tasksState.tasks.some((task) => task.id === input.id)) {
      throw new Error(`Task already exists: ${input.id}`);
    }

    const now = nowIso();
    const task: LedgerTask = {
      id: input.id,
      title: input.title,
      objective: input.objective,
      doneCriteria: input.doneCriteria,
      ownedFiles: [...input.ownedFiles],
      allowedFiles: [...(input.allowedFiles ?? [])],
      verificationCommands: [...(input.verificationCommands ?? [])],
      dependencies: [...(input.dependencies ?? [])],
      riskScore: input.riskScore ?? 5,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      attemptCount: 0,
      maxRetries: input.maxRetries ?? 1,
      ...(input.preferredWorker ? { preferredWorker: input.preferredWorker } : {}),
      ...(input.fallbackWorker ? { fallbackWorker: input.fallbackWorker } : {}),
    };

    tasksState.tasks.push(task);
    refreshReadyTaskStatuses(tasksState.tasks);
    tasksState.updatedAt = nowIso();
    return task;
  });
}

export async function getTask(taskId: string, cwd: string = process.cwd()): Promise<LedgerTask | null> {
  const ledger = await readLedger(cwd);
  return ledger.tasks.tasks.find((task) => task.id === taskId) ?? null;
}

export async function getReadyTasks(cwd: string = process.cwd()): Promise<LedgerTask[]> {
  const ledger = await readLedger(cwd);
  const tasks = ledger.tasks.tasks;
  const index = taskIndex(tasks);
  return tasks.filter((task) => isReadyTask(task, index));
}

export async function getBlockedTasks(cwd: string = process.cwd()): Promise<LedgerTask[]> {
  const ledger = await readLedger(cwd);
  const tasks = ledger.tasks.tasks;
  const index = taskIndex(tasks);
  return tasks.filter((task) => task.status === 'pending' && !areDependenciesMet(task, index));
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  options: { error?: string | null; incrementAttempt?: boolean; cwd?: string } = {},
): Promise<LedgerTask> {
  const cwd = options.cwd ?? process.cwd();
  return mutateLedger(cwd, (ledger) => {
    const task = requireTask(ledger.tasks.tasks, taskId);
    task.status = status;
    task.updatedAt = nowIso();
    if (options.incrementAttempt) {
      task.attemptCount += 1;
    }
    if (options.error === null) {
      delete task.error;
    } else if (options.error) {
      task.error = options.error;
    }

    refreshReadyTaskStatuses(ledger.tasks.tasks);
    ledger.tasks.updatedAt = nowIso();
    return task;
  });
}

export async function getActiveExecution(cwd: string = process.cwd()): Promise<ActiveExecutionState | null> {
  const ledger = await readLedger(cwd);
  return ledger.runtime.activeExecution ?? null;
}

export async function startNextReadyTask(options: StartNextReadyTaskOptions): Promise<LedgerTask> {
  const cwd = options.cwd ?? process.cwd();
  return mutateLedger(cwd, (ledger) => {
    if (ledger.runtime.activeExecution) {
      throw new Error(`An active execution already exists for task ${ledger.runtime.activeExecution.taskId}.`);
    }

    const tasks = ledger.tasks.tasks;
    refreshReadyTaskStatuses(tasks);
    const index = taskIndex(tasks);

    let task: LedgerTask | undefined;
    if (options.taskId) {
      task = tasks.find((entry) => entry.id === options.taskId);
      if (!task) {
        throw new Error(`Task not found: ${options.taskId}`);
      }
      if (!isReadyTask(task, index)) {
        throw new Error(`Task is not ready for execution: ${options.taskId}`);
      }
    } else {
      task = tasks.find((entry) => isReadyTask(entry, index));
    }

    if (!task) {
      throw new Error('No ready task available to start.');
    }

    const timestamp = nowIso();
    task.status = 'in_progress';
    task.updatedAt = timestamp;
    task.attemptCount += 1;
    delete task.error;

    ledger.runtime.activeExecution = {
      taskId: task.id,
      workerId: options.worker,
      startedAt: timestamp,
      attempt: task.attemptCount,
      phase: options.phase ?? 'dispatching',
      ...(options.statusMessage ? { statusMessage: options.statusMessage } : {}),
    };
    ledger.tasks.updatedAt = timestamp;
    ledger.runtime.updatedAt = timestamp;
    return task;
  });
}

export async function updateActiveExecution(options: UpdateActiveExecutionOptions = {}): Promise<ActiveExecutionState> {
  const cwd = options.cwd ?? process.cwd();
  return mutateLedger(cwd, (ledger) => {
    const active = ledger.runtime.activeExecution;
    if (!active) {
      throw new Error('No active execution to update.');
    }

    if (options.phase) {
      active.phase = options.phase;
    }
    if (options.statusMessage === null) {
      delete active.statusMessage;
    } else if (typeof options.statusMessage === 'string') {
      active.statusMessage = options.statusMessage;
    }

    ledger.runtime.updatedAt = nowIso();
    return active;
  });
}

export async function clearActiveExecution(options: ClearActiveExecutionOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  await mutateLedger(cwd, (ledger) => {
    const active = ledger.runtime.activeExecution;
    if (!active) {
      return;
    }
    if (options.taskId && active.taskId !== options.taskId) {
      throw new Error(`Active execution task mismatch: expected ${options.taskId}, got ${active.taskId}`);
    }
    delete ledger.runtime.activeExecution;
    ledger.runtime.updatedAt = nowIso();
  });
}

export async function completeActiveTask(options: CompleteActiveTaskOptions = {}): Promise<LedgerTask> {
  const cwd = options.cwd ?? process.cwd();
  return mutateLedger(cwd, (ledger) => {
    const task = requireActiveTask(ledger.tasks.tasks, ledger.runtime.activeExecution, options.taskId);
    task.status = 'completed';
    task.updatedAt = nowIso();
    delete task.error;

    delete ledger.runtime.activeExecution;
    refreshReadyTaskStatuses(ledger.tasks.tasks);
    ledger.tasks.updatedAt = nowIso();
    ledger.runtime.updatedAt = nowIso();
    return task;
  });
}

export async function failActiveTask(options: FailActiveTaskOptions): Promise<LedgerTask> {
  const cwd = options.cwd ?? process.cwd();
  return mutateLedger(cwd, (ledger) => {
    const task = requireActiveTask(ledger.tasks.tasks, ledger.runtime.activeExecution, options.taskId);
    task.status = options.toStatus ?? 'failed';
    task.updatedAt = nowIso();
    task.error = options.error;

    delete ledger.runtime.activeExecution;
    refreshReadyTaskStatuses(ledger.tasks.tasks);
    ledger.tasks.updatedAt = nowIso();
    ledger.runtime.updatedAt = nowIso();
    return task;
  });
}

export async function blockActiveTask(options: BlockActiveTaskOptions): Promise<LedgerTask> {
  const cwd = options.cwd ?? process.cwd();
  return mutateLedger(cwd, (ledger) => {
    const task = requireActiveTask(ledger.tasks.tasks, ledger.runtime.activeExecution, options.taskId);
    task.status = 'blocked';
    task.updatedAt = nowIso();
    task.error = options.error;

    delete ledger.runtime.activeExecution;
    ledger.tasks.updatedAt = nowIso();
    ledger.runtime.updatedAt = nowIso();
    return task;
  });
}

export async function completeTask(
  taskId: string,
  options: { worker?: WorkerKind; cwd?: string } = {},
): Promise<LedgerTask> {
  return completeActiveTask({ taskId, cwd: options.cwd ?? process.cwd() });
}

export async function getTaskGraph(cwd: string = process.cwd()): Promise<{
  tasks: LedgerTask[];
  edges: Array<{ from: string; to: string }>;
}> {
  const ledger = await readLedger(cwd);
  const tasks = ledger.tasks.tasks;
  const edges = tasks.flatMap((task) =>
    task.dependencies.map((dependencyId) => ({
      from: task.id,
      to: dependencyId,
    })),
  );
  return { tasks, edges };
}

export async function getDependencyChain(taskId: string, cwd: string = process.cwd()): Promise<string[]> {
  const ledger = await readLedger(cwd);
  const index = taskIndex(ledger.tasks.tasks);
  const visited = new Set<string>();
  const chain: string[] = [];

  const walk = (currentId: string): void => {
    const current = index.get(currentId);
    if (!current) {
      return;
    }
    for (const dependencyId of current.dependencies) {
      if (visited.has(dependencyId)) {
        continue;
      }
      visited.add(dependencyId);
      chain.push(dependencyId);
      walk(dependencyId);
    }
  };

  walk(taskId);
  return chain;
}
