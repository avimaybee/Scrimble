import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import JSZip from 'jszip';
import { z } from 'zod';
import { verifyFirebaseToken } from '../middleware/auth';
import { decrypt, encrypt } from '../utils/crypto';
import { diffSchema } from '../types/diff';
import {
  Batch2FetchAndReadSchema,
  Batch3ArchitectSchema,
  Batch6GenerateFilesSchema,
  SKILL_FILE_NAMES,
} from './generation-schemas';
import { listUserMCPServers, mcpServerPayloadSchema, upsertUserMCPServer } from './mcp-servers';
import { createGenerationSseStream, persistGenerationStreamEvent } from './generation-events';
import {
  callAIWithRetry,
  defaultModelForProvider,
  extractJSON,
  streamProviderText,
} from './ai';
import {
  BUILDER_PROFILE_CATEGORY_KEYS,
  TOOL_PROFICIENCIES,
} from '../../src/lib/builder-profile';
import {
  appendProjectBriefSystemPrompt,
  appendProjectIntakeMessage,
  createFallbackStructuredBrief,
  getProjectBrief,
  listProjectIntakeMessages,
  loadProjectBriefContext,
  upsertProjectBrief,
} from './project-briefs';
import {
  getArchitectureReviewPayload,
  getBatchCompletionMessage,
  loadBatchOutput,
  processProjectGeneration,
  saveArchitectureReviewApproval,
} from './generation-pipeline';
import { runProjectIntakeTurn } from './project-intake';
import { applyPlanDiffToProject } from './plan-diff';
import { appendResearchFooter, collectStepResearchContext, formatStepResearchPrompt } from './step-research';
import { buildToolsContext, deleteUserTool, listUserTools, updateUserTool, upsertUserTool } from './user-tools';
import { WorkflowBriefDriftError, processWorkflowUpdate, workflowUpdateRequestSchema } from './workflow-update';
import {
  GENERATION_BATCHES,
  PREFERRED_IDES,
  type AppContext,
  type AppEnv,
  type Bindings,
  type GenerationBatchName,
  type PreferredIde,
  type ProviderType,
} from './types';

export const app = new Hono<AppEnv>().basePath('/api');

app.onError((error, c) => {
  console.error('[Hono Error]', error);
  const status = error instanceof z.ZodError ? 400 : 500;
  const message = error instanceof Error ? error.message : 'Internal Server Error';
  
  return c.json({ 
    error: message,
    details: error instanceof z.ZodError ? error.format() : undefined
  }, status as any);
});

app.use('*', async (c, next) => {
  await next();
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self' https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com https://identitytoolkit.googleapis.com https://firebaseinstallations.googleapis.com https://securetoken.googleapis.com; img-src 'self' data: https://lh3.googleusercontent.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com;");
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
});

const providerSchema = z.object({
  name: z.string().trim().min(1),
  provider: z.enum(['anthropic', 'gemini', 'openai', 'custom']),
  apiKey: z.string().trim().min(1),
  baseUrl: z.string().trim().optional(),
  model: z.string().trim().optional(),
  isDefault: z.boolean().optional(),
});

const enrichSchema = z.object({
  projectId: z.string().trim().min(1),
  providerId: z.string().trim().optional(),
  feedback: z.string().trim().optional(),
  editedOutput: z.string().trim().optional(),
});

const proxySchema = z.object({
  providerId: z.string().trim().optional(),
  system: z.string().optional(),
  prompt: z.string().trim().min(1),
  projectId: z.string().trim().optional(),
  stepId: z.string().trim().optional(),
});

const createProjectSchema = z.object({
  description: z.string().trim().min(1),
  providerId: z.string().trim().optional(),
});

const intakeStartSchema = createProjectSchema;

const intakeRespondSchema = z.object({
  message: z.string().trim().min(1),
  providerId: z.string().trim().optional(),
});

const intakeConfirmSchema = z.object({
  providerId: z.string().trim().optional(),
});

const architectureReviewApprovalSchema = z.object({
  feedback: z.string().optional().default(''),
  preferredIde: z.enum(PREFERRED_IDES).optional().default('cursor'),
});

const userToolSchema = z.object({
  category: z.enum(BUILDER_PROFILE_CATEGORY_KEYS),
  name: z.string().trim().min(1).max(80),
  proficiency: z.enum(TOOL_PROFICIENCIES).default('comfortable'),
  notes: z.string().trim().max(200).optional(),
});

const userToolUpdateSchema = z
  .object({
    proficiency: z.enum(TOOL_PROFICIENCIES).optional(),
    notes: z.string().trim().max(200).nullable().optional(),
  })
  .refine((value) => value.proficiency !== undefined || value.notes !== undefined, {
    message: 'Add something to update.',
  });
 
const StepDetailSchema = z.object({
  ai_output: z.string(),
  prompts: z.array(z.object({
    label: z.string(),
    content: z.string()
  }))
});

const reviewSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    feedback: z.string().trim().optional(),
    edited_output: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'reject' && !value.feedback) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['feedback'],
        message: 'Feedback is required when rejecting a step.',
      });
    }
  });

function jsonError(message: string, status: number, details?: unknown) {
  return Response.json(details ? { error: message, details } : { error: message }, { status });
}

function getAIErrorMessage(status: number, fallback: string) {
  switch (status) {
    case 401:
      return 'Your AI key was rejected. Check it in Settings.';
    case 429:
      return 'Your AI provider is rate limited. Wait a moment and try again.';
    case 503:
      return "Your AI provider isn't responding. Try again shortly.";
    default:
      return fallback;
  }
}

const updateStreamEncoder = new TextEncoder();

async function writeUpdateStreamEvent(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  event: 'activity' | 'thinking' | 'complete' | 'error',
  payload: Record<string, unknown>,
) {
  await writer.write(updateStreamEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function serializeJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return typeof value === 'string' ? value : JSON.stringify(value);
}

function slugifyProjectName(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'project';
}

function toUint8ArrayStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function inferGateFlag(source: {
  title?: string | null;
  objective?: string | null;
  why_it_matters?: string | null;
  category?: string | null;
  done_when?: string | null;
}): boolean {
  const haystack = [source.title, source.objective, source.why_it_matters, source.category, source.done_when]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return [
    'security',
    'auth',
    'authentication',
    'deploy',
    'deployment',
    'production',
    'billing',
    'payment',
    'secret',
    'permission',
    'database change',
    'database migration',
    'environment variable',
  ].some((keyword) => haystack.includes(keyword));
}

function mapProviderRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    base_url: row.base_url || undefined,
    model: row.model || undefined,
    is_default: toBoolean(row.is_default),
  };
}

