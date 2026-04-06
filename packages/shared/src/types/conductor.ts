// Conductor and Scrimble runtime types for the Gemini-Conductor pivot.
// Conductor owns planning (conductor/); Scrimble owns runtime (.scrimble/runtime/).

// --- Conductor Track Model ---

/** Status of a Conductor track. */
export type ConductorTrackStatus = 'pending' | 'active' | 'completed' | 'blocked';

/** A Conductor track parsed from conductor/tracks.md and conductor/tracks/<id>/. */
export interface ConductorTrack {
  id: string;
  title: string;
  status: ConductorTrackStatus;
  specPath?: string; // conductor/tracks/<id>/spec.md
  planPath?: string; // conductor/tracks/<id>/plan.md
  metadataPath?: string; // conductor/tracks/<id>/metadata.json
}

/** Status of a task within a Conductor plan. */
export type ConductorTaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

/** A substep within a Conductor task. */
export interface ConductorSubstep {
  text: string;
  completed: boolean;
}

/** A task parsed from conductor/tracks/<id>/plan.md. */
export interface ConductorTask {
  id: string;
  title: string;
  status: ConductorTaskStatus;
  phase?: string; // Parent phase heading
  substeps: ConductorSubstep[];
  isManualVerification: boolean; // Hard checkpoint requiring human intervention
  rawMarkdown: string; // Original markdown block for reference
}

/** A phase (section) within a Conductor plan. */
export interface ConductorPhase {
  id: string;
  title: string;
  tasks: ConductorTask[];
}

/** Parsed Conductor plan from conductor/tracks/<id>/plan.md. */
export interface ConductorPlan {
  trackId: string;
  phases: ConductorPhase[];
  tasks: ConductorTask[]; // Flat list of all tasks for convenience
}

/** Summary of Conductor artifacts in the workspace. */
export interface ConductorWorkspace {
  exists: boolean;
  productPath?: string; // conductor/product.md
  guidelinesPath?: string; // conductor/product-guidelines.md
  techStackPath?: string; // conductor/tech-stack.md
  workflowPath?: string; // conductor/workflow.md
  tracksPath?: string; // conductor/tracks.md
  tracks: ConductorTrack[];
}

// --- Scrimble Runtime Model ---

/** Runtime execution state managed by Scrimble. */
export type RunStatus =
  | 'idle' // No active execution
  | 'bootstrapping' // Setting up Conductor via guided/manual flow
  | 'running' // Actively executing a task
  | 'verifying' // Running verification after task completion
  | 'stuck' // Stalled, awaiting retry or intervention
  | 'paused' // User-paused execution
  | 'failed' // Terminal failure, requires intervention
  | 'completed'; // Track completed successfully

/** An execution attempt for a task. */
export interface TaskAttempt {
  id: string;
  taskId: string;
  trackId: string;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  stalled: boolean;
  promptHash: string;
  outputPath?: string; // Path to captured stdout/stderr
  verificationResult?: 'pass' | 'fail' | 'skipped';
}

/** Current execution state stored in .scrimble/runtime/run-state.json. */
export interface RuntimeState {
  status: RunStatus;
  activeTrackId?: string;
  activeTaskId?: string;
  lastAttemptId?: string;
  attemptCount: number;
  lastActivityAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/** Track approval for autonomous execution in .scrimble/runtime/approvals.json. */
export interface TrackApproval {
  trackId: string;
  approvedAt: string;
  approvedBy?: string; // User identifier
  scope: 'full' | 'current_phase'; // Approval scope
}

/** Approvals state stored in .scrimble/runtime/approvals.json. */
export interface ApprovalsState {
  approvals: TrackApproval[];
}

/** A runtime event stored in .scrimble/runtime/events.ndjson. */
export interface RuntimeEvent {
  id: string;
  type: RuntimeEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export type RuntimeEventType =
  | 'run_started'
  | 'run_completed'
  | 'run_failed'
  | 'run_paused'
  | 'run_resumed'
  | 'task_started'
  | 'task_completed'
  | 'task_skipped'
  | 'task_failed'
  | 'task_stalled'
  | 'task_retried'
  | 'verification_started'
  | 'verification_passed'
  | 'verification_failed'
  | 'track_approved'
  | 'track_completed'
  | 'track_creation_started'
  | 'track_creation_completed'
  | 'manual_checkpoint_reached';

// --- Gemini Preflight Model ---

/** Status of Gemini CLI detection. */
export interface GeminiStatus {
  available: boolean;
  path?: string;
  version?: string;
  error?: string;
}

/** Status of headless authentication. */
export interface HeadlessAuthStatus {
  available: boolean;
  error?: string;
}

/** Status of folder trust configuration. */
export interface FolderTrustStatus {
  enabled: boolean;
  workspaceTrusted: boolean;
  error?: string;
}

/** Status of the Conductor extension. */
export interface ConductorExtensionStatus {
  installed: boolean;
  enabled: boolean;
  version?: string;
  error?: string;
}

/** Complete preflight check result. */
export interface PreflightResult {
  gemini: GeminiStatus;
  headlessAuth: HeadlessAuthStatus;
  folderTrust: FolderTrustStatus;
  conductor: ConductorExtensionStatus;
  canProceed: boolean; // All critical checks passed
  warnings: string[];
  errors: string[];
}
