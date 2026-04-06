import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { z } from 'zod';
import { aiConfigSchema, createProjectSchema } from '@scrimble/shared';
import type { GenerationProgressHub } from './durable-objects/generation-progress.js';
import {
  appendPlanSyncRevision,
  appendProjectEvent,
  createProjectForUser,
  createGenerationRunRecord,
  getLatestPlanSyncRevision,
  ensureProjectRecordForUser,
  getActiveRunForProject,
  getLatestRunForProject,
  listProjectEvents,
  getProjectForUser,
  listProjectsForUser,
  getRunStepDiagnostics,
  markGenerationRunFailed,
} from './lib/persistence.js';
import {
  approveDeviceCodeByUserCode,
  approveDeviceCodeWithFirebase,
  exchangeDeviceCodeForToken,
  issueDeviceCodeChallenge,
  resolveAuthContextFromBearer,
  type AuthContext,
} from './lib/auth.js';
import { listArtifacts, readArtifact, storeJsonArtifact } from './lib/storage.js';
export { GenerationProgressHub } from './durable-objects/generation-progress.js';

// Type definitions for Cloudflare bindings
export interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  PROGRESS_HUB: DurableObjectNamespace<GenerationProgressHub>;
  ENVIRONMENT: string;
}

type AppEnv = {
  Bindings: Env;
  Variables: {
    auth: AuthContext;
  };
};

const app = new Hono<AppEnv>();

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

