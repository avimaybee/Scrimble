import { createHash } from 'node:crypto';
import type { LedgerTask, WorkerDriver, WorkerHealth, WorkerKind } from '@scrimble/shared';
import {
  acquireFileLease,
  completeTask,
  getReadyTasks,
  getTask,
  leaseTask,
  releaseFileLease,
  releaseTask,
  setAssignmentStatus,
  updateTaskStatus,
} from '../ledger/operations.js';
import { appendLedgerEvent, completeExecutionRecord, startExecutionRecord } from '../ledger/records.js';
import {
  loadAssignmentsState,
  loadFileLeasesState,
  loadTasksState,
  loadWorkersState,
  saveWorkersState,
} from '../ledger/storage.js';
import { getWorkerDriver } from '../workers/factory.js';
import { checkParallelDispatch, detectOutOfLeaseEdits } from './parallel.js';
import { routeTask } from './router.js';
import { analyzeTaskDrift, verifyTaskExecution } from '../verification/index.js';

export type WorkerSelection = 'auto' | WorkerKind;

export interface SupervisorRunOptions {
  cwd?: string;
  worker?: WorkerSelection;
  parallel?: number;
  timeoutMs?: number;
  maxTasks?: number;
}

export interface SupervisorRunResult {
  completedTaskIds: string[];
  failedTaskIds: string[];
  conflictedTaskIds: string[];
  retriedTaskIds: string[];
  skippedTaskIds: string[];
}

interface TaskRunResult {
  status: 'completed' | 'failed' | 'conflicted' | 'retry' | 'skipped';
  taskId: string;
  worker: WorkerKind;
  error?: string;
}

function createDriver(worker: WorkerKind, cwd: string): WorkerDriver {
  return getWorkerDriver(worker, { cwd });
}

function workerHistoryFromState(
  healthByWorker: Record<WorkerKind, WorkerHealth>,
): Partial<Record<WorkerKind, { successes: number; failures: number }>> {
  return {
    gemini: {
      successes: healthByWorker.gemini.tasksCompleted,
      failures: healthByWorker.gemini.tasksFailed,
    },
    copilot: {
      successes: healthByWorker.copilot.tasksCompleted,
      failures: healthByWorker.copilot.tasksFailed,
    },
  };
}

function activeWorkerLoads(
  workers: WorkerKind[],
  assignments: Awaited<ReturnType<typeof loadAssignmentsState>>['assignments'],
): Record<WorkerKind, number> {
  const loadByWorker = Object.fromEntries(workers.map((worker) => [worker, 0])) as Record<WorkerKind, number>;
  for (const assignment of assignments) {
    if (assignment.status !== 'assigned' && assignment.status !== 'in_progress') {
      continue;
    }
    loadByWorker[assignment.worker] = (loadByWorker[assignment.worker] ?? 0) + 1;
  }
  return loadByWorker;
}

function workerSnapshotForRouting(
  workerHealthByKind: Record<WorkerKind, WorkerHealth>,
  workerCapacityByKind: Record<WorkerKind, number>,
  activeLoadByWorker: Record<WorkerKind, number>,
  reservedLoadByWorker: Record<WorkerKind, number>,
): WorkerHealth[] {
  return Object.values(workerHealthByKind).map((worker) => {
    const baseLoad = activeLoadByWorker[worker.kind] ?? 0;
    const reservedLoad = reservedLoadByWorker[worker.kind] ?? 0;
    const effectiveLoad = baseLoad + reservedLoad;
    const capacity = Math.max(1, workerCapacityByKind[worker.kind] ?? 1);
    return {
      ...worker,
      available: worker.available && effectiveLoad < capacity,
      ...(effectiveLoad > 0
        ? { currentTaskId: worker.currentTaskId ?? `reserved-${worker.kind}` }
        : worker.currentTaskId
          ? { currentTaskId: worker.currentTaskId }
          : {}),
    };
  });
}

export class LedgerSupervisor {
  private ledgerOpsTail: Promise<void> = Promise.resolve();

