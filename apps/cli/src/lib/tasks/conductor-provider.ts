import type { ConductorPlan, ConductorTask, ConductorTrack, VerificationStatus } from '@scrimble/shared';
import {
  getActiveTrack,
  getNextTask,
  getPlanStats,
  isTrackApproved,
  loadConductorWorkspace,
  parsePlan,
  updateTaskStatus,
} from '../conductor/index.js';
import { appendRuntimeEvent, loadRuntimeState, setRunStatus } from '../conductor/runtime.js';
import { runVerification } from '../verify/index.js';
import { appendActivity } from '../local/index.js';
import { recordTelemetry } from '../telemetry.js';
import { buildTaskPrompt } from '../gemini/session.js';
import { readTextIfExists } from '../fs/index.js';
import type {
  ActivateNextTaskResult,
  CompleteTaskOptions,
  CompleteTaskResult,
  PromptPayload,
  SkipTaskResult,
  TaskProvider,
  TaskProviderSummary,
  UnifiedTask,
} from './types.js';

interface ConductorContext {
  workspace: Awaited<ReturnType<typeof loadConductorWorkspace>>;
  runtimeState: Awaited<ReturnType<typeof loadRuntimeState>>;
  activeTrack?: ConductorTrack;
  plan?: ConductorPlan;
}

function toUnifiedTask(task: ConductorTask, track: ConductorTrack): UnifiedTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    prompt: task.rawMarkdown,
    provider: 'conductor',
    manualVerification: task.isManualVerification,
    trackId: track.id,
    trackTitle: track.title,
  };
}

export class ConductorTaskProvider implements TaskProvider {
  readonly kind = 'conductor' as const;

  constructor(private readonly cwd: string = process.cwd()) {}

  async getActiveTask(): Promise<UnifiedTask | null> {
    const context = await this.loadContext();
    if (!context.activeTrack || !context.plan) {
      return null;
    }

    const activeTask =
      (context.runtimeState.activeTaskId
        ? context.plan.tasks.find((task) => task.id === context.runtimeState.activeTaskId)
        : undefined) ??
      context.plan.tasks.find((task) => task.status === 'in_progress') ??
      context.plan.tasks.find((task) => task.status === 'pending');

    return activeTask ? toUnifiedTask(activeTask, context.activeTrack) : null;
  }

  async getNextTask(): Promise<UnifiedTask | null> {
    const context = await this.loadContext();
    if (!context.activeTrack || !context.plan) {
      return null;
    }

    const inProgress = context.plan.tasks.find((task) => task.status === 'in_progress');
    const nextPending = context.plan.tasks.find((task) => task.status === 'pending');
    const selected = inProgress ? nextPending : getNextTask(context.plan);
    return selected ? toUnifiedTask(selected, context.activeTrack) : null;
  }

  async getPromptPayload(): Promise<PromptPayload | null> {
    const context = await this.loadContext();
    if (!context.activeTrack || !context.plan) {
      return null;
    }

    const activeTask =
      (context.runtimeState.activeTaskId
        ? context.plan.tasks.find((task) => task.id === context.runtimeState.activeTaskId)
        : undefined) ?? getNextTask(context.plan);
    if (!activeTask) {
      return null;
    }

    const [productDescription, techStack, guidelines] = await Promise.all([
      readTextIfExists(context.workspace.productPath),
      readTextIfExists(context.workspace.techStackPath),
      readTextIfExists(context.workspace.guidelinesPath),
    ]);

    const prompt = buildTaskPrompt({
      task: {
        title: activeTask.title,
        description: activeTask.rawMarkdown,
        substeps: activeTask.substeps.map((substep) => substep.text),
        ...(activeTask.phase ? { phase: activeTask.phase } : {}),
      },
      trackContext: {
        ...(productDescription ? { productDescription } : {}),
        ...(techStack ? { techStack } : {}),
        ...(guidelines ? { guidelines } : {}),
      },
      doNotTouch: [],
      verificationHints: [],
    });

    return {
      task: toUnifiedTask(activeTask, context.activeTrack),
      prompt,
    };
  }

