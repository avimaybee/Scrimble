/**
 * Scrimble Native Ledger Types
 *
 * The ledger is the canonical source of truth for task state, runtime execution,
 * and ownership scope. Provider artifacts (GEMINI.md, AGENTS.md, conductor/)
 * are supplemental context only.
 */

import type { IntentState } from './intent.js';

// --- Worker Identity ---

/** Supported worker kinds for autonomous execution. */
export type WorkerKind = 'gemini' | 'copilot';

// --- Task State Machine ---

/**
 * Task lifecycle status.
 *
 * State machine:
 *   pending → ready → in_progress → completed
 *                           ↘ blocked / failed
 *                           ↘ ready (retry)
 */
export type TaskStatus =
  | 'pending' // Waiting on dependencies
  | 'ready' // Ready to execute
  | 'in_progress' // Worker is actively executing this task
  | 'blocked' // Blocked by dependency or conflict
  | 'failed' // Terminal failure, requires intervention
  | 'completed'; // Successfully completed and verified

// --- Core Ledger Entities ---

/** A task in the Scrimble ledger. */
export interface LedgerTask {
  /** Unique task identifier (kebab-case, e.g., "user-auth-module"). */
  id: string;
  /** Human-readable task title. */
  title: string;
  /** What the task should accomplish. */
  objective: string;
  /** Why this task exists in the generated plan. */
  rationale?: string;
  /** Criteria for determining task completion. */
  doneCriteria: string;
  /** Files/globs this task is allowed to create or modify. */
  ownedFiles: string[];
  /** Additional files the task may read but not modify. */
  allowedFiles: string[];
  /** Ownership confidence from planner inference. */
  ownershipConfidence?: 'high' | 'medium' | 'low';
  /** Planning warnings attached to this task. */
  planningWarnings?: string[];
  /** Commands to verify task completion. */
  verificationCommands: string[];
  /** Task IDs that must complete before this task. */
  dependencies: string[];
  /** Preferred worker for this task. */
  preferredWorker?: WorkerKind;
  /** Fallback worker if preferred is unavailable. */
  fallbackWorker?: WorkerKind;
  /** Risk score 0-10 (higher = more risky, may need human review). */
  riskScore: number;
  /** Current task status. */
  status: TaskStatus;
  /** Timestamp when task was created. */
  createdAt: string;
  /** Timestamp of last status change. */
  updatedAt: string;
  /** Error message if status is 'failed' or 'blocked'. */
  error?: string;
  /** Number of execution attempts. */
  attemptCount: number;
  /** Maximum retry attempts before marking failed. */
  maxRetries: number;
}

/** Execution phase of the currently active task attempt. */
export type ActiveExecutionPhase = 'dispatching' | 'executing' | 'verifying';

/** Single in-flight task execution state for the runtime. */
export interface ActiveExecutionState {
  /** Task currently being executed. */
  taskId: string;
  /** Worker currently executing the task. */
  workerId: WorkerKind;
  /** Execution start timestamp. */
  startedAt: string;
  /** Attempt number of the task execution. */
  attempt: number;
  /** Optional phase for status/reporting UI. */
  phase?: ActiveExecutionPhase;
  /** Optional status line for status/reporting UI. */
  statusMessage?: string;
}

/** Record of a single execution attempt. */
export interface TaskExecutionRecord {
  /** Unique attempt identifier. */
  attemptId: string;
  /** Task being executed. */
  taskId: string;
  /** Worker that executed. */
  worker: WorkerKind;
  /** SHA256 hash of the prompt (first 16 chars). */
  promptHash: string;
  /** When execution started. */
  startedAt: string;
  /** When execution ended. */
  endedAt: string;
  /** Process exit code. */
  exitCode: number | null;
  /** Captured stdout (path to file or inline if small). */
  stdout: string;
  /** Captured stderr (path to file or inline if small). */
  stderr: string;
  /** Files actually touched during execution. */
  touchedFiles: string[];
  /** Verification result. */
  verificationResult: 'pass' | 'fail' | 'skipped';
  /** Verification error message if failed. */
  verificationError?: string;
  /** Whether execution timed out. */
  timedOut: boolean;
  /** Whether worker stalled (no output for timeout period). */
  stalled: boolean;
  /** Duration in milliseconds. */
  durationMs: number;
}

/** Health status of a worker driver. */
export interface WorkerHealth {
  /** Worker kind. */
  kind: WorkerKind;
  /** Whether worker is available. */
  available: boolean;
  /** Current session ID if active. */
  sessionId?: string;
  /** Last heartbeat timestamp. */
  lastHeartbeat?: string;
  /** Number of tasks completed this session. */
  tasksCompleted: number;
  /** Number of tasks failed this session. */
  tasksFailed: number;
  /** Error message if unavailable. */
  error?: string;
}

// --- Ledger State Containers ---

/** Root container for the task graph in the ledger document. */
export interface TasksState {
  /** Schema version for migrations. */
  version: number;
  /** All tasks in the ledger. */
  tasks: LedgerTask[];
  /** Timestamp of last modification. */
  updatedAt: string;
}

