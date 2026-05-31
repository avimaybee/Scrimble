import { createHash } from 'node:crypto';
import type { LedgerTask, WorkerDriver, WorkerHealth, WorkerKind } from '@scrimble/shared';
import {
  completeActiveTask,
  failActiveTask,
  getReadyTasks,
  getTask,
  startNextReadyTask,
  updateActiveExecution,
  updateTaskStatus,
  blockActiveTask,
  clearActiveExecution,
} from '../ledger/operations.js';
import { appendLedgerEvent, completeExecutionRecord, startExecutionRecord } from '../ledger/records.js';
import { mutateLedger, readLedger } from '../ledger/storage.js';
import { getWorkerDriver } from '../workers/factory.js';
import { detectOutOfScopeEdits, hasExplicitOwnership } from './ownership.js';
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

function nowIso(): string {
  return new Date().toISOString();
}

function createDriver(worker: WorkerKind, cwd: string): WorkerDriver {
  return getWorkerDriver(worker, { cwd });
}

function toWorkerHealthMap(ledgerWorkers: WorkerHealth[]): Record<WorkerKind, WorkerHealth> {
  return {
    gemini: ledgerWorkers.find((worker) => worker.kind === 'gemini') ?? {
      kind: 'gemini',
      available: false,
      tasksCompleted: 0,
      tasksFailed: 0,
    },
    copilot: ledgerWorkers.find((worker) => worker.kind === 'copilot') ?? {
      kind: 'copilot',
      available: false,
      tasksCompleted: 0,
      tasksFailed: 0,
    },
  };
}

function normalizeBoundedExecution(options: SupervisorRunOptions): { parallel: number; maxTasks: number } {
  const requestedParallel = options.parallel ?? 1;
  const requestedMaxTasks = options.maxTasks ?? 1;
  return {
    parallel: requestedParallel > 1 ? 1 : Math.max(1, requestedParallel),
    maxTasks: requestedMaxTasks > 1 ? 1 : Math.max(1, requestedMaxTasks),
  };
}

