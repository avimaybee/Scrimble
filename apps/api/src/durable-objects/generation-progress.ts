import { DurableObject } from 'cloudflare:workers';

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
  projectId: string;
  goal: string;
  repoSnapshot?: string;
}

interface ReplanJobInput {
  projectId: string;
  updateRequest: string;
  currentPlanSummary?: string;
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
 * All LLM orchestration and step-by-step retry logic lives here instead of
 * in separate Cloudflare Workflows.
 */
export class GenerationProgressHub extends DurableObject<unknown> {
  private readonly subscribers = new Map<number, Subscriber>();
  private subscriberCounter = 0;

  constructor(private readonly state: DurableObjectState, env: unknown) {
    super(state, env);
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
    if (!input.projectId?.trim() || !input.goal?.trim()) {
      return Response.json({ error: 'projectId and goal are required' }, { status: 400 });
    }

    const jobState: JobState = {
      type: 'generation',
      status: 'pending',
      input: {
        projectId: input.projectId.trim(),
        goal: input.goal.trim(),
        ...(input.repoSnapshot?.trim() ? { repoSnapshot: input.repoSnapshot.trim() } : {}),
      },
    };
    await this.state.storage.put(JOB_STATE_KEY, jobState);

    // Execute the job asynchronously
    this.state.waitUntil(this.runGenerationJob(jobState));

    return Response.json({ status: 'queued', type: 'generation' });
  }

  private async handleStartReplan(request: Request): Promise<Response> {
    const input = (await request.json()) as ReplanJobInput;
    if (!input.projectId?.trim() || !input.updateRequest?.trim()) {
      return Response.json({ error: 'projectId and updateRequest are required' }, { status: 400 });
    }

    const jobState: JobState = {
      type: 'replan',
      status: 'pending',
      input: {
        projectId: input.projectId.trim(),
        updateRequest: input.updateRequest.trim(),
        ...(input.currentPlanSummary?.trim() ? { currentPlanSummary: input.currentPlanSummary.trim() } : {}),
      },
    };
    await this.state.storage.put(JOB_STATE_KEY, jobState);

    // Execute the job asynchronously
    this.state.waitUntil(this.runReplanJob(jobState));

    return Response.json({ status: 'queued', type: 'replan' });
  }

  private async handleStatus(): Promise<Response> {
    const jobState = await this.state.storage.get<JobState>(JOB_STATE_KEY);
    if (!jobState) {
      return Response.json({ status: 'idle', message: 'No job has been started' });
    }
    return Response.json(jobState);
  }

  private async runGenerationJob(initialState: JobState): Promise<void> {
    const input = initialState.input as GenerationJobInput;
    
    try {
      // Update status to running
      const runningState: JobState = {
        ...initialState,
        status: 'running',
        startedAt: new Date().toISOString(),
      };
      await this.state.storage.put(JOB_STATE_KEY, runningState);
      await this.publishProgressInternal('started', 'Generation job started.');

      // Step 1: Normalize input
      await this.publishProgressInternal('normalized', 'Input normalized.', { projectId: input.projectId });

      // Step 2: Generate architecture summary (stub for now - will integrate with AI provider)
      const architectureSummary = [
        `Goal: ${input.goal}`,
        'CLI-first execution with one active chunk at a time.',
        'Cloudflare Workers + D1 + R2 backend boundary.',
        input.repoSnapshot ? `Repo snapshot: ${input.repoSnapshot}` : 'Repo snapshot: not supplied.',
      ].join('\n');
      await this.publishProgressInternal('architecture-generated', 'Architecture summary generated.');

      // Step 3: Generate initial chunk plan (stub for now - will integrate with AI provider)
      const chunks = [
        {
          id: 'chunk-001',
          title: 'Foundation hardening',
          objective: 'Ensure CLI and backend scaffolding are stable and validated.',
        },
      ];
      await this.publishProgressInternal('chunks-generated', 'Initial chunk plan generated.', {
        chunkCount: chunks.length,
      });

      const output = {
        projectId: input.projectId,
        architectureSummary,
        chunks,
        completedAt: new Date().toISOString(),
      };

      // Update status to completed
      const completedState: JobState = {
        ...runningState,
        status: 'completed',
        output,
        completedAt: new Date().toISOString(),
      };
      await this.state.storage.put(JOB_STATE_KEY, completedState);
      await this.publishProgressInternal('completed', 'Generation job completed.', { completedAt: output.completedAt });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedState: JobState = {
        ...initialState,
        status: 'failed',
        error: errorMessage,
        completedAt: new Date().toISOString(),
      };
      await this.state.storage.put(JOB_STATE_KEY, failedState);
      await this.publishProgressInternal('failed', `Generation job failed: ${errorMessage}`);
    }
  }

  private async runReplanJob(initialState: JobState): Promise<void> {
    const input = initialState.input as ReplanJobInput;

    try {
      // Update status to running
      const runningState: JobState = {
        ...initialState,
        status: 'running',
        startedAt: new Date().toISOString(),
      };
      await this.state.storage.put(JOB_STATE_KEY, runningState);
      await this.publishProgressInternal('started', 'Replan job started.');

      // Step 1: Draft revised plan summary (stub for now - will integrate with AI provider)
      const revisedPlanSummary = [
        `Replan request: ${input.updateRequest}`,
        input.currentPlanSummary
          ? `Current plan summary: ${input.currentPlanSummary}`
          : 'Current plan summary: not supplied.',
        'Preserve completed chunks and adjust only future pending chunks.',
      ].join('\n');
      await this.publishProgressInternal('plan-drafted', 'Revised plan summary drafted.');

      // Step 2: Produce revised chunks (stub for now - will integrate with AI provider)
      const updatedChunks = [
        {
          id: 'chunk-next',
          title: 'Apply replan changes',
          objective: 'Integrate update request while preserving completed work.',
        },
      ];
      await this.publishProgressInternal('chunks-revised', 'Revised chunks generated.', {
        chunkCount: updatedChunks.length,
      });

      const output = {
        projectId: input.projectId,
        revisedPlanSummary,
        chunks: updatedChunks,
        completedAt: new Date().toISOString(),
      };

      // Update status to completed
      const completedState: JobState = {
        ...runningState,
        status: 'completed',
        output,
        completedAt: new Date().toISOString(),
      };
      await this.state.storage.put(JOB_STATE_KEY, completedState);
      await this.publishProgressInternal('completed', 'Replan job completed.', { completedAt: output.completedAt });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedState: JobState = {
        ...initialState,
        status: 'failed',
        error: errorMessage,
        completedAt: new Date().toISOString(),
      };
      await this.state.storage.put(JOB_STATE_KEY, failedState);
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

    await this.state.storage.put(sequenceToKey(sequence), event);
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

    await this.state.storage.put(sequenceToKey(sequence), event);
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
    const entries = await this.state.storage.list<GenerationProgressEvent>({
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
    const previous = (await this.state.storage.get<number>(META_LAST_SEQUENCE)) ?? 0;
    const next = previous + 1;
    await this.state.storage.put(META_LAST_SEQUENCE, next);
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
      await this.state.storage.delete(keysToDelete);
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
}