  async completeTask(options: CompleteTaskOptions): Promise<CompleteTaskResult | null> {
    const context = await this.loadContext();
    if (!context.activeTrack || !context.plan || !context.activeTrack.planPath) {
      return null;
    }

    const activeTask =
      (context.runtimeState.activeTaskId
        ? context.plan.tasks.find((task) => task.id === context.runtimeState.activeTaskId)
        : undefined) ??
      context.plan.tasks.find((task) => task.status === 'in_progress') ??
      context.plan.tasks.find((task) => task.status === 'pending');
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

    await updateTaskStatus(context.activeTrack.planPath, activeTask.id, 'completed');

    const refreshedPlan = await parsePlan(context.activeTrack.planPath, context.activeTrack.id);
    const nextPending = refreshedPlan.tasks.find((task) => task.status === 'pending');

    if (nextPending) {
      await updateTaskStatus(context.activeTrack.planPath, nextPending.id, 'in_progress');
      await appendRuntimeEvent(
        'task_started',
        { trackId: context.activeTrack.id, taskId: nextPending.id, source: 'manual_done' },
        this.cwd,
      );
      await setRunStatus('idle', { trackId: context.activeTrack.id, taskId: nextPending.id, cwd: this.cwd });
    } else {
      await appendRuntimeEvent('track_completed', { trackId: context.activeTrack.id, source: 'manual_done' }, this.cwd);
      await setRunStatus('completed', { trackId: context.activeTrack.id, taskId: activeTask.id, cwd: this.cwd });
    }

    await appendRuntimeEvent(
      'task_completed',
      {
        trackId: context.activeTrack.id,
        taskId: activeTask.id,
        verificationStatus,
        forced: options.force,
        ...(options.reason ? { reason: options.reason } : {}),
        source: 'manual_done',
      },
      this.cwd,
    );
    await appendActivity(
      'task_done',
      {
        trackId: context.activeTrack.id,
        taskId: activeTask.id,
        verificationStatus,
        forced: options.force,
        reason: options.reason ?? null,
        nextTaskId: nextPending?.id ?? null,
      },
      this.cwd,
    );
    await recordTelemetry({
      event: 'conductor_task_done',
      payload: {
        trackId: context.activeTrack.id,
        taskId: activeTask.id,
        verificationStatus,
        forced: options.force,
        nextTaskId: nextPending?.id ?? null,
      },
    });

    return {
      completedTask: toUnifiedTask(activeTask, context.activeTrack),
      ...(nextPending ? { nextTask: toUnifiedTask(nextPending, context.activeTrack) } : {}),
      verificationStatus,
    };
  }

  async skipTask(reason: string): Promise<SkipTaskResult | null> {
    const context = await this.loadContext();
    if (!context.activeTrack || !context.plan || !context.activeTrack.planPath) {
      return null;
    }

    const activeTask =
      (context.runtimeState.activeTaskId
        ? context.plan.tasks.find((task) => task.id === context.runtimeState.activeTaskId)
        : undefined) ??
      context.plan.tasks.find((task) => task.status === 'in_progress') ??
      context.plan.tasks.find((task) => task.status === 'pending');
    if (!activeTask) {
      return null;
    }

    await updateTaskStatus(context.activeTrack.planPath, activeTask.id, 'skipped');

    const refreshedPlan = await parsePlan(context.activeTrack.planPath, context.activeTrack.id);
    const nextPending = refreshedPlan.tasks.find((task) => task.status === 'pending');

    if (nextPending) {
      await updateTaskStatus(context.activeTrack.planPath, nextPending.id, 'in_progress');
      await appendRuntimeEvent(
        'task_started',
        { trackId: context.activeTrack.id, taskId: nextPending.id, source: 'manual_skip' },
        this.cwd,
      );
      await setRunStatus('idle', { trackId: context.activeTrack.id, taskId: nextPending.id, cwd: this.cwd });
    } else {
      await setRunStatus('paused', { trackId: context.activeTrack.id, cwd: this.cwd });
    }

    await appendRuntimeEvent(
      'task_skipped',
      {
        trackId: context.activeTrack.id,
        taskId: activeTask.id,
        reason,
        source: 'manual_skip',
      },
      this.cwd,
    );
    await appendActivity(
      'task_skipped',
      {
        trackId: context.activeTrack.id,
        taskId: activeTask.id,
        reason,
        nextTaskId: nextPending?.id ?? null,
      },
      this.cwd,
    );
    await recordTelemetry({
      event: 'conductor_task_skipped',
      level: 'warn',
      payload: {
        trackId: context.activeTrack.id,
        taskId: activeTask.id,
        reason,
        nextTaskId: nextPending?.id ?? null,
      },
    });

    return {
      skippedTask: toUnifiedTask(activeTask, context.activeTrack),
      ...(nextPending ? { nextTask: toUnifiedTask(nextPending, context.activeTrack) } : {}),
    };
  }

