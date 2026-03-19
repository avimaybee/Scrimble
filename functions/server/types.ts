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

export type ProjectGenerationBackend = 'queue' | 'workflow' | 'durable_object';

export type DurableObjectIdLike = {
  toString(): string;
};

export type DurableObjectStubLike = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export type DurableObjectNamespaceLike = {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): DurableObjectStubLike;
};

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

export type DurableObjectStorageLike = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTimeMs: number): Promise<void> | void;
  deleteAlarm(): Promise<void> | void;
};

export type DurableObjectAlarmInfoLike = {
  retryCount?: number;
  isRetry?: boolean;
};

export type DurableObjectStateLike = {
  waitUntil(promise: Promise<unknown>): void;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  storage: DurableObjectStorageLike;
};

export type Bindings = {
  DB: any;
  ENVIRONMENT: string;
  FIREBASE_PROJECT_ID: string;
  ENCRYPTION_KEY: string;
  PROJECT_GENERATION_RUNTIME?: string;
  AGENT_QUEUE?: {
    send(body: unknown, options?: { contentType?: 'json' | 'text' | 'bytes' | 'v8'; delaySeconds?: number }): Promise<void>;
  };
  PROJECT_GENERATOR?: DurableObjectNamespaceLike;
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
  | 'pipeline_failed';

export type Variables = {
  uid: string;
};

export type PagesBindings = Omit<Bindings, 'GENERATION_WORKFLOW'>;

export type AppEnv = {
  Bindings: PagesBindings;
  Variables: Variables;
};

export type AppContext = Context<AppEnv>;

export type QueueExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export type QueueMessageBody = {
  type: 'generate_project';
  projectId: string;
  userId: string;
  providerId?: string;
  runId?: string;
};

export type QueueMessage<T = QueueMessageBody> = {
  id: string;
  body: T;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

export type QueueMessageBatch<T = QueueMessageBody> = {
  messages: readonly QueueMessage<T>[];
};
