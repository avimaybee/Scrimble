import type {
  Assignment,
  AssignmentStatus,
  FileLease,
  LeaseCheckResult,
  LedgerTask,
  TaskStatus,
  WorkerKind,
} from '@scrimble/shared';
import {
  loadAssignmentsState,
  loadFileLeasesState,
  loadTasksState,
  saveAssignmentsState,
  saveFileLeasesState,
  saveTasksState,
} from './storage.js';
import { ownershipOverlaps } from '../path-glob.js';

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

export interface LeaseTaskOptions {
  force?: boolean;
  sessionId?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function assignmentForTask(assignments: Assignment[], taskId: string): Assignment | undefined {
  return assignments.find((entry) => entry.taskId === taskId);
}

function taskIndex(tasks: LedgerTask[]): Map<string, LedgerTask> {
  return new Map(tasks.map((task) => [task.id, task]));
}

function areDependenciesMet(task: LedgerTask, index: Map<string, LedgerTask>): boolean {
  return task.dependencies.every((dependencyId) => index.get(dependencyId)?.status === 'completed');
}

function leaseConflicts(
  requestedPaths: string[],
  requestedGlobs: string[],
  existingLease: FileLease,
): boolean {
  return ownershipOverlaps(
    {
      paths: requestedPaths,
      globs: requestedGlobs,
    },
    {
      paths: existingLease.paths,
      globs: existingLease.globs,
    },
  );
}

export async function createTask(
  input: CreateLedgerTaskInput,
  cwd: string = process.cwd(),
): Promise<LedgerTask> {
  const tasksState = await loadTasksState(cwd);
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
  await saveTasksState(tasksState, cwd);
  return task;
}

export async function getTask(taskId: string, cwd: string = process.cwd()): Promise<LedgerTask | null> {
  const tasksState = await loadTasksState(cwd);
  return tasksState.tasks.find((task) => task.id === taskId) ?? null;
}

export async function getReadyTasks(cwd: string = process.cwd()): Promise<LedgerTask[]> {
  const tasksState = await loadTasksState(cwd);
  const index = taskIndex(tasksState.tasks);
  return tasksState.tasks.filter((task) => task.status === 'pending' && areDependenciesMet(task, index));
}

export async function getBlockedTasks(cwd: string = process.cwd()): Promise<LedgerTask[]> {
  const tasksState = await loadTasksState(cwd);
  const index = taskIndex(tasksState.tasks);
  return tasksState.tasks.filter((task) => task.status === 'pending' && !areDependenciesMet(task, index));
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  options: { error?: string | null; incrementAttempt?: boolean; cwd?: string } = {},
): Promise<LedgerTask> {
  const cwd = options.cwd ?? process.cwd();
  const tasksState = await loadTasksState(cwd);
  const task = tasksState.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

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

  await saveTasksState(tasksState, cwd);
  return task;
}

export async function leaseTask(
  taskId: string,
  worker: WorkerKind,
  options: LeaseTaskOptions & { cwd?: string } = {},
): Promise<Assignment> {
  const cwd = options.cwd ?? process.cwd();
  const tasksState = await loadTasksState(cwd);
  const assignmentsState = await loadAssignmentsState(cwd);
  const currentTask = tasksState.tasks.find((entry) => entry.id === taskId);

  if (!currentTask) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const index = taskIndex(tasksState.tasks);
  if (!options.force) {
    if (currentTask.status !== 'pending') {
      throw new Error(`Task is not pending: ${taskId}`);
    }
    if (!areDependenciesMet(currentTask, index)) {
      throw new Error(`Task dependencies are not satisfied: ${taskId}`);
    }
  }

  currentTask.status = 'leased';
  currentTask.updatedAt = nowIso();

  const timestamp = nowIso();
  const existing = assignmentForTask(assignmentsState.assignments, taskId);
  if (existing) {
    existing.worker = worker;
    existing.status = 'assigned';
    existing.leasedAt = timestamp;
    delete existing.startedAt;
    delete existing.completedAt;
    existing.lastHeartbeat = timestamp;
    if (options.sessionId) {
      existing.sessionId = options.sessionId;
    } else {
      delete existing.sessionId;
    }
    await saveTasksState(tasksState, cwd);
    await saveAssignmentsState(assignmentsState, cwd);
    return existing;
  }

  const assignment: Assignment = {
    taskId,
    worker,
    status: 'assigned',
    leasedAt: timestamp,
    lastHeartbeat: timestamp,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
  };

  assignmentsState.assignments.push(assignment);
  await saveTasksState(tasksState, cwd);
  await saveAssignmentsState(assignmentsState, cwd);
  return assignment;
}

export async function setAssignmentStatus(
  taskId: string,
  status: AssignmentStatus,
  options: { sessionId?: string | null; cwd?: string } = {},
): Promise<Assignment> {
  const cwd = options.cwd ?? process.cwd();
  const assignmentsState = await loadAssignmentsState(cwd);
  const assignment = assignmentForTask(assignmentsState.assignments, taskId);
  if (!assignment) {
    throw new Error(`Assignment not found for task: ${taskId}`);
  }

  assignment.status = status;
  assignment.lastHeartbeat = nowIso();

  if (status === 'in_progress' && !assignment.startedAt) {
    assignment.startedAt = nowIso();
  }
  if (status === 'done') {
    assignment.completedAt = nowIso();
  }
  if (options.sessionId === null) {
    delete assignment.sessionId;
  } else if (options.sessionId) {
    assignment.sessionId = options.sessionId;
  }

  await saveAssignmentsState(assignmentsState, cwd);
  return assignment;
}

export async function releaseTask(
  taskId: string,
  options: { toStatus?: Extract<TaskStatus, 'pending' | 'blocked' | 'failed'>; error?: string; cwd?: string } = {},
): Promise<LedgerTask> {
  const cwd = options.cwd ?? process.cwd();
  const nextStatus = options.toStatus ?? 'pending';
  const tasksState = await loadTasksState(cwd);
  const assignmentsState = await loadAssignmentsState(cwd);
  const task = tasksState.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  task.status = nextStatus;
  task.updatedAt = nowIso();
  if (options.error) {
    task.error = options.error;
  } else if (nextStatus === 'pending') {
    delete task.error;
  }

  assignmentsState.assignments = assignmentsState.assignments.filter((entry) => entry.taskId !== taskId);
  await releaseFileLease(taskId, cwd);
  await saveTasksState(tasksState, cwd);
  await saveAssignmentsState(assignmentsState, cwd);
  return task;
}

export async function completeTask(
  taskId: string,
  options: { worker?: WorkerKind; cwd?: string } = {},
): Promise<LedgerTask> {
  const cwd = options.cwd ?? process.cwd();
  const tasksState = await loadTasksState(cwd);
  const assignmentsState = await loadAssignmentsState(cwd);
  const task = tasksState.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  task.status = 'completed';
  task.updatedAt = nowIso();
  delete task.error;

  const assignment = assignmentForTask(assignmentsState.assignments, taskId);
  if (assignment) {
    assignment.status = 'done';
    assignment.completedAt = nowIso();
    assignment.lastHeartbeat = nowIso();
    if (options.worker) {
      assignment.worker = options.worker;
    }
  }

  await releaseFileLease(taskId, cwd);
  await saveTasksState(tasksState, cwd);
  await saveAssignmentsState(assignmentsState, cwd);
  return task;
}

export async function checkLeaseConflict(
  taskId: string,
  requested: { paths?: string[]; globs?: string[] },
  cwd: string = process.cwd(),
): Promise<LeaseCheckResult> {
  const fileLeasesState = await loadFileLeasesState(cwd);
  const requestedPaths = requested.paths ?? [];
  const requestedGlobs = requested.globs ?? [];

  const conflicts = fileLeasesState.leases.filter((lease) => {
    if (lease.taskId === taskId) {
      return false;
    }
    return leaseConflicts(requestedPaths, requestedGlobs, lease);
  });

  if (conflicts.length === 0) {
    return { canLease: true, conflicts: [] };
  }

  return {
    canLease: false,
    conflicts,
    reason: `Lease conflict with ${conflicts.map((conflict) => conflict.taskId).join(', ')}`,
  };
}

export async function acquireFileLease(
  taskId: string,
  worker: WorkerKind,
  requested: { paths?: string[]; globs?: string[] },
  cwd: string = process.cwd(),
): Promise<FileLease> {
  const fileLeasesState = await loadFileLeasesState(cwd);
  const paths = requested.paths ?? [];
  const globs = requested.globs ?? [];

  const check = await checkLeaseConflict(taskId, { paths, globs }, cwd);
  if (!check.canLease) {
    throw new Error(check.reason ?? `Unable to acquire lease for task ${taskId}`);
  }

  const lease: FileLease = {
    taskId,
    worker,
    paths: [...paths],
    globs: [...globs],
    leasedAt: nowIso(),
  };

  fileLeasesState.leases = fileLeasesState.leases.filter((entry) => entry.taskId !== taskId);
  fileLeasesState.leases.push(lease);
  await saveFileLeasesState(fileLeasesState, cwd);
  return lease;
}

export async function releaseFileLease(taskId: string, cwd: string = process.cwd()): Promise<void> {
  const fileLeasesState = await loadFileLeasesState(cwd);
  const nextLeases = fileLeasesState.leases.filter((entry) => entry.taskId !== taskId);
  if (nextLeases.length === fileLeasesState.leases.length) {
    return;
  }
  fileLeasesState.leases = nextLeases;
  await saveFileLeasesState(fileLeasesState, cwd);
}

export async function getTaskGraph(cwd: string = process.cwd()): Promise<{
  tasks: LedgerTask[];
  edges: Array<{ from: string; to: string }>;
}> {
  const tasksState = await loadTasksState(cwd);
  const edges = tasksState.tasks.flatMap((task) =>
    task.dependencies.map((dependencyId) => ({
      from: task.id,
      to: dependencyId,
    })),
  );

  return { tasks: tasksState.tasks, edges };
}

export async function getDependencyChain(taskId: string, cwd: string = process.cwd()): Promise<string[]> {
  const tasksState = await loadTasksState(cwd);
  const index = taskIndex(tasksState.tasks);
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

