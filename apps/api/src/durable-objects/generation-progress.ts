import { DurableObject } from 'cloudflare:workers';
import {
  appendProjectEvent,
  markGenerationRunCompleted,
  markGenerationRunFailed,
  markGenerationRunRunning,
  persistPlanRevision,
  type PersistedPlanChunk,
} from '../lib/persistence.js';
import { storeJsonArtifact } from '../lib/storage.js';

interface ProgressPublishPayload {
  stage: string;
  message: string;
  data?: unknown;
}

interface GenerationProgressEvent {
  sequence: number;
  stage: string;
  message: string;
  data?: unknown;
  timestamp: string;
}

interface Subscriber {
  id: number;
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeat: ReturnType<typeof setInterval>;
}

interface GenerationJobInput {
  runId: string;
  projectId: string;
  goal: string;
  repoSnapshot?: string;
}

interface ReplanJobInput {
  runId: string;
  projectId: string;
  updateRequest: string;
  currentPlanSummary?: string;
}

interface ProgressHubEnv {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
}

interface JobState {
  type: 'generation' | 'replan';
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: GenerationJobInput | ReplanJobInput;
  output?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

const encoder = new TextEncoder();
const EVENT_KEY_PREFIX = 'event/';
const META_LAST_SEQUENCE = 'meta:last-sequence';
const JOB_STATE_KEY = 'job:state';
const RETAIN_EVENT_COUNT = 200;
const STEP_MAX_ATTEMPTS = 3;
const STEP_BASE_BACKOFF_MS = 300;

function sequenceToKey(sequence: number): string {
  return `${EVENT_KEY_PREFIX}${sequence.toString().padStart(12, '0')}`;
}

function createSseFrame(eventName: string, payload: unknown): Uint8Array {
  return encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/**
 * GenerationProgressHub is a unified Durable Object that serves as:
 * 1. The orchestrator for generation and replan jobs
 * 2. The SSE broadcaster for progress events
 *
 * All orchestration and step-level retry behavior lives in this Durable Object.
 */
export class GenerationProgressHub extends DurableObject<ProgressHubEnv> {
  private readonly subscribers = new Map<number, Subscriber>();
  private subscriberCounter = 0;
  private readonly doState: DurableObjectState;

  constructor(state: DurableObjectState, env: ProgressHubEnv) {
    super(state, env);
    this.doState = state;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/publish') {
      return this.handlePublish(request);
    }

    if (request.method === 'GET' && url.pathname === '/events') {
      return this.handleEvents(url);
    }

    if (request.method === 'GET' && url.pathname === '/stream') {
      return this.handleStream(url);
    }

    if (request.method === 'POST' && url.pathname === '/start-generation') {
      return this.handleStartGeneration(request);
    }

    if (request.method === 'POST' && url.pathname === '/start-replan') {
      return this.handleStartReplan(request);
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      return this.handleStatus();
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleStartGeneration(request: Request): Promise<Response> {
    const input = (await request.json()) as GenerationJobInput;
    if (!input.runId?.trim() || !input.projectId?.trim() || !input.goal?.trim()) {
      return Response.json({ error: 'runId, projectId and goal are required' }, { status: 400 });
    }
    const activeJobResponse = await this.ensureNoActiveJob('generation');
    if (activeJobResponse) {
      return activeJobResponse;
    }

    const jobState: JobState = {
      type: 'generation',
      status: 'pending',
      input: {
        runId: input.runId.trim(),
        projectId: input.projectId.trim(),
        goal: input.goal.trim(),
        ...(input.repoSnapshot?.trim() ? { repoSnapshot: input.repoSnapshot.trim() } : {}),
      },
    };
    await this.doState.storage.put(JOB_STATE_KEY, jobState);

    // Execute the job asynchronously
    this.doState.waitUntil(this.runGenerationJob(jobState));

    return Response.json({ status: 'queued', type: 'generation' });
  }

  private async handleStartReplan(request: Request): Promise<Response> {
    const input = (await request.json()) as ReplanJobInput;
    if (!input.runId?.trim() || !input.projectId?.trim() || !input.updateRequest?.trim()) {
      return Response.json({ error: 'runId, projectId and updateRequest are required' }, { status: 400 });
    }
    const activeJobResponse = await this.ensureNoActiveJob('replan');
    if (activeJobResponse) {
      return activeJobResponse;
    }

    const jobState: JobState = {
      type: 'replan',
      status: 'pending',
      input: {
        runId: input.runId.trim(),
        projectId: input.projectId.trim(),
        updateRequest: input.updateRequest.trim(),
        ...(input.currentPlanSummary?.trim() ? { currentPlanSummary: input.currentPlanSummary.trim() } : {}),
      },
    };
    await this.doState.storage.put(JOB_STATE_KEY, jobState);

    // Execute the job asynchronously
    this.doState.waitUntil(this.runReplanJob(jobState));

    return Response.json({ status: 'queued', type: 'replan' });
  }

  private async handleStatus(): Promise<Response> {
    const jobState = await this.doState.storage.get<JobState>(JOB_STATE_KEY);
    if (!jobState) {
      return Response.json({ status: 'idle', message: 'No job has been started' });
    }
    return Response.json(jobState);
  }

  private async runGenerationJob(initialState: JobState): Promise<void> {
    const input = initialState.input as GenerationJobInput;

    const runningState: JobState = {
      ...initialState,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    await this.doState.storage.put(JOB_STATE_KEY, runningState);
    await this.publishProgressInternal('started', 'Generation job started.');

    try {
      await markGenerationRunRunning(this.env.DB, input.runId);

      await this.runStepWithRetry({
        jobType: 'generation',
        step: 'normalize-input',
        run: async () => {
          await this.publishProgressInternal('normalized', 'Input normalized.', { projectId: input.projectId });
        },
      });

      const architectureSummary = await this.runStepWithRetry({
        jobType: 'generation',
        step: 'generate-architecture-summary',
        run: async () => {
          const summary = [
            `Goal: ${input.goal}`,
            'CLI-first execution with one active chunk at a time.',
            'Cloudflare Workers + D1 + R2 backend boundary.',
            input.repoSnapshot ? `Repo snapshot: ${input.repoSnapshot}` : 'Repo snapshot: not supplied.',
          ].join('\n');
          await this.publishProgressInternal('architecture-generated', 'Architecture summary generated.');
          return summary;
        },
      });

      const chunks = await this.runStepWithRetry({
        jobType: 'generation',
        step: 'generate-initial-chunks',
        run: async () => {
          const generated: PersistedPlanChunk[] = [
            {
              sequence: 1,
              title: 'Foundation hardening',
              prompt: 'Stabilize CLI and API foundations before adding higher-order orchestration complexity.',
              doneCondition: 'CLI/API runtime validations pass and baseline project health is documented.',
              verificationHints: ['pnpm run lint', 'pnpm run build', 'pnpm test'],
            },
          ];
          await this.publishProgressInternal('chunks-generated', 'Initial chunk plan generated.', {
            chunkCount: generated.length,
          });
          return generated;
        },
      });

      const revision = await this.runStepWithRetry({
        jobType: 'generation',
        step: 'persist-plan-revision',
        run: async () => {
          const persisted = await persistPlanRevision(this.env.DB, {
            projectId: input.projectId,
            architecture: architectureSummary,
            chunks,
          });
          await this.publishProgressInternal('plan-revision-persisted', 'Plan revision persisted.', {
            revisionId: persisted.revisionId,
            version: persisted.version,
          });
          return persisted;
        },
      });

      const artifact = await this.runStepWithRetry({
        jobType: 'generation',
        step: 'persist-output-artifact',
        run: async () => {
          const stored = await storeJsonArtifact(this.env.ARTIFACTS, {
            projectId: input.projectId,
            type: 'generation-output',
            payload: {
              runId: input.runId,
              architectureSummary,
              chunks,
              revisionId: revision.revisionId,
              revisionVersion: revision.version,
            },
            metadata: {
              runId: input.runId,
              revisionId: revision.revisionId,
            },
          });
          await this.publishProgressInternal('artifact-persisted', 'Generation artifact persisted.', {
            artifactKey: stored.key,
          });
          return stored;
        },
      });

      const output = {
        runId: input.runId,
        projectId: input.projectId,
        architectureSummary,
        chunks,
        revisionId: revision.revisionId,
        revisionVersion: revision.version,
        artifactKey: artifact.key,
        completedAt: new Date().toISOString(),
      };

      const completedState: JobState = {
        ...runningState,
        status: 'completed',
        output,
        completedAt: output.completedAt,
      };
      await this.doState.storage.put(JOB_STATE_KEY, completedState);
      await markGenerationRunCompleted(this.env.DB, {
        runId: input.runId,
        output,
      });
      await appendProjectEvent(this.env.DB, {
        projectId: input.projectId,
        type: 'generation_completed',
        data: {
          runId: input.runId,
          revisionId: revision.revisionId,
          artifactKey: artifact.key,
        },
      });
      await this.publishProgressInternal('completed', 'Generation job completed.', { completedAt: output.completedAt });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedState: JobState = {
        ...runningState,
        status: 'failed',
        error: errorMessage,
        completedAt: new Date().toISOString(),
      };
      await this.doState.storage.put(JOB_STATE_KEY, failedState);
      await markGenerationRunFailed(this.env.DB, {
        runId: input.runId,
        error: errorMessage,
      });
      await appendProjectEvent(this.env.DB, {
        projectId: input.projectId,
        type: 'generation_failed',
        data: {
          runId: input.runId,
          error: errorMessage,
        },
      });
      await this.publishProgressInternal('failed', `Generation job failed: ${errorMessage}`);
    }
  }

  private async runReplanJob(initialState: JobState): Promise<void> {
    const input = initialState.input as ReplanJobInput;

    const runningState: JobState = {
      ...initialState,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    await this.doState.storage.put(JOB_STATE_KEY, runningState);
    await this.publishProgressInternal('started', 'Replan job started.');

    try {
      await markGenerationRunRunning(this.env.DB, input.runId);

      const revisedPlanSummary = await this.runStepWithRetry({
        jobType: 'replan',
        step: 'draft-plan-summary',
        run: async () => {
          const summary = [
            `Replan request: ${input.updateRequest}`,
            input.currentPlanSummary
              ? `Current plan summary: ${input.currentPlanSummary}`
              : 'Current plan summary: not supplied.',
            'Preserve completed chunks and adjust only future pending chunks.',
          ].join('\n');
          await this.publishProgressInternal('plan-drafted', 'Revised plan summary drafted.');
          return summary;
        },
      });

      const updatedChunks = await this.runStepWithRetry({
        jobType: 'replan',
        step: 'generate-replanned-chunks',
        run: async () => {
          const generated: PersistedPlanChunk[] = [
            {
              sequence: 1,
              title: 'Apply replan changes',
              prompt: `Apply requested plan update: ${input.updateRequest}`,
              doneCondition: 'Requested update is reflected in implementation and validated.',
              verificationHints: ['scrimble verify', 'scrimble status'],
            },
          ];
          await this.publishProgressInternal('chunks-revised', 'Revised chunks generated.', {
            chunkCount: generated.length,
          });
          return generated;
        },
      });

      const revision = await this.runStepWithRetry({
        jobType: 'replan',
        step: 'persist-plan-revision',
        run: async () => {
          const persisted = await persistPlanRevision(this.env.DB, {
            projectId: input.projectId,
            architecture: revisedPlanSummary,
            chunks: updatedChunks,
          });
          await this.publishProgressInternal('plan-revision-persisted', 'Replan revision persisted.', {
            revisionId: persisted.revisionId,
            version: persisted.version,
          });
          return persisted;
        },
      });

      const artifact = await this.runStepWithRetry({
        jobType: 'replan',
        step: 'persist-output-artifact',
        run: async () => {
          const stored = await storeJsonArtifact(this.env.ARTIFACTS, {
            projectId: input.projectId,
            type: 'replan-output',
            payload: {
              runId: input.runId,
              revisedPlanSummary,
              chunks: updatedChunks,
              revisionId: revision.revisionId,
              revisionVersion: revision.version,
            },
            metadata: {
              runId: input.runId,
              revisionId: revision.revisionId,
            },
          });
          await this.publishProgressInternal('artifact-persisted', 'Replan artifact persisted.', {
            artifactKey: stored.key,
          });
          return stored;
        },
      });

      const output = {
        runId: input.runId,
        projectId: input.projectId,
        revisedPlanSummary,
        chunks: updatedChunks,
        revisionId: revision.revisionId,
        revisionVersion: revision.version,
        artifactKey: artifact.key,
        completedAt: new Date().toISOString(),
      };

      const completedState: JobState = {
        ...runningState,
        status: 'completed',
        output,
        completedAt: output.completedAt,
      };
      await this.doState.storage.put(JOB_STATE_KEY, completedState);
      await markGenerationRunCompleted(this.env.DB, {
        runId: input.runId,
        output,
      });
      await appendProjectEvent(this.env.DB, {
        projectId: input.projectId,
        type: 'plan_replanned',
        data: {
          runId: input.runId,
          revisionId: revision.revisionId,
          artifactKey: artifact.key,
        },
      });
      await this.publishProgressInternal('completed', 'Replan job completed.', { completedAt: output.completedAt });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedState: JobState = {
        ...runningState,
        status: 'failed',
        error: errorMessage,
        completedAt: new Date().toISOString(),
      };
      await this.doState.storage.put(JOB_STATE_KEY, failedState);
      await markGenerationRunFailed(this.env.DB, {
        runId: input.runId,
        error: errorMessage,
      });
      await this.publishProgressInternal('failed', `Replan job failed: ${errorMessage}`);
    }
  }

  private async publishProgressInternal(stage: string, message: string, data?: unknown): Promise<void> {
    const sequence = await this.nextSequence();
    const event: GenerationProgressEvent = {
      sequence,
      stage,
      message,
      ...(data === undefined ? {} : { data }),
      timestamp: new Date().toISOString(),
    };

    await this.doState.storage.put(sequenceToKey(sequence), event);
    await this.trimOldEvents(sequence);
    this.broadcast(event);
  }

  private async handlePublish(request: Request): Promise<Response> {
    const payload = (await request.json()) as ProgressPublishPayload;
    if (!payload.stage?.trim() || !payload.message?.trim()) {
      return Response.json({ error: 'stage and message are required' }, { status: 400 });
    }

    const sequence = await this.nextSequence();
    const event: GenerationProgressEvent = {
      sequence,
      stage: payload.stage.trim(),
      message: payload.message.trim(),
      ...(payload.data === undefined ? {} : { data: payload.data }),
      timestamp: new Date().toISOString(),
    };

    await this.doState.storage.put(sequenceToKey(sequence), event);
    await this.trimOldEvents(sequence);
    this.broadcast(event);

    return Response.json({ ok: true, sequence });
  }

  private async handleEvents(url: URL): Promise<Response> {
    const since = this.parseSince(url.searchParams.get('since'));
    const events = await this.listEventsSince(since);
    return Response.json({ events, count: events.length });
  }

  private async handleStream(url: URL): Promise<Response> {
    const since = this.parseSince(url.searchParams.get('since'));
    const backlog = await this.listEventsSince(since);
    let subscriberId: number | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        subscriberId = this.nextSubscriberId();
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          } catch {
            if (subscriberId !== null) {
              this.removeSubscriber(subscriberId);
            }
          }
        }, 15000);
        const subscriber: Subscriber = { id: subscriberId, controller, heartbeat };
        this.subscribers.set(subscriberId, subscriber);

        for (const event of backlog) {
          controller.enqueue(createSseFrame('progress', event));
        }

        controller.enqueue(encoder.encode(': connected\n\n'));
      },
      cancel: () => {
        if (subscriberId !== null) {
          this.removeSubscriber(subscriberId);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  private async listEventsSince(since: number): Promise<GenerationProgressEvent[]> {
    const startKey = sequenceToKey(since + 1);
    const entries = await this.doState.storage.list<GenerationProgressEvent>({
      start: startKey,
      end: `${EVENT_KEY_PREFIX}\uffff`,
      limit: RETAIN_EVENT_COUNT,
    });
    return Array.from(entries.values());
  }

  private parseSince(value: string | null): number {
    if (!value) return 0;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return parsed;
  }

  private async nextSequence(): Promise<number> {
    const previous = (await this.doState.storage.get<number>(META_LAST_SEQUENCE)) ?? 0;
    const next = previous + 1;
    await this.doState.storage.put(META_LAST_SEQUENCE, next);
    return next;
  }

  private async trimOldEvents(lastSequence: number): Promise<void> {
    const oldestRetained = Math.max(lastSequence - RETAIN_EVENT_COUNT + 1, 1);
    if (oldestRetained <= 1) {
      return;
    }

    const keysToDelete: string[] = [];
    for (let sequence = 1; sequence < oldestRetained; sequence += 1) {
      keysToDelete.push(sequenceToKey(sequence));
    }
    if (keysToDelete.length > 0) {
      await this.doState.storage.delete(keysToDelete);
    }
  }

  private broadcast(event: GenerationProgressEvent): void {
    const frame = createSseFrame('progress', event);
    for (const [id, subscriber] of this.subscribers.entries()) {
      try {
        subscriber.controller.enqueue(frame);
      } catch {
        this.removeSubscriber(id);
      }
    }
  }

  private removeSubscriber(id: number): void {
    const subscriber = this.subscribers.get(id);
    if (!subscriber) {
      return;
    }
    clearInterval(subscriber.heartbeat);
    this.subscribers.delete(id);
  }

  private nextSubscriberId(): number {
    this.subscriberCounter += 1;
    return this.subscriberCounter;
  }

  private async ensureNoActiveJob(type: JobState['type']): Promise<Response | null> {
    const existing = await this.doState.storage.get<JobState>(JOB_STATE_KEY);
    if (!existing) {
      return null;
    }
    if (existing.status !== 'pending' && existing.status !== 'running') {
      return null;
    }
    return Response.json(
      {
        error: `Cannot start ${type} while ${existing.type} is ${existing.status}.`,
        activeJob: existing,
      },
      { status: 409 },
    );
  }

  private async runStepWithRetry<T>(options: {
    jobType: JobState['type'];
    step: string;
    run: () => Promise<T>;
    maxAttempts?: number;
  }): Promise<T> {
    const maxAttempts = options.maxAttempts ?? STEP_MAX_ATTEMPTS;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await options.run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastError = error instanceof Error ? error : new Error(message);
        const canRetry = attempt < maxAttempts;
        await this.publishProgressInternal(canRetry ? 'step-retrying' : 'step-failed', canRetry
          ? `Step "${options.step}" failed on attempt ${attempt}/${maxAttempts}; retrying.`
          : `Step "${options.step}" failed on attempt ${attempt}/${maxAttempts}.`, {
          jobType: options.jobType,
          step: options.step,
          attempt,
          maxAttempts,
          error: message,
        });
        if (canRetry) {
          const backoffMs = STEP_BASE_BACKOFF_MS * (2 ** (attempt - 1));
          await this.delay(backoffMs);
        }
      }
    }

    throw lastError ?? new Error(`Step "${options.step}" failed.`);
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