function mapProjectRow(row: any) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description || '',
    project_type: row.project_type || 'other',
    stack: row.stack || '{}',
    status: row.status || 'active',
    generation_status: row.generation_status || 'complete',
    generation_error: row.generation_error || undefined,
    generation_started_at: row.generation_started_at || undefined,
    generation_completed_at: row.generation_completed_at || undefined,
    progress: asNumber(row.progress, 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapPlanRow(row: any) {
  return {
    id: row.id,
    project_id: row.project_id,
    version: asNumber(row.version, 1),
    canvas_state: row.canvas_state || '{}',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapStageRow(row: any) {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    type: row.type,
    order_index: asNumber(row.order_index, 0),
    status: row.status || 'locked',
    created_at: row.created_at,
  };
}

function mapStepRow(row: any) {
  return {
    id: row.id,
    stage_id: row.stage_id,
    project_id: row.project_id,
    title: row.title,
    type: row.type,
    category: row.category || '',
    position_x: asNumber(row.position_x, 0),
    position_y: asNumber(row.position_y, 0),
    status: row.status || 'locked',
    is_gate: toBoolean(row.is_gate),
    risk_level: row.risk_level || 'low',
    objective: row.objective || '',
    why_it_matters: row.why_it_matters || '',
    suggested_tools: row.suggested_tools || undefined,
    prompts: row.prompts || undefined,
    done_when: row.done_when || '',
    ai_output: row.ai_output || undefined,
    is_ai_enriched: toBoolean(row.is_ai_enriched),
    order_index: asNumber(row.order_index, 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapEdgeRow(row: any) {
  return {
    id: row.id,
    project_id: row.project_id,
    source_step_id: row.source_step_id,
    target_step_id: row.target_step_id,
    edge_type: row.edge_type || 'default',
    condition: row.condition || undefined,
  };
}

function mapChecklistItemRow(row: any) {
  return {
    id: row.id,
    step_id: row.step_id,
    label: row.label,
    is_required: toBoolean(row.is_required),
    is_completed: toBoolean(row.is_completed),
    completed_at: row.completed_at || undefined,
    order_index: asNumber(row.order_index, 0),
  };
}

async function ensureProfile(c: AppContext, uid: string) {
  await c.env.DB.prepare('INSERT OR IGNORE INTO profiles (id) VALUES (?)').bind(uid).run();
}

async function touchProject(c: AppContext, projectId: string) {
  await c.env.DB.prepare('UPDATE projects SET updated_at = datetime("now") WHERE id = ?').bind(projectId).run();
}

async function getOwnedProject(c: AppContext, projectId: string) {
  return c.env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').bind(projectId, c.get('uid')).first();
}

async function buildIntakeResponse(c: AppContext, projectId: string) {
  const [project, brief, messages] = await Promise.all([
    getOwnedProject(c, projectId),
    getProjectBrief(c.env, projectId),
    listProjectIntakeMessages(c.env, projectId),
  ]);

  if (!project || !brief) {
    throw new Error('Project intake state is unavailable.');
  }

  const latestAgentMessage = [...messages].reverse().find((message) => message.role === 'agent') || null;
  const ready = latestAgentMessage?.content.startsWith('READY:') || false;

  return {
    project_id: projectId,
    generation_status: (project.generation_status as string | null) || 'intake',
    ready,
    agent_message: latestAgentMessage?.content || '',
    messages,
    brief: {
      ...brief,
      summary: latestAgentMessage?.content.startsWith('READY:')
        ? latestAgentMessage.content.replace(/^READY:\s*/, '').trim()
        : brief.what_it_is || brief.raw_description,
    },
  };
}

async function loadStoredSkillFiles(c: AppContext, projectId: string) {
  const projectFiles = await c.env.DB.prepare(`
    SELECT id, filename, content, created_at, updated_at
    FROM project_files
    WHERE project_id = ?
    ORDER BY filename ASC
  `)
    .bind(projectId)
    .all();

  if (projectFiles.results.length > 0) {
    return projectFiles.results
      .map((row: any) => ({
        id: row.id,
        filename: row.filename,
        content: row.content,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))
      .sort(
        (left, right) => SKILL_FILE_NAMES.indexOf(left.filename) - SKILL_FILE_NAMES.indexOf(right.filename),
      );
  }

  const latestRun = await c.env.DB.prepare(`
    SELECT output
    FROM agent_runs
    WHERE project_id = ? AND run_type = 'batch_6_generate_files' AND status = 'complete'
    ORDER BY completed_at DESC
    LIMIT 1
  `)
    .bind(projectId)
    .first();

  if (!latestRun?.output || typeof latestRun.output !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(latestRun.output) as unknown;
    const normalized = Array.isArray(parsed) ? { files: parsed } : parsed;
    const validated = Batch6GenerateFilesSchema.safeParse(normalized);

    if (!validated.success) {
      return [];
    }

    return validated.data.files
      .map((file) => ({
        id: `${projectId}:${file.filename}`,
        filename: file.filename,
        content: file.content,
        created_at: '',
        updated_at: '',
      }))
      .sort(
        (left, right) => SKILL_FILE_NAMES.indexOf(left.filename) - SKILL_FILE_NAMES.indexOf(right.filename),
      );
  } catch {
    return [];
  }
}

async function getOwnedProjectWithProgress(c: AppContext, projectId: string) {
  return c.env.DB.prepare(`
    SELECT
      p.*,
      CASE
        WHEN COUNT(s.id) = 0 THEN 0
        ELSE CAST(ROUND(100.0 * SUM(CASE WHEN s.status = 'complete' THEN 1 ELSE 0 END) / COUNT(s.id)) AS INTEGER)
      END AS progress
    FROM projects p
    LEFT JOIN workflows w ON w.project_id = p.id
    LEFT JOIN steps s ON s.workflow_id = w.id
    WHERE p.id = ? AND p.user_id = ?
    GROUP BY p.id
  `)
    .bind(projectId, c.get('uid'))
    .first();
}

async function getOwnedStep(c: AppContext, stepId: string) {
  return c.env.DB.prepare(`
    SELECT s.*
    FROM steps s
    INNER JOIN workflows w ON w.id = s.workflow_id
    INNER JOIN projects p ON p.id = w.project_id
    WHERE s.id = ? AND p.user_id = ?
  `)
    .bind(stepId, c.get('uid'))
    .first();
}

async function getOwnedChecklistItem(c: AppContext, checklistItemId: string) {
  return c.env.DB.prepare(`
    SELECT ci.*, w.project_id
    FROM checklist_items ci
    INNER JOIN steps s ON s.id = ci.step_id
    INNER JOIN workflows w ON w.id = s.workflow_id
    INNER JOIN projects p ON p.id = w.project_id
    WHERE ci.id = ? AND p.user_id = ?
  `)
    .bind(checklistItemId, c.get('uid'))
    .first();
}

async function resolveProvider(c: AppContext, providerId?: string) {
  const uid = c.get('uid');

  if (providerId) {
    return c.env.DB.prepare('SELECT * FROM ai_providers WHERE id = ? AND user_id = ?').bind(providerId, uid).first();
  }

  return c.env.DB.prepare(
    'SELECT * FROM ai_providers WHERE user_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1'
  )
    .bind(uid)
    .first();
}

async function resolveProviderContext(c: AppContext, providerId?: string) {
  const providerRecord = await resolveProvider(c, providerId);
  if (!providerRecord) {
    return null;
  }

  let apiKey: string;
  try {
    apiKey = await decrypt(providerRecord.api_key_enc as string, c.env.ENCRYPTION_KEY);
  } catch {
    throw new Error('Failed to decrypt API key');
  }

  const providerType = providerRecord.provider as ProviderType;
  const model = (providerRecord.model as string | null) || defaultModelForProvider(providerType);
  const baseUrl = providerRecord.base_url as string | null;

  return {
    providerId: providerRecord.id as string,
    providerType,
    apiKey,
    model,
    baseUrl,
  };
}

async function insertAgentRun(
  c: AppContext,
  payload: {
    projectId: string;
    stepId?: string | null;
    runType: string;
    status: string;
    provider?: string | null;
    model?: string | null;
    input?: string | null;
    output?: string | null;
  },
) {
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO agent_runs (id, project_id, step_id, run_type, status, provider, model, input, output)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      id,
      payload.projectId,
      payload.stepId || null,
      payload.runType,
      payload.status,
      payload.provider || null,
      payload.model || null,
      payload.input || null,
      payload.output || null,
    )
    .run();

  return id;
}

app.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonError('Missing or invalid Authorization header', 401);
  }

  try {
    const uid = await verifyFirebaseToken(authHeader.slice(7), c.env.FIREBASE_PROJECT_ID);
    c.set('uid', uid);
    await ensureProfile(c, uid);
    await next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    return jsonError(`Auth failed: ${message}`, 401);
  }
});

app.get('/ai/providers', async (c) => {
  const providers = await c.env.DB.prepare(
    'SELECT id, name, provider, base_url, model, is_default FROM ai_providers WHERE user_id = ? ORDER BY is_default DESC, created_at ASC'
  )
    .bind(c.get('uid'))
    .all();

  return c.json(providers.results.map(mapProviderRow));
});

app.post('/ai/providers', async (c) => {
  const parsed = providerSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Invalid provider payload', details: parsed.error.format() }, 400);
  }

  const { name, provider, apiKey } = parsed.data;
  const baseUrl = parsed.data.baseUrl?.trim() || null;
  const model = parsed.data.model?.trim() || defaultModelForProvider(provider);
  const isDefault = parsed.data.isDefault ?? false;

  if (provider === 'custom' && !baseUrl) {
    return c.json({ error: 'A base URL is required for custom providers.' }, 400);
  }

  // SECURITY: key material never logged
  const encryptedKey = await encrypt(apiKey, c.env.ENCRYPTION_KEY);
  const id = crypto.randomUUID();

  if (isDefault) {
    await c.env.DB.prepare('UPDATE ai_providers SET is_default = 0 WHERE user_id = ?').bind(c.get('uid')).run();
  }

  await c.env.DB.prepare(`
    INSERT INTO ai_providers (id, user_id, name, provider, api_key_enc, base_url, model, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(id, c.get('uid'), name.trim(), provider, encryptedKey, baseUrl, model, isDefault ? 1 : 0)
    .run();

  return c.json({ success: true, id });
});

app.delete('/ai/providers/:id', async (c) => {
  const providerId = c.req.param('id');
  const existingProvider = await c.env.DB.prepare('SELECT id FROM ai_providers WHERE id = ? AND user_id = ?')
    .bind(providerId, c.get('uid'))
    .first();

  if (!existingProvider) {
    return c.json({ error: 'Provider not found' }, 404);
  }

  await c.env.DB.prepare('DELETE FROM ai_providers WHERE id = ? AND user_id = ?').bind(providerId, c.get('uid')).run();
  return c.json({ success: true });
});

app.get('/settings/mcp-servers', async (c) => {
  const servers = await listUserMCPServers(c.env, c.get('uid'));
  return c.json(servers);
});

app.post('/settings/mcp-servers', async (c) => {
  const rawBody = await c.req.json().catch(() => null);
  const parsed = mcpServerPayloadSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: 'Invalid research tool payload', details: parsed.error.format() }, 400);
  }

  const result = await upsertUserMCPServer(c.env, c.get('uid'), parsed.data);
  return c.json({ success: true, id: result.id });
});

app.patch('/settings/mcp-servers/:id', async (c) => {
  const serverId = c.req.param('id');
  const existingServer = await c.env.DB.prepare(`
    SELECT id, is_active
    FROM mcp_servers
    WHERE id = ? AND user_id = ?
  `)
    .bind(serverId, c.get('uid'))
    .first();

  if (!existingServer) {
    return c.json({ error: 'Research tool not found' }, 404);
  }

  const nextIsActive = toBoolean(existingServer.is_active) ? 0 : 1;

  await c.env.DB.prepare(`
    UPDATE mcp_servers
    SET is_active = ?
    WHERE id = ? AND user_id = ?
  `)
    .bind(nextIsActive, serverId, c.get('uid'))
    .run();

  return c.json({ success: true, is_active: nextIsActive === 1 });
});

app.delete('/settings/mcp-servers/:id', async (c) => {
  const serverId = c.req.param('id');
  const existingServer = await c.env.DB.prepare('SELECT id FROM mcp_servers WHERE id = ? AND user_id = ?')
    .bind(serverId, c.get('uid'))
    .first();

  if (!existingServer) {
    return c.json({ error: 'Research tool not found' }, 404);
  }

  await c.env.DB.prepare('DELETE FROM mcp_servers WHERE id = ? AND user_id = ?')
    .bind(serverId, c.get('uid'))
    .run();

  return c.json({ success: true });
});

app.get('/settings/user-tools', async (c) => {
  const tools = await listUserTools(c.env, c.get('uid'));
  return c.json(tools);
});

app.put('/settings/user-tools', async (c) => {
  const parsed = userToolSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid builder profile tool payload', details: parsed.error.format() }, 400);
  }

  const tool = await upsertUserTool(c.env, c.get('uid'), parsed.data);
  if (!tool) {
    return c.json({ error: 'Could not save that tool right now.' }, 500);
  }

  return c.json(tool);
});

app.patch('/settings/user-tools/:id', async (c) => {
  const parsed = userToolUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid builder profile update payload', details: parsed.error.format() }, 400);
  }

  const tool = await updateUserTool(c.env, c.get('uid'), c.req.param('id'), parsed.data);
  if (!tool) {
    return c.json({ error: 'Builder profile tool not found' }, 404);
  }

  return c.json(tool);
});

app.delete('/settings/user-tools/:id', async (c) => {
  const deleted = await deleteUserTool(c.env, c.get('uid'), c.req.param('id'));
  if (!deleted) {
    return c.json({ error: 'Builder profile tool not found' }, 404);
  }

  return c.json({ success: true });
});

app.get('/projects', async (c) => {
  const projects = await c.env.DB.prepare(`
    SELECT
      p.*,
      CASE
        WHEN COUNT(s.id) = 0 THEN 0
        ELSE CAST(ROUND(100.0 * SUM(CASE WHEN s.status = 'complete' THEN 1 ELSE 0 END) / COUNT(s.id)) AS INTEGER)
      END AS progress
    FROM projects p
    LEFT JOIN workflows w ON w.project_id = p.id
    LEFT JOIN steps s ON s.workflow_id = w.id
    WHERE p.user_id = ?
    GROUP BY p.id
    ORDER BY p.updated_at DESC
  `)
    .bind(c.get('uid'))
    .all();

  return c.json(projects.results.map(mapProjectRow));
});

app.post('/intake/start', async (c) => {
  const parsed = intakeStartSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'A project description is required.', details: parsed.error.format() }, 400);
  }

  if (!c.env.AGENT_QUEUE) {
    return c.json({ error: 'Project generation queue is not configured.' }, 500);
  }

  let providerContext;
  try {
    providerContext = await resolveProviderContext(c, parsed.data.providerId);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load AI provider.' }, 500);
  }

  if (!providerContext) {
    return c.json({ error: 'You need to add an AI key first.' }, 400);
  }

  const id = crypto.randomUUID();
  const description = parsed.data.description.trim();
  const provisionalNameBase = description.split(/\s+/).slice(0, 8).join(' ');
  const provisionalName =
    provisionalNameBase.length < description.length ? `${provisionalNameBase}...` : provisionalNameBase;
  const toolsContext = await buildToolsContext(c.get('uid'), c.env);

  await c.env.DB.prepare(`
    INSERT INTO projects (
      id, user_id, name, description, project_type, stack, status, risk_score, generation_status, generation_error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      id,
      c.get('uid'),
      provisionalName || 'Untitled project',
      description,
      null,
      '{}',
      'active',
      0,
      'intake',
      null,
    )
    .run();

  await appendProjectIntakeMessage(c.env, id, 'user', description);
  await upsertProjectBrief(c.env, {
    projectId: id,
    rawDescription: description,
    structuredBrief: createFallbackStructuredBrief(description),
    toolsContext,
    conversationTurns: 0,
  });

  const intakeTurn = await runProjectIntakeTurn({
    env: c.env,
    userId: c.get('uid'),
    rawDescription: description,
    messages: await listProjectIntakeMessages(c.env, id),
    provider: providerContext,
    conversationTurns: 1,
  });

  await appendProjectIntakeMessage(c.env, id, 'agent', intakeTurn.agentReply);
  await upsertProjectBrief(c.env, {
    projectId: id,
    rawDescription: description,
    structuredBrief: intakeTurn.structuredBrief,
    toolsContext: intakeTurn.toolsContext,
    conversationTurns: 1,
  });

  return c.json(await buildIntakeResponse(c, id), 202);
});

app.post('/intake/:id/respond', async (c) => {
  const projectId = c.req.param('id');
  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  if ((project.generation_status || 'intake') !== 'intake') {
    return c.json({ error: 'This intake conversation is no longer active.' }, 409);
  }

  const parsed = intakeRespondSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Add a reply before sending.', details: parsed.error.format() }, 400);
  }

  let providerContext;
  try {
    providerContext = await resolveProviderContext(c, parsed.data.providerId);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load AI provider.' }, 500);
  }

  if (!providerContext) {
    return c.json({ error: 'You need to add an AI key first.' }, 400);
  }

  await appendProjectIntakeMessage(c.env, projectId, 'user', parsed.data.message);
  const messages = await listProjectIntakeMessages(c.env, projectId);
  const brief = await getProjectBrief(c.env, projectId);
  const conversationTurns = (brief?.conversation_turns || 0) + 1;

  const intakeTurn = await runProjectIntakeTurn({
    env: c.env,
    userId: c.get('uid'),
    rawDescription: asText(project.description, ''),
    messages,
    provider: providerContext,
    conversationTurns,
  });

  await appendProjectIntakeMessage(c.env, projectId, 'agent', intakeTurn.agentReply);
  await upsertProjectBrief(c.env, {
    projectId,
    rawDescription: asText(project.description, ''),
    structuredBrief: intakeTurn.structuredBrief,
    toolsContext: intakeTurn.toolsContext,
    conversationTurns,
  });

  return c.json(await buildIntakeResponse(c, projectId));
});

app.post('/intake/:id/confirm', async (c) => {
  const projectId = c.req.param('id');
  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  if ((project.generation_status || 'intake') !== 'intake') {
    return c.json({ error: 'This project has already moved past intake.' }, 409);
  }

  if (!c.env.AGENT_QUEUE) {
    return c.json({ error: 'Project generation queue is not configured.' }, 500);
  }

  const parsed = intakeConfirmSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Invalid intake confirmation payload', details: parsed.error.format() }, 400);
  }

  let providerContext;
  try {
    providerContext = await resolveProviderContext(c, parsed.data.providerId);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to load AI provider.' }, 500);
  }

  if (!providerContext) {
    return c.json({ error: 'You need to add an AI key first.' }, 400);
  }

  const briefContext = await loadProjectBriefContext(c.env, projectId, c.get('uid'), {
    rawDescription: asText(project.description, ''),
    projectStack: asText(project.stack, '{}'),
  });
  const nextNameBase = (briefContext.effectiveBrief.what_it_is || asText(project.name, 'Untitled project'))
    .split(/\s+/)
    .slice(0, 8)
    .join(' ');
  const nextName =
    nextNameBase.length < (briefContext.effectiveBrief.what_it_is || '').length
      ? `${nextNameBase}...`
      : nextNameBase || asText(project.name, 'Untitled project');

  await c.env.DB.prepare(`
    UPDATE projects
    SET name = ?, generation_status = 'queued', generation_error = NULL, updated_at = datetime("now")
    WHERE id = ? AND user_id = ?
  `)
    .bind(nextName, projectId, c.get('uid'))
    .run();

  await c.env.AGENT_QUEUE.send({
    type: 'generate_project',
    projectId,
    userId: c.get('uid'),
    providerId: providerContext.providerId,
  });

  return c.json({
    success: true,
    project_id: projectId,
    generation_status: 'queued',
  });
});

