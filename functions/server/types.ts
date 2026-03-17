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

export type ProjectGenerationBackend = 'queue' | 'durable_object';

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
  CHECKPOINT_BUCKET: {
    put(key: string, body: string | ArrayBuffer | Uint8Array): Promise<R2Object>;
    get(key: string): Promise<R2Object | null>;
    delete(key: string): Promise<void>;
  };
  R2?: any;
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

export type AppEnv = {
  Bindings: Bindings;
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