export class LedgerSupervisor {
  async run(options: SupervisorRunOptions = {}): Promise<SupervisorRunResult> {
    const cwd = options.cwd ?? process.cwd();
    const workerSelection = options.worker ?? 'auto';
    const timeoutMs = options.timeoutMs ?? 300_000;
    const bounded = normalizeBoundedExecution(options);

    const ledger = await readLedger(cwd);
    if (ledger.tasks.tasks.length > 0 && !ledger.approval.approved) {
      await appendLedgerEvent(
        'run_paused',
        {
          reason: 'approval_required',
          suggestedAction: 'confirm a mutating conversational plan before execution',
        },
        cwd,
      );
      throw new Error('Ledger execution requires a confirmed conversational plan before dispatch.');
    }

    if (ledger.runtime.activeExecution) {
      await appendLedgerEvent(
        'run_paused',
        {
          reason: 'active_execution_present',
          taskId: ledger.runtime.activeExecution.taskId,
        },
        cwd,
      );
      throw new Error(`Cannot start a new run while task ${ledger.runtime.activeExecution.taskId} is still active.`);
    }

    await appendLedgerEvent(
      'run_started',
      {
        worker: workerSelection,
        parallel: bounded.parallel,
        maxTasks: bounded.maxTasks,
        timeoutMs,
        ...(options.parallel && options.parallel > 1 ? { normalizedParallel: options.parallel } : {}),
        ...(options.maxTasks && options.maxTasks > 1 ? { normalizedMaxTasks: options.maxTasks } : {}),
      },
      cwd,
    );

    const workerHealthByKind = toWorkerHealthMap(ledger.workers.workers);
    const candidateWorkers: WorkerKind[] = workerSelection === 'auto' ? ['gemini', 'copilot'] : [workerSelection];
    const preflights = await Promise.all(
      candidateWorkers.map(async (worker) => {
        const driver = createDriver(worker, cwd);
        const preflight = await driver.preflight();
        return { worker, preflight };
      }),
    );

    for (const { worker, preflight } of preflights) {
      const current = workerHealthByKind[worker];
      workerHealthByKind[worker] = {
        ...current,
        available: preflight.available,
        ...(preflight.errors.length > 0 ? { error: preflight.errors[0] } : {}),
      };
      if (preflight.available) {
        await appendLedgerEvent('worker_available', { worker }, cwd);
      } else {
        await appendLedgerEvent(
          'worker_unavailable',
          {
            worker,
            errors: preflight.errors,
          },
          cwd,
        );
      }
    }

    const result: SupervisorRunResult = {
      completedTaskIds: [],
      failedTaskIds: [],
      conflictedTaskIds: [],
      retriedTaskIds: [],
      skippedTaskIds: [],
    };

    const readyTasks = await getReadyTasks(cwd);
    const nextTask = readyTasks[0];
    if (nextTask) {
      if (!hasExplicitOwnership(nextTask)) {
        await updateTaskStatus(nextTask.id, 'blocked', {
          error: 'Task has no explicit owned files; execution was paused for safety.',
          cwd,
        });
        await appendLedgerEvent(
          'task_blocked',
          {
            taskId: nextTask.id,
            reason: 'missing_owned_files',
          },
          cwd,
        );
        result.skippedTaskIds.push(nextTask.id);
      } else {
        const workersForRouting = Object.values(workerHealthByKind);
        const availableWorkers = workersForRouting.filter((worker) => worker.available);
        if (availableWorkers.length > 0) {
          const worker = routeTask(nextTask, {
            workers: workersForRouting,
            ...(workerSelection === 'auto' ? {} : { manualWorker: workerSelection }),
          }).worker;
          const taskResult = await this.runSingleTask(nextTask, {
            worker,
            cwd,
            timeoutMs,
          });

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
    }

    await mutateLedger(cwd, (latest) => {
      latest.workers = {
        version: latest.workers.version,
        workers: Object.values(workerHealthByKind),
        updatedAt: nowIso(),
      };
    });

    await appendLedgerEvent(
      'run_completed',
      {
        completed: result.completedTaskIds.length,
        failed: result.failedTaskIds.length,
        conflicted: result.conflictedTaskIds.length,
        retried: result.retriedTaskIds.length,
        skipped: result.skippedTaskIds.length,
      },
      cwd,
    );

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
      const activeTask = await startNextReadyTask({
        worker,
        taskId: task.id,
        phase: 'dispatching',
        statusMessage: `Dispatching ${task.id}`,
        cwd: input.cwd,
      });

      const contextArtifacts = await driver.discoverContextArtifacts();
      const ledger = await readLedger(input.cwd);
      const prompt = driver.buildPrompt(activeTask, contextArtifacts, {
        tasks: ledger.tasks,
        runtime: ledger.runtime,
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

      await updateActiveExecution({
        phase: 'executing',
        statusMessage: `Executing ${task.id}`,
        cwd: input.cwd,
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

      await updateActiveExecution({
        phase: 'verifying',
        statusMessage: `Verifying ${task.id}`,
        cwd: input.cwd,
      });

      const scopeValidation = detectOutOfScopeEdits(task, touchedFiles);
      if (!scopeValidation.valid) {
        const message = `Out-of-scope edits: ${scopeValidation.outOfScopeFiles.join(', ')}`;
        await completeExecutionRecord(
          record.attemptId,
          {
            exitCode: execution.exitCode,
            stdout: execution.stdout,
            stderr: execution.stderr,
            touchedFiles,
            verificationResult: 'fail',
            verificationError: message,
            timedOut: execution.timedOut,
            stalled: false,
          },
          input.cwd,
        );
        await blockActiveTask({
          taskId: task.id,
          error: message,
          cwd: input.cwd,
        });
        await appendLedgerEvent(
          'task_blocked',
          {
            taskId: task.id,
            worker,
            outOfScopeFiles: scopeValidation.outOfScopeFiles,
          },
          input.cwd,
        );
        return { status: 'conflicted', taskId: task.id, worker };
      }

      if (execution.success) {
        await appendLedgerEvent('verification_started', { taskId: task.id, worker }, input.cwd);

        const verification = await verifyTaskExecution({
          task: activeTask,
          cwd: input.cwd,
          touchedFiles,
        });
        const latestTasks = (await readLedger(input.cwd)).tasks;
        const drift = analyzeTaskDrift({
          task: activeTask,
          touchedFiles,
          dependencyStatuses: activeTask.dependencies.map((dependencyId) => ({
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
          await failActiveTask({
            taskId: task.id,
            toStatus: 'failed',
            error: failureMessage,
            cwd: input.cwd,
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
        await completeActiveTask({ taskId: task.id, cwd: input.cwd });
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

      const latestTask = await getTask(task.id, input.cwd);
      const attemptCount = latestTask?.attemptCount ?? activeTask.attemptCount;
      if (failure.retryable && attemptCount < activeTask.maxRetries) {
        await failActiveTask({
          taskId: task.id,
          toStatus: 'ready',
          error: failure.message,
          cwd: input.cwd,
        });
        await appendLedgerEvent('task_retried', { taskId: task.id, worker, reason: failure.message }, input.cwd);
        return { status: 'retry', taskId: task.id, worker };
      }

      await failActiveTask({
        taskId: task.id,
        toStatus: 'failed',
        error: failure.message,
        cwd: input.cwd,
      });
      await appendLedgerEvent('task_failed', { taskId: task.id, worker, error: failure.message }, input.cwd);
      return { status: 'failed', taskId: task.id, worker, error: failure.message };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await failActiveTask({
          taskId: task.id,
          toStatus: 'failed',
          error: message,
          cwd: input.cwd,
        });
      } catch {
        try {
          await clearActiveExecution({ taskId: task.id, cwd: input.cwd });
        } catch (clearError) {
          await appendLedgerEvent(
            'run_failed',
            {
              taskId: task.id,
              error: clearError instanceof Error ? clearError.message : String(clearError),
            },
            input.cwd,
          );
        }
        await updateTaskStatus(task.id, 'failed', { error: message, cwd: input.cwd });
      }
      await appendLedgerEvent('task_failed', { taskId: task.id, worker, error: message }, input.cwd);
      return { status: 'failed', taskId: task.id, worker, error: message };
    }
  }
}