app.get('/intake/:id/brief', async (c) => {
  const project = await getOwnedProject(c, c.req.param('id'));
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  return c.json(await buildIntakeResponse(c, c.req.param('id')));
});

app.post('/projects', async (c) => {
  const parsed = createProjectSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'A project description is required.', details: parsed.error.format() }, 400);
  }

  if (!c.env.AGENT_QUEUE) {
    return c.json({ error: 'Project generation queue is not configured.' }, 500);
  }

  const providerRecord = await resolveProvider(c, parsed.data.providerId);
  if (!providerRecord) {
    return c.json({ error: 'You need to add an AI key first.' }, 400);
  }

  const id = crypto.randomUUID();
  const description = parsed.data.description.trim();
  const provisionalNameBase = description.split(/\s+/).slice(0, 8).join(' ');
  const provisionalName =
    provisionalNameBase.length < description.length ? `${provisionalNameBase}...` : provisionalNameBase;

  await c.env.DB.prepare(`
    INSERT INTO projects (
      id, user_id, name, description, project_type, stack, status, risk_score, generation_status, generation_error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      id,
      c.get('uid'),
      provisionalName || 'Untitled project',
      description,
      null,
      '{}',
      'active',
      0,
      'queued',
      null,
    )
    .run();

  await c.env.AGENT_QUEUE.send({
    type: 'generate_project',
    projectId: id,
    userId: c.get('uid'),
    providerId: parsed.data.providerId,
  });

  return c.json({ success: true, id, generation_status: 'queued' }, 202);
});

app.get('/projects/:id', async (c) => {
  const project = await getOwnedProjectWithProgress(c, c.req.param('id'));
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  return c.json(mapProjectRow(project));
});

app.get('/projects/:id/status', async (c) => {
  const projectId = c.req.param('id');
  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const completedBatchRows = await c.env.DB.prepare(`
    SELECT run_type, completed_at
    FROM agent_runs
    WHERE project_id = ? AND status = 'complete' AND run_type IN (${GENERATION_BATCHES.map(() => '?').join(', ')})
    ORDER BY sequence_index ASC, completed_at ASC
  `)
    .bind(projectId, ...GENERATION_BATCHES)
    .all();

  const completedBatches = completedBatchRows.results.map((row: any) => ({
    batch: row.run_type,
    completed_at: row.completed_at,
    message: getBatchCompletionMessage(row.run_type as GenerationBatchName),
  }));

  return c.json({
    project_id: projectId,
    generation_status: project.generation_status || 'complete',
    generation_error: project.generation_error || null,
    completed_batches: completedBatches,
    completed_batch_count: completedBatches.length,
    total_batches: GENERATION_BATCHES.length,
    progress_percent: Math.round((completedBatches.length / GENERATION_BATCHES.length) * 100),
    is_intake: (project.generation_status || 'complete') === 'intake',
    is_complete: (project.generation_status || 'complete') === 'complete',
    is_failed: (project.generation_status || 'complete') === 'failed',
    is_review_required: (project.generation_status || 'complete') === 'awaiting_review',
    is_approved: (project.generation_status || 'complete') === 'approved',
  });
});

app.get('/projects/:id/architecture-review', async (c) => {
  const projectId = c.req.param('id');
  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  try {
    const review = await getArchitectureReviewPayload(c.env, projectId);
    return c.json(review);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Architecture review is not ready yet.';
    return c.json({ error: message }, 409);
  }
});

app.post('/projects/:id/architecture-review', async (c) => {
  const projectId = c.req.param('id');
  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  if (!c.env.AGENT_QUEUE) {
    return c.json({ error: 'Project generation queue is not configured.' }, 500);
  }

  const parsed = architectureReviewApprovalSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Review feedback payload is invalid.', details: parsed.error.format() }, 400);
  }

  if ((project.generation_status || 'complete') !== 'awaiting_review') {
    return c.json({ error: 'Architecture review is not awaiting approval.' }, 409);
  }

  const feedback = parsed.data.feedback?.trim() || '';
  const preferredIde = parsed.data.preferredIde as PreferredIde;
  let providerId: string | undefined;

  try {
    const approval = await saveArchitectureReviewApproval(c.env, projectId, feedback, preferredIde);
    providerId = approval.providerId;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save architecture review approval.';
    return c.json({ error: message }, 409);
  }

  await c.env.AGENT_QUEUE.send({
    type: 'generate_project',
    projectId,
    userId: c.get('uid'),
    providerId,
  });

  await persistGenerationStreamEvent(c.env, {
    projectId,
    batchName: 'batch_4_plan_build',
    event: {
      type: 'activity',
      icon: '✦',
      message:
        feedback.length > 0
          ? 'Architecture approved with your adjustments — reshaping the build plan now.'
          : 'Architecture approved — resuming plan generation.',
      timestamp: new Date().toISOString(),
    },
  });

  return c.json({
    success: true,
    generation_status: 'approved',
    feedback_provided: feedback.length > 0,
    preferred_ide: preferredIde,
  });
});

app.post('/projects/:id/resume', async (c) => {
  const projectId = c.req.param('id');
  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  if (!c.env.AGENT_QUEUE) {
    return c.json({ error: 'Project generation queue is not configured.' }, 500);
  }

  const status = project.generation_status || 'queued';
  if (status === 'complete') {
    return c.json({ error: 'Cannot resume a project that is already complete.' }, 409);
  }


  // Find the last provider used for this project to re-enqueue
  const lastRun = await c.env.DB.prepare(
    'SELECT provider FROM agent_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(projectId).first<{ provider: string | null }>();

  // If we found a provider string (e.g. 'anthropic'), we need to find the user's provider record for it
  let providerId: string | undefined;
  if (lastRun?.provider) {
    const providerRecord = await c.env.DB.prepare(
      'SELECT id FROM ai_providers WHERE user_id = ? AND provider = ? ORDER BY is_default DESC LIMIT 1'
    ).bind(c.get('uid'), lastRun.provider).first<{ id: string }>();
    providerId = providerRecord?.id;
  }

  await c.env.DB.prepare(`
    UPDATE projects 
    SET generation_status = 'queued', generation_error = NULL, updated_at = datetime("now")
    WHERE id = ? AND user_id = ?
  `).bind(projectId, c.get('uid')).run();

  await c.env.AGENT_QUEUE.send({
    type: 'generate_project',
    projectId,
    userId: c.get('uid'),
    providerId,
  });

  return c.json({
    success: true,
    generation_status: status,
    resumedAt: new Date().toISOString()
  });
});

app.get('/projects/:id/generation-stream', async (c) => {
  const projectId = c.req.param('id');
  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const lastEventId = asNumber(c.req.header('Last-Event-ID'), 0);
  const stream = createGenerationSseStream(c.env, {
    projectId,
    lastEventId,
    signal: c.req.raw.signal,
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
});

app.get('/projects/:id/generated-files', async (c) => {
  const projectId = c.req.param('id');
  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  return c.json(await loadStoredSkillFiles(c, projectId));
});

app.get('/projects/:id/skill-files', async (c) => {
  const projectId = c.req.param('id');
  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const files = await loadStoredSkillFiles(c, projectId);
  if (files.length === 0) {
    return c.json({ error: 'Files will be ready when your plan is complete.' }, 409);
  }

  const zip = new JSZip();
  files.forEach((file) => {
    zip.file(file.filename, file.content);
  });

  const zipBytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const filename = `scrimble-${slugifyProjectName(asText(project.name, 'project'))}-ai-files.zip`;

  return new Response(toUint8ArrayStream(zipBytes), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'Content-Length': `${zipBytes.byteLength}`,
    },
  });
});

app.patch('/projects/:id', async (c) => {
  const projectId = c.req.param('id');
  const existingProject = await getOwnedProject(c, projectId);
  if (!existingProject) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const body = await c.req.json();
  await c.env.DB.prepare(`
    UPDATE projects
    SET name = ?, description = ?, project_type = ?, stack = ?, status = ?, risk_score = ?, updated_at = datetime("now")
    WHERE id = ?
  `)
    .bind(
      optionalText(body.name) || existingProject.name,
      typeof body.description === 'string' ? body.description : existingProject.description,
      typeof body.project_type === 'string' ? body.project_type : existingProject.project_type,
      body.stack !== undefined ? serializeJson(body.stack) || '{}' : existingProject.stack,
      optionalText(body.status) || existingProject.status,
      body.risk_score !== undefined ? asNumber(body.risk_score, 0) : asNumber(existingProject.risk_score, 0),
      projectId,
    )
    .run();

  const updatedProject = await getOwnedProjectWithProgress(c, projectId);
  return c.json(updatedProject ? mapProjectRow(updatedProject) : { success: true });
});

app.delete('/projects/:id', async (c) => {
  const projectId = c.req.param('id');
  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  // Delete everything related to this project.
  // Using CASCADE would be ideal, but we'll do explicit deletes for safety.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM project_generation_events WHERE project_id = ?').bind(projectId),
    c.env.DB.prepare('DELETE FROM project_generation_live_state WHERE project_id = ?').bind(projectId),
    c.env.DB.prepare('DELETE FROM project_intake_messages WHERE project_id = ?').bind(projectId),
    c.env.DB.prepare('DELETE FROM project_briefs WHERE project_id = ?').bind(projectId),
    c.env.DB.prepare('DELETE FROM agent_runs WHERE project_id = ?').bind(projectId),
    c.env.DB.prepare('DELETE FROM edges WHERE project_id = ?').bind(projectId),
    c.env.DB.prepare('DELETE FROM checklist_items WHERE step_id IN (SELECT id FROM steps WHERE workflow_id IN (SELECT id FROM workflows WHERE project_id = ?))').bind(projectId),
    c.env.DB.prepare('DELETE FROM steps WHERE workflow_id IN (SELECT id FROM workflows WHERE project_id = ?1) OR id IN (SELECT id FROM steps WHERE project_id = ?1)').bind(projectId),
    c.env.DB.prepare('DELETE FROM stages WHERE workflow_id IN (SELECT id FROM workflows WHERE project_id = ?)').bind(projectId),
    c.env.DB.prepare('DELETE FROM workflows WHERE project_id = ?').bind(projectId),
    c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(projectId),
  ]);


  return c.body(null, 204);
});

app.get('/api/plans', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) {
    return c.json({ error: 'projectId is required' }, 400);
  }

  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const plans = await c.env.DB.prepare('SELECT * FROM workflows WHERE project_id = ? ORDER BY version DESC, created_at DESC')
    .bind(projectId)
    .all();

  return c.json(plans.results.map(mapPlanRow));
});

app.post('/plans', async (c) => {
  const body = await c.req.json();
  const projectId = asText(body.project_id).trim();
  if (!projectId) {
    return c.json({ error: 'project_id is required' }, 400);
  }

  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO workflows (id, project_id, version, canvas_state) VALUES (?, ?, ?, ?)')
    .bind(id, projectId, asNumber(body.version, 1), serializeJson(body.canvas_state) || '{}')
    .run();

  await touchProject(c, projectId);
  return c.json({ success: true, id });
});

app.get('/api/stages', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) {
    return c.json({ error: 'projectId is required' }, 400);
  }

  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const stages = await c.env.DB.prepare(`
    SELECT st.*, w.project_id
    FROM stages st
    INNER JOIN workflows w ON w.id = st.workflow_id
    WHERE w.project_id = ?
    ORDER BY st.order_index ASC, st.created_at ASC
  `)
    .bind(projectId)
    .all();

  return c.json(stages.results.map(mapStageRow));
});

app.post('/stages', async (c) => {
  const body = await c.req.json();
  const projectId = asText(body.project_id).trim();
  const title = asText(body.title).trim();
  const type = asText(body.type).trim();

  if (!projectId || !title || !type) {
    return c.json({ error: 'project_id, title, and type are required' }, 400);
  }

  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const workflowRecord = await c.env.DB.prepare('SELECT id FROM workflows WHERE project_id = ?').bind(projectId).first();
  if (!workflowRecord) {
    return c.json({ error: 'Workflow not found for this project' }, 404);
  }
  const workflowId = workflowRecord.id;

  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO stages (id, workflow_id, title, type, order_index, status) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, workflowId, title, type, asNumber(body.order_index, 0), optionalText(body.status) || 'locked')
    .run();

  await touchProject(c, projectId);
  return c.json({ success: true, id });
});

app.get('/api/steps', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) {
    return c.json({ error: 'projectId is required' }, 400);
  }

  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const steps = await c.env.DB.prepare(`
    SELECT s.*, w.project_id
    FROM steps s
    INNER JOIN workflows w ON w.id = s.workflow_id
    WHERE w.project_id = ?
    ORDER BY s.order_index ASC, s.created_at ASC
  `)
    .bind(projectId)
    .all();

  return c.json(steps.results.map(mapStepRow));
});

app.get('/steps/:id', async (c) => {
  const step = await getOwnedStep(c, c.req.param('id'));
  if (!step) {
    return c.json({ error: 'Step not found' }, 404);
  }

  return c.json(mapStepRow(step));
});

app.post('/steps', async (c) => {
  const body = await c.req.json();
  const projectId = asText(body.project_id).trim();
  const title = asText(body.title).trim();

  if (!projectId || !title) {
    return c.json({ error: 'project_id and title are required' }, 400);
  }

  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const inferredGate = inferGateFlag({
    title,
    objective: optionalText(body.objective),
    why_it_matters: optionalText(body.why_it_matters),
    category: optionalText(body.category),
    done_when: optionalText(body.done_when),
  });

  const id = crypto.randomUUID();
  const workflowRecord = await c.env.DB.prepare('SELECT id FROM workflows WHERE project_id = ?').bind(projectId).first();
  if (!workflowRecord) {
    return c.json({ error: 'Workflow not found for this project' }, 404);
  }
  const workflowId = workflowRecord.id;

  await c.env.DB.prepare(`
    INSERT INTO steps (
      id, workflow_id, stage_id, title, type, category, position_x, position_y, status,
      is_gate, risk_level, order_index, objective, why_it_matters, suggested_tools,
      done_when, ai_output, prompts, is_ai_enriched
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      id,
      workflowId,
      optionalText(body.stage_id),
      title,
      optionalText(body.type) || 'task',
      asText(body.category),
      asNumber(body.position_x, 0),
      asNumber(body.position_y, 0),
      optionalText(body.status) || 'locked',
      typeof body.is_gate === 'boolean' ? (body.is_gate ? 1 : 0) : inferredGate ? 1 : 0,
      optionalText(body.risk_level) || 'low',
      asNumber(body.order_index, 0),
      asText(body.objective),
      asText(body.why_it_matters),
      serializeJson(body.suggested_tools),
      asText(body.done_when),
      optionalText(body.ai_output),
      serializeJson(body.prompts),
      typeof body.is_ai_enriched === 'boolean' && body.is_ai_enriched ? 1 : 0,
    )
    .run();

  await touchProject(c, projectId);
  return c.json({ success: true, id });
});

