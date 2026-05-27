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
