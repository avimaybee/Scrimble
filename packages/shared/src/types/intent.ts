/**
 * Scrimble Intent and Task Graph Types
 *
 * Intent capture stores the normalized user goal.
 * Task graph is generated from intent + repo state.
 */

import type { LedgerTask, WorkerKind } from './ledger.js';

// --- Intent Model ---

/** Discovery mode used to collect project foundation. */
export type DiscoveryMode = 'interactive' | 'autogenerate' | 'custom';

/** Discovery step used for resume/recovery. */
export type DiscoveryStep =
  | 'scan_summary'
  | 'mode_selection'
  | 'autogenerate_goal'
  | 'interactive_questions'
  | 'custom_brief'
  | 'draft_review';

/** Inferred stack and repository baseline for planning. */
export interface InferredStackSummary {
  projectType: 'greenfield' | 'brownfield';
  repoName: string;
  repoPath: string;
  branch?: string;
  languages: string[];
  frameworks: string[];
  packageManager?: string;
}

/** Lightweight scan output used to ground discovery prompts. */
export interface RepoScanSummary {
  projectType: 'greenfield' | 'brownfield';
  repoName: string;
  repoPath: string;
  branch?: string;
  languages: string[];
  frameworks: string[];
  packageManager?: string;
  readmeSummary?: string;
  configSummary: string[];
  hasScrimbleDir: boolean;
  hasConductorArtifacts: boolean;
  conductorArtifacts: string[];
}

/** Normalized user intent for a project. */
export interface Intent {
  /** Unique intent identifier. */
  id: string;
  /** Human-readable project name. */
  projectName: string;
  /** User's goal in natural language. */
  goal: string;
  /** Product vision statement used for planning context. */
  productVision: string;
  /** Product assumptions derived from goal. */
  productAssumptions: string[];
  /** Product-level constraints. */
  productConstraints: string[];
  /** Technical constraints. */
  technicalConstraints: string[];
  /** Backward-compatible alias of technical constraints. */
  constraints: string[];
  /** Success criteria. */
  successCriteria: string[];
  /** Explicit non-goals/out-of-scope list. */
  nonGoals: string[];
  /** Out of scope items. */
  outOfScope: string[];
  /** Target audience/users. */
  targetUsers: string;
  /** Timeline preference. */
  timeline: 'asap' | 'flexible' | 'long_term';
  /** Quality preference. */
  qualityPreference: 'prototype' | 'production' | 'enterprise';
  /** Inferred or user-confirmed stack baseline. */
  inferredStack: InferredStackSummary;
  /** Design/UX direction for user-facing products when relevant. */
  designDirection?: string;
  /** Source mode used to build this foundation. */
  discoveryMode: DiscoveryMode;
  /** When intent was captured. */
  createdAt: string;
  /** When intent was last updated. */
  updatedAt: string;
}

/** Input for intent capture conversation. */
export interface IntentCaptureInput {
  /** Initial goal from user. */
  initialGoal: string;
  /** Repo context for grounding. */
  repoContext?: RepoContextSummary;
  /** Previous intent to refine. */
  previousIntent?: Intent;
}

/** Minimal repo context for intent capture. */
export interface RepoContextSummary {
  /** Repository name. */
  name: string;
  /** Repository path when known. */
  path?: string;
  /** Current branch when known. */
  branch?: string;
  /** Project maturity inference. */
  projectType?: 'greenfield' | 'brownfield';
  /** Primary language. */
  primaryLanguage?: string;
  /** Detected frameworks. */
  frameworks: string[];
  /** Package manager when known. */
  packageManager?: string;
  /** Existing README summary. */
  readmeSummary?: string;
  /** Key directories. */
  keyDirectories: string[];
}

// --- Task Graph Model ---

/** A directed edge in the task graph (dependency). */
export interface TaskEdge {
  /** Source task (depends on target). */
  from: string;
  /** Target task (must complete before source). */
  to: string;
}

/** The complete task graph generated from intent. */
export interface TaskGraph {
  /** Intent this graph was generated from. */
  intentId: string;
  /** All tasks in the graph. */
  tasks: LedgerTask[];
  /** Dependency edges. */
  edges: TaskEdge[];
  /** Workstream groups for human-readable review (optional). */
  phases: TaskPhase[];
  /** When graph was generated. */
  generatedAt: string;
  /** Generation metadata. */
  metadata: TaskGraphMetadata;
}

/** A workstream grouping related tasks. */
export interface TaskPhase {
  /** Phase identifier. */
  id: string;
  /** Workstream title. */
  title: string;
  /** Task IDs in this phase. */
  taskIds: string[];
  /** Phase description. */
  description?: string;
}

