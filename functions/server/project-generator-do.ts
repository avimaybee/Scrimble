import {
  GenerationPipelineError,
  MAX_PROJECT_GENERATION_RETRY_ATTEMPTS,
  processProjectGeneration,
  RetryableGenerationPipelineError,
} from './generation-pipeline';
import { persistGenerationStreamEvent } from './generation-events';
import type {
  Bindings,
  DurableObjectAlarmInfoLike,
  DurableObjectStateLike,
  QueueMessageBody,
} from './types';

type ProjectGeneratorRequestBody = QueueMessageBody & {
  kind?: string;
  previousStatus?: string | null;
  targetStatus?: string;
};

type ScheduledRetry = {
  action: string;
  attempts: number;
  message: QueueMessageBody;
};

const RETRY_STORAGE_KEY = 'scheduled-retry';

function isProjectGeneratorRequestBody(value: unknown): value is ProjectGeneratorRequestBody {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === 'generate_project'
    && typeof candidate.projectId === 'string'
    && candidate.projectId.trim().length > 0
    && typeof candidate.userId === 'string'
    && candidate.userId.trim().length > 0
    && typeof candidate.runId === 'string'
    && candidate.runId.trim().length > 0
    && (candidate.providerId === undefined || typeof candidate.providerId === 'string')
  );
}

