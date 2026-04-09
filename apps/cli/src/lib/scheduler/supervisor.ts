import { createHash } from 'node:crypto';
import type { LedgerTask, WorkerDriver, WorkerHealth, WorkerKind } from '@scrimble/shared';
import {
  completeTask,
  getReadyTasks,
  getTask,
  leaseTask,
  releaseTask,
  setAssignmentStatus,
  updateTaskStatus,
} from '../ledger/operations.js';
import { appendLedgerEvent, completeExecutionRecord, startExecutionRecord } from '../ledger/records.js';
import { mutateLedger, readLedger } from '../ledger/storage.js';
import { getWorkerDriver } from '../workers/factory.js';
import { detectOutOfScopeEdits, hasExplicitOwnership } from './parallel.js';
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

export class LedgerSupervisor {
  async run(options: SupervisorRunOptions = {}): Promise<SupervisorRunResult> {
    const cwd = options.cwd ?? process.cwd();
    const workerSelection = options.worker ?? 'auto';
    const timeoutMs = options.timeoutMs ?? 300_000;
    const maxTasks = options.maxTasks ?? Number.POSITIVE_INFINITY;

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

    await appendLedgerEvent(
      'run_started',
      {
        worker: workerSelection,
        parallel: 1,
        timeoutMs,
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

    let processed = 0;
    while (processed < maxTasks) {
      const readyTasks = await getReadyTasks(cwd);
      if (readyTasks.length === 0) {
        break;
      }

      const nextTask = readyTasks[0];
      if (!nextTask) {
        break;
      }

      if (!hasExplicitOwnership(nextTask)) {
        await releaseTask(nextTask.id, {
          toStatus: 'blocked',
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
        processed += 1;
        continue;
      }

      const workersForRouting = Object.values(workerHealthByKind);
      if (!workersForRouting.some((worker) => worker.available)) {
        break;
      }

      let worker: WorkerKind;
      try {
        worker = routeTask(nextTask, {
          workers: workersForRouting,
          ...(workerSelection === 'auto' ? {} : { manualWorker: workerSelection }),
        }).worker;
      } catch {
        break;
      }

      const taskResult = await this.runSingleTask(nextTask, {
        worker,
        cwd,
        timeoutMs,
      });
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
      await leaseTask(task.id, worker, { cwd: input.cwd });
      await appendLedgerEvent('task_leased', { taskId: task.id, worker }, input.cwd);

      const contextArtifacts = await driver.discoverContextArtifacts();
      const ledger = await readLedger(input.cwd);
      const prompt = driver.buildPrompt(task, contextArtifacts, {
        tasks: ledger.tasks,
        assignments: ledger.assignments,
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

      await updateTaskStatus(task.id, 'running', { incrementAttempt: true, error: null, cwd: input.cwd });
      await setAssignmentStatus(task.id, 'in_progress', { cwd: input.cwd });

      const handle = await driver.startExecution(prompt, {
        timeout: input.timeoutMs,
        cwd: input.cwd,
        outputFormat: 'json',
        approvalMode: 'yolo',
        checkpointing: true,
      });
      const execution = await driver.waitForCompletion(handle);
      const touchedFiles = driver.extractTouchedFiles(execution);

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
        await setAssignmentStatus(task.id, 'conflicted', { cwd: input.cwd });
        await releaseTask(task.id, {
          toStatus: 'blocked',
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
        await updateTaskStatus(task.id, 'verify_pending', { cwd: input.cwd, error: null });
        await appendLedgerEvent('verification_started', { taskId: task.id, worker }, input.cwd);

        const verification = await verifyTaskExecution({
          task,
          cwd: input.cwd,
          touchedFiles,
        });
        const latestTasks = (await readLedger(input.cwd)).tasks;
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
          await releaseTask(task.id, { toStatus: 'failed', error: failureMessage, cwd: input.cwd });
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
        await completeTask(task.id, { worker, cwd: input.cwd });
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
      const attemptCount = latestTask?.attemptCount ?? task.attemptCount;
      if (failure.retryable && attemptCount < task.maxRetries) {
        await releaseTask(task.id, { toStatus: 'pending', error: failure.message, cwd: input.cwd });
        await appendLedgerEvent('task_retried', { taskId: task.id, worker, reason: failure.message }, input.cwd);
        return { status: 'retry', taskId: task.id, worker };
      }

      await releaseTask(task.id, { toStatus: 'failed', error: failure.message, cwd: input.cwd });
      await appendLedgerEvent('task_failed', { taskId: task.id, worker, error: failure.message }, input.cwd);
      return { status: 'failed', taskId: task.id, worker, error: failure.message };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await releaseTask(task.id, { toStatus: 'failed', error: message, cwd: input.cwd });
      await appendLedgerEvent('task_failed', { taskId: task.id, worker, error: message }, input.cwd);
      return { status: 'failed', taskId: task.id, worker, error: message };
    }
  }
}

