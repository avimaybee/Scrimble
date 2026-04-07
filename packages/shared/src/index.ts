// Re-export all types (these are the canonical type definitions)
export * from './types/index.js';

// Re-export schemas only (types are inferred from schemas, not re-exported)
export {
  // Schema exports (validators)
  aiProviderSchema,
  aiOptionsSchema,
  aiConfigSchema,
  authProviderSchema,
  authConfigSchema,
  authSessionSchema,
  scrimbleConfigSchema,
  projectStatusSchema,
  createProjectSchema,
  chunkStatusSchema,
  chunkDefinitionSchema,
  planDataSchema,
  verificationStatusSchema,
  verificationCheckSchema,
  verificationResultSchema,
  generationRunTypeSchema,
  generationRunStatusSchema,
  stackInfoSchema,
  directoryNodeSchema,
  repoContextSchema,
  generationInputSchema,
  initProjectRequestSchema,
  completeChunkRequestSchema,
  skipChunkRequestSchema,
  updatePlanRequestSchema,
  firebaseApproveRequestSchema,
} from './schemas/index.js';

// Constants
export const SCRIMBLE_DIR = '.scrimble';
export const CONFIG_FILE = 'config.json';
export const PROJECT_FILE = 'project.json';
export const PLAN_FILE = 'plan.json';
export const CURRENT_CHUNK_FILE = 'current-chunk.md';
export const ARCHITECTURE_FILE = 'architecture.md';
export const RESEARCH_FILE = 'research-summary.md';
export const ACTIVITY_LOG = 'activity.log';
export const SESSION_FILE = 'session.json';
export const VERIFICATION_DIR = 'verification';
export const PROMPTS_DIR = 'prompts';
export const RULES_DIR = 'rules';

// Conductor artifact paths (planning truth)
export const CONDUCTOR_DIR = 'conductor';
export const CONDUCTOR_PRODUCT_FILE = 'product.md';
export const CONDUCTOR_GUIDELINES_FILE = 'product-guidelines.md';
export const CONDUCTOR_TECH_STACK_FILE = 'tech-stack.md';
export const CONDUCTOR_WORKFLOW_FILE = 'workflow.md';
export const CONDUCTOR_TRACKS_FILE = 'tracks.md';
export const CONDUCTOR_TRACKS_DIR = 'tracks';

// Scrimble runtime paths (runtime truth)
export const RUNTIME_DIR = 'runtime';
export const RUNTIME_STATE_FILE = 'run-state.json';
export const RUNTIME_APPROVALS_FILE = 'approvals.json';
export const RUNTIME_EVENTS_FILE = 'events.ndjson';
export const RUNTIME_ATTEMPTS_DIR = 'attempts';
export const RUNTIME_WORKERS_FILE = 'workers.json';

// Scrimble ledger paths (task/assignment truth)
export const LEDGER_DIR = 'ledger';
export const LEDGER_TASKS_FILE = 'tasks.json';
export const LEDGER_ASSIGNMENTS_FILE = 'assignments.json';
export const LEDGER_FILE_LEASES_FILE = 'file-leases.json';
export const INTENT_FILE = 'intent.json';
export const LEDGER_FILE = 'ledger.json';

export const DEFAULT_CLOUD_ENDPOINT = 'https://api.scrimble.dev';
