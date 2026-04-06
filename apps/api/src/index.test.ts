import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const persistenceMocks = vi.hoisted(() => ({
  appendPlanSyncRevision: vi.fn(),
  appendProjectEvent: vi.fn(),
  createProjectForUser: vi.fn(),
  createGenerationRunRecord: vi.fn(),
  ensureProjectRecordForUser: vi.fn(),
  getActiveRunForProject: vi.fn(),
  getLatestPlanSyncRevision: vi.fn(),
  getLatestRunForProject: vi.fn(),
  listProjectEvents: vi.fn(),
  getProjectForUser: vi.fn(),
  listProjectsForUser: vi.fn(),
  getRunStepDiagnostics: vi.fn(),
  markGenerationRunFailed: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  listArtifacts: vi.fn(),
  readArtifact: vi.fn(),
  storeJsonArtifact: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  approveDeviceCodeByUserCode: vi.fn(),
  approveDeviceCodeWithFirebase: vi.fn(),
  exchangeDeviceCodeForToken: vi.fn(),
  issueDeviceCodeChallenge: vi.fn(),
  resolveAuthContextFromBearer: vi.fn(),
}));

vi.mock('./durable-objects/generation-progress.js', () => ({
  GenerationProgressHub: class GenerationProgressHubMock {},
}));

vi.mock('./lib/persistence.js', () => persistenceMocks);
vi.mock('./lib/storage.js', () => storageMocks);
vi.mock('./lib/auth.js', () => authMocks);

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

async function requestWithAuth(
  path: string,
  init: RequestInit,
  env: {
    DB: D1Database;
    ARTIFACTS: R2Bucket;
    PROGRESS_HUB: DurableObjectNamespace<never>;
    ENVIRONMENT: string;
  },
) {
  const headers = new Headers(init.headers);
  if (path.startsWith('/v1/') && !headers.has('authorization')) {
    headers.set('authorization', 'Bearer access-token-1');
  }

  return app.request(
    path,
    {
      ...init,
      headers,
    },
    env,
  );
}