app.patch('/steps/:id', async (c) => {
  const stepId = c.req.param('id');
  const existingStep = await getOwnedStep(c, stepId);
  if (!existingStep) {
    return c.json({ error: 'Step not found' }, 404);
  }

  const body = await c.req.json();
  const inferredGate = inferGateFlag({
    title: typeof body.title === 'string' ? body.title : existingStep.title,
    objective: typeof body.objective === 'string' ? body.objective : existingStep.objective,
    why_it_matters: typeof body.why_it_matters === 'string' ? body.why_it_matters : existingStep.why_it_matters,
    category: typeof body.category === 'string' ? body.category : existingStep.category,
    done_when: typeof body.done_when === 'string' ? body.done_when : existingStep.done_when,
  });

  await c.env.DB.prepare(`
    UPDATE steps
    SET stage_id = ?, title = ?, type = ?, category = ?, position_x = ?, position_y = ?, status = ?,
        is_gate = ?, risk_level = ?, order_index = ?, objective = ?, why_it_matters = ?,
        suggested_tools = ?, done_when = ?, ai_output = ?, prompts = ?, is_ai_enriched = ?, updated_at = datetime("now")
    WHERE id = ?
  `)
    .bind(
      body.stage_id !== undefined ? optionalText(body.stage_id) : existingStep.stage_id,
      optionalText(body.title) || existingStep.title,
      optionalText(body.type) || existingStep.type,
      typeof body.category === 'string' ? body.category : existingStep.category,
      body.position_x !== undefined ? asNumber(body.position_x, 0) : asNumber(existingStep.position_x, 0),
      body.position_y !== undefined ? asNumber(body.position_y, 0) : asNumber(existingStep.position_y, 0),
      optionalText(body.status) || existingStep.status,
      typeof body.is_gate === 'boolean' ? (body.is_gate ? 1 : 0) : inferredGate ? 1 : 0,
      optionalText(body.risk_level) || existingStep.risk_level,
      body.order_index !== undefined ? asNumber(body.order_index, 0) : asNumber(existingStep.order_index, 0),
      typeof body.objective === 'string' ? body.objective : existingStep.objective,
      typeof body.why_it_matters === 'string' ? body.why_it_matters : existingStep.why_it_matters,
      body.suggested_tools !== undefined ? serializeJson(body.suggested_tools) : existingStep.suggested_tools,
      typeof body.done_when === 'string' ? body.done_when : existingStep.done_when,
      body.ai_output !== undefined ? optionalText(body.ai_output) : existingStep.ai_output,
      body.prompts !== undefined ? serializeJson(body.prompts) : existingStep.prompts,
      typeof body.is_ai_enriched === 'boolean' ? (body.is_ai_enriched ? 1 : 0) : toBoolean(existingStep.is_ai_enriched) ? 1 : 0,
      stepId,
    )
    .run();

  await touchProject(c, existingStep.project_id as string);
  const updatedStep = await getOwnedStep(c, stepId);
  return c.json(updatedStep ? mapStepRow(updatedStep) : { success: true });
});

