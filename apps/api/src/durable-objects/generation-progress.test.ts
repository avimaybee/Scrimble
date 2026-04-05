import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => {
  class DurableObjectMock {
    constructor(state: unknown, env: unknown) {
      (this as { ctx?: unknown }).ctx = state;
      (this as { env?: unknown }).env = env;
    }
  }
  return { DurableObject: DurableObjectMock };
});

const persistenceMocks = vi.hoisted(() => ({
  appendProjectEvent: vi.fn(),
  markGenerationRunCompleted: vi.fn(),
  markGenerationRunFailed: vi.fn(),
  markGenerationRunRunning: vi.fn(),
  persistPlanRevision: vi.fn(),
}));

const planningMocks = vi.hoisted(() => ({
  generateInitialPlan: vi.fn(),
  generateReplan: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  storeJsonArtifact: vi.fn(),
}));

vi.mock('../lib/persistence.js', () => persistenceMocks);
vi.mock('../lib/planning-ai.js', () => planningMocks);
vi.mock('../lib/storage.js', () => storageMocks);

import { GenerationProgressHub } from './generation-progress.js';

class FakeDurableObjectStorage {
  private readonly records = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.records.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.records.set(key, value);
  }

  async list<T>(options: { start?: string; end?: string; limit?: number } = {}): Promise<Map<string, T>> {
    const start = options.start ?? '';
    const end = options.end ?? '\uffff';
    const sorted = Array.from(this.records.entries())
      .filter(([key]) => key >= start && key <= end)
      .sort(([left], [right]) => left.localeCompare(right));
    const limited = typeof options.limit === 'number' ? sorted.slice(0, options.limit) : sorted;
    return new Map(limited as Array<[string, T]>);
  }

  async delete(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.records.delete(key);
    }
  }
}

function createHub(): {
  hub: GenerationProgressHub;
  waitUntilPromises: Promise<unknown>[];
} {
  const waitUntilPromises: Promise<unknown>[] = [];
  const state = {
    storage: new FakeDurableObjectStorage(),
    waitUntil: (promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
    },
  } as unknown as DurableObjectState;

  const env = {
    DB: {} as D1Database,
    ARTIFACTS: {} as R2Bucket,
  };

  const hub = new GenerationProgressHub(state, env);
  return { hub, waitUntilPromises };
}

async function flushBackground(waitUntilPromises: Promise<unknown>[]): Promise<void> {
  while (waitUntilPromises.length > 0) {
    const pending = waitUntilPromises.splice(0);
    await vi.runAllTimersAsync();
    await Promise.all(pending);
  }
}

const validAiConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com/v1',
};

const planChunk = {
  sequence: 1,
  title: 'Chunk 1',
  prompt: 'Do work',
  doneCondition: 'Work done',
  verificationHints: ['pnpm run lint'],
};

