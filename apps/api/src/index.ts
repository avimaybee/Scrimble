import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

// Type definitions for Cloudflare bindings
export interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
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