export class ProjectGeneratorDO {
  private pipelineChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: Bindings,
  ) {}

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/state') {
      return Response.json({ scheduled: true });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed.' }, { status: 405 });
    }

    if (url.pathname === '/cancel') {
      const body = await request.json().catch(() => null) as { projectId?: string } | null;
      if (!body?.projectId) {
        return Response.json({ error: 'Missing projectId.' }, { status: 400 });
      }
      await this.cancelPipeline(body.projectId);
      return Response.json({ success: true, cancelled: true });
    }

    if (!['/start', '/resume', '/approve', '/nudge'].includes(url.pathname)) {
      return Response.json({ error: 'Not found.' }, { status: 404 });
    }

    const parsedBody = await request.json().catch(() => null);
    if (!isProjectGeneratorRequestBody(parsedBody)) {
      return Response.json({ error: 'Invalid project generator payload.' }, { status: 400 });
    }

    const message: QueueMessageBody = {
      type: 'generate_project',
      projectId: parsedBody.projectId,
      userId: parsedBody.userId,
      providerId: parsedBody.providerId,
      runId: parsedBody.runId,
    };

    await this.clearScheduledRetry();
    this.enqueuePipelineRun(message, url.pathname);

    return Response.json({
      success: true,
      scheduled: true,
      action: url.pathname.slice(1),
      project_id: message.projectId,
      run_id: message.runId,
    }, { status: 202 });
  }

  async alarm(_alarmInfo?: DurableObjectAlarmInfoLike) {
    const scheduledRetry = await this.state.storage.get<ScheduledRetry>(RETRY_STORAGE_KEY);
    if (!scheduledRetry) {
      return;
    }

    await this.clearScheduledRetry();
    this.enqueuePipelineRun(scheduledRetry.message, scheduledRetry.action, scheduledRetry.attempts);
  }

  private enqueuePipelineRun(message: QueueMessageBody, action: string, retryAttempts = 0) {
    const nextRun = this.pipelineChain
      .catch(() => undefined)
      .then(async () => {
        console.log('[PROJECT_GENERATOR_DO] Starting scheduled pipeline run.', {
          action,
          projectId: message.projectId,
          runId: message.runId,
          retryAttempts,
        });
        await processProjectGeneration(this.env, message, {
          continuationMode: 'inline',
        });
      })
      .catch(async (error) => {
        if (error instanceof RetryableGenerationPipelineError) {
          if (retryAttempts < MAX_PROJECT_GENERATION_RETRY_ATTEMPTS) {
            await this.scheduleRetry(message, action, retryAttempts + 1, error);
            return;
          }

          await this.persistPipelineFailure(
            message.projectId,
            error.message || 'Project generation failed after multiple retry attempts.',
          );
          return;
        }

        if (error instanceof GenerationPipelineError && error.alreadyPersisted) {
          console.warn('[PROJECT_GENERATOR_DO] Pipeline failure already persisted.', {
            action,
            projectId: message.projectId,
            runId: message.runId,
            error: error.message,
          });
          return;
        }

        const messageText = error instanceof Error ? error.message : 'Project generation failed unexpectedly.';
        await this.persistPipelineFailure(message.projectId, messageText);
      });

    this.pipelineChain = nextRun;
    this.state.waitUntil(nextRun);
  }

  private async scheduleRetry(
    message: QueueMessageBody,
    action: string,
    attempts: number,
    error: RetryableGenerationPipelineError,
  ) {
    const delaySeconds = Math.max(1, error.delaySeconds || 1);
    const retryMessage = error.message || 'Temporary provider issue. Retrying automatically.';
    const retryNotice =
      `${retryMessage} Retrying automatically in ${delaySeconds} second${delaySeconds === 1 ? '' : 's'} `
      + `(${attempts}/${MAX_PROJECT_GENERATION_RETRY_ATTEMPTS}).`;

    await this.state.storage.put<ScheduledRetry>(RETRY_STORAGE_KEY, {
      action,
      attempts,
      message,
    });
    await this.state.storage.setAlarm(Date.now() + (delaySeconds * 1000));

    const persistenceResults = await Promise.allSettled([
      this.env.DB.prepare(`
        UPDATE projects
        SET generation_error = NULL,
            generation_completed_at = NULL,
            generation_heartbeat_at = datetime("now"),
            updated_at = datetime("now")
        WHERE id = ?
      `)
        .bind(message.projectId)
        .run(),
      persistGenerationStreamEvent(this.env, {
        projectId: message.projectId,
        event: {
          type: 'activity',
          icon: '⚠️',
          message: retryNotice,
          timestamp: new Date().toISOString(),
        },
      }),
    ]);

    const failedPersistence = persistenceResults
      .map((result, index) => ({ index, result }))
      .filter((entry): entry is { index: number; result: PromiseRejectedResult } => entry.result.status === 'rejected');

    if (failedPersistence.length > 0) {
      console.warn('[PROJECT_GENERATOR_DO] Scheduled retry but failed to persist all retry metadata.', {
        action,
        attempts,
        delaySeconds,
        projectId: message.projectId,
        runId: message.runId,
        failures: failedPersistence.map((entry) => ({
          target: entry.index === 0 ? 'project-heartbeat' : 'generation-event',
          error: entry.result.reason instanceof Error ? entry.result.reason.message : String(entry.result.reason),
        })),
      });
    }

    console.warn('[PROJECT_GENERATOR_DO] Scheduled retryable pipeline rerun.', {
      action,
      attempts,
      delaySeconds,
      projectId: message.projectId,
      runId: message.runId,
      error: retryMessage,
    });
  }

  private async persistPipelineFailure(projectId: string, errorMessage: string) {
    await this.clearScheduledRetry();

    await this.env.DB.prepare(`
      UPDATE projects
      SET generation_status = 'failed',
          generation_error = ?,
          generation_started_at = CASE
            WHEN generation_started_at IS NULL THEN datetime("now")
            ELSE generation_started_at
          END,
          generation_completed_at = datetime("now"),
          generation_heartbeat_at = datetime("now"),
          updated_at = datetime("now")
      WHERE id = ?
    `)
      .bind(errorMessage, projectId)
      .run();

    await persistGenerationStreamEvent(this.env, {
      projectId,
      event: {
        type: 'pipeline_failed',
        error: errorMessage,
      },
    });

    console.error('[PROJECT_GENERATOR_DO] Pipeline run failed.', {
      projectId,
      error: errorMessage,
    });
  }

  private async clearScheduledRetry() {
    await this.state.storage.delete(RETRY_STORAGE_KEY);
    await this.state.storage.deleteAlarm();
  }

  private async cancelPipeline(projectId: string) {
    await this.clearScheduledRetry();

    // Reset the pipeline chain so any queued-but-not-yet-started run is dropped
    this.pipelineChain = Promise.resolve();
    const cancelledRunId = crypto.randomUUID();

    await this.env.DB.prepare(`
      UPDATE projects
      SET generation_status = 'cancelled',
          generation_error = 'Generation cancelled by user.',
          generation_run_id = ?,
          generation_completed_at = datetime("now"),
          generation_heartbeat_at = datetime("now"),
          updated_at = datetime("now")
      WHERE id = ?
    `)
      .bind(cancelledRunId, projectId)
      .run();

    await persistGenerationStreamEvent(this.env, {
      projectId,
      event: {
        type: 'pipeline_failed',
        error: 'Generation cancelled by user.',
      },
    });
  }
}