  async activateNextTask(): Promise<ActivateNextTaskResult> {
    const context = await this.loadContext();
    if (!context.activeTrack || !context.plan || !context.activeTrack.planPath) {
      return {};
    }

    const inProgress = context.plan.tasks.find((task) => task.status === 'in_progress');
    if (inProgress) {
      return {
        alreadyActiveTask: toUnifiedTask(inProgress, context.activeTrack),
      };
    }

    const nextPending = context.plan.tasks.find((task) => task.status === 'pending');
    if (!nextPending) {
      return {};
    }

    await updateTaskStatus(context.activeTrack.planPath, nextPending.id, 'in_progress');
    await setRunStatus('idle', { trackId: context.activeTrack.id, taskId: nextPending.id, cwd: this.cwd });
    await appendRuntimeEvent(
      'task_started',
      { trackId: context.activeTrack.id, taskId: nextPending.id, source: 'manual_next' },
      this.cwd,
    );
    await appendActivity('task_activated', { trackId: context.activeTrack.id, taskId: nextPending.id }, this.cwd);
    await recordTelemetry({
      event: 'conductor_task_activated',
      payload: {
        trackId: context.activeTrack.id,
        taskId: nextPending.id,
      },
    });

    return {
      activatedTask: toUnifiedTask(nextPending, context.activeTrack),
    };
  }

  async getSummary(): Promise<TaskProviderSummary> {
    const context = await this.loadContext();
    const quickActions = [
      'scrimble prompt',
      'scrimble run',
      'scrimble done',
      'scrimble skip',
      'scrimble next',
      'scrimble logs',
    ];

    if (!context.activeTrack || !context.plan) {
      return {
        kind: 'conductor',
        statusLabel: `Status: ${context.runtimeState.status}`,
        warnings: ['No active track is available.'],
        nextAction: 'scrimble generate "<goal>"',
        quickActions,
      };
    }

    const planStats = getPlanStats(context.plan);
    const activeTask =
      (context.runtimeState.activeTaskId
        ? context.plan.tasks.find((task) => task.id === context.runtimeState.activeTaskId)
        : undefined) ??
      context.plan.tasks.find((task) => task.status === 'in_progress');
    const nextTask = context.plan.tasks.find((task) => task.status === 'pending');
    const approved = await isTrackApproved(context.activeTrack.id, this.cwd);

    let nextAction = 'scrimble status';
    const warnings: string[] = [];
    if (!approved) {
      nextAction = `scrimble approve ${context.activeTrack.id}`;
    } else if (context.runtimeState.status === 'failed' || context.runtimeState.status === 'stuck') {
      nextAction = 'scrimble logs';
      warnings.push(`Run is ${context.runtimeState.status}.`);
    } else if (context.runtimeState.status === 'idle' || context.runtimeState.status === 'paused') {
      nextAction = 'scrimble run';
    }

    if (activeTask?.isManualVerification) {
      warnings.push('Manual verification checkpoint is active.');
      nextAction = 'scrimble done';
    }

    return {
      kind: 'conductor',
      statusLabel: `Status: ${context.runtimeState.status}`,
      progressLabel: `Tasks: ${planStats.completed}/${planStats.total} complete`,
      ...(activeTask ? { activeTask: toUnifiedTask(activeTask, context.activeTrack) } : {}),
      ...(nextTask ? { nextTask: toUnifiedTask(nextTask, context.activeTrack) } : {}),
      warnings,
      nextAction,
      quickActions,
    };
  }

  private async loadContext(): Promise<ConductorContext> {
    const workspace = await loadConductorWorkspace(this.cwd);
    const runtimeState = await loadRuntimeState(this.cwd);
    if (!workspace.exists) {
      return { workspace, runtimeState };
    }

    const activeTrack =
      (runtimeState.activeTrackId
        ? workspace.tracks.find((track) => track.id === runtimeState.activeTrackId)
        : undefined) ?? getActiveTrack(workspace);
    if (!activeTrack || !activeTrack.planPath) {
      return { workspace, runtimeState, ...(activeTrack ? { activeTrack } : {}) };
    }

    const plan = await parsePlan(activeTrack.planPath, activeTrack.id);
    return {
      workspace,
      runtimeState,
      activeTrack,
      plan,
    };
  }
}
