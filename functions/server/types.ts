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

export type ProviderType = 'anthropic' | 'gemini' | 'openai' | 'custom';

export const GENERATION_BATCHES = [
  'batch_1_research_stack',
  'batch_2_fetch_and_read',
  'batch_3_architect',
  'batch_4_plan_build',
  'batch_5_enrich_steps',
  'batch_6_generate_files',
] as const;

export type GenerationBatchName = (typeof GENERATION_BATCHES)[number];

export const PREFERRED_IDES = ['cursor', 'windsurf', 'vscode', 'claude_desktop'] as const;

export type PreferredIde = (typeof PREFERRED_IDES)[number];

export type ProjectGenerationStatus =
  | GenerationBatchName
  | 'intake'
  | 'queued'
  | 'awaiting_review'
  | 'approved'
  | 'complete'
  | 'failed';

export type Bindings = {
  DB: any;
  FIREBASE_PROJECT_ID: string;
  ENCRYPTION_KEY: string;
  AGENT_QUEUE?: {
    send(body: unknown, options?: { contentType?: 'json' | 'text' | 'bytes' | 'v8'; delaySeconds?: number }): Promise<void>;
  };
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
  CHECKPOINT_BUCKET?: {
    put(key: string, body: string | ArrayBuffer | Uint8Array): Promise<R2Object>;
    get(key: string): Promise<R2Object | null>;
    delete(key: string): Promise<void>;
  };
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