/** Root runtime state for the ledger document. */
export interface RuntimeState {
  /** Schema version for migrations. */
  version: number;
  /** Optional currently active execution. */
  activeExecution?: ActiveExecutionState;
  /** Timestamp of last modification. */
  updatedAt: string;
}

/** Root container for worker health in the ledger document. */
export interface WorkersState {
  /** Schema version for migrations. */
  version: number;
  /** Health status per worker. */
  workers: WorkerHealth[];
  /** Timestamp of last modification. */
  updatedAt: string;
}

/** Root approval state for autonomous ledger execution. */
export interface LedgerApprovalState {
  /** Schema version for migrations. */
  version: number;
  /** Whether autonomous execution is approved. */
  approved: boolean;
  /** When approval was last granted. */
  approvedAt?: string;
  /** Optional approval notes. */
  notes?: string;
  /** Timestamp of last modification. */
  updatedAt: string;
}

/** Pending approval boundary for the operator loop. */
export interface OrchestrationBoundaryState {
  id: string;
  action: string;
  actionSummary: string;
  reason: string;
  category?: 'setup' | 'planning' | 'execution' | 'inspection';
  riskLevel?: 'low' | 'medium' | 'high';
  nextStepHint?: string;
  scope: {
    parallel: number;
    maxTasks: number;
    args: Record<string, unknown>;
  };
  choices: Array<'proceed' | 'pause' | 'redirect'>;
  requestedAt: string;
}

/** Single completed operator step. */
export interface OrchestrationStepState {
  action: string;
  summary: string;
  completedAt: string;
}

/** Durable state for an active conversational operator run. */
export interface OrchestrationActiveRunState {
  request: string;
  startedAt: string;
  updatedAt: string;
  completedSteps?: OrchestrationStepState[];
  lastCompletedStep?: OrchestrationStepState;
  currentStep?: {
    action: string;
    actionSummary: string;
    rationale: string;
    requiresConfirmation: boolean;
    expectedOutcome: string;
    pauseCondition: string;
    plannedAt: string;
  };
  pendingBoundary?: OrchestrationBoundaryState;
  lastPauseReason?: string;
}

/** Snapshot of the latest operator-loop outcome. */
export interface OrchestrationRunOutcomeState {
  status: 'completed' | 'paused' | 'blocked' | 'redirected' | 'failed';
  request: string;
  summary: string;
  reason?: string;
  nextSuggestedAction?: string;
  recoveryKind?: string;
  recoveryActions?: Array<{
    kind: string;
    label: string;
    description: string;
  }>;
  lastFailure?: {
    source: string;
    taskId?: string;
    files?: string[];
    commands?: string[];
    detail?: string;
  };
  completedAt: string;
}

/** Conversational orchestration continuity state stored in the ledger document. */
export interface OrchestrationState {
  version: number;
  sessionId: string;
  activeRun?: OrchestrationActiveRunState;
  lastRunOutcome?: OrchestrationRunOutcomeState;
  recentOutcomes?: OrchestrationRunOutcomeState[];
  updatedAt: string;
}

/** Canonical whole-document ledger persisted in `.scrimble/ledger.json`. */
export interface LedgerDocument {
  version: number;
  updatedAt: string;
  tasks: TasksState;
  runtime: RuntimeState;
  workers: WorkersState;
  intent: IntentState;
  approval: LedgerApprovalState;
  orchestration: OrchestrationState;
}

// --- Ledger Events ---

/** Event types for the append-only event log. */
export type LedgerEventType =
  // Task lifecycle
  | 'task_created'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'task_blocked'
  | 'task_retried'
  // Verification
  | 'verification_started'
  | 'verification_passed'
  | 'verification_failed'
  // Worker lifecycle
  | 'worker_available'
  | 'worker_unavailable'
  | 'worker_stalled'
  | 'worker_heartbeat'
  // Supervisor
  | 'run_started'
  | 'run_paused'
  | 'run_resumed'
  | 'run_completed'
  | 'run_failed';

/** An event in the ledger event log. */
export interface LedgerEvent {
  /** Unique event identifier. */
  id: string;
  /** Event type. */
  type: LedgerEventType;
  /** Event timestamp. */
  timestamp: string;
  /** Event-specific data. */
  data: Record<string, unknown>;
}

// --- Utility Types ---

/** Summary of ledger state for status display. */
export interface LedgerSummary {
  /** Total tasks. */
  totalTasks: number;
  /** Tasks by status. */
  tasksByStatus: Record<TaskStatus, number>;
  /** Current active execution task, if any. */
  activeExecutionTaskId?: string;
  /** Available workers. */
  availableWorkers: WorkerKind[];
  /** Blocked tasks. */
  blockedTasks: string[];
  /** Failed tasks. */
  failedTasks: string[];
  /** Tasks ready to execute. */
  readyTasks: string[];
}

/** Options for querying tasks. */
export interface TaskQuery {
  /** Filter by status. */
  status?: TaskStatus | TaskStatus[];
  /** Filter by preferred worker. */
  worker?: WorkerKind;
  /** Only tasks with no unmet dependencies. */
  ready?: boolean;
  /** Limit results. */
  limit?: number;
}

