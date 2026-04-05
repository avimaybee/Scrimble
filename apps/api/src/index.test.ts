import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const persistenceMocks = vi.hoisted(() => ({
  appendProjectEvent: vi.fn(),
  createGenerationRunRecord: vi.fn(),
  ensureLocalProjectRecord: vi.fn(),
  getActiveRunForProject: vi.fn(),
  getLatestRunForProject: vi.fn(),
  markGenerationRunFailed: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  listArtifacts: vi.fn(),
  readArtifact: vi.fn(),
  storeJsonArtifact: vi.fn(),
}));

vi.mock('./durable-objects/generation-progress.js', () => ({
  GenerationProgressHub: class GenerationProgressHubMock {},
}));

vi.mock('./lib/persistence.js', () => persistenceMocks);
vi.mock('./lib/storage.js', () => storageMocks);

import app from './index.js';

const validAiConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: 'secret-key',
  baseUrl: 'https://api.openai.com/v1',
};

function createEnv(doFetch: (url: string, init?: RequestInit) => Promise<Response>) {
  const stub = { fetch: vi.fn(doFetch) };
  const namespace = {
    idFromName: vi.fn((value: string) => `do:${value}`),
    get: vi.fn(() => stub),
  };

  return {
    env: {
      DB: {} as D1Database,
      ARTIFACTS: {} as R2Bucket,
      PROGRESS_HUB: namespace as unknown as DurableObjectNamespace<never>,
      ENVIRONMENT: 'test',
    },
    stub,
    namespace,
  };
}

describe('API start route contracts', () => {
  beforeEach(() => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('run-fixed');
    persistenceMocks.getActiveRunForProject.mockResolvedValue(null);
    persistenceMocks.ensureLocalProjectRecord.mockResolvedValue(undefined);
    persistenceMocks.createGenerationRunRecord.mockResolvedValue(undefined);
    persistenceMocks.appendProjectEvent.mockResolvedValue(undefined);
    persistenceMocks.markGenerationRunFailed.mockResolvedValue(undefined);
    persistenceMocks.getLatestRunForProject.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('returns 400 for generation start when apiKey is missing', async () => {
    const { env, stub } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await app.request(
      '/v1/generation/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          goal: 'Ship runtime',
          aiConfig: {
            provider: 'openai',
            model: 'gpt-4o',
          },
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'Invalid generation start payload.',
    });
    expect(stub.fetch).not.toHaveBeenCalled();
    expect(persistenceMocks.createGenerationRunRecord).not.toHaveBeenCalled();
  });

  it('dispatches generation start to Durable Object and redacts persisted aiConfig', async () => {
    const { env, stub, namespace } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await app.request(
      '/v1/generation/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          goal: 'Ship runtime',
          repoSnapshot: 'snapshot',
          aiConfig: validAiConfig,
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      instanceId: 'project-1',
      runId: 'run-fixed',
      status: 'queued',
      type: 'generation',
    });

    expect(persistenceMocks.createGenerationRunRecord).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        runId: 'run-fixed',
        projectId: 'project-1',
        type: 'initial',
        input: expect.objectContaining({
          goal: 'Ship runtime',
          aiConfig: {
            provider: 'openai',
            model: 'gpt-4o',
            baseUrl: 'https://api.openai.com/v1',
          },
        }),
      }),
    );
    expect(namespace.idFromName).toHaveBeenCalledWith('project-1');
    expect(stub.fetch).toHaveBeenCalledTimes(1);

    const doPayload = JSON.parse(String((stub.fetch.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
    expect(doPayload).toMatchObject({
      runId: 'run-fixed',
      projectId: 'project-1',
      goal: 'Ship runtime',
      aiConfig: validAiConfig,
    });
  });

  it('returns 400 for replan start when provider is unsupported', async () => {
    const { env, stub } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'replan' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await app.request(
      '/v1/replan/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-2',
          updateRequest: 'Change scope',
          aiConfig: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            apiKey: 'secret-key',
          },
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'Invalid replan start payload.',
    });
    expect(stub.fetch).not.toHaveBeenCalled();
    expect(persistenceMocks.createGenerationRunRecord).not.toHaveBeenCalled();
  });

  it('dispatches replan start to Durable Object with run metadata', async () => {
    const { env, stub, namespace } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'replan' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await app.request(
      '/v1/replan/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-2',
          updateRequest: 'Change scope',
          currentPlanSummary: 'done=2,pending=3',
          aiConfig: validAiConfig,
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      instanceId: 'project-2',
      runId: 'run-fixed',
      status: 'queued',
      type: 'replan',
    });

    expect(persistenceMocks.createGenerationRunRecord).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        runId: 'run-fixed',
        projectId: 'project-2',
        type: 'replan',
        input: expect.objectContaining({
          updateRequest: 'Change scope',
          currentPlanSummary: 'done=2,pending=3',
          aiConfig: {
            provider: 'openai',
            model: 'gpt-4o',
            baseUrl: 'https://api.openai.com/v1',
          },
        }),
      }),
    );
    expect(namespace.idFromName).toHaveBeenCalledWith('project-2');
    expect(stub.fetch).toHaveBeenCalledTimes(1);
  });
});
