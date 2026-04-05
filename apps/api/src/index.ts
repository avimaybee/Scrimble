import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { z } from 'zod';
import type { GenerationProgressHub } from './durable-objects/generation-progress.js';
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
const startGenerationSchema = z.object({
  projectId: z.string().min(1),
  goal: z.string().min(1),
  repoSnapshot: z.string().optional(),
});
const startReplanSchema = z.object({
  projectId: z.string().min(1),
  updateRequest: z.string().min(1),
  currentPlanSummary: z.string().optional(),
});

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
  const parsed = startGenerationSchema.parse(body);
  
  // Use project ID as the DO instance name for consistent addressing
  const doId = c.env.PROGRESS_HUB.idFromName(parsed.projectId);
  const stub = c.env.PROGRESS_HUB.get(doId);
  
  const response = await stub.fetch('https://progress-hub.internal/start-generation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: parsed.projectId,
      goal: parsed.goal,
      ...(parsed.repoSnapshot ? { repoSnapshot: parsed.repoSnapshot } : {}),
    }),
  });
  
  const result = (await response.json()) as Record<string, unknown>;
  return c.json({
    instanceId: parsed.projectId,
    ...result,
  });
});

v1.get('/generation/:id', async (c) => {
  const id = c.req.param('id');
  const doId = c.env.PROGRESS_HUB.idFromName(id);
  const stub = c.env.PROGRESS_HUB.get(doId);
  const response = await stub.fetch('https://progress-hub.internal/status');
  const status = (await response.json()) as Record<string, unknown>;
  return c.json({ instanceId: id, ...status });
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
  const parsed = startReplanSchema.parse(body);
  
  // Use project ID as the DO instance name for consistent addressing
  const doId = c.env.PROGRESS_HUB.idFromName(parsed.projectId);
  const stub = c.env.PROGRESS_HUB.get(doId);
  
  const response = await stub.fetch('https://progress-hub.internal/start-replan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: parsed.projectId,
      updateRequest: parsed.updateRequest,
      ...(parsed.currentPlanSummary ? { currentPlanSummary: parsed.currentPlanSummary } : {}),
    }),
  });
  
  const result = (await response.json()) as Record<string, unknown>;
  return c.json({
    instanceId: parsed.projectId,
    ...result,
  });
});

v1.get('/replan/:id', async (c) => {
  const id = c.req.param('id');
  const doId = c.env.PROGRESS_HUB.idFromName(id);
  const stub = c.env.PROGRESS_HUB.get(doId);
  const response = await stub.fetch('https://progress-hub.internal/status');
  const status = (await response.json()) as Record<string, unknown>;
  return c.json({ instanceId: id, ...status });
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