app.delete('/steps/:id', async (c) => {
  const stepId = c.req.param('id');
  const existingStep = await getOwnedStep(c, stepId);
  if (!existingStep) {
    return c.json({ error: 'Step not found' }, 404);
  }

  await c.env.DB.prepare('DELETE FROM steps WHERE id = ?').bind(stepId).run();
  await touchProject(c, existingStep.project_id as string);
  return c.body(null, 204);
});

app.post('/steps/:id/review', async (c) => {
  const stepId = c.req.param('id');
  const stepRecord = await getOwnedStep(c, stepId);
  if (!stepRecord) {
    return c.json({ error: 'Step not found' }, 404);
  }

  const parsed = reviewSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Invalid review payload', details: parsed.error.format() }, 400);
  }

  const review = parsed.data;
  const nextOutput = review.edited_output?.trim() || stepRecord.ai_output || null;
  const runId = await insertAgentRun(c, {
    projectId: stepRecord.project_id as string,
    stepId,
    runType: 'review_gate',
    status: 'complete',
    input: JSON.stringify(review),
    output: review.feedback || nextOutput,
  });

  if (review.decision === 'approve') {
    const unlockedStepIds = (
      await c.env.DB.prepare('SELECT target_step_id FROM edges WHERE project_id = ? AND source_step_id = ?')
        .bind(stepRecord.project_id, stepId)
        .all()
    ).results
      .map((row: any) => row.target_step_id as string)
      .filter(Boolean);

    const statements = [
      c.env.DB.prepare(`
        UPDATE steps
        SET ai_output = ?, is_ai_enriched = 1, status = 'complete', updated_at = datetime("now")
        WHERE id = ?
      `).bind(nextOutput, stepId),
      c.env.DB.prepare('UPDATE agent_runs SET completed_at = datetime("now") WHERE id = ?').bind(runId),
    ];

    if (unlockedStepIds.length > 0) {
      const placeholders = unlockedStepIds.map(() => '?').join(', ');
      statements.push(
        c.env.DB.prepare(`
          UPDATE steps
          SET status = 'active', updated_at = datetime("now")
          WHERE project_id = ? AND status = 'locked' AND id IN (${placeholders})
        `).bind(stepRecord.project_id, ...unlockedStepIds),
      );
    }

    await c.env.DB.batch(statements);
    await touchProject(c, stepRecord.project_id as string);
    return c.json({ success: true, decision: 'approve', unlockedStepIds });
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE steps
      SET ai_output = ?, is_ai_enriched = 0, status = 'active', updated_at = datetime("now")
      WHERE id = ?
    `).bind(nextOutput, stepId),
    c.env.DB.prepare('UPDATE agent_runs SET completed_at = datetime("now") WHERE id = ?').bind(runId),
  ]);

  await touchProject(c, stepRecord.project_id as string);
  return c.json({ success: true, decision: 'reject', regenerate: true });
});

app.get('/api/edges', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) {
    return c.json({ error: 'projectId is required' }, 400);
  }

  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const edges = await c.env.DB.prepare(`
    SELECT e.*, w.project_id
    FROM edges e
    INNER JOIN workflows w ON w.id = e.workflow_id
    WHERE w.project_id = ?
  `).bind(projectId).all();
  return c.json(edges.results.map(mapEdgeRow));
});

app.post('/edges', async (c) => {
  const body = await c.req.json();
  const projectId = asText(body.project_id).trim();
  const sourceStepId = asText(body.source_step_id).trim();
  const targetStepId = asText(body.target_step_id).trim();

  if (!projectId || !sourceStepId || !targetStepId) {
    return c.json({ error: 'project_id, source_step_id, and target_step_id are required' }, 400);
  }

  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const stepCount = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM steps WHERE project_id = ? AND id IN (?, ?)')
    .bind(projectId, sourceStepId, targetStepId)
    .first();

  if (asNumber(stepCount?.count, 0) !== 2) {
    return c.json({ error: 'Both steps must belong to the project.' }, 400);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO edges (id, project_id, source_step_id, target_step_id, edge_type, condition)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
    .bind(id, projectId, sourceStepId, targetStepId, optionalText(body.edge_type) || 'default', optionalText(body.condition))
    .run();

  await touchProject(c, projectId);
  return c.json({ success: true, id });
});

app.get('/api/checklist-items', async (c) => {
  const stepId = c.req.query('stepId');
  if (!stepId) {
    return c.json({ error: 'stepId is required' }, 400);
  }

  const step = await getOwnedStep(c, stepId);
  if (!step) {
    return c.json({ error: 'Step not found' }, 404);
  }

  const checklistItems = await c.env.DB.prepare(
    'SELECT * FROM checklist_items WHERE step_id = ? ORDER BY order_index ASC, id ASC'
  )
    .bind(stepId)
    .all();

  return c.json(checklistItems.results.map(mapChecklistItemRow));
});

app.post('/checklist-items', async (c) => {
  const body = await c.req.json();
  const stepId = asText(body.step_id).trim();
  const label = asText(body.label).trim();

  if (!stepId || !label) {
    return c.json({ error: 'step_id and label are required' }, 400);
  }

  const step = await getOwnedStep(c, stepId);
  if (!step) {
    return c.json({ error: 'Step not found' }, 404);
  }

  const id = crypto.randomUUID();
  const isCompleted = typeof body.is_completed === 'boolean' ? body.is_completed : false;

  await c.env.DB.prepare(`
    INSERT INTO checklist_items (id, step_id, label, is_required, is_completed, completed_at, order_index)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      id,
      stepId,
      label,
      typeof body.is_required === 'boolean' && body.is_required ? 1 : 0,
      isCompleted ? 1 : 0,
      isCompleted ? optionalText(body.completed_at) || new Date().toISOString() : null,
      asNumber(body.order_index, 0),
    )
    .run();

  await touchProject(c, step.project_id as string);
  return c.json({ success: true, id });
});