  private async withLedgerLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.ledgerOpsTail;
    let releaseCurrent: (() => void) | undefined;
    this.ledgerOpsTail = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      releaseCurrent?.();
    }
  }

  async run(options: SupervisorRunOptions = {}): Promise<SupervisorRunResult> {
    const cwd = options.cwd ?? process.cwd();
    const workerSelection = options.worker ?? 'auto';
    const parallel = Math.max(1, options.parallel ?? 1);
    const timeoutMs = options.timeoutMs ?? 300_000;
    const maxTasks = options.maxTasks ?? Number.POSITIVE_INFINITY;

    await appendLedgerEvent('run_started', {
      worker: workerSelection,
      parallel,
      timeoutMs,
    }, cwd);

    const workersState = await loadWorkersState(cwd);
    const workerCapacityByKind: Record<WorkerKind, number> = {
      gemini: 1,
      copilot: 1,
    };
    const workerHealthByKind: Record<WorkerKind, WorkerHealth> = {
      gemini:
        workersState.workers.find((worker) => worker.kind === 'gemini') ?? {
          kind: 'gemini',
          available: false,
          tasksCompleted: 0,
          tasksFailed: 0,
        },
      copilot:
        workersState.workers.find((worker) => worker.kind === 'copilot') ?? {
          kind: 'copilot',
          available: false,
          tasksCompleted: 0,
          tasksFailed: 0,
        },
    };

    const candidateWorkers: WorkerKind[] =
      workerSelection === 'auto' ? ['gemini', 'copilot'] : [workerSelection];
    const preflights = await Promise.all(
      candidateWorkers.map(async (worker) => {
        const driver = createDriver(worker, cwd);
        const preflight = await driver.preflight();
        return { worker, preflight };
      }),
    );

    for (const { worker, preflight } of preflights) {
      const current = workerHealthByKind[worker];
      if (preflight.capabilities?.maxParallelTasks) {
        workerCapacityByKind[worker] = Math.max(1, preflight.capabilities.maxParallelTasks);
      }
      workerHealthByKind[worker] = {
        ...current,
        available: preflight.available,
        ...(preflight.errors.length > 0 ? { error: preflight.errors[0] } : {}),
      };
      if (preflight.available) {
        await appendLedgerEvent('worker_available', { worker }, cwd);
      } else {
        await appendLedgerEvent('worker_unavailable', {
          worker,
          errors: preflight.errors,
        }, cwd);
      }
    }

    const result: SupervisorRunResult = {
      completedTaskIds: [],
      failedTaskIds: [],
      conflictedTaskIds: [],
      retriedTaskIds: [],
      skippedTaskIds: [],
    };

    let processed = 0;
    while (processed < maxTasks) {
      const readyTasks = await getReadyTasks(cwd);
      if (readyTasks.length === 0) {
        break;
      }

      const tasksState = await loadTasksState(cwd);
      const assignmentsState = await loadAssignmentsState(cwd);
      const fileLeasesState = await loadFileLeasesState(cwd);
      const activeTasks = tasksState.tasks.filter((task) => task.status === 'running' || task.status === 'leased');
      const activeLoadByWorker = activeWorkerLoads(['gemini', 'copilot'], assignmentsState.assignments);
      const reservedLoadByWorker: Record<WorkerKind, number> = { gemini: 0, copilot: 0 };
      const batch: Array<{ task: LedgerTask; worker: WorkerKind }> = [];
      const syntheticLeases = [...fileLeasesState.leases];
      const history = workerHistoryFromState(workerHealthByKind);

      for (const task of readyTasks) {
        if (batch.length >= parallel || processed + batch.length >= maxTasks) {
          break;
        }
        const workersForRouting = workerSnapshotForRouting(
          workerHealthByKind,
          workerCapacityByKind,
          activeLoadByWorker,
          reservedLoadByWorker,
        );
        if (!workersForRouting.some((worker) => worker.available)) {
          break;
        }
        const dispatch = checkParallelDispatch(task, activeTasks, syntheticLeases);
        if (!dispatch.allowed) {
          result.skippedTaskIds.push(task.id);
          continue;
        }

        let worker: WorkerKind;
        try {
          worker = routeTask(task, {
            workers: workersForRouting,
            history,
            ...(workerSelection === 'auto' ? {} : { manualWorker: workerSelection }),
          }).worker;
        } catch {
          break;
        }

        batch.push({ task, worker });
        reservedLoadByWorker[worker] += 1;
        syntheticLeases.push({
          taskId: task.id,
          worker,
          paths: [...task.ownedFiles],
          globs: task.ownedFiles.filter((entry) => entry.includes('*') || entry.includes('?')),
          leasedAt: new Date().toISOString(),
        });
      }

      if (batch.length === 0) {
        break;
      }

      const taskResults = await Promise.all(
        batch.map(({ task, worker }) =>
          this.runSingleTask(task, {
            worker,
            cwd,
            timeoutMs,
          }),
        ),
      );

      for (const taskResult of taskResults) {
        processed += 1;
        const workerState = workerHealthByKind[taskResult.worker];
        if (taskResult.status === 'completed') {
          result.completedTaskIds.push(taskResult.taskId);
          workerState.tasksCompleted += 1;
        } else if (taskResult.status === 'failed') {
          result.failedTaskIds.push(taskResult.taskId);
          workerState.tasksFailed += 1;
        } else if (taskResult.status === 'conflicted') {
          result.conflictedTaskIds.push(taskResult.taskId);
          workerState.tasksFailed += 1;
        } else if (taskResult.status === 'retry') {
          result.retriedTaskIds.push(taskResult.taskId);
        } else {
          result.skippedTaskIds.push(taskResult.taskId);
        }
      }
    }

    await saveWorkersState(
      {
        version: workersState.version,
        workers: Object.values(workerHealthByKind),
        updatedAt: new Date().toISOString(),
      },
      cwd,
    );

    await appendLedgerEvent('run_completed', {
      completed: result.completedTaskIds.length,
      failed: result.failedTaskIds.length,
      conflicted: result.conflictedTaskIds.length,
      retried: result.retriedTaskIds.length,
      skipped: result.skippedTaskIds.length,
    }, cwd);

    return result;
  }

  private async runSingleTask(
    task: LedgerTask,
    input: {
      worker: WorkerKind;
      cwd: string;
      timeoutMs: number;
    },
  ): Promise<TaskRunResult> {
    const worker = input.worker;
    const driver = createDriver(worker, input.cwd);

    try {
      await this.withLedgerLock(async () => {
        await leaseTask(task.id, worker, { cwd: input.cwd });
      });
      await appendLedgerEvent('task_leased', { taskId: task.id, worker }, input.cwd);

      await this.withLedgerLock(async () => {
        await acquireFileLease(
          task.id,
          worker,
          {
            paths: task.ownedFiles,
            globs: task.ownedFiles.filter((entry) => entry.includes('*') || entry.includes('?')),
          },
          input.cwd,
        );
      });
      await appendLedgerEvent('lease_acquired', { taskId: task.id, worker }, input.cwd);

      const contextArtifacts = await driver.discoverContextArtifacts();
      const [tasksState, assignmentsState, fileLeasesState] = await this.withLedgerLock(async () => Promise.all([
        loadTasksState(input.cwd),
        loadAssignmentsState(input.cwd),
        loadFileLeasesState(input.cwd),
      ]));
      const prompt = driver.buildPrompt(task, contextArtifacts, {
        tasks: tasksState,
        assignments: assignmentsState,
        fileLeases: fileLeasesState,
      });

      const promptHash = createHash('sha256').update(prompt).digest('hex').slice(0, 16);
      const record = await startExecutionRecord(
        {
          taskId: task.id,
          worker,
          promptHash,
        },
        input.cwd,
      );

      await this.withLedgerLock(async () => {
        await updateTaskStatus(task.id, 'running', { incrementAttempt: true, error: null, cwd: input.cwd });
        await setAssignmentStatus(task.id, 'in_progress', { cwd: input.cwd });
      });

      const handle = await driver.startExecution(prompt, {
        timeout: input.timeoutMs,
        cwd: input.cwd,
        outputFormat: 'json',
        approvalMode: 'yolo',
        checkpointing: true,
      });
      const execution = await driver.waitForCompletion(handle);
      const touchedFiles = driver.extractTouchedFiles(execution);

      const leaseValidation = detectOutOfLeaseEdits(task, touchedFiles);
      if (!leaseValidation.valid) {
        await completeExecutionRecord(
          record.attemptId,
          {
            exitCode: execution.exitCode,
            stdout: execution.stdout,
            stderr: execution.stderr,
            touchedFiles,
            verificationResult: 'fail',
            verificationError: `Out-of-lease edits detected: ${leaseValidation.outOfLeaseFiles.join(', ')}`,
            timedOut: execution.timedOut,
            stalled: false,
          },
          input.cwd,
        );
        await this.withLedgerLock(async () => {
          await setAssignmentStatus(task.id, 'conflicted', { cwd: input.cwd });
          await releaseTask(task.id, {
            toStatus: 'blocked',
            error: `Out-of-lease edits: ${leaseValidation.outOfLeaseFiles.join(', ')}`,
            cwd: input.cwd,
          });
        });
        await appendLedgerEvent(
          'lease_violation',
          {
            taskId: task.id,
            worker,
            outOfLeaseFiles: leaseValidation.outOfLeaseFiles,
          },
          input.cwd,
        );
        return { status: 'conflicted', taskId: task.id, worker };
      }

      if (execution.success) {
        await this.withLedgerLock(async () => {
          await updateTaskStatus(task.id, 'verify_pending', { cwd: input.cwd, error: null });
        });
        await appendLedgerEvent('verification_started', { taskId: task.id, worker }, input.cwd);

        const verification = await verifyTaskExecution({
          task,
          cwd: input.cwd,
          touchedFiles,
        });
        const latestTasks = await this.withLedgerLock(async () => loadTasksState(input.cwd));
        const drift = analyzeTaskDrift({
          task,
          touchedFiles,
          dependencyStatuses: task.dependencies.map((dependencyId) => ({
            taskId: dependencyId,
            status: latestTasks.tasks.find((candidate) => candidate.id === dependencyId)?.status ?? 'blocked',
          })),
        });

        if (!verification.passed || !drift.valid) {
          const driftSummary = drift.findings.map((finding) => finding.message).join('; ');
          const failureMessage = !verification.passed
            ? verification.summary
            : driftSummary || 'Drift validation failed';
          await appendLedgerEvent(
            'verification_failed',
            {
              taskId: task.id,
              worker,
              verification: verification.summary,
              driftFindings: drift.findings,
            },
            input.cwd,
          );
          await completeExecutionRecord(
            record.attemptId,
            {
              exitCode: execution.exitCode,
              stdout: execution.stdout,
              stderr: execution.stderr,
              touchedFiles,
              verificationResult: 'fail',
              verificationError: failureMessage,
              timedOut: execution.timedOut,
              stalled: false,
            },
            input.cwd,
          );
          await this.withLedgerLock(async () => {
            await releaseTask(task.id, { toStatus: 'failed', error: failureMessage, cwd: input.cwd });
          });
          return { status: 'failed', taskId: task.id, worker, error: failureMessage };
        }

        await appendLedgerEvent(
          'verification_passed',
          {
            taskId: task.id,
            worker,
            confidence: verification.confidence,
            summary: verification.summary,
          },
          input.cwd,
        );
        await completeExecutionRecord(
          record.attemptId,
          {
            exitCode: execution.exitCode,
            stdout: execution.stdout,
            stderr: execution.stderr,
            touchedFiles,
            verificationResult: 'pass',
            timedOut: execution.timedOut,
            stalled: false,
          },
          input.cwd,
        );
        await this.withLedgerLock(async () => {
          await completeTask(task.id, { worker, cwd: input.cwd });
        });
        return { status: 'completed', taskId: task.id, worker };
      }

      const failure = driver.classifyFailure(execution);
      await completeExecutionRecord(
        record.attemptId,
        {
          exitCode: execution.exitCode,
          stdout: execution.stdout,
          stderr: execution.stderr,
          touchedFiles,
          verificationResult: 'fail',
          verificationError: failure.message,
          timedOut: execution.timedOut,
          stalled: failure.kind === 'stall',
        },
        input.cwd,
      );

      const latestTask = await this.withLedgerLock(async () => getTask(task.id, input.cwd));
      const attemptCount = latestTask?.attemptCount ?? task.attemptCount;
      if (failure.retryable && attemptCount < task.maxRetries) {
        await this.withLedgerLock(async () => {
          await updateTaskStatus(task.id, 'pending', { cwd: input.cwd, error: failure.message });
          await setAssignmentStatus(task.id, 'needs_retry', { cwd: input.cwd, sessionId: null });
          await releaseFileLease(task.id, input.cwd);
        });
        await appendLedgerEvent('task_retried', { taskId: task.id, worker, reason: failure.message }, input.cwd);
        return { status: 'retry', taskId: task.id, worker };
      }

      await this.withLedgerLock(async () => {
        await releaseTask(task.id, { toStatus: 'failed', error: failure.message, cwd: input.cwd });
      });
      await appendLedgerEvent('task_failed', { taskId: task.id, worker, error: failure.message }, input.cwd);
      return { status: 'failed', taskId: task.id, worker, error: failure.message };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.withLedgerLock(async () => {
        await releaseTask(task.id, { toStatus: 'failed', error: message, cwd: input.cwd });
      });
      await appendLedgerEvent('task_failed', { taskId: task.id, worker, error: message }, input.cwd);
      return { status: 'failed', taskId: task.id, worker, error: message };
    }
  }
}

