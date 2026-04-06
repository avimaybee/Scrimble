import type { VerificationStatus } from '@scrimble/shared';
import {
  appendActivity,
  getActiveChunk,
  getCompletionStats,
  getNextPendingChunk,
  loadPlanState,
  renderChunkMarkdown,
  savePlanState,
  writeCurrentChunkFromPlan,
  type LocalChunk,
} from '../local/index.js';
import { detectStaleness } from '../staleness.js';
import { runVerification } from '../verify/index.js';
import {
  formatCloudError,
  recordChunkCompletion,
  resolveCloudClientConfig,
} from '../api/index.js';
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
} from './types.js';

function toUnifiedTask(chunk: LocalChunk): UnifiedTask {
  const status = chunk.status === 'active' ? 'in_progress' : chunk.status;
  return {
    id: chunk.id,
    title: chunk.title,
    status,
    prompt: chunk.prompt,
    provider: 'legacy',
    manualVerification: false,
    ...(chunk.doneWhen ? { doneWhen: chunk.doneWhen } : {}),
    ...(chunk.doNotTouch ? { doNotTouch: chunk.doNotTouch } : {}),
    ...(chunk.verificationSignals ? { verificationSignals: chunk.verificationSignals } : {}),
  };
}

export class LegacyTaskProvider implements TaskProvider {
  readonly kind = 'legacy' as const;

  constructor(private readonly cwd: string = process.cwd()) {}

  async getActiveTask(): Promise<UnifiedTask | null> {
    const plan = await loadPlanState(this.cwd);
    const active = getActiveChunk(plan);
    return active ? toUnifiedTask(active) : null;
  }

  async getNextTask(): Promise<UnifiedTask | null> {
    const plan = await loadPlanState(this.cwd);
    const next = getNextPendingChunk(plan);
    return next ? toUnifiedTask(next) : null;
  }

  async getPromptPayload(): Promise<PromptPayload | null> {
    const plan = await loadPlanState(this.cwd);
    const active = getActiveChunk(plan);
    if (!active) {
      return null;
    }

    return {
      task: toUnifiedTask(active),
      prompt: renderChunkMarkdown(active),
    };
  }