app.patch('/checklist-items/:id', async (c) => {
  const checklistItemId = c.req.param('id');
  const existingItem = await getOwnedChecklistItem(c, checklistItemId);
  if (!existingItem) {
    return c.json({ error: 'Checklist item not found' }, 404);
  }

  const body = await c.req.json();
  const isCompleted = typeof body.is_completed === 'boolean' ? body.is_completed : toBoolean(existingItem.is_completed);

  await c.env.DB.prepare(`
    UPDATE checklist_items
    SET label = ?, is_required = ?, is_completed = ?, completed_at = ?, order_index = ?
    WHERE id = ?
  `)
    .bind(
      optionalText(body.label) || existingItem.label,
      typeof body.is_required === 'boolean' ? (body.is_required ? 1 : 0) : toBoolean(existingItem.is_required) ? 1 : 0,
      isCompleted ? 1 : 0,
      isCompleted ? optionalText(body.completed_at) || new Date().toISOString() : null,
      body.order_index !== undefined ? asNumber(body.order_index, 0) : asNumber(existingItem.order_index, 0),
      checklistItemId,
    )
    .run();

  await touchProject(c, existingItem.project_id as string);
  return c.json({ success: true });
});

app.post('/projects/:id/plan-diff', async (c) => {
  const projectId = c.req.param('id');
  const project = await getOwnedProject(c, projectId);
  if (!project) {
    return c.json({ error: 'Project not found or access denied' }, 403);
  }

  const parsed = diffSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Malformed diff', details: parsed.error.format() }, 400);
  }

  try {
    const applyResult = await applyPlanDiffToProject(c.env, projectId, parsed.data);
    if (applyResult.appliedChangeCount > 0) {
      await touchProject(c, projectId);
    }

    return c.json({ success: true, summary: parsed.data.summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown diff failure';
    return c.json({ error: `Failed to apply diff: ${message}` }, 500);
  }
});

app.post('/workflows/:id/update', async (c) => {
  const workflowId = c.req.param('id');
  const workflowRecord = await c.env.DB.prepare(`
    SELECT
      w.id,
      w.project_id,
      p.user_id,
      p.name,
      p.description,
      p.stack
    FROM workflows w
    INNER JOIN projects p ON p.id = w.project_id
    WHERE w.id = ? AND p.user_id = ?
    ORDER BY w.version DESC
    LIMIT 1
  `)
    .bind(workflowId, c.get('uid'))
    .first();

  if (!workflowRecord) {
    return c.json({ error: 'Workflow not found or access denied' }, 404);
  }

  const parsed = workflowUpdateRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Invalid workflow update payload', details: parsed.error.format() }, 400);
  }

  const providerRecord = await resolveProvider(c, parsed.data.providerId);
  if (!providerRecord) {
    return c.json({ error: 'You need to add an AI key first.' }, 400);
  }

  let apiKey: string;
  try {
    apiKey = await decrypt(providerRecord.api_key_enc as string, c.env.ENCRYPTION_KEY);
  } catch {
    return c.json({ error: 'Failed to decrypt API key' }, 500);
  }

  const providerType = providerRecord.provider as ProviderType;
  const model = (providerRecord.model as string | null) || defaultModelForProvider(providerType);
  const baseUrl = providerRecord.base_url as string | null;
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const result = await processWorkflowUpdate({
          env: c.env,
          workflowId,
          project: {
            id: workflowRecord.project_id,
            user_id: workflowRecord.user_id,
            name: optionalText(workflowRecord.name),
            description: optionalText(workflowRecord.description),
            stack: optionalText(workflowRecord.stack),
          },
          provider: {
            providerType,
            apiKey,
            model,
            baseUrl,
          },
          message: parsed.data.message,
          driftResolution: parsed.data.driftResolution,
          onProgress: async (progress) => {
            await writeUpdateStreamEvent(writer, 'activity', {
              icon: progress.icon,
              message: progress.message,
              timestamp: new Date().toISOString(),
            });
            if (progress.thinking) {
              await writeUpdateStreamEvent(writer, 'thinking', {
                content: progress.thinking,
                timestamp: new Date().toISOString(),
              });
            }
          },
        });

        await writeUpdateStreamEvent(writer, 'complete', {
          ...result,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        if (error instanceof WorkflowBriefDriftError) {
          await writeUpdateStreamEvent(writer, 'error', {
            error: error.message,
            error_code: 'brief_drift',
            drift: error.drift,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        const message = error instanceof Error ? error.message : 'Failed to update the workflow.';
        await writeUpdateStreamEvent(writer, 'error', {
          error: message,
          timestamp: new Date().toISOString(),
        });
      } finally {
        await writer.close();
      }
    })(),
  );

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

app.post('/steps/:id/enrich', async (c) => {
  const stepId = c.req.param('id');
  const parsed = enrichSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Invalid enrichment payload', details: parsed.error.format() }, 400);
  }

  const { providerId, projectId, feedback, editedOutput } = parsed.data;
  const stepRecord = await c.env.DB.prepare('SELECT * FROM steps WHERE id = ? AND project_id = ?')
    .bind(stepId, projectId)
    .first();

  if (!stepRecord) {
    return c.json({ error: 'Step not found' }, 404);
  }

  const projectRecord = await getOwnedProject(c, projectId);
  if (!projectRecord) {
    return c.json({ error: 'Project not found or access denied' }, 403);
  }

  let adrContext;
  let researchContext;
  try {
    [adrContext, researchContext] = await Promise.all([
      loadBatchOutput(c.env, projectId, 'batch_3_architect', Batch3ArchitectSchema),
      loadBatchOutput(c.env, projectId, 'batch_2_fetch_and_read', Batch2FetchAndReadSchema),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Project research context is unavailable.';
    return c.json({ error: message }, 400);
  }

  const stepResearchContext = await collectStepResearchContext({
    env: c.env,
    userId: asText(projectRecord.user_id),
    stepId,
    stepTitle: asText(stepRecord.title, 'Untitled step'),
    stepObjective: asText(stepRecord.objective, ''),
    stepWhyItMatters: asText(stepRecord.why_it_matters, ''),
    stepCategory: asText(stepRecord.category, ''),
    stepDoneWhen: asText(stepRecord.done_when, ''),
    stepIsGate: toBoolean(stepRecord.is_gate),
    adr: adrContext,
    research: researchContext,
  });
  const projectBriefContext = await loadProjectBriefContext(
    c.env,
    projectId,
    asText(projectRecord.user_id),
    {
      rawDescription: asText(projectRecord.description, ''),
      projectStack: asText(projectRecord.stack, '{}'),
    },
  );

  const providerRecord = await resolveProvider(c, providerId);
  if (!providerRecord) {
    return c.json({ error: 'No AI provider is configured yet. Add one in Settings first.' }, 400);
  }

  let apiKey: string;
  try {
    // SECURITY: key material never logged
    apiKey = await decrypt(providerRecord.api_key_enc as string, c.env.ENCRYPTION_KEY);
  } catch {
    return c.json({ error: 'Failed to decrypt API key' }, 500);
  }

  const providerType = providerRecord.provider as ProviderType;
  const model = (providerRecord.model as string | null) || defaultModelForProvider(providerType);
  const baseUrl = providerRecord.base_url as string | null;
  const systemPrompt = appendProjectBriefSystemPrompt(
    `You are Scrimble's step enrichment agent. You produce specific, actionable guidance for a single build step. Write for a solo builder in plain language with no jargon. Respond ONLY with valid JSON in the shape {"ai_output": string, "prompts": [{"label": string, "content": string}] }.`,
    projectBriefContext.promptContext,
  );
  const promptSections = [
    `Step title: ${stepRecord.title}`,
    `Project name: ${projectRecord.name}`,
    `Project brief: ${projectBriefContext.summary}`,
    `Project stack: ${projectRecord.stack || '{}'}`,
    `Step objective: ${stepRecord.objective || 'Not specified yet.'}`,
    `Why it matters: ${stepRecord.why_it_matters || 'Not specified yet.'}`,
    `Done when: ${stepRecord.done_when || 'Not specified yet.'}`,
    `Live research context:\n${formatStepResearchPrompt(stepResearchContext)}`,
    'Use the live documentation provided to generate specific, current guidance. Reference actual function names, hook names, and config options from the docs. If any open bugs were found, mention them in the ai_output and explain the workaround. Follow any requirements listed in the live research context exactly.',
  ];

  if (editedOutput) {
    promptSections.push(`Current draft to improve:\n${editedOutput}`);
  }

  if (feedback) {
    promptSections.push(`Human feedback to address:\n${feedback}`);
    promptSections.push('Revise the guidance so it directly addresses the human feedback before continuing.');
  }

  await c.env.DB.prepare('UPDATE steps SET status = "agent_working", updated_at = datetime("now") WHERE id = ?')
    .bind(stepId)
    .run();

  const runId = await insertAgentRun(c, {
    projectId,
    stepId,
    runType: 'enrich_step',
    status: 'running',
    provider: providerType,
    model,
    input: JSON.stringify({ feedback: feedback || null, editedOutput: editedOutput || null }),
  });

  try {
    const aiResponse = await callAIWithRetry({
      providerType,
      apiKey,
      model,
      baseUrl,
      system: systemPrompt,
      prompt: promptSections.join('\n\n'),
    });

    if (!aiResponse.ok) {
      const message = getAIErrorMessage(aiResponse.status, 'AI Enrichment Error');
      
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE steps SET status = "active", updated_at = datetime("now") WHERE id = ?').bind(stepId),
        c.env.DB.prepare(`
          UPDATE agent_runs
          SET status = 'failed', output = ?, completed_at = datetime("now")
          WHERE id = ?
        `).bind(message, runId),
      ]);

      return aiResponse;
    }

    if (!aiResponse.body) {
      throw new Error('AI Provider did not return a streaming body.');
    }

    const { readable, writable } = new TransformStream();
    const [stream1, stream2] = readable.tee();

    c.executionCtx.waitUntil(
      (async () => {
        const fullContent = await streamProviderText(providerType, stream2);

        try {
          const parsedContent = JSON.parse(extractJSON(fullContent));
          const validated = StepDetailSchema.safeParse(parsedContent);
          if (!validated.success) {
            throw new Error(`AI enrichment validation failed: ${validated.error.message}`);
          }

          const data = validated.data;
          const aiOutputWithFooter = appendResearchFooter(data.ai_output, stepResearchContext.footer);
          const nextStatus = toBoolean(stepRecord.is_gate) ? 'needs_review' : 'complete';
 
          await c.env.DB.batch([
            c.env.DB.prepare(`
              UPDATE steps
              SET ai_output = ?, prompts = ?, is_ai_enriched = 1, status = ?, updated_at = datetime("now")
              WHERE id = ?
            `).bind(
              aiOutputWithFooter || null,
              JSON.stringify(data.prompts || []),
              nextStatus,
              stepId,
            ),
            c.env.DB.prepare(`
              UPDATE agent_runs
              SET status = 'complete', output = ?, completed_at = datetime("now")
              WHERE id = ?
            `).bind(fullContent, runId),
          ]);
 
          await touchProject(c, projectId);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Malformed AI payload';
          await c.env.DB.batch([
            c.env.DB.prepare('UPDATE steps SET status = "active", updated_at = datetime("now") WHERE id = ?').bind(stepId),
            c.env.DB.prepare(`
              UPDATE agent_runs
              SET status = 'failed', output = ?, completed_at = datetime("now")
              WHERE id = ?
            `).bind(`JSON Parse Error: ${message}`, runId),
          ]);
        }
      })(),
    );

    aiResponse.body.pipeTo(writable);

    return new Response(stream1, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown enrichment failure';
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE steps SET status = "active", updated_at = datetime("now") WHERE id = ?').bind(stepId),
      c.env.DB.prepare(`
        UPDATE agent_runs
        SET status = 'failed', output = ?, completed_at = datetime("now")
        WHERE id = ?
      `).bind(message, runId),
    ]);
    return c.json({ error: message }, 500);
  }
});

app.post('/ai/proxy', async (c) => {
  const parsed = proxySchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Invalid proxy payload', details: parsed.error.format() }, 400);
  }

  const providerRecord = await resolveProvider(c, parsed.data.providerId);
  if (!providerRecord) {
    return c.json({ error: 'No AI provider is configured yet. Add one in Settings first.' }, 400);
  }

  let apiKey: string;
  try {
    // SECURITY: key material never logged
    apiKey = await decrypt(providerRecord.api_key_enc as string, c.env.ENCRYPTION_KEY);
  } catch {
    return c.json({ error: 'Failed to decrypt API key' }, 500);
  }

  const providerType = providerRecord.provider as ProviderType;
  const model = (providerRecord.model as string | null) || defaultModelForProvider(providerType);
  const baseUrl = providerRecord.base_url as string | null;
  const runId = parsed.data.projectId
    ? await insertAgentRun(c, {
        projectId: parsed.data.projectId,
        stepId: parsed.data.stepId || null,
        runType: 'proxy_call',
        status: 'running',
        provider: providerType,
        model,
      })
    : null;

  try {
    const response = await callAIWithRetry({
      providerType,
      apiKey,
      model,
      baseUrl,
      system: parsed.data.system || null,
      prompt: parsed.data.prompt,
    });

    if (!response.ok) {
      const message = getAIErrorMessage(response.status, 'AI Proxy Error');

      if (runId) {
        await c.env.DB.prepare(`
          UPDATE agent_runs
          SET status = 'failed', output = ?, completed_at = datetime("now")
          WHERE id = ?
        `)
          .bind(message, runId)
          .run();
      }
      return response;
    }

    if (!response.body) {
      throw new Error('AI Provider did not return a streaming body.');
    }

    const { readable, writable } = new TransformStream();
    response.body.pipeTo(writable);

    if (runId) {
      c.executionCtx.waitUntil(
        c.env.DB.prepare(`
          UPDATE agent_runs
          SET status = 'complete', completed_at = datetime("now")
          WHERE id = ?
        `).bind(runId).run(),
      );
    }

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown proxy failure';

    if (runId) {
      await c.env.DB.prepare(`
        UPDATE agent_runs
        SET status = 'failed', output = ?, completed_at = datetime("now")
        WHERE id = ?
      `)
        .bind(message, runId)
        .run();
    }

    return c.json({ error: message }, 500);
  }
});
