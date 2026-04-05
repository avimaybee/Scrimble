import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { z } from 'zod';
import { aiConfigSchema } from '@scrimble/shared';
import type { GenerationProgressHub } from './durable-objects/generation-progress.js';
import {
  appendProjectEvent,
  createGenerationRunRecord,
  ensureLocalProjectRecord,
  getActiveRunForProject,
  getLatestRunForProject,
  getRunStepDiagnostics,
  markGenerationRunFailed,
} from './lib/persistence.js';
import { listArtifacts, readArtifact, storeJsonArtifact } from './lib/storage.js';
export { GenerationProgressHub } from './durable-objects/generation-progress.js';

// Type definitions for Cloudflare bindings
export interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  PROGRESS_HUB: DurableObjectNamespace<GenerationProgressHub>;
  ENVIRONMENT: string;
}

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Health check
app.get('/', (c) => {
  return c.json({
    name: 'scrimble-api',
    version: '0.1.0',
    status: 'ok',
    environment: c.env.ENVIRONMENT,
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'healthy' });
});

// API v1 routes (to be implemented)
const v1 = new Hono<{ Bindings: Env }>();
const createArtifactSchema = z.object({
  projectId: z.string().min(1),
  type: z.string().min(1),
  payload: z.unknown(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const CLOUD_PLANNING_PROVIDERS = new Set([
  'openai',
  'openrouter',
  'github-copilot',
  'groq',
  'together',
  'azure',
]);

const cloudPlanningAiConfigSchema = aiConfigSchema.superRefine((value, context) => {
  if (!value.apiKey?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'aiConfig.apiKey is required for cloud planning runs.',
      path: ['apiKey'],
    });
  }

  if (!CLOUD_PLANNING_PROVIDERS.has(value.provider)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Provider "${value.provider}" is not supported for cloud planning MVP. Use an OpenAI-compatible provider.`,
      path: ['provider'],
    });
  }
});

const startGenerationSchema = z.object({
  projectId: z.string().min(1),
  goal: z.string().min(1),
  repoSnapshot: z.string().optional(),
  aiConfig: cloudPlanningAiConfigSchema,
});
const startReplanSchema = z.object({
  projectId: z.string().min(1),
  updateRequest: z.string().min(1),
  currentPlanSummary: z.string().optional(),
  aiConfig: cloudPlanningAiConfigSchema,
});

function formatValidationErrorResponse(error: string, issues: z.ZodIssue[]): {
  error: string;
  message: string;
  issues: z.ZodIssue[];
} {
  return {
    error,
    message: 'Request validation failed.',
    issues,
  };
}

function redactAIConfig(aiConfig: unknown): Record<string, unknown> {
  const parsed = aiConfigSchema.parse(aiConfig);
  return {
    provider: parsed.provider,
    model: parsed.model,
    ...(parsed.baseUrl ? { baseUrl: parsed.baseUrl } : {}),
    ...(parsed.options ? { options: parsed.options } : {}),
  };
}

v1.get('/projects', async (c) => {
  // TODO: Implement project listing
  return c.json({ projects: [], message: 'Not yet implemented' });
});

v1.post('/projects', async (c) => {
  // TODO: Implement project creation
  return c.json({ message: 'Not yet implemented' }, 501);
});

v1.get('/projects/:id', async (c) => {
  // TODO: Implement project fetch
  const id = c.req.param('id');
  return c.json({ message: 'Not yet implemented', id }, 501);
});

v1.post('/artifacts', async (c) => {
  const body = await c.req.json();
  const parsed = createArtifactSchema.parse(body);
  const stored = await storeJsonArtifact(c.env.ARTIFACTS, {
    projectId: parsed.projectId,
    type: parsed.type,
    payload: parsed.payload,
    ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
  });
  return c.json({
    key: stored.key,
    bytes: stored.contentLength,
  });
});

v1.get('/artifacts', async (c) => {
  const key = c.req.query('key');
  if (!key) {
    return c.json({ error: 'Missing query parameter: key' }, 400);
  }

  const artifact = await readArtifact(c.env.ARTIFACTS, key);
  if (!artifact) {
    return c.json({ error: 'Artifact not found', key }, 404);
  }

  return c.json({ key, artifact });
});

v1.get('/artifacts/list', async (c) => {
  const projectId = c.req.query('projectId');
  const type = c.req.query('type');
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 20;
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20;

  const prefixParts = [projectId, type].filter((value): value is string => Boolean(value));
  const prefix = prefixParts.length > 0 ? `${prefixParts.join('/')}/` : undefined;
  const artifacts = await listArtifacts(c.env.ARTIFACTS, {
    ...(prefix ? { prefix } : {}),
    limit: safeLimit,
  });

  return c.json({ artifacts, count: artifacts.length });
});

v1.post('/generation/start', async (c) => {
  const body = await c.req.json();
  const parsedResult = startGenerationSchema.safeParse(body);
  if (!parsedResult.success) {
    return c.json(formatValidationErrorResponse('Invalid generation start payload.', parsedResult.error.issues), 400);
  }
  const parsed = parsedResult.data;
  const projectId = parsed.projectId.trim();
  const runId = crypto.randomUUID();

  const activeRun = await getActiveRunForProject(c.env.DB, projectId);
  if (activeRun) {
    return c.json({
      error: `Cannot start generation while run ${activeRun.runId} is ${activeRun.status}.`,
      activeRun,
    }, 409);
  }

  await ensureLocalProjectRecord(c.env.DB, {
    projectId,
    goal: parsed.goal.trim(),
  });
  await createGenerationRunRecord(c.env.DB, {
    runId,
    projectId,
    type: 'initial',
    input: {
      goal: parsed.goal,
      ...(parsed.repoSnapshot ? { repoSnapshot: parsed.repoSnapshot } : {}),
      aiConfig: redactAIConfig(parsed.aiConfig),
    },
  });
  await appendProjectEvent(c.env.DB, {
    projectId,
    type: 'generation_started',
    data: { runId },
  });
  
  // Use project ID as the DO instance name for consistent addressing
  const doId = c.env.PROGRESS_HUB.idFromName(projectId);
  const stub = c.env.PROGRESS_HUB.get(doId);
  
  const response = await stub.fetch('https://progress-hub.internal/start-generation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      runId,
      projectId,
      goal: parsed.goal,
      ...(parsed.repoSnapshot ? { repoSnapshot: parsed.repoSnapshot } : {}),
      aiConfig: parsed.aiConfig,
    }),
  });
  
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const errorMessage = typeof result['error'] === 'string'
      ? result['error']
      : `Failed to start generation run (status ${response.status}).`;
    await markGenerationRunFailed(c.env.DB, { runId, error: errorMessage });
  }
  return new Response(
    JSON.stringify({
      instanceId: projectId,
      runId,
      ...result,
    }),
    {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    },
  );
});

v1.get('/generation/:id', async (c) => {
  const id = c.req.param('id');
  const run = await getLatestRunForProject(c.env.DB, { projectId: id, type: 'initial' });
  if (!run) {
    return c.json({ instanceId: id, status: 'idle', message: 'No generation run found.' });
  }
  const diagnostics = await getRunStepDiagnostics(c.env.DB, {
    projectId: id,
    runId: run.runId,
    type: 'generation',
  });
  return c.json({
    instanceId: id,
    ...run,
    diagnostics,
  });
});

v1.get('/generation/:id/progress', async (c) => {
  const id = c.req.param('id');
  const since = c.req.query('since');
  const progressId = c.env.PROGRESS_HUB.idFromName(id);
  const stub = c.env.PROGRESS_HUB.get(progressId);
  const url = new URL('https://progress-hub.internal/events');
  if (since) {
    url.searchParams.set('since', since);
  }
  return stub.fetch(url.toString());
});

v1.get('/generation/:id/stream', async (c) => {
  const id = c.req.param('id');
  const since = c.req.query('since');
  const progressId = c.env.PROGRESS_HUB.idFromName(id);
  const stub = c.env.PROGRESS_HUB.get(progressId);
  const url = new URL('https://progress-hub.internal/stream');
  if (since) {
    url.searchParams.set('since', since);
  }
  return stub.fetch(url.toString(), {
    headers: {
      accept: c.req.header('accept') ?? 'text/event-stream',
    },
  });
});

v1.post('/replan/start', async (c) => {
  const body = await c.req.json();
  const parsedResult = startReplanSchema.safeParse(body);
  if (!parsedResult.success) {
    return c.json(formatValidationErrorResponse('Invalid replan start payload.', parsedResult.error.issues), 400);
  }
  const parsed = parsedResult.data;
  const projectId = parsed.projectId.trim();
  const runId = crypto.randomUUID();

  const activeRun = await getActiveRunForProject(c.env.DB, projectId);
  if (activeRun) {
    return c.json({
      error: `Cannot start replan while run ${activeRun.runId} is ${activeRun.status}.`,
      activeRun,
    }, 409);
  }

  await ensureLocalProjectRecord(c.env.DB, {
    projectId,
  });
  await createGenerationRunRecord(c.env.DB, {
    runId,
    projectId,
    type: 'replan',
    input: {
      updateRequest: parsed.updateRequest,
      ...(parsed.currentPlanSummary ? { currentPlanSummary: parsed.currentPlanSummary } : {}),
      aiConfig: redactAIConfig(parsed.aiConfig),
    },
  });
  
  // Use project ID as the DO instance name for consistent addressing
  const doId = c.env.PROGRESS_HUB.idFromName(projectId);
  const stub = c.env.PROGRESS_HUB.get(doId);
  
  const response = await stub.fetch('https://progress-hub.internal/start-replan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      runId,
      projectId,
      updateRequest: parsed.updateRequest,
      ...(parsed.currentPlanSummary ? { currentPlanSummary: parsed.currentPlanSummary } : {}),
      aiConfig: parsed.aiConfig,
    }),
  });
  
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const errorMessage = typeof result['error'] === 'string'
      ? result['error']
      : `Failed to start replan run (status ${response.status}).`;
    await markGenerationRunFailed(c.env.DB, { runId, error: errorMessage });
  }
  return new Response(
    JSON.stringify({
      instanceId: projectId,
      runId,
      ...result,
    }),
    {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    },
  );
});

v1.get('/replan/:id', async (c) => {
  const id = c.req.param('id');
  const run = await getLatestRunForProject(c.env.DB, { projectId: id, type: 'replan' });
  if (!run) {
    return c.json({ instanceId: id, status: 'idle', message: 'No replan run found.' });
  }
  const diagnostics = await getRunStepDiagnostics(c.env.DB, {
    projectId: id,
    runId: run.runId,
    type: 'replan',
  });
  return c.json({
    instanceId: id,
    ...run,
    diagnostics,
  });
});

app.route('/v1', v1);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not Found', path: c.req.path }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('API Error:', err);
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

export default app;
