import type { Context } from 'hono';

export interface R2Object {
  key: string;
  size: number;
  httpEtag: string;
  customMetadata?: Record<string, string>;
  body: ReadableStream;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export type ProviderType = 'anthropic' | 'gemini' | 'openai' | 'custom' | 'openrouter' | 'groq';

export type ResolvedGenerationProviderConfig = {
  providerId: string;
  providerName: string;
  providerType: ProviderType;
  model: string;
  baseUrl: string | null;
  apiKey: string;
};

export const GENERATION_BATCHES = [
  'batch_1_research_stack',
  'batch_2_fetch_and_read',
  'batch_3_architect',
  'batch_4_plan_build',
  'batch_5_enrich_steps',
  'batch_6_generate_files',
] as const;

export type GenerationBatchName = (typeof GENERATION_BATCHES)[number];

export type ProjectGenerationStatus =
  | GenerationBatchName
  | 'intake'
  | 'queued'
  | 'awaiting_review'
  | 'approved'
  | 'complete'
  | 'failed'
  | 'cancelled';

/**
 * Generation Run Status - the lifecycle status of a single generation execution.
 * Unlike ProjectGenerationStatus (which mixes batch names with lifecycle states),
 * this type cleanly separates runtime lifecycle from batch progress.
 */
export type GenerationRunStatus =
  | 'queued'           // Waiting to start
  | 'running'          // Executing a batch
  | 'awaiting_review'  // Paused at human gate
  | 'approved'         // User approved, ready to continue
  | 'complete'         // Finished successfully
  | 'failed'           // Failed with error
  | 'cancelled';       // User cancelled

/**
 * Generation Run - represents a single execution of the generation pipeline.
 * This is the canonical runtime state model (Task A2).
 * 
 * A project can have many runs over time, but only one can be "current".
 * This separates durable project facts from transient workflow runtime.
 */
export type GenerationRun = {
  id: string;                              // Same as projects.generation_run_id
  project_id: string;
  workflow_instance_id: string | null;     // Cloudflare Workflow instance ID
  
  // Lifecycle
  status: GenerationRunStatus;
  current_batch: GenerationBatchName | null;  // Currently executing batch
  
  // Runtime tracking
  provider_id: string | null;
  heartbeat_at: string | null;
  
  // Error handling
  error_message: string | null;
  
  // Timestamps
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Maps the legacy ProjectGenerationStatus to the new GenerationRunStatus.
 * Used during the transition period while both models coexist.
 */
export function projectStatusToRunStatus(status: ProjectGenerationStatus): GenerationRunStatus {
  if (status === 'intake' || status === 'queued') return 'queued';
  if (status.startsWith('batch_')) return 'running';
  if (status === 'awaiting_review') return 'awaiting_review';
  if (status === 'approved') return 'approved';
  if (status === 'complete') return 'complete';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return 'queued'; // fallback
}

/**
 * Extracts the current batch from a ProjectGenerationStatus.
 * Returns null if the status is not a batch status.
 */
export function extractBatchFromStatus(status: ProjectGenerationStatus): GenerationBatchName | null {
  if (GENERATION_BATCHES.includes(status as GenerationBatchName)) {
    return status as GenerationBatchName;
  }
  return null;
}

export type WorkflowInstanceStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'errored'
  | 'terminated'
  | 'complete'
  | 'waiting'
  | 'waitingForPause'
  | 'unknown';

export type WorkflowInstanceLike = {
  id: string;
  status(): Promise<{
    status: WorkflowInstanceStatus;
    error?: { name: string; message: string };
    output?: unknown;
  }>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  restart(): Promise<void>;
  terminate(): Promise<void>;
  sendEvent(options: { type: string; payload?: unknown }): Promise<void>;
};

export type WorkflowBindingLike<TParams = unknown> = {
  create(options?: { id?: string; params?: TParams }): Promise<WorkflowInstanceLike>;
  get(id: string): Promise<WorkflowInstanceLike>;
};

export type GenerationWorkflowPayload = {
  protocolVersion: number;
  projectId: string;
  userId: string;
  runId: string;
  description: string;
  intakeAnswers: Record<string, string>;
  fastProvider: ResolvedGenerationProviderConfig;
  deepProvider: ResolvedGenerationProviderConfig;
  stackTechnologies: Array<{ name: string; docsUrl?: string; githubRepo?: string }>;
};

export type WorkflowApprovalPayload = {
  feedback: string;
  preferredIde: string;
  approved: boolean;
};

export type WorkflowServiceBindingLike = {
  createGeneration(payload: GenerationWorkflowPayload): Promise<{ instanceId: string }>;
  sendApproval(instanceId: string, approvalPayload: WorkflowApprovalPayload): Promise<void>;
  cancelGeneration(instanceId: string): Promise<void>;
  getStatus(instanceId: string): Promise<{ status: string; output: unknown }>;
};

export type Bindings = {
  DB: any;
  ENVIRONMENT: string;
  FIREBASE_PROJECT_ID: string;
  ENCRYPTION_KEY: string;
  WORKFLOW_SERVICE?: WorkflowServiceBindingLike;
  GENERATION_WORKFLOW?: WorkflowBindingLike<GenerationWorkflowPayload>;
  CHECKPOINT_BUCKET: {
    put(key: string, body: string | ArrayBuffer | Uint8Array): Promise<R2Object>;
    get(key: string): Promise<R2Object | null>;
    delete(key: string): Promise<void>;
  };
  SCRIMBLE_BUCKET?: {
    put(key: string, body: string | ArrayBuffer | Uint8Array): Promise<R2Object>;
    get(key: string): Promise<R2Object | null>;
    delete(key: string): Promise<void>;
  };
  R2?: any;
};

export type ProjectRecordForWorkflowDispatch = {
  id: string;
  user_id: string;
  description: string | null;
  intake_answers: string | null;
  workflow_instance_id: string | null;
};

export type GenerationEventType =
  | 'batch_start'
  | 'activity'
  | 'thinking'
  | 'batch_complete'
  | 'checkpoint'
  | 'pipeline_complete'
  | 'pipeline_failed'
  | 'invariant';

export type Variables = {
  uid: string;
};

export type PagesBindings = Omit<Bindings, 'GENERATION_WORKFLOW'>;

export type AppEnv = {
  Bindings: PagesBindings;
  Variables: Variables;
};

export type AppContext = Context<AppEnv>;

// ─────────────────────────────────────────────────────────────────
// Step Content Types (Task A3 / T1)
// Server-side typed structures for step content fields.
// These are parsed from JSON strings before returning in API responses.
// ─────────────────────────────────────────────────────────────────

export interface StepNavigationLink {
  label: string;
  url: string;
  when: string;
}

export interface StepPrompt {
  label: string;
  content: string;
}

export interface StepResearchFooterMeta {
  researched_at: string;
  tools: string[];
  quality?: 'live' | 'cached' | 'degraded' | 'none';
  live_source_count?: number;
  cached_source_count?: number;
  degraded_sources?: string[];
}

export interface StepSuggestedTool {
  name: string;
  url?: string;
  reason?: string;
}

export interface ParsedStepContent {
  navigationLinks: StepNavigationLink[];
  prompts: StepPrompt[];
  researchFooterMeta: StepResearchFooterMeta | null;
  suggestedTools: StepSuggestedTool[];
}

function safeJsonParse(raw: unknown): unknown {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseNavigationLinks(raw: unknown): StepNavigationLink[] {
  const parsed = safeJsonParse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const e = entry as Record<string, unknown>;
      const label = typeof e.label === 'string' ? e.label.trim() : '';
      const url = typeof e.url === 'string' ? e.url.trim() : '';
      const when = typeof e.when === 'string' ? e.when.trim() : '';
      if (!label || !url) return null;
      return { label, url, when };
    })
    .filter((entry): entry is StepNavigationLink => entry !== null);
}

export function parsePrompts(raw: unknown): StepPrompt[] {
  const parsed = safeJsonParse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const e = entry as Record<string, unknown>;
      const label = typeof e.label === 'string' ? e.label.trim() : '';
      const content = typeof e.content === 'string' ? e.content.trim() : '';
      if (!label || !content) return null;
      return { label, content };
    })
    .filter((entry): entry is StepPrompt => entry !== null);
}

