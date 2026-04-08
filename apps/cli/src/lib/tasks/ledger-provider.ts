import type { Assignment, LedgerTask, TaskStatus, VerificationStatus } from '@scrimble/shared';
import {
  completeTask as completeLedgerTask,
  getReadyTasks,
  releaseTask,
} from '../ledger/operations.js';
import { loadAssignmentsState, loadTasksState } from '../ledger/storage.js';
import { runVerification } from '../verify/index.js';
import { appendActivity } from '../local/index.js';
import { recordTelemetry } from '../telemetry.js';
import type {
  ActivateNextTaskResult,
  CompleteTaskOptions,
  CompleteTaskResult,
  PromptPayload,
  SkipTaskResult,
  TaskProvider,
  TaskProviderSummary,
  UnifiedTask,
  UnifiedTaskStatus,
} from './types.js';

function toUnifiedStatus(status: TaskStatus): UnifiedTaskStatus {
  switch (status) {
    case 'running':
    case 'leased':
    case 'verify_pending':
      return 'in_progress';
    case 'failed':
      return 'failed';
    case 'blocked':
      return 'blocked';
    case 'completed':
      return 'completed';
    default:
      return 'pending';
  }
}

function renderPrompt(task: LedgerTask): string {
  const ownedFiles = task.ownedFiles.length > 0 ? task.ownedFiles.map((entry) => `- ${entry}`).join('\n') : '- (none)';
  const allowedFiles = task.allowedFiles.length > 0 ? task.allowedFiles.map((entry) => `- ${entry}`).join('\n') : '- (none)';
  const verification = task.verificationCommands.length > 0
    ? task.verificationCommands.map((entry) => `- ${entry}`).join('\n')
    : '- Run `scrimble verify`';

  return [
    `# ${task.title}`,
    '',
    '## Objective',
    task.objective,
    '',
    '## Done Criteria',
    task.doneCriteria,
    '',
    '## Owned Files',
    ownedFiles,
    '',
    '## Allowed Files',
    allowedFiles,
    '',
    '## Verification',
    verification,
    '',
  ].join('\n');
}

function toUnifiedTask(task: LedgerTask): UnifiedTask {
  return {
    id: task.id,
    title: task.title,
    status: toUnifiedStatus(task.status),
    prompt: renderPrompt(task),
    provider: 'ledger',
    manualVerification: false,
    doneWhen: task.doneCriteria,
  };
}

function findActiveTask(tasks: LedgerTask[], assignments: Assignment[]): LedgerTask | undefined {
  const assignmentInProgress = assignments.find((assignment) => assignment.status === 'in_progress');
  if (assignmentInProgress) {
    const assignedTask = tasks.find((task) => task.id === assignmentInProgress.taskId);
    if (assignedTask) {
      return assignedTask;
    }
  }
  return tasks.find((task) => task.status === 'running' || task.status === 'leased' || task.status === 'verify_pending');
}

export class LedgerTaskProvider implements TaskProvider {
  readonly kind = 'ledger' as const;

  constructor(private readonly cwd: string = process.cwd()) {}

  async getActiveTask(): Promise<UnifiedTask | null> {
    const [tasksState, assignmentsState] = await Promise.all([
      loadTasksState(this.cwd),
      loadAssignmentsState(this.cwd),
    ]);
    const activeTask = findActiveTask(tasksState.tasks, assignmentsState.assignments);
    return activeTask ? toUnifiedTask(activeTask) : null;
  }

  async getNextTask(): Promise<UnifiedTask | null> {
    const ready = await getReadyTasks(this.cwd);
    const next = ready[0];
    return next ? toUnifiedTask(next) : null;
  }

  async getPromptPayload(): Promise<PromptPayload | null> {
    const [tasksState, assignmentsState] = await Promise.all([
      loadTasksState(this.cwd),
      loadAssignmentsState(this.cwd),
    ]);
    const activeTask = findActiveTask(tasksState.tasks, assignmentsState.assignments);
    const nextReady = activeTask ?? (await getReadyTasks(this.cwd))[0];
    if (!nextReady) {
      return null;
    }

    return {
      task: toUnifiedTask(nextReady),
      prompt: renderPrompt(nextReady),
    };
  }