// API v1 routes
const v1 = new Hono<AppEnv>();
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
const artifactListQuerySchema = z.object({
  projectId: z.string().trim().min(1),
  type: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const createProjectRequestSchema = createProjectSchema.extend({
  id: z.string().trim().min(1).optional(),
});
const syncPlanRequestSchema = z.object({
  planHash: z.string().trim().min(1),
  plan: z.unknown(),
  expectedRemoteHash: z.string().trim().min(1).optional(),
});
const completeChunkRequestSchema = z.object({
  chunkId: z.string().trim().min(1),
  chunkTitle: z.string().trim().min(1),
  verificationStatus: z.string().trim().min(1).optional(),
  forced: z.boolean().optional(),
  reason: z.string().trim().nullable().optional(),
  nextChunkId: z.string().trim().nullable().optional(),
  completedAt: z.string().trim().min(1).optional(),
});
const projectEventsQuerySchema = z.object({
  type: z.string().trim().min(1).optional(),
  since: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const firebaseApprovePayloadSchema = z.object({
  userCode: z.string().trim().min(1),
  idToken: z.string().trim().min(1),
});
const deviceCodeRequestSchema = z.object({
  client_id: z.string().trim().min(1),
  scope: z.string().trim().optional(),
  audience: z.string().trim().optional(),
});
const deviceTokenRequestSchema = z.object({
  grant_type: z.string().trim().min(1),
  client_id: z.string().trim().min(1),
  device_code: z.string().trim().min(1),
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

function formatErrorResponse(
  error: string,
  message: string,
  extra?: Record<string, unknown>,
): { error: string; message: string } & Record<string, unknown> {
  return {
    error,
    message,
    ...(extra ?? {}),
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

function createProjectId(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized.length > 0 ? normalized : `project-${crypto.randomUUID().slice(0, 8)}`;
}

function scopeProjectId(userId: string, projectId: string): string {
  const trimmed = projectId.trim();
  return `${userId}:${trimmed}`;
}

function unscopeProjectId(userId: string, projectId: string): string {
  const prefix = `${userId}:`;
  return projectId.startsWith(prefix) ? projectId.slice(prefix.length) : projectId;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-_.]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function readUrlEncodedBody(c: { req: { text: () => Promise<string> } }): Promise<Record<string, string>> {
  const body = await c.req.text();
  const params = new URLSearchParams(body);
  return Object.fromEntries(params.entries());
}

function renderDeviceVerificationPage(userCode?: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Scrimble — Authorize Device</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-stone-50 text-stone-900 font-sans min-h-screen flex items-center justify-center p-6">
    <div class="max-w-md w-full bg-white rounded-2xl shadow-xl border border-stone-200 p-8">
      <div class="mb-8 text-center">
        <h1 class="text-2xl font-bold tracking-tight">Authorize Device</h1>
        <p class="text-stone-500 mt-2">Sign in to link this CLI session to your Scrimble account.</p>
      </div>

      <div id="auth-container" class="space-y-6">
        <div class="bg-stone-50 rounded-xl p-4 border border-stone-200 text-center">
          <span class="text-xs font-semibold text-stone-400 uppercase tracking-wider">Device Code</span>
          <div class="text-3xl font-mono font-bold mt-1 tracking-widest text-stone-800" id="display-user-code">${userCode || '---- ----'}</div>
        </div>

        <div id="firebaseui-auth-container">
           <button id="sign-in-btn" class="w-full py-3 px-4 bg-stone-900 text-white rounded-lg font-medium hover:bg-stone-800 transition-colors flex items-center justify-center gap-2">
             Sign in with Google
           </button>
        </div>

        <div id="status-msg" class="hidden p-4 rounded-lg text-sm font-medium"></div>
      </div>
    </div>

    <!-- Firebase SDKs -->
    <script type="module">
      import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
      import { getAuth, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

      const firebaseConfig = {
        apiKey: "AIzaSyBjaSbuwgaFSBDmhAEX5TcLuOPokBMNyp0",
        authDomain: "scrimble-auth.firebaseapp.com",
        projectId: "scrimble-auth",
        storageBucket: "scrimble-auth.firebasestorage.app",
        messagingSenderId: "714624747391",
        appId: "1:714624747391:web:214613547d5e8ace2ebc4a",
        measurementId: "G-EBBT2RYJQD"
      };

      const app = initializeApp(firebaseConfig);
      const auth = getAuth(app);
      const provider = new GoogleAuthProvider();

      const btn = document.getElementById('sign-in-btn');
      const status = document.getElementById('status-msg');
      const container = document.getElementById('auth-container');

      const userCode = "${userCode || ''}";

      function showStatus(msg, type) {
        status.textContent = msg;
        status.className = \`p-4 rounded-lg text-sm font-medium \${
          type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 
          'bg-red-50 text-red-700 border border-red-200'
        }\`;
        status.classList.remove('hidden');
      }

      btn.onclick = async () => {
        if (!userCode) {
          showStatus('Missing user code in URL. Re-open the link from your terminal.', 'error');
          return;
        }

        btn.disabled = true;
        btn.textContent = 'Signing in...';

        try {
          const result = await signInWithPopup(auth, provider);
          const idToken = await result.user.getIdToken();
          
          showStatus('Authenticating with Scrimble...', 'success');
          
          const response = await fetch('/v1/auth/firebase-approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userCode, idToken })
          });

          const data = await response.json();
          if (response.ok) {
            container.innerHTML = \`
              <div class="text-center py-6">
                <div class="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                </div>
                <h2 class="text-xl font-bold">Authorized Successfully</h2>
                <p class="text-stone-500 mt-2">You can close this window and return to your terminal.</p>
              </div>
            \`;
          } else {
            showStatus(data.message || 'Approval failed.', 'error');
            btn.disabled = false;
            btn.textContent = 'Sign in with Google';
          }
        } catch (err) {
          console.error(err);
          showStatus(err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Sign in with Google';
        }
      };

      // Auto-load if user_code is missing
      if (!userCode) {
        showStatus('No user code provided. Please follow the link from your CLI.', 'error');
        btn.classList.add('hidden');
      }
    </script>
  </body>
</html>`;
}

app.post('/oauth/device/code', async (c) => {
  const parsedResult = deviceCodeRequestSchema.safeParse(await readUrlEncodedBody(c));
  if (!parsedResult.success) {
    return c.json(
      formatValidationErrorResponse('Invalid device code request.', parsedResult.error.issues),
      400,
    );
  }

  const parsed = parsedResult.data;
  const challenge = await issueDeviceCodeChallenge(c.env.DB, {
    clientId: parsed.client_id,
    ...(parsed.scope ? { scope: parsed.scope } : {}),
    ...(parsed.audience ? { audience: parsed.audience } : {}),
    origin: new URL(c.req.url).origin,
  });

  return c.json({
    device_code: challenge.deviceCode,
    user_code: challenge.userCode,
    verification_uri: challenge.verificationUri,
    verification_uri_complete: challenge.verificationUriComplete,
    expires_in: challenge.expiresIn,
    interval: challenge.interval,
  });
});

app.get('/oauth/device/verify', async (c) => {
  const userCode = c.req.query('user_code')?.trim();
  return c.html(renderDeviceVerificationPage(userCode), 200);
});

v1.post('/auth/firebase-approve', async (c) => {
  const body = await c.req.json();
  const parsedResult = firebaseApprovePayloadSchema.safeParse(body);
  if (!parsedResult.success) {
    return c.json(formatValidationErrorResponse('Invalid approval payload.', parsedResult.error.issues), 400);
  }

  try {
    const approval = await approveDeviceCodeWithFirebase(
      c.env.DB,
      parsedResult.data.userCode,
      parsedResult.data.idToken
    );

    if (!approval.ok) {
      const status = approval.reason === 'not_found' ? 404 : 410;
      return c.json({ error: approval.reason, message: `Device code ${approval.reason}.` }, status);
    }

    return c.json({ ok: true, message: 'Device authorized.' });
  } catch (err) {
    console.error('Firebase approval error:', err);
    return c.json({ error: 'auth_error', message: (err as Error).message }, 401);
  }
});

app.post('/oauth/token', async (c) => {
  const parsedResult = deviceTokenRequestSchema.safeParse(await readUrlEncodedBody(c));
  if (!parsedResult.success) {
    return c.json(
      formatValidationErrorResponse('Invalid token request.', parsedResult.error.issues),
      400,
    );
  }

  const parsed = parsedResult.data;
  if (parsed.grant_type !== 'urn:ietf:params:oauth:grant-type:device_code') {
    return c.json({
      error: 'unsupported_grant_type',
      error_description: 'Only OAuth device_code grant_type is supported.',
    });
  }

  const tokenResult = await exchangeDeviceCodeForToken(c.env.DB, {
    clientId: parsed.client_id,
    deviceCode: parsed.device_code,
  });

  if ('error' in tokenResult) {
    return c.json({
      error: tokenResult.error,
      error_description: tokenResult.errorDescription,
    });
  }

  return c.json({
    access_token: tokenResult.accessToken,
    token_type: tokenResult.tokenType,
    ...(tokenResult.scope ? { scope: tokenResult.scope } : {}),
    expires_in: tokenResult.expiresIn,
  });
});

v1.use('*', async (c, next) => {
  const auth = await resolveAuthContextFromBearer(c.env.DB, c.req.header('authorization'));
  if (!auth) {
    return c.json(
      formatErrorResponse('Unauthorized', 'Missing or invalid bearer token.'),
      401,
    );
  }
  c.set('auth', auth);
  await next();
});

v1.get('/projects', async (c) => {
  const auth = c.get('auth');
  const projects = await listProjectsForUser(c.env.DB, auth.userId);
  return c.json({ projects, count: projects.length });
});

v1.post('/projects', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json();
  const parsedResult = createProjectRequestSchema.safeParse(body);
  if (!parsedResult.success) {
    return c.json(
      formatValidationErrorResponse('Invalid project payload.', parsedResult.error.issues),
      400,
    );
  }
  const parsed = parsedResult.data;
  const externalProjectId = (parsed.id ?? createProjectId(parsed.name)).trim();
  const projectId = scopeProjectId(auth.userId, externalProjectId);
  const existing = await getProjectForUser(c.env.DB, auth.userId, projectId);
  if (existing) {
    return c.json(
      formatErrorResponse('Project already exists', 'A project with this id already exists.', {
        id: externalProjectId,
      }),
      409,
    );
  }

  const project = await createProjectForUser(c.env.DB, {
    userId: auth.userId,
    userEmail: auth.email,
    id: projectId,
    name: parsed.name,
    goal: parsed.goal,
    ...(parsed.repoUrl ? { repoUrl: parsed.repoUrl } : {}),
  });
  await appendProjectEvent(c.env.DB, {
    projectId,
    type: 'project_created',
    data: {
      source: 'api',
    },
  });

  return c.json({
    project: {
      ...project,
      id: unscopeProjectId(auth.userId, project.id),
    },
  }, 201);
});

v1.get('/projects/:id', async (c) => {
  const auth = c.get('auth');
  const externalProjectId = c.req.param('id').trim();
  if (!externalProjectId) {
    return c.json(
      formatErrorResponse('Invalid project id', 'Request validation failed.'),
      400,
    );
  }

  const scopedProjectId = scopeProjectId(auth.userId, externalProjectId);
  const project = await getProjectForUser(c.env.DB, auth.userId, scopedProjectId);
  if (!project) {
    return c.json(
      formatErrorResponse('Project not found', 'Requested project does not exist.', { id: externalProjectId }),
      404,
    );
  }

  return c.json({
    project: {
      ...project,
      id: unscopeProjectId(auth.userId, project.id),
    },
  });
});

v1.get('/projects/:id/sync', async (c) => {
  const auth = c.get('auth');
  const externalProjectId = c.req.param('id').trim();
  if (!externalProjectId) {
    return c.json(
      formatErrorResponse('Invalid project id', 'Request validation failed.'),
      400,
    );
  }

  const projectId = scopeProjectId(auth.userId, externalProjectId);
  const latest = await getLatestPlanSyncRevision(c.env.DB, projectId);
  return c.json({
    projectId: externalProjectId,
    latest: latest
      ? {
        version: latest.version,
        planHash: latest.planHash,
        plan: latest.plan,
        syncedAt: latest.syncedAt,
        createdAt: latest.createdAt,
      }
      : null,
  });
});

v1.post('/projects/:id/sync', async (c) => {
  const auth = c.get('auth');
  const externalProjectId = c.req.param('id').trim();
  if (!externalProjectId) {
    return c.json(
      formatErrorResponse('Invalid project id', 'Request validation failed.'),
      400,
    );
  }

  const parsedResult = syncPlanRequestSchema.safeParse(await c.req.json());
  if (!parsedResult.success) {
    return c.json(
      formatValidationErrorResponse('Invalid sync payload.', parsedResult.error.issues),
      400,
    );
  }

  const parsed = parsedResult.data;
  const projectId = scopeProjectId(auth.userId, externalProjectId);
  await ensureProjectRecordForUser(c.env.DB, {
    userId: auth.userId,
    userEmail: auth.email,
    projectId,
    name: externalProjectId,
  });

  const latest = await getLatestPlanSyncRevision(c.env.DB, projectId);
  if (
    parsed.expectedRemoteHash &&
    latest &&
    latest.planHash !== parsed.expectedRemoteHash &&
    latest.planHash !== parsed.planHash
  ) {
    return c.json(
      formatErrorResponse('Sync conflict', 'Remote canonical plan changed since last known hash.', {
        conflict: {
          remotePlanHash: latest.planHash,
          localPlanHash: parsed.planHash,
          expectedRemoteHash: parsed.expectedRemoteHash,
        },
        latest: {
          version: latest.version,
          planHash: latest.planHash,
          plan: latest.plan,
          syncedAt: latest.syncedAt,
          createdAt: latest.createdAt,
        },
      }),
      409,
    );
  }

  if (latest && latest.planHash === parsed.planHash) {
    return c.json({
      status: 'noop',
      projectId: externalProjectId,
      latest: {
        version: latest.version,
        planHash: latest.planHash,
        plan: latest.plan,
        syncedAt: latest.syncedAt,
        createdAt: latest.createdAt,
      },
    });
  }

  const syncedAt = new Date().toISOString();
  const appended = await appendPlanSyncRevision(c.env.DB, {
    projectId,
    planHash: parsed.planHash,
    plan: parsed.plan,
    syncedAt,
  });

  await appendProjectEvent(c.env.DB, {
    projectId,
    type: 'plan_synced',
    data: {
      version: appended.version,
      planHash: appended.planHash,
      syncedAt: appended.syncedAt,
    },
  });

  return c.json({
    status: 'synced',
    projectId: externalProjectId,
    latest: {
      version: appended.version,
      planHash: appended.planHash,
      plan: appended.plan,
      syncedAt: appended.syncedAt,
      createdAt: appended.createdAt,
    },
  });
});

v1.post('/projects/:id/chunks/complete', async (c) => {
  const auth = c.get('auth');
  const externalProjectId = c.req.param('id').trim();
  if (!externalProjectId) {
    return c.json(
      formatErrorResponse('Invalid project id', 'Request validation failed.'),
      400,
    );
  }

  const parsedResult = completeChunkRequestSchema.safeParse(await c.req.json());
  if (!parsedResult.success) {
    return c.json(
      formatValidationErrorResponse('Invalid chunk completion payload.', parsedResult.error.issues),
      400,
    );
  }

  const parsed = parsedResult.data;
  const projectId = scopeProjectId(auth.userId, externalProjectId);
  await ensureProjectRecordForUser(c.env.DB, {
    userId: auth.userId,
    userEmail: auth.email,
    projectId,
    name: externalProjectId,
  });

  const completedAt = parsed.completedAt ?? new Date().toISOString();
  await appendProjectEvent(c.env.DB, {
    projectId,
    type: 'chunk_completed',
    data: {
      chunkId: parsed.chunkId,
      chunkTitle: parsed.chunkTitle,
      verificationStatus: parsed.verificationStatus ?? null,
      forced: parsed.forced ?? false,
      reason: parsed.reason ?? null,
      nextChunkId: parsed.nextChunkId ?? null,
      completedAt,
    },
  });

  return c.json({
    status: 'recorded',
    projectId: externalProjectId,
    chunkId: parsed.chunkId,
    completedAt,
  });
});

v1.get('/projects/:id/events', async (c) => {
  const auth = c.get('auth');
  const externalProjectId = c.req.param('id').trim();
  if (!externalProjectId) {
    return c.json(
      formatErrorResponse('Invalid project id', 'Request validation failed.'),
      400,
    );
  }

  const parsedResult = projectEventsQuerySchema.safeParse({
    type: c.req.query('type'),
    since: c.req.query('since'),
    limit: c.req.query('limit'),
  });
  if (!parsedResult.success) {
    return c.json(
      formatValidationErrorResponse('Invalid project events query.', parsedResult.error.issues),
      400,
    );
  }

  const parsed = parsedResult.data;
  const projectId = scopeProjectId(auth.userId, externalProjectId);
  const events = await listProjectEvents(c.env.DB, {
    projectId,
    ...(parsed.type ? { type: parsed.type } : {}),
    ...(parsed.since ? { since: parsed.since } : {}),
    limit: parsed.limit,
  });

  return c.json({
    projectId: externalProjectId,
    events: events.map((event) => ({
      ...event,
      projectId: externalProjectId,
    })),
    count: events.length,
  });
});

v1.post('/artifacts', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json();
  const parsedResult = createArtifactSchema.safeParse(body);
  if (!parsedResult.success) {
    return c.json(
      formatValidationErrorResponse('Invalid artifact payload.', parsedResult.error.issues),
      400,
    );
  }
  const parsed = parsedResult.data;
  const scopedProjectId = scopeProjectId(auth.userId, parsed.projectId);
  const stored = await storeJsonArtifact(c.env.ARTIFACTS, {
    projectId: scopedProjectId,
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
  const auth = c.get('auth');
  const key = c.req.query('key');
  const projectId = c.req.query('projectId');
  if (!key) {
    return c.json(
      formatErrorResponse('Missing query parameter: key', 'Request validation failed.'),
      400,
    );
  }
  if (!projectId) {
    return c.json(
      formatErrorResponse('Missing query parameter: projectId', 'Request validation failed.'),
      400,
    );
  }

  const scopedProjectId = scopeProjectId(auth.userId, projectId);
  const allowedPrefix = `${slug(scopedProjectId)}/`;
  if (!key.startsWith(allowedPrefix)) {
    return c.json(
      formatErrorResponse('Artifact not found', 'Requested artifact does not exist.', { key }),
      404,
    );
  }

  const artifact = await readArtifact(c.env.ARTIFACTS, key);
  if (!artifact) {
    return c.json(
      formatErrorResponse('Artifact not found', 'Requested artifact does not exist.', { key }),
      404,
    );
  }

  return c.json({ key, artifact });
});

v1.get('/artifacts/list', async (c) => {
  const auth = c.get('auth');
  const parsedResult = artifactListQuerySchema.safeParse({
    projectId: c.req.query('projectId'),
    type: c.req.query('type'),
    limit: c.req.query('limit'),
  });
  if (!parsedResult.success) {
    return c.json(
      formatValidationErrorResponse('Invalid artifacts list query.', parsedResult.error.issues),
      400,
    );
  }
  const parsed = parsedResult.data;

  const scopedProjectId = scopeProjectId(auth.userId, parsed.projectId);
  const prefixParts = [scopedProjectId, parsed.type].filter((value): value is string => Boolean(value));
  const prefix = prefixParts.length > 0 ? `${prefixParts.join('/')}/` : undefined;
  const artifacts = await listArtifacts(c.env.ARTIFACTS, {
    ...(prefix ? { prefix } : {}),
    limit: parsed.limit,
  });

  return c.json({ artifacts, count: artifacts.length });
});

v1.post('/generation/start', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json();
  const parsedResult = startGenerationSchema.safeParse(body);
  if (!parsedResult.success) {
    return c.json(formatValidationErrorResponse('Invalid generation start payload.', parsedResult.error.issues), 400);
  }
  const parsed = parsedResult.data;
  const externalProjectId = parsed.projectId.trim();
  const projectId = scopeProjectId(auth.userId, externalProjectId);
  const runId = crypto.randomUUID();

  const activeRun = await getActiveRunForProject(c.env.DB, projectId);
  if (activeRun) {
    return c.json({
      error: `Cannot start generation while run ${activeRun.runId} is ${activeRun.status}.`,
      activeRun: {
        ...activeRun,
        projectId: externalProjectId,
      },
    }, 409);
  }

  await ensureProjectRecordForUser(c.env.DB, {
    userId: auth.userId,
    userEmail: auth.email,
    projectId,
    name: externalProjectId,
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
      instanceId: externalProjectId,
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
  const auth = c.get('auth');
  const id = c.req.param('id').trim();
  const scopedProjectId = scopeProjectId(auth.userId, id);
  const run = await getLatestRunForProject(c.env.DB, { projectId: scopedProjectId, type: 'initial' });
  if (!run) {
    return c.json({ instanceId: id, status: 'idle', message: 'No generation run found.' });
  }
  const diagnostics = await getRunStepDiagnostics(c.env.DB, {
    projectId: scopedProjectId,
    runId: run.runId,
    type: 'generation',
  });
  return c.json({
    instanceId: id,
    ...run,
    projectId: id,
    diagnostics,
  });
});

v1.get('/generation/:id/progress', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id').trim();
  const since = c.req.query('since');
  const scopedProjectId = scopeProjectId(auth.userId, id);
  const progressId = c.env.PROGRESS_HUB.idFromName(scopedProjectId);
  const stub = c.env.PROGRESS_HUB.get(progressId);
  const url = new URL('https://progress-hub.internal/events');
  if (since) {
    url.searchParams.set('since', since);
  }
  return stub.fetch(url.toString());
});

v1.get('/generation/:id/stream', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id').trim();
  const since = c.req.query('since');
  const scopedProjectId = scopeProjectId(auth.userId, id);
  const progressId = c.env.PROGRESS_HUB.idFromName(scopedProjectId);
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
  const auth = c.get('auth');
  const body = await c.req.json();
  const parsedResult = startReplanSchema.safeParse(body);
  if (!parsedResult.success) {
    return c.json(formatValidationErrorResponse('Invalid replan start payload.', parsedResult.error.issues), 400);
  }
  const parsed = parsedResult.data;
  const externalProjectId = parsed.projectId.trim();
  const projectId = scopeProjectId(auth.userId, externalProjectId);
  const runId = crypto.randomUUID();

  const activeRun = await getActiveRunForProject(c.env.DB, projectId);
  if (activeRun) {
    return c.json({
      error: `Cannot start replan while run ${activeRun.runId} is ${activeRun.status}.`,
      activeRun: {
        ...activeRun,
        projectId: externalProjectId,
      },
    }, 409);
  }

  await ensureProjectRecordForUser(c.env.DB, {
    userId: auth.userId,
    userEmail: auth.email,
    projectId,
    name: externalProjectId,
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
      instanceId: externalProjectId,
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
  const auth = c.get('auth');
  const id = c.req.param('id').trim();
  const scopedProjectId = scopeProjectId(auth.userId, id);
  const run = await getLatestRunForProject(c.env.DB, { projectId: scopedProjectId, type: 'replan' });
  if (!run) {
    return c.json({ instanceId: id, status: 'idle', message: 'No replan run found.' });
  }
  const diagnostics = await getRunStepDiagnostics(c.env.DB, {
    projectId: scopedProjectId,
    runId: run.runId,
    type: 'replan',
  });
  return c.json({
    instanceId: id,
    ...run,
    projectId: id,
    diagnostics,
  });
});

app.route('/v1', v1);

// 404 handler
app.notFound((c) => {
  return c.json(formatErrorResponse('Not Found', 'Route does not exist.', { path: c.req.path }), 404);
});

// Error handler
app.onError((err, c) => {
  console.error('API Error:', err);
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

export default app;