describe('API start route contracts', () => {
  beforeEach(() => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('run-fixed');
    authMocks.resolveAuthContextFromBearer.mockResolvedValue({
      userId: 'local-user',
      email: 'local@scrimble.dev',
      sessionId: 'session-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    authMocks.issueDeviceCodeChallenge.mockResolvedValue({
      deviceCode: 'device-code-1',
      userCode: 'ABCD-1234',
      verificationUri: 'https://api.scrimble.dev/oauth/device/verify',
      verificationUriComplete: 'https://api.scrimble.dev/oauth/device/verify?user_code=ABCD-1234',
      expiresIn: 900,
      interval: 5,
    });
    authMocks.approveDeviceCodeByUserCode.mockResolvedValue({ ok: true });
    authMocks.approveDeviceCodeWithFirebase.mockResolvedValue({ ok: true });
    authMocks.exchangeDeviceCodeForToken.mockResolvedValue({
      accessToken: 'access-token-1',
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: 'scrimble:cli',
    });
    persistenceMocks.getActiveRunForProject.mockResolvedValue(null);
    persistenceMocks.ensureProjectRecordForUser.mockResolvedValue(undefined);
    persistenceMocks.createGenerationRunRecord.mockResolvedValue(undefined);
    persistenceMocks.appendProjectEvent.mockResolvedValue(undefined);
    persistenceMocks.markGenerationRunFailed.mockResolvedValue(undefined);
    persistenceMocks.getLatestRunForProject.mockResolvedValue(null);
    persistenceMocks.getLatestPlanSyncRevision.mockResolvedValue(null);
    persistenceMocks.appendPlanSyncRevision.mockResolvedValue({
      projectId: 'project-1',
      version: 1,
      planHash: 'hash-1',
      plan: { version: 1, chunks: [] },
      syncedAt: '2026-04-06T00:00:00.000Z',
      createdAt: '2026-04-06T00:00:00.000Z',
    });
    persistenceMocks.getProjectForUser.mockResolvedValue(null);
    persistenceMocks.listProjectEvents.mockResolvedValue([]);
    persistenceMocks.listProjectsForUser.mockResolvedValue([]);
    persistenceMocks.createProjectForUser.mockResolvedValue({
      id: 'project-1',
      name: 'Project 1',
      goal: 'Ship runtime',
      status: 'active',
      createdAt: '2026-04-05T00:00:00.000Z',
      updatedAt: '2026-04-05T00:00:00.000Z',
    });
    persistenceMocks.getRunStepDiagnostics.mockResolvedValue({
      retryCount: 0,
      failedStepCount: 0,
    });
    storageMocks.readArtifact.mockResolvedValue({ ok: true });
    storageMocks.listArtifacts.mockResolvedValue([]);
    storageMocks.storeJsonArtifact.mockResolvedValue({ key: 'artifact-key', contentLength: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('issues OAuth device-code challenges with expected response fields', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth(
      '/oauth/device/code',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'client_id=scrimble-cli&scope=scrimble%3Acli',
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      device_code: 'device-code-1',
      user_code: 'ABCD-1234',
      verification_uri: 'https://api.scrimble.dev/oauth/device/verify',
      verification_uri_complete: 'https://api.scrimble.dev/oauth/device/verify?user_code=ABCD-1234',
      expires_in: 900,
      interval: 5,
    });
    expect(authMocks.issueDeviceCodeChallenge).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        clientId: 'scrimble-cli',
        scope: 'scrimble:cli',
        origin: 'http://localhost',
      }),
    );
  });

  it('renders OAuth device verification page when user_code is missing', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth('/oauth/device/verify', { method: 'GET' }, env);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Authorize Device');
    // Validation now happens client-side via Firebase bridge
    expect(authMocks.approveDeviceCodeByUserCode).not.toHaveBeenCalled();
    expect(authMocks.approveDeviceCodeByUserCode).not.toHaveBeenCalled();
  });

  it('renders OAuth device verification page with user_code context', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth('/oauth/device/verify?user_code=ABCD-1234', { method: 'GET' }, env);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Authorize Device');
    expect(html).toContain('ABCD-1234');
    expect(authMocks.approveDeviceCodeByUserCode).not.toHaveBeenCalled();
  });

  it('returns 404 for firebase approval when device code is unknown', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    authMocks.approveDeviceCodeWithFirebase.mockResolvedValueOnce({ ok: false, reason: 'not_found' });

    const response = await requestWithAuth(
      '/v1/auth/firebase-approve',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userCode: 'MISSING',
          idToken: 'firebase-token',
        }),
      },
      env,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'not_found',
      message: 'Device code not_found.',
    });
    expect(authMocks.approveDeviceCodeWithFirebase).toHaveBeenCalledWith(env.DB, 'MISSING', 'firebase-token');
  });

  it('returns authorization_pending payload while OAuth device authorization is incomplete', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    authMocks.exchangeDeviceCodeForToken.mockResolvedValueOnce({
      error: 'authorization_pending',
      errorDescription: 'User has not completed device authorization yet.',
    });

    const response = await requestWithAuth(
      '/oauth/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&client_id=scrimble-cli&device_code=device-code-1',
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      error: 'authorization_pending',
      error_description: 'User has not completed device authorization yet.',
    });
  });

  it('returns 401 for v1 routes when bearer token is missing', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    authMocks.resolveAuthContextFromBearer.mockResolvedValueOnce(null);

    const response = await app.request('/v1/projects', { method: 'GET' }, env);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Unauthorized',
      message: 'Missing or invalid bearer token.',
    });
  });

  it('returns 400 for generation start when apiKey is missing', async () => {
    const { env, stub } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth(
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
    const payload = (await response.json()) as {
      error: string;
      message: string;
      issues: Array<{ message: string }>;
    };
    expect(payload).toMatchObject({
      error: 'Invalid generation start payload.',
      message: 'Request validation failed.',
    });
    expect(payload.issues.length).toBeGreaterThan(0);
    expect(payload.issues.some((issue) => issue.message.includes('aiConfig.apiKey'))).toBe(true);
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

    const response = await requestWithAuth(
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
        projectId: 'local-user:project-1',
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
    expect(namespace.idFromName).toHaveBeenCalledWith('local-user:project-1');
    expect(stub.fetch).toHaveBeenCalledTimes(1);

    const doPayload = JSON.parse(String((stub.fetch.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
    expect(doPayload).toMatchObject({
      runId: 'run-fixed',
      projectId: 'local-user:project-1',
      goal: 'Ship runtime',
      aiConfig: validAiConfig,
    });
  });

  it('returns 409 for generation start when project already has an active run', async () => {
    const { env, stub } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.getActiveRunForProject.mockResolvedValue({
      runId: 'run-active',
      status: 'running',
    });

    const response = await requestWithAuth(
      '/v1/generation/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          goal: 'Ship runtime',
          aiConfig: validAiConfig,
        }),
      },
      env,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'Cannot start generation while run run-active is running.',
      activeRun: { runId: 'run-active', status: 'running' },
    });
    expect(persistenceMocks.createGenerationRunRecord).not.toHaveBeenCalled();
    expect(stub.fetch).not.toHaveBeenCalled();
  });

  it('marks generation run as failed when Durable Object start returns an error status', async () => {
    const { env, stub } = createEnv(async () =>
      new Response(JSON.stringify({ error: 'Generation orchestrator unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth(
      '/v1/generation/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          goal: 'Ship runtime',
          aiConfig: validAiConfig,
        }),
      },
      env,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      instanceId: 'project-1',
      runId: 'run-fixed',
      error: 'Generation orchestrator unavailable',
    });
    expect(stub.fetch).toHaveBeenCalledTimes(1);
    expect(persistenceMocks.markGenerationRunFailed).toHaveBeenCalledWith(env.DB, {
      runId: 'run-fixed',
      error: 'Generation orchestrator unavailable',
    });
  });

  it('returns 400 for replan start when provider is unsupported', async () => {
    const { env, stub } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'replan' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth(
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
    const payload = (await response.json()) as {
      error: string;
      message: string;
      issues: Array<{ message: string }>;
    };
    expect(payload).toMatchObject({
      error: 'Invalid replan start payload.',
      message: 'Request validation failed.',
    });
    expect(payload.issues.length).toBeGreaterThan(0);
    expect(payload.issues.some((issue) => issue.message.includes('not supported for cloud planning MVP'))).toBe(true);
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

    const response = await requestWithAuth(
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
        projectId: 'local-user:project-2',
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
    expect(namespace.idFromName).toHaveBeenCalledWith('local-user:project-2');
    expect(stub.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns 409 for replan start when project already has an active run', async () => {
    const { env, stub } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'replan' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.getActiveRunForProject.mockResolvedValue({
      runId: 'run-active',
      status: 'pending',
    });

    const response = await requestWithAuth(
      '/v1/replan/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-2',
          updateRequest: 'Change scope',
          aiConfig: validAiConfig,
        }),
      },
      env,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'Cannot start replan while run run-active is pending.',
      activeRun: { runId: 'run-active', status: 'pending' },
    });
    expect(persistenceMocks.createGenerationRunRecord).not.toHaveBeenCalled();
    expect(stub.fetch).not.toHaveBeenCalled();
  });

  it('uses fallback failure message when replan Durable Object error payload lacks error field', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ reason: 'backend overloaded' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth(
      '/v1/replan/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-2',
          updateRequest: 'Change scope',
          aiConfig: validAiConfig,
        }),
      },
      env,
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      instanceId: 'project-2',
      runId: 'run-fixed',
      reason: 'backend overloaded',
    });
    expect(persistenceMocks.markGenerationRunFailed).toHaveBeenCalledWith(env.DB, {
      runId: 'run-fixed',
      error: 'Failed to start replan run (status 500).',
    });
  });

  it('returns idle generation status when no initial run exists', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.getLatestRunForProject.mockResolvedValueOnce(null);

    const response = await requestWithAuth('/v1/generation/project-3', { method: 'GET' }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      instanceId: 'project-3',
      status: 'idle',
      message: 'No generation run found.',
    });
    expect(persistenceMocks.getLatestRunForProject).toHaveBeenCalledWith(env.DB, {
      projectId: 'local-user:project-3',
      type: 'initial',
    });
  });

  it('returns latest generation run payload from D1', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.getLatestRunForProject.mockResolvedValueOnce({
      runId: 'run-generation',
      status: 'completed',
      output: { revisionId: 'rev-2' },
    });

    const response = await requestWithAuth('/v1/generation/project-3', { method: 'GET' }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      instanceId: 'project-3',
      runId: 'run-generation',
      status: 'completed',
      output: { revisionId: 'rev-2' },
      diagnostics: {
        retryCount: 0,
        failedStepCount: 0,
      },
    });
    expect(persistenceMocks.getRunStepDiagnostics).toHaveBeenCalledWith(env.DB, {
      projectId: 'local-user:project-3',
      runId: 'run-generation',
      type: 'generation',
    });
  });

  it('returns failed generation diagnostics including latestFailure details', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.getLatestRunForProject.mockResolvedValueOnce({
      runId: 'run-generation-failed',
      status: 'failed',
      error: 'provider timeout',
    });
    persistenceMocks.getRunStepDiagnostics.mockResolvedValueOnce({
      retryCount: 2,
      failedStepCount: 1,
      latestFailure: {
        step: 'generate_chunks',
        attempt: 3,
        maxAttempts: 3,
        error: 'provider timeout',
        occurredAt: '2026-04-05T10:00:00.000Z',
      },
    });

    const response = await requestWithAuth('/v1/generation/project-3', { method: 'GET' }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      instanceId: 'project-3',
      runId: 'run-generation-failed',
      status: 'failed',
      diagnostics: {
        retryCount: 2,
        failedStepCount: 1,
        latestFailure: {
          step: 'generate_chunks',
          attempt: 3,
          maxAttempts: 3,
          error: 'provider timeout',
          occurredAt: '2026-04-05T10:00:00.000Z',
        },
      },
    });
  });

  it('returns idle replan status when no replan run exists', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'replan' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.getLatestRunForProject.mockResolvedValueOnce(null);

    const response = await requestWithAuth('/v1/replan/project-4', { method: 'GET' }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      instanceId: 'project-4',
      status: 'idle',
      message: 'No replan run found.',
    });
    expect(persistenceMocks.getLatestRunForProject).toHaveBeenCalledWith(env.DB, {
      projectId: 'local-user:project-4',
      type: 'replan',
    });
  });

  it('returns latest replan run payload from D1', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'replan' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.getLatestRunForProject.mockResolvedValueOnce({
      runId: 'run-replan',
      status: 'failed',
      error: 'provider timeout',
    });

    const response = await requestWithAuth('/v1/replan/project-4', { method: 'GET' }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      instanceId: 'project-4',
      runId: 'run-replan',
      status: 'failed',
      error: 'provider timeout',
      diagnostics: {
        retryCount: 0,
        failedStepCount: 0,
      },
    });
    expect(persistenceMocks.getRunStepDiagnostics).toHaveBeenCalledWith(env.DB, {
      projectId: 'local-user:project-4',
      runId: 'run-replan',
      type: 'replan',
    });
  });

  it('returns failed replan diagnostics including latestFailure details', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'replan' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.getLatestRunForProject.mockResolvedValueOnce({
      runId: 'run-replan-failed',
      status: 'failed',
      error: 'provider timeout',
    });
    persistenceMocks.getRunStepDiagnostics.mockResolvedValueOnce({
      retryCount: 3,
      failedStepCount: 1,
      latestFailure: {
        step: 'replan_chunks',
        attempt: 4,
        maxAttempts: 4,
        error: 'provider timeout',
        occurredAt: '2026-04-05T11:00:00.000Z',
      },
    });

    const response = await requestWithAuth('/v1/replan/project-4', { method: 'GET' }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      instanceId: 'project-4',
      runId: 'run-replan-failed',
      status: 'failed',
      diagnostics: {
        retryCount: 3,
        failedStepCount: 1,
        latestFailure: {
          step: 'replan_chunks',
          attempt: 4,
          maxAttempts: 4,
          error: 'provider timeout',
          occurredAt: '2026-04-05T11:00:00.000Z',
        },
      },
    });
  });

  it('forwards /generation/:id/progress requests to DO events endpoint with since query', async () => {
    const { env, stub, namespace } = createEnv(async () =>
      new Response(JSON.stringify({ events: [{ sequence: 2, stage: 'chunks-generated' }], count: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth('/v1/generation/project-5/progress?since=7', { method: 'GET' }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      events: [{ sequence: 2, stage: 'chunks-generated' }],
      count: 1,
    });
    expect(namespace.idFromName).toHaveBeenCalledWith('local-user:project-5');
    expect(stub.fetch).toHaveBeenCalledWith('https://progress-hub.internal/events?since=7');
  });

  it('forwards /generation/:id/stream requests to DO stream endpoint preserving accept header', async () => {
    const { env, stub, namespace } = createEnv(async (_url, init) =>
      new Response(': connected\n\nevent: progress\ndata: {"sequence":2}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );

    const response = await requestWithAuth(
      '/v1/generation/project-6/stream?since=11',
      {
        method: 'GET',
        headers: { accept: 'text/event-stream' },
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toContain('event: progress');
    expect(namespace.idFromName).toHaveBeenCalledWith('local-user:project-6');

    const [url, init] = stub.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://progress-hub.internal/stream?since=11');
    expect((init.headers as Record<string, string>)['accept']).toBe('text/event-stream');
  });

  it('lists projects from persistence with count metadata', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.listProjectsForUser.mockResolvedValueOnce([
      {
        id: 'project-10',
        name: 'Project 10',
        goal: 'Ship runtime',
        status: 'active',
        createdAt: '2026-04-05T00:00:00.000Z',
        updatedAt: '2026-04-05T00:00:00.000Z',
      },
    ]);

    const response = await requestWithAuth('/v1/projects', { method: 'GET' }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      projects: [
        {
          id: 'project-10',
          name: 'Project 10',
          goal: 'Ship runtime',
          status: 'active',
          createdAt: '2026-04-05T00:00:00.000Z',
          updatedAt: '2026-04-05T00:00:00.000Z',
        },
      ],
      count: 1,
    });
    expect(persistenceMocks.listProjectsForUser).toHaveBeenCalledWith(env.DB, 'local-user');
  });

  it('creates project with generated id when payload is valid', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.createProjectForUser.mockResolvedValueOnce({
      id: 'ship-runtime',
      name: 'Ship Runtime',
      goal: 'Ship runtime',
      status: 'active',
      createdAt: '2026-04-05T00:00:00.000Z',
      updatedAt: '2026-04-05T00:00:00.000Z',
    });

    const response = await requestWithAuth(
      '/v1/projects',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Ship Runtime',
          goal: 'Ship runtime',
        }),
      },
      env,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      project: {
        id: 'ship-runtime',
        name: 'Ship Runtime',
        goal: 'Ship runtime',
        status: 'active',
        createdAt: '2026-04-05T00:00:00.000Z',
        updatedAt: '2026-04-05T00:00:00.000Z',
      },
    });
    expect(persistenceMocks.getProjectForUser).toHaveBeenCalledWith(env.DB, 'local-user', 'local-user:ship-runtime');
    expect(persistenceMocks.createProjectForUser).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        userId: 'local-user',
        id: 'local-user:ship-runtime',
        name: 'Ship Runtime',
        goal: 'Ship runtime',
      }),
    );
    expect(persistenceMocks.appendProjectEvent).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        projectId: 'local-user:ship-runtime',
        type: 'project_created',
      }),
    );
  });

  it('returns 400 validation contract for invalid project payload', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth(
      '/v1/projects',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: '',
          goal: '',
        }),
      },
      env,
    );
    const payload = (await response.json()) as {
      error: string;
      message: string;
      issues: Array<{ path: Array<string | number> }>;
    };

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      error: 'Invalid project payload.',
      message: 'Request validation failed.',
    });
    expect(payload.issues.some((issue) => issue.path[0] === 'name' || issue.path[0] === 'goal')).toBe(true);
    expect(persistenceMocks.createProjectForUser).not.toHaveBeenCalled();
  });

  it('returns 409 when project id already exists during project creation', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.getProjectForUser.mockResolvedValueOnce({
      id: 'project-dup',
      name: 'Existing',
      goal: 'Keep existing',
      status: 'active',
      createdAt: '2026-04-05T00:00:00.000Z',
      updatedAt: '2026-04-05T00:00:00.000Z',
    });

    const response = await requestWithAuth(
      '/v1/projects',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'project-dup',
          name: 'Existing',
          goal: 'Keep existing',
        }),
      },
      env,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Project already exists',
      message: 'A project with this id already exists.',
      id: 'project-dup',
    });
    expect(persistenceMocks.createProjectForUser).not.toHaveBeenCalled();
  });

  it('returns 404 for project fetch when project does not exist', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.getProjectForUser.mockResolvedValueOnce(null);

    const response = await requestWithAuth('/v1/projects/project-999', { method: 'GET' }, env);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Project not found',
      message: 'Requested project does not exist.',
      id: 'project-999',
    });
  });

  it('returns project payload for project fetch when project exists', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.getProjectForUser.mockResolvedValueOnce({
      id: 'project-11',
      name: 'Project 11',
      goal: 'Ship runtime',
      status: 'active',
      createdAt: '2026-04-05T00:00:00.000Z',
      updatedAt: '2026-04-05T00:00:00.000Z',
    });

    const response = await requestWithAuth('/v1/projects/project-11', { method: 'GET' }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      project: {
        id: 'project-11',
        name: 'Project 11',
        goal: 'Ship runtime',
        status: 'active',
        createdAt: '2026-04-05T00:00:00.000Z',
        updatedAt: '2026-04-05T00:00:00.000Z',
      },
    });
  });

  it('returns canonical sync registry state for a project', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.getLatestPlanSyncRevision.mockResolvedValueOnce({
      projectId: 'project-11',
      version: 2,
      planHash: 'hash-remote',
      plan: { version: 3, chunks: [{ id: 'chunk-1' }] },
      syncedAt: '2026-04-06T01:00:00.000Z',
      createdAt: '2026-04-06T01:00:00.000Z',
    });

    const response = await requestWithAuth('/v1/projects/project-11/sync', { method: 'GET' }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      projectId: 'project-11',
      latest: {
        version: 2,
        planHash: 'hash-remote',
        plan: { version: 3, chunks: [{ id: 'chunk-1' }] },
        syncedAt: '2026-04-06T01:00:00.000Z',
        createdAt: '2026-04-06T01:00:00.000Z',
      },
    });
    expect(persistenceMocks.getLatestPlanSyncRevision).toHaveBeenCalledWith(env.DB, 'local-user:project-11');
  });

  it('appends a canonical sync revision for valid sync payload', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.getLatestPlanSyncRevision.mockResolvedValueOnce({
      projectId: 'project-11',
      version: 1,
      planHash: 'hash-prev',
      plan: { version: 1, chunks: [] },
      syncedAt: '2026-04-06T00:00:00.000Z',
      createdAt: '2026-04-06T00:00:00.000Z',
    });
    persistenceMocks.appendPlanSyncRevision.mockResolvedValueOnce({
      projectId: 'project-11',
      version: 2,
      planHash: 'hash-next',
      plan: { version: 2, chunks: [{ id: 'chunk-1' }] },
      syncedAt: '2026-04-06T02:00:00.000Z',
      createdAt: '2026-04-06T02:00:00.000Z',
    });

    const response = await requestWithAuth(
      '/v1/projects/project-11/sync',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planHash: 'hash-next',
          plan: { version: 2, chunks: [{ id: 'chunk-1' }] },
          expectedRemoteHash: 'hash-prev',
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'synced',
      projectId: 'project-11',
      latest: {
        version: 2,
        planHash: 'hash-next',
        plan: { version: 2, chunks: [{ id: 'chunk-1' }] },
        syncedAt: '2026-04-06T02:00:00.000Z',
        createdAt: '2026-04-06T02:00:00.000Z',
      },
    });
    expect(persistenceMocks.ensureProjectRecordForUser).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        userId: 'local-user',
        projectId: 'local-user:project-11',
      }),
    );
    expect(persistenceMocks.appendPlanSyncRevision).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        projectId: 'local-user:project-11',
        planHash: 'hash-next',
      }),
    );
    expect(persistenceMocks.appendProjectEvent).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        projectId: 'local-user:project-11',
        type: 'plan_synced',
      }),
    );
  });

  it('returns 409 sync conflict when expected remote hash does not match canonical hash', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.getLatestPlanSyncRevision.mockResolvedValueOnce({
      projectId: 'project-11',
      version: 3,
      planHash: 'hash-remote-new',
      plan: { version: 3, chunks: [{ id: 'chunk-remote' }] },
      syncedAt: '2026-04-06T03:00:00.000Z',
      createdAt: '2026-04-06T03:00:00.000Z',
    });

    const response = await requestWithAuth(
      '/v1/projects/project-11/sync',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planHash: 'hash-local-next',
          plan: { version: 4, chunks: [{ id: 'chunk-local' }] },
          expectedRemoteHash: 'hash-remote-old',
        }),
      },
      env,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'Sync conflict',
      message: 'Remote canonical plan changed since last known hash.',
      conflict: {
        remotePlanHash: 'hash-remote-new',
        localPlanHash: 'hash-local-next',
        expectedRemoteHash: 'hash-remote-old',
      },
    });
    expect(persistenceMocks.appendPlanSyncRevision).not.toHaveBeenCalled();
  });

  it('records cloud chunk completion events', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth(
      '/v1/projects/project-11/chunks/complete',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chunkId: 'chunk-002',
          chunkTitle: 'Implement registry sync',
          verificationStatus: 'pass',
          forced: false,
          reason: null,
          nextChunkId: 'chunk-003',
          completedAt: '2026-04-06T05:00:00.000Z',
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'recorded',
      projectId: 'project-11',
      chunkId: 'chunk-002',
      completedAt: '2026-04-06T05:00:00.000Z',
    });
    expect(persistenceMocks.ensureProjectRecordForUser).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        userId: 'local-user',
        projectId: 'local-user:project-11',
      }),
    );
    expect(persistenceMocks.appendProjectEvent).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        projectId: 'local-user:project-11',
        type: 'chunk_completed',
        data: expect.objectContaining({
          chunkId: 'chunk-002',
          chunkTitle: 'Implement registry sync',
          nextChunkId: 'chunk-003',
        }),
      }),
    );
  });

  it('lists cloud project events with filtering', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    persistenceMocks.listProjectEvents.mockResolvedValueOnce([
      {
        id: 'event-1',
        projectId: 'local-user:project-11',
        type: 'generation_step_retrying',
        data: { runId: 'run-1', step: 'generate_chunks', attempt: 2 },
        createdAt: '2026-04-06T07:30:00.000Z',
      },
    ]);

    const response = await requestWithAuth(
      '/v1/projects/project-11/events?type=generation_step_retrying&limit=5',
      { method: 'GET' },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      projectId: 'project-11',
      events: [
        {
          id: 'event-1',
          projectId: 'project-11',
          type: 'generation_step_retrying',
          data: { runId: 'run-1', step: 'generate_chunks', attempt: 2 },
          createdAt: '2026-04-06T07:30:00.000Z',
        },
      ],
      count: 1,
    });
    expect(persistenceMocks.listProjectEvents).toHaveBeenCalledWith(
      env.DB,
      expect.objectContaining({
        projectId: 'local-user:project-11',
        type: 'generation_step_retrying',
        limit: 5,
      }),
    );
  });

  it('returns 400 validation contract for invalid project events query', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth('/v1/projects/project-11/events?limit=abc', { method: 'GET' }, env);
    const payload = (await response.json()) as {
      error: string;
      message: string;
      issues: Array<{ path: Array<string | number> }>;
    };

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      error: 'Invalid project events query.',
      message: 'Request validation failed.',
    });
    expect(payload.issues.some((issue) => issue.path[0] === 'limit')).toBe(true);
  });

  it('returns 400 validation contract for invalid artifact create payload', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth(
      '/v1/artifacts',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: '',
          payload: { revision: 2 },
        }),
      },
      env,
    );
    const payload = (await response.json()) as {
      error: string;
      message: string;
      issues: Array<{ path: Array<string | number> }>;
    };

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      error: 'Invalid artifact payload.',
      message: 'Request validation failed.',
    });
    expect(payload.issues.some((issue) => issue.path[0] === 'projectId' || issue.path[0] === 'type')).toBe(true);
    expect(storageMocks.storeJsonArtifact).not.toHaveBeenCalled();
  });

  it('stores artifact and returns key/bytes payload on valid create request', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth(
      '/v1/artifacts',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-8',
          type: 'plan-snapshot',
          payload: { revision: 3 },
          metadata: { source: 'cli' },
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      key: 'artifact-key',
      bytes: 1,
    });
    expect(storageMocks.storeJsonArtifact).toHaveBeenCalledWith(env.ARTIFACTS, {
      projectId: 'local-user:project-8',
      type: 'plan-snapshot',
      payload: { revision: 3 },
      metadata: { source: 'cli' },
    });
  });

  it('returns consistent error/message contract when artifacts key is missing', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth('/v1/artifacts', { method: 'GET' }, env);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Missing query parameter: key',
      message: 'Request validation failed.',
    });
  });

  it('returns 400 validation contract when artifacts list limit is non-numeric', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth('/v1/artifacts/list?limit=abc', { method: 'GET' }, env);
    const payload = (await response.json()) as {
      error: string;
      message: string;
      issues: Array<{ path: Array<string | number> }>;
    };

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      error: 'Invalid artifacts list query.',
      message: 'Request validation failed.',
    });
    expect(payload.issues.some((issue) => issue.path[0] === 'limit')).toBe(true);
    expect(storageMocks.listArtifacts).not.toHaveBeenCalled();
  });

  it('returns 400 validation contract when artifacts list limit exceeds max', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth('/v1/artifacts/list?limit=101', { method: 'GET' }, env);
    const payload = (await response.json()) as {
      error: string;
      message: string;
      issues: Array<{ path: Array<string | number> }>;
    };

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      error: 'Invalid artifacts list query.',
      message: 'Request validation failed.',
    });
    expect(payload.issues.some((issue) => issue.path[0] === 'limit')).toBe(true);
    expect(storageMocks.listArtifacts).not.toHaveBeenCalled();
  });

  it('lists artifacts with validated prefix and limit', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    storageMocks.listArtifacts.mockResolvedValueOnce([
      { key: 'local-user:project-7/plan/revision-2.json', uploaded: '2026-04-05T11:20:00.000Z' },
    ]);

    const response = await requestWithAuth(
      '/v1/artifacts/list?projectId=project-7&type=plan&limit=2',
      { method: 'GET' },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      artifacts: [{ key: 'local-user:project-7/plan/revision-2.json', uploaded: '2026-04-05T11:20:00.000Z' }],
      count: 1,
    });
    expect(storageMocks.listArtifacts).toHaveBeenCalledWith(env.ARTIFACTS, {
      prefix: 'local-user:project-7/plan/',
      limit: 2,
    });
  });

  it('returns consistent not-found artifact error payload', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    storageMocks.readArtifact.mockResolvedValueOnce(null);

    const response = await requestWithAuth(
      '/v1/artifacts?projectId=project-7&key=local-user-project-7/plan/missing-artifact.json',
      { method: 'GET' },
      env,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Artifact not found',
      message: 'Requested artifact does not exist.',
      key: 'local-user-project-7/plan/missing-artifact.json',
    });
    expect(storageMocks.readArtifact).toHaveBeenCalledWith(env.ARTIFACTS, 'local-user-project-7/plan/missing-artifact.json');
  });

  it('returns consistent notFound route error contract', async () => {
    const { env } = createEnv(async () =>
      new Response(JSON.stringify({ status: 'queued', type: 'generation' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const response = await requestWithAuth('/v1/does-not-exist', { method: 'GET' }, env);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Not Found',
      message: 'Route does not exist.',
      path: '/v1/does-not-exist',
    });
  });
});
