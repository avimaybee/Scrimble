// Active shared contract surface for Scrimble.
// Deprecated project/chunk/generation-era types live under "./legacy".

// Worker preflight types
export * from './worker-preflight.js';

// Ledger/runtime/orchestration types
export * from './ledger.js';

// Worker driver + context artifact contracts
export * from './worker.js';

// Intent/discovery/foundation + task-graph contracts
export * from './intent.js';

// Verification types
export type VerificationStatus = 'pass' | 'warn' | 'fail' | 'manual_review';

export interface VerificationResult {
  status: VerificationStatus;
  confidence: number; // 0-1
  checks: VerificationCheck[];
  timestamp: string;
}

export interface VerificationCheck {
  name: string;
  status: VerificationStatus;
  message?: string;
  evidence?: string;
}

// AI provider configuration
export type AIProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'openrouter'
  | 'github-copilot'
  | 'azure'
  | 'groq'
  | 'together';

export type AIModelStrategy = 'auto' | 'explicit';

export type AIProfileAuthStrategy =
  | 'api_key'
  | 'copilot_login'
  | 'env_token'
  | 'gh_cli'
  | 'personal_access_token';

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey?: string | undefined; // Can be env var reference like ${OPENAI_API_KEY}
  baseUrl?: string | undefined;
  options?: AIOptions | undefined;
}

export interface AIProfileAuth {
  strategy: AIProfileAuthStrategy;
  apiKey?: string | undefined; // api_key strategy
  token?: string | undefined; // personal_access_token strategy
}

export interface AIProviderProfile {
  id: string;
  name: string;
  provider: AIProvider;
  modelStrategy: AIModelStrategy;
  model?: string | undefined;
  baseUrl?: string | undefined;
  auth: AIProfileAuth;
  options?: AIOptions | undefined;
}

export type ProviderCapabilitySource = 'live' | 'cached' | 'fallback';
export type ModelAvailabilityStatus = 'available' | 'unverified' | 'unavailable';
export type ProfileAuthStatus = 'ready' | 'missing' | 'invalid';

export interface ProfileCapabilitySnapshot {
  source: ProviderCapabilitySource;
  availableModels: string[];
  validatedAt: string;
  stale?: boolean | undefined;
}

export interface ProfileValidationCacheEntry {
  profileId: string;
  provider: AIProvider;
  authStrategy: AIProfileAuthStrategy;
  authStatus: ProfileAuthStatus;
  authSource?: string | undefined;
  modelStrategy: AIModelStrategy;
  model?: string | undefined;
  modelAvailability: ModelAvailabilityStatus;
  capability: ProfileCapabilitySnapshot;
  issues: string[];
  usabilityIssues: string[];
  validatedAt: string;
}

export interface ProviderValidationCache {
  version: 1;
  updatedAt: string;
  profiles: Record<string, ProfileValidationCacheEntry>;
}

export interface AIOptions {
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  topP?: number | undefined;
}

// Planner/execution defaults in config
export type PlannerWorker = 'gemini' | 'copilot' | 'auto';

export interface WorkerPreferences {
  defaultWorker?: PlannerWorker | undefined;
  allowParallel?: boolean | undefined;
  maxParallelWorkers?: number | undefined;
}

export interface ExecutionDefaults {
  worker?: PlannerWorker | undefined;
  timeoutSeconds?: number | undefined;
  maxParallelTasks?: number | undefined;
  maxRetriesPerTask?: number | undefined;
}

export interface VerificationDefaults {
  enabled?: boolean | undefined;
  commands?: string[] | undefined;
}

export type InteractionMode = 'guide' | 'balanced' | 'operator';

// Local config
export interface ScrimbleConfig {
  schemaVersion: number;
  activeProfileId?: string | undefined;
  profiles: AIProviderProfile[];
  interactionMode: InteractionMode;
  plannerWorker?: PlannerWorker | undefined;
  workerPreferences?: WorkerPreferences | undefined;
  executionDefaults?: ExecutionDefaults | undefined;
  verificationDefaults?: VerificationDefaults | undefined;
}