describe('GenerationProgressHub orchestration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    persistenceMocks.appendProjectEvent.mockResolvedValue(undefined);
    persistenceMocks.markGenerationRunCompleted.mockResolvedValue(undefined);
    persistenceMocks.markGenerationRunFailed.mockResolvedValue(undefined);
    persistenceMocks.markGenerationRunRunning.mockResolvedValue(undefined);
    persistenceMocks.persistPlanRevision.mockResolvedValue({ revisionId: 'rev-1', version: 1 });
    storageMocks.storeJsonArtifact.mockResolvedValue({ key: 'artifact-1', contentLength: 100 });
    planningMocks.generateReplan.mockResolvedValue({
      revisedPlanSummary: 'Replanned summary',
      chunks: [planChunk],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('queues and completes generation, persisting revision and artifact', async () => {
    planningMocks.generateInitialPlan.mockResolvedValue({
      architectureSummary: 'Architecture summary',
      chunks: [planChunk],
    });

    const { hub, waitUntilPromises } = createHub();
    const response = await hub.fetch(
      new Request('https://progress-hub.internal/start-generation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-1',
          projectId: 'project-1',
          goal: 'Ship stable runtime',
          aiConfig: validAiConfig,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'queued', type: 'generation' });

    await flushBackground(waitUntilPromises);

    expect(planningMocks.generateInitialPlan).toHaveBeenCalledTimes(1);
    expect(persistenceMocks.persistPlanRevision).toHaveBeenCalledTimes(1);
    expect(storageMocks.storeJsonArtifact).toHaveBeenCalledTimes(1);
    expect(persistenceMocks.markGenerationRunCompleted).toHaveBeenCalledTimes(1);
    expect(persistenceMocks.markGenerationRunFailed).not.toHaveBeenCalled();

    const statusResponse = await hub.fetch(new Request('https://progress-hub.internal/status'));
    const status = (await statusResponse.json()) as { status: string; output?: { revisionId?: string } };
    expect(status.status).toBe('completed');
    expect(status.output?.revisionId).toBe('rev-1');
  });

  it('retries failed generation step and emits retry event before succeeding', async () => {
    planningMocks.generateInitialPlan
      .mockRejectedValueOnce(new Error('transient provider error'))
      .mockResolvedValueOnce({
        architectureSummary: 'Recovered summary',
        chunks: [planChunk],
      });

    const { hub, waitUntilPromises } = createHub();
    await hub.fetch(
      new Request('https://progress-hub.internal/start-generation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-2',
          projectId: 'project-2',
          goal: 'Ship retry-safe runtime',
          aiConfig: validAiConfig,
        }),
      }),
    );

    await flushBackground(waitUntilPromises);

    expect(planningMocks.generateInitialPlan).toHaveBeenCalledTimes(2);

    const eventsResponse = await hub.fetch(new Request('https://progress-hub.internal/events'));
    const eventsPayload = (await eventsResponse.json()) as {
      events: Array<{ stage: string; message: string }>;
    };
    expect(eventsPayload.events.some((event) => event.stage === 'step-retrying')).toBe(true);
    expect(persistenceMocks.appendProjectEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: 'project-2',
        type: 'generation_step_retrying',
        data: expect.objectContaining({
          runId: 'run-2',
          step: 'generate-initial-plan',
          attempt: 1,
          maxAttempts: 3,
          error: 'transient provider error',
        }),
      }),
    );
  });

  it('marks run as failed after max retry exhaustion', async () => {
    planningMocks.generateInitialPlan.mockRejectedValue(new Error('persistent provider outage'));

    const { hub, waitUntilPromises } = createHub();
    await hub.fetch(
      new Request('https://progress-hub.internal/start-generation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-3',
          projectId: 'project-3',
          goal: 'Ship failure path',
          aiConfig: validAiConfig,
        }),
      }),
    );

    await flushBackground(waitUntilPromises);

    expect(planningMocks.generateInitialPlan).toHaveBeenCalledTimes(3);
    expect(persistenceMocks.markGenerationRunFailed).toHaveBeenCalledTimes(1);
    expect(persistenceMocks.markGenerationRunCompleted).not.toHaveBeenCalled();
    expect(persistenceMocks.appendProjectEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: 'project-3',
        type: 'generation_step_failed',
        data: expect.objectContaining({
          runId: 'run-3',
          step: 'generate-initial-plan',
          attempt: 3,
          maxAttempts: 3,
          error: 'persistent provider outage',
        }),
      }),
    );

    const statusResponse = await hub.fetch(new Request('https://progress-hub.internal/status'));
    const status = (await statusResponse.json()) as { status: string; error?: string };
    expect(status.status).toBe('failed');
    expect(status.error).toContain('persistent provider outage');
  });

  it('applies since filtering for /events progress reads', async () => {
    const { hub } = createHub();

    await hub.fetch(
      new Request('https://progress-hub.internal/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'first', message: 'first event' }),
      }),
    );
    await hub.fetch(
      new Request('https://progress-hub.internal/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'second', message: 'second event' }),
      }),
    );

    const response = await hub.fetch(new Request('https://progress-hub.internal/events?since=1'));
    const payload = (await response.json()) as {
      events: Array<{ sequence: number; stage: string }>;
      count: number;
    };

    expect(payload.count).toBe(1);
    expect(payload.events[0]).toMatchObject({ sequence: 2, stage: 'second' });
  });

  it('streams backlog progress with SSE framing on /stream', async () => {
    const { hub } = createHub();

    await hub.fetch(
      new Request('https://progress-hub.internal/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'first', message: 'first event' }),
      }),
    );
    await hub.fetch(
      new Request('https://progress-hub.internal/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'second', message: 'second event' }),
      }),
    );

    const response = await hub.fetch(new Request('https://progress-hub.internal/stream?since=1'));
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const first = await reader?.read();
    const chunk = new TextDecoder().decode(first?.value);
    expect(chunk).toContain('event: progress');
    expect(chunk).toContain('"stage":"second"');
    expect(chunk).toContain('"sequence":2');

    await reader?.cancel();
  });
});