export function parseResearchFooterMeta(raw: unknown): StepResearchFooterMeta | null {
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  const researched_at = typeof p.researched_at === 'string' ? p.researched_at.trim() : '';
  const tools = Array.isArray(p.tools)
    ? p.tools.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
    : [];
  if (!researched_at || tools.length === 0) return null;

  const validQuality = ['live', 'cached', 'degraded', 'none'] as const;
  const quality = typeof p.quality === 'string' && validQuality.includes(p.quality as typeof validQuality[number])
    ? (p.quality as StepResearchFooterMeta['quality'])
    : undefined;
  const live_source_count = typeof p.live_source_count === 'number' ? p.live_source_count : undefined;
  const cached_source_count = typeof p.cached_source_count === 'number' ? p.cached_source_count : undefined;
  const degraded_sources = Array.isArray(p.degraded_sources)
    ? p.degraded_sources.filter((s): s is string => typeof s === 'string')
    : undefined;

  return {
    researched_at,
    tools,
    quality,
    live_source_count,
    cached_source_count,
    degraded_sources: degraded_sources?.length ? degraded_sources : undefined,
  };
}

export function parseSuggestedTools(raw: unknown): StepSuggestedTool[] {
  const parsed = safeJsonParse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry): StepSuggestedTool | null => {
      if (!entry || typeof entry !== 'object') return null;
      const e = entry as Record<string, unknown>;
      const name = typeof e.name === 'string' ? e.name.trim() : '';
      if (!name) return null;
      return {
        name,
        url: typeof e.url === 'string' ? e.url.trim() : undefined,
        reason: typeof e.reason === 'string' ? e.reason.trim() : undefined,
      };
    })
    .filter((entry): entry is StepSuggestedTool => entry !== null);
}

export function parseStepContent(step: {
  navigation_links?: unknown;
  prompts?: unknown;
  research_footer_meta?: unknown;
  suggested_tools?: unknown;
}): ParsedStepContent {
  return {
    navigationLinks: parseNavigationLinks(step.navigation_links),
    prompts: parsePrompts(step.prompts),
    researchFooterMeta: parseResearchFooterMeta(step.research_footer_meta),
    suggestedTools: parseSuggestedTools(step.suggested_tools),
  };
}