  async completeTask(options: CompleteTaskOptions): Promise<CompleteTaskResult | null> {
    const [tasksState, assignmentsState] = await Promise.all([
      loadTasksState(this.cwd),
      loadAssignmentsState(this.cwd),
    ]);
    const activeTask = findActiveTask(tasksState.tasks, assignmentsState.assignments) ?? (await getReadyTasks(this.cwd))[0];
    if (!activeTask) {
      return null;
    }

    let verificationStatus: VerificationStatus | null = null;
    if (!options.skipVerification) {
      const verification = await runVerification({
        ...(options.verifyCommands ? { commands: options.verifyCommands } : {}),
      });
      verificationStatus = verification.status;

      if (verification.status === 'fail' && !options.force) {
        throw new Error('Verification failed. Use --force with --reason to override.');
      }
      if (verification.status === 'fail' && options.force && !options.reason) {
        throw new Error('Override requires --reason when verification fails.');
      }
    }

    await completeLedgerTask(activeTask.id, { cwd: this.cwd });
    const nextReady = (await getReadyTasks(this.cwd))[0];

    await appendActivity(
      'task_done',
      {
        taskId: activeTask.id,
        verificationStatus,
        forced: options.force,
        reason: options.reason ?? null,
        nextTaskId: nextReady?.id ?? null,
      },
      this.cwd,
    );
    await recordTelemetry({
      event: 'ledger_task_done',
      payload: {
        taskId: activeTask.id,
        verificationStatus,
        forced: options.force,
        nextTaskId: nextReady?.id ?? null,
      },
    });

    return {
      completedTask: toUnifiedTask({ ...activeTask, status: 'completed' }),
      ...(nextReady ? { nextTask: toUnifiedTask(nextReady) } : {}),
      verificationStatus,
    };
  }

  async skipTask(reason: string): Promise<SkipTaskResult | null> {
    const [tasksState, assignmentsState] = await Promise.all([
      loadTasksState(this.cwd),
      loadAssignmentsState(this.cwd),
    ]);
    const activeTask = findActiveTask(tasksState.tasks, assignmentsState.assignments) ?? (await getReadyTasks(this.cwd))[0];
    if (!activeTask) {
      return null;
    }

    await releaseTask(activeTask.id, {
      toStatus: 'blocked',
      error: `Skipped: ${reason}`,
      cwd: this.cwd,
    });

    const nextReady = (await getReadyTasks(this.cwd))[0];
    await appendActivity(
      'task_skipped',
      {
        taskId: activeTask.id,
        reason,
        nextTaskId: nextReady?.id ?? null,
      },
      this.cwd,
    );
    await recordTelemetry({
      event: 'ledger_task_skipped',
      level: 'warn',
      payload: {
        taskId: activeTask.id,
        reason,
      },
    });

    return {
      skippedTask: toUnifiedTask({ ...activeTask, status: 'blocked' }),
      ...(nextReady ? { nextTask: toUnifiedTask(nextReady) } : {}),
    };
  }

  async activateNextTask(): Promise<ActivateNextTaskResult> {
    const [tasksState, assignmentsState] = await Promise.all([
      loadTasksState(this.cwd),
      loadAssignmentsState(this.cwd),
    ]);
    const activeTask = findActiveTask(tasksState.tasks, assignmentsState.assignments);
    if (activeTask) {
      return {
        alreadyActiveTask: toUnifiedTask(activeTask),
      };
    }

    const nextReady = (await getReadyTasks(this.cwd))[0];
    if (!nextReady) {
      return {};
    }

    return {
      activatedTask: toUnifiedTask(nextReady),
    };
  }

  async getSummary(): Promise<TaskProviderSummary> {
    const [tasksState, assignmentsState] = await Promise.all([
      loadTasksState(this.cwd),
      loadAssignmentsState(this.cwd),
    ]);
    const tasks = tasksState.tasks;
    const completed = tasks.filter((task) => task.status === 'completed').length;
    const failed = tasks.filter((task) => task.status === 'failed').length;
    const blocked = tasks.filter((task) => task.status === 'blocked').length;
    const pending = tasks.filter((task) => task.status === 'pending').length;
    const active = findActiveTask(tasks, assignmentsState.assignments);
    const nextReady = (await getReadyTasks(this.cwd))[0];

    const warnings: string[] = [];
    if (failed > 0) {
      warnings.push(`${failed} task(s) failed and need retry.`);
    }
    if (blocked > 0) {
      warnings.push(`${blocked} task(s) are blocked.`);
    }

    let nextAction = 'scrimble status';
    if (tasks.length === 0) {
      nextAction = 'scrimble generate';
    } else if (failed > 0 || blocked > 0) {
      nextAction = 'scrimble conflicts';
    } else if (active) {
      nextAction = 'scrimble prompt';
    } else if (nextReady || pending > 0) {
      nextAction = 'scrimble run --worker auto';
    }

    return {
      kind: 'ledger',
      statusLabel: `Progress: ${completed}/${tasks.length} completed`,
      progressLabel: `pending=${pending} blocked=${blocked} failed=${failed}`,
      ...(active ? { activeTask: toUnifiedTask(active) } : {}),
      ...(nextReady ? { nextTask: toUnifiedTask(nextReady) } : {}),
      warnings,
      nextAction,
      quickActions: [
        'scrimble status',
        'scrimble prompt',
        'scrimble run --worker auto',
        'scrimble done',
        'scrimble retry',
      ],
    };
  }
}