/** Metadata about task graph generation. */
export interface TaskGraphMetadata {
  /** Total estimated complexity (sum of task risk scores). */
  totalComplexity: number;
  /** Critical path length (longest dependency chain). */
  criticalPathLength: number;
  /** Ratio of tasks with explicit ownership (0-1). */
  ownershipCoverage: number;
  /** Ratio of tasks with explicit verification commands (0-1). */
  verificationCoverage: number;
  /** Aggregate grounding score for intent + repo signals (0-1). */
  groundingScore: number;
  /** Number of planner warnings emitted for this graph. */
  warningCount: number;
  /** Workstreams used to derive this graph. */
  workstreams: string[];
  /** Provider artifacts used as context. */
  contextSourcesUsed: string[];
}

/** Scrimble foundation artifact used during planning. */
export interface FoundationContextArtifact {
  path: string;
  content: string;
}

/** Scripts discovered for verification inference. */
export interface PlanningScriptCatalog {
  packageManager?: string;
  rootScripts: string[];
  workspaceScripts: ScriptCatalogEntry[];
}

/** Workspace package scripts used for scoped verification inference. */
export interface ScriptCatalogEntry {
  path: string;
  name?: string;
  scripts: string[];
}

/** Structured planner warning emitted during task synthesis. */
export interface PlanningWarning {
  code:
    | 'ownership_weak'
    | 'verification_missing'
    | 'requirements_ambiguous'
    | 'conflicting_repo_signals'
    | 'foundation_context_missing';
  message: string;
  taskId?: string;
}

// --- Task Generation ---

/** Input for task graph generation. */
export interface TaskGenerationInput {
  /** Intent to generate from. */
  intent: Intent;
  /** Repo context for grounding. */
  repoContext: RepoContextSummary;
  /** Repository scan summary from discovery. */
  repoScan?: RepoScanSummary;
  /** Existing file structure. */
  existingFiles: string[];
  /** Foundation artifacts under .scrimble/context. */
  foundationContext?: FoundationContextArtifact[];
  /** Scripts used for verification inference. */
  scriptCatalog?: PlanningScriptCatalog;
  /** Provider context artifacts. */
  contextArtifacts: ContextArtifactRef[];
  /** Worker preferences. */
  workerPreferences?: WorkerPreferences;
}

/** Reference to a context artifact without content. */
export interface ContextArtifactRef {
  /** Artifact path. */
  path: string;
  /** Artifact kind. */
  kind: string;
}

/** Worker preferences for task generation. */
export interface WorkerPreferences {
  /** Preferred worker for most tasks. */
  defaultWorker?: WorkerKind;
  /** Task type to worker mapping. */
  taskTypeOverrides?: Record<string, WorkerKind>;
  /** Allow parallel execution. */
  allowParallel: boolean;
  /** Maximum parallel workers. */
  maxParallelWorkers: number;
}

/** Output from task graph generation. */
export interface TaskGenerationOutput {
  /** Generated task graph. */
  graph: TaskGraph;
  /** Warnings during generation. */
  warnings: string[];
  /** Structured planning-quality warnings. */
  qualityWarnings: PlanningWarning[];
  /** Suggestions for improvement. */
  suggestions: string[];
}

// --- Conductor Import ---

/** Result of importing Conductor artifacts into ledger format. */
export interface ConductorImportResult {
  /** Whether import was successful. */
  success: boolean;
  /** Imported intent. */
  intent?: Intent;
  /** Imported task graph. */
  graph?: TaskGraph;
  /** Warnings during import. */
  warnings: string[];
  /** Errors during import. */
  errors: string[];
  /** Conductor artifacts found. */
  artifactsFound: string[];
}

/** Options for Conductor import. */
export interface ConductorImportOptions {
  /** Import as context only (don't create ledger tasks). */
  contextOnly: boolean;
  /** Specific track ID to import. */
  trackId?: string;
  /** Override existing intent if present. */
  overwriteIntent: boolean;
}

// --- Intent State ---

/** Root container for intent in intent.json. */
export interface IntentState {
  /** Schema version for migrations. */
  version: number;
  /** Current intent. */
  intent: Intent | null;
  /** Discovery/onboarding continuity state. */
  discovery: IntentDiscoveryState;
  /** History of intent refinements. */
  history: IntentHistoryEntry[];
  /** Timestamp of last modification. */
  updatedAt: string;
}

/** Persistent discovery/onboarding state. */
export interface IntentDiscoveryState {
  status: 'not_started' | 'in_progress' | 'draft_ready' | 'approved' | 'skipped';
  mode?: DiscoveryMode;
  step?: DiscoveryStep;
  questionIndex?: number;
  scan?: RepoScanSummary;
  draft?: Intent;
  updatedAt: string;
}

/** An entry in intent history. */
export interface IntentHistoryEntry {
  /** Intent snapshot. */
  intent: Intent;
  /** Reason for change. */
  reason: string;
  /** When change was made. */
  changedAt: string;
}
