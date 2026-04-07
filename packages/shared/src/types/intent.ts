/**
 * Scrimble Intent and Task Graph Types
 *
 * Intent capture stores the normalized user goal.
 * Task graph is generated from intent + repo state.
 */

import type { LedgerTask, WorkerKind } from './ledger.js';

// --- Intent Model ---

/** Normalized user intent for a project. */
export interface Intent {
  /** Unique intent identifier. */
  id: string;
  /** User's goal in natural language. */
  goal: string;
  /** Product assumptions derived from goal. */
  productAssumptions: string[];
  /** Technical constraints. */
  constraints: string[];
  /** Success criteria. */
  successCriteria: string[];
  /** Out of scope items. */
  outOfScope: string[];
  /** Target audience/users. */
  targetUsers?: string;
  /** Timeline preference. */
  timeline?: 'asap' | 'flexible' | 'long_term';
  /** Quality preference. */
  qualityPreference?: 'prototype' | 'production' | 'enterprise';
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
  /** Primary language. */
  primaryLanguage?: string;
  /** Detected frameworks. */
  frameworks: string[];
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
  /** Phases for human readability (optional grouping). */
  phases: TaskPhase[];
  /** When graph was generated. */
  generatedAt: string;
  /** Generation metadata. */
  metadata: TaskGraphMetadata;
}

/** A phase grouping related tasks. */
export interface TaskPhase {
  /** Phase identifier. */
  id: string;
  /** Phase title. */
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
  /** Number of parallel-safe task groups. */
  parallelGroups: number;
  /** Critical path length (longest dependency chain). */
  criticalPathLength: number;
  /** Estimated total duration in hours (rough). */
  estimatedHours?: number;
  /** Provider artifacts used as context. */
  contextSourcesUsed: string[];
}

// --- Task Generation ---

/** Input for task graph generation. */
export interface TaskGenerationInput {
  /** Intent to generate from. */
  intent: Intent;
  /** Repo context for grounding. */
  repoContext: RepoContextSummary;
  /** Existing file structure. */
  existingFiles: string[];
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
  /** History of intent refinements. */
  history: IntentHistoryEntry[];
  /** Timestamp of last modification. */
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