  async completeTask(options: CompleteTaskOptions): Promise<CompleteTaskResult | null> {
    const plan = await loadPlanState(this.cwd);
    const activeChunk = getActiveChunk(plan);
    if (!activeChunk) {
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

    const now = new Date().toISOString();
    const completedChunks = plan.chunks.map((chunk) =>
      chunk.id === activeChunk.id
        ? { ...chunk, status: 'completed' as const, completedAt: now, updatedAt: now }
        : chunk,
    );
    const nextPending = getNextPendingChunk({ ...plan, chunks: completedChunks });
    const finalChunks = completedChunks.map((chunk) =>
      nextPending && chunk.id === nextPending.id
        ? { ...chunk, status: 'active' as const, updatedAt: now }
        : chunk,
    );

    const completionPayload = {
      chunkId: activeChunk.id,
      chunkTitle: activeChunk.title,
      completedAt: now,
      verificationStatus,
      forced: options.force,
      reason: options.reason ?? null,
      nextChunkId: nextPending?.id ?? null,
    };

    const syncState = { ...(plan.sync ?? {}) };
    delete syncState.lastSyncError;

    const nextPlan = {
      ...plan,
      chunks: finalChunks,
      sync: syncState,
    };

    let cloudRecorded = false;
    let cloudError: string | undefined;
    if (options.cloud) {
      try {
        const cloudConfig = await resolveCloudClientConfig(this.cwd);
        await recordChunkCompletion(cloudConfig, {
          chunkId: activeChunk.id,
          chunkTitle: activeChunk.title,
          ...(verificationStatus ? { verificationStatus } : {}),
          forced: options.force,
          reason: options.reason ?? null,
          nextChunkId: nextPending?.id ?? null,
          completedAt: now,
        });
        cloudRecorded = true;
      } catch (error) {
        cloudError = formatCloudError(error);
        await recordTelemetry({
          event: 'chunk_done_cloud_emit_failed',
          level: 'warn',
          payload: { message: cloudError },
        });
      }
    }

    await savePlanState(nextPlan, this.cwd);
    await writeCurrentChunkFromPlan(nextPlan, this.cwd);
    await appendActivity(
      'chunk_done',
      {
        ...completionPayload,
        cloudRecorded,
        cloudError: cloudError ?? null,
      },
      this.cwd,
    );
    await recordTelemetry({
      event: 'chunk_done',
      payload: {
        ...completionPayload,
        cloudRecorded,
      },
    });

    return {
      completedTask: toUnifiedTask({ ...activeChunk, status: 'completed' }),
      ...(nextPending ? { nextTask: toUnifiedTask(nextPending) } : {}),
      verificationStatus,
      cloudRecorded,
      ...(cloudError ? { cloudError } : {}),
    };
  }

  async skipTask(reason: string): Promise<SkipTaskResult | null> {
    const plan = await loadPlanState(this.cwd);
    const activeChunk = getActiveChunk(plan);
    if (!activeChunk) {
      return null;
    }

    const timestamp = new Date().toISOString();
    let activatedNextId: string | undefined;
    const updatedChunks = plan.chunks.map((chunk) => {
      if (chunk.id === activeChunk.id) {
        return {
          ...chunk,
          status: 'skipped' as const,
          skipReason: reason,
          skippedAt: timestamp,
          updatedAt: timestamp,
        };
      }
      return chunk;
    });

    const firstPendingIndex = updatedChunks.findIndex((chunk) => chunk.status === 'pending');
    if (firstPendingIndex !== -1) {
      const pendingChunk = updatedChunks[firstPendingIndex];
      if (!pendingChunk) {
        throw new Error('Pending chunk lookup failed during skip flow.');
      }
      activatedNextId = pendingChunk.id;
      updatedChunks[firstPendingIndex] = {
        ...pendingChunk,
        status: 'active',
        updatedAt: timestamp,
      };
    }

    const nextPlan = { ...plan, chunks: updatedChunks };
    const nextTask = activatedNextId
      ? nextPlan.chunks.find((chunk) => chunk.id === activatedNextId)
      : undefined;

    await savePlanState(nextPlan, this.cwd);
    await writeCurrentChunkFromPlan(nextPlan, this.cwd);
    await appendActivity('chunk_skipped', {
      chunkId: activeChunk.id,
      reason,
      activatedNextId: activatedNextId ?? null,
    }, this.cwd);
    await recordTelemetry({
      event: 'chunk_skipped',
      level: 'warn',
      payload: {
        chunkId: activeChunk.id,
        reason,
      },
    });

    return {
      skippedTask: toUnifiedTask({ ...activeChunk, status: 'skipped' }),
      ...(nextTask ? { nextTask: toUnifiedTask(nextTask) } : {}),
    };
  }

  async activateNextTask(): Promise<ActivateNextTaskResult> {
    const plan = await loadPlanState(this.cwd);
    const alreadyActive = getActiveChunk(plan);
    if (alreadyActive) {
      return {
        alreadyActiveTask: toUnifiedTask(alreadyActive),
      };
    }

    const nextChunk = getNextPendingChunk(plan);
    if (!nextChunk) {
      return {};
    }

    const activatedAt = new Date().toISOString();
    const nextChunks = plan.chunks.map((chunk) =>
      chunk.id === nextChunk.id
        ? {
          ...chunk,
          status: 'active' as const,
          updatedAt: activatedAt,
        }
        : chunk.status === 'active'
          ? { ...chunk, status: 'pending' as const, updatedAt: activatedAt }
          : chunk,
    );

    const activated = { ...plan, chunks: nextChunks };
    await savePlanState(activated, this.cwd);
    await writeCurrentChunkFromPlan(activated, this.cwd);
    await appendActivity('chunk_activated', { chunkId: nextChunk.id }, this.cwd);
    await recordTelemetry({
      event: 'chunk_activated',
      payload: { chunkId: nextChunk.id },
    });

    return {
      activatedTask: toUnifiedTask({ ...nextChunk, status: 'active' }),
    };
  }

  async getSummary(): Promise<TaskProviderSummary> {
    const plan = await loadPlanState(this.cwd);
    const stats = getCompletionStats(plan);
    const active = getActiveChunk(plan);
    const next = getNextPendingChunk(plan);
    const staleIssues = await detectStaleness(plan);
    const warnings = staleIssues.map((issue) => issue.message);

    if (plan.architecture?.approved === false) {
      warnings.unshift('Architecture is not approved.');
    }

    let nextAction = 'scrimble prompt';
    if (plan.architecture?.approved === false) {
      nextAction = 'scrimble approve';
    } else if (!active && next) {
      nextAction = 'scrimble next';
    } else if (!active && !next) {
      nextAction = 'scrimble generate';
    }

    return {
      kind: 'legacy',
      statusLabel: `Progress: ${stats.completed}/${stats.total} complete (${stats.skipped} skipped)`,
      ...(active ? { activeTask: toUnifiedTask(active) } : {}),
      ...(next ? { nextTask: toUnifiedTask(next) } : {}),
      warnings,
      nextAction,
      quickActions: [
        'scrimble prompt',
        'scrimble verify',
        'scrimble done',
        'scrimble skip',
        'scrimble next',
        'scrimble sync',
      ],
    };
  }
}
