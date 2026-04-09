// Core entity types for Scrimble

// Gemini preflight types
export * from './conductor.js';

// Native ledger types for single-active execution orchestration
export * from './ledger.js';
export * from './worker.js';
export * from './intent.js';

export type UserID = string;
export type ProjectID = string;
export type ChunkID = string;
export type PlanRevisionID = string;
export type GenerationRunID = string;
export type SessionID = string;
export type EventID = string;

export interface User {
  id: UserID;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'abandoned';

export interface Project {
  id: ProjectID;
  userId: UserID;
  name: string;
  repoUrl?: string;
  goal?: string;
  status: ProjectStatus;
  currentChunkId?: ChunkID;
  createdAt: string;
  updatedAt: string;
}

export interface PlanRevision {
  id: PlanRevisionID;
  projectId: ProjectID;
  version: number;
  planData: PlanData;
  createdAt: string;
}

export interface PlanData {
  architecture: string;
  researchSummary?: string;
  chunks: ChunkDefinition[];
}

export interface ChunkDefinition {
  id: ChunkID;
  sequence: number;
  title: string;
  prompt: string;
  doneCondition: string;
  doNotTouch?: string;
  verificationHints?: string[];
}

export type ChunkStatus = 'pending' | 'active' | 'completed' | 'skipped';

export interface Chunk {
  id: ChunkID;
  projectId: ProjectID;
  planRevisionId: PlanRevisionID;
  sequence: number;
  title: string;
  prompt: string;
  doneCondition: string;
  doNotTouch?: string;
  verificationHints?: string;
  status: ChunkStatus;
  completedAt?: string;
  skipReason?: string;
  createdAt: string;
}

export type GenerationRunType = 'initial' | 'replan' | 'update';
export type GenerationRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface GenerationRun {
  id: GenerationRunID;
  projectId: ProjectID;
  type: GenerationRunType;
  status: GenerationRunStatus;
  inputData?: GenerationInput;
  outputData?: GenerationOutput;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface GenerationInput {
  goal: string;
  repoContext?: RepoContext;
  existingPlan?: PlanData;
  updateRequest?: string;
}

export interface GenerationOutput {
  architecture?: string;
  researchSummary?: string;
  chunks?: ChunkDefinition[];
}

export interface RepoContext {
  name: string;
  path: string;
  stack: StackInfo;
  structure: DirectoryNode[];
  existingFiles?: string[];
}

export interface StackInfo {
  languages: string[];
  frameworks: string[];
  packageManager?: string;
  buildTool?: string;
}

export interface DirectoryNode {
  name: string;
  type: 'file' | 'directory';
  children?: DirectoryNode[];
}

export type EventType =
  | 'project_created'
  | 'generation_started'
  | 'generation_completed'
  | 'generation_failed'
  | 'architecture_approved'
  | 'chunk_activated'
  | 'chunk_completed'
  | 'chunk_skipped'
  | 'verification_passed'
  | 'verification_failed'
  | 'verification_overridden'
  | 'plan_updated'
  | 'plan_replanned';

export interface ProjectEvent {
  id: EventID;
  projectId: ProjectID;
  type: EventType;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface Session {
  id: SessionID;
  userId: UserID;
  tokenHash: string;
  deviceName?: string;
  expiresAt: string;
  createdAt: string;
}

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

// AI Provider configuration
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
