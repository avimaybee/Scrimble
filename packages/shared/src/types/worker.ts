/**
 * Scrimble Worker Driver Types
 *
 * Provider-neutral abstractions for autonomous code execution workers.
 * Both Gemini CLI and GitHub Copilot CLI implement this interface.
 */

import type { WorkerKind, LedgerTask, RuntimeState, TasksState } from './ledger.js';

// --- Worker Capabilities ---

/** Task types a worker can handle. */
export type TaskType =
  | 'code_generation'
  | 'code_modification'
  | 'code_review'
  | 'test_generation'
  | 'documentation'
  | 'refactoring'
  | 'debugging'
  | 'configuration';

/** Capabilities advertised by a worker driver. */
export interface WorkerCapabilities {
  /** Task types this worker handles well. */
  supportedTaskTypes: TaskType[];
  /** Maximum parallel tasks (usually 1). */
  maxParallelTasks: number;
  /** Whether worker supports checkpointing. */
  supportsCheckpointing: boolean;
  /** Whether worker supports continuation prompts. */
  supportsContinuation: boolean;
  /** Whether worker outputs structured JSON. */
  supportsJsonOutput: boolean;
  /** Model identifier if relevant. */
  model?: string;
}

// --- Context Artifacts ---

/** Types of context artifacts workers can discover. */
export type ContextArtifactKind =
  | 'gemini_md' // GEMINI.md
  | 'agents_md' // AGENTS.md
  | 'conductor_product' // conductor/product.md
  | 'conductor_guidelines' // conductor/product-guidelines.md
  | 'conductor_tech_stack' // conductor/tech-stack.md
  | 'conductor_workflow' // conductor/workflow.md
  | 'conductor_tracks' // conductor/tracks.md
  | 'conductor_spec' // conductor/tracks/<id>/spec.md
  | 'conductor_plan' // conductor/tracks/<id>/plan.md
  | 'copilot_settings' // .github/copilot/settings.json
  | 'copilot_settings_local' // .github/copilot/settings.local.json
  | 'copilot_plan' // Copilot-managed plan files
  | 'readme' // README.md
  | 'package_json' // package.json
  | 'tsconfig' // tsconfig.json
  | 'custom'; // User-specified context file

/** A context artifact discovered in the workspace. */
export interface ContextArtifact {
  /** File path relative to workspace root. */
  path: string;
  /** Artifact kind for routing/prioritization. */
  kind: ContextArtifactKind;
  /** File content (may be truncated for large files). */
  content: string;
  /** Whether content was truncated. */
  truncated: boolean;
  /** Worker this artifact is most relevant for. */
  relevantTo?: WorkerKind;
}

// --- Execution ---

/** Options for starting worker execution. */
export interface ExecutionOptions {
  /** Timeout in milliseconds. */
  timeout: number;
  /** Working directory. */
  cwd: string;
  /** Additional environment variables. */
  env?: Record<string, string>;
  /** Whether to enable checkpointing. */
  checkpointing?: boolean;
  /** Output format preference. */
  outputFormat?: 'json' | 'text' | 'jsonl';
  /** Approval mode for tool usage. */
  approvalMode?: 'yolo' | 'interactive' | 'suggest';
}

/** Handle to a running execution. */
export interface ExecutionHandle {
  /** Unique session ID. */
  sessionId: string;
  /** Worker kind. */
  worker: WorkerKind;
  /** Process ID if available. */
  pid?: number;
  /** When execution started. */
  startedAt: string;
  /** Function to kill the process. */
  kill: () => void;
  /** Function to check if still running. */
  isRunning: () => boolean;
}

/** Result of worker execution. */
export interface ExecutionResult {
  /** Whether execution succeeded. */
  success: boolean;
  /** Process exit code. */
  exitCode: number | null;
  /** Raw stdout. */
  stdout: string;
  /** Raw stderr. */
  stderr: string;
  /** Files touched during execution. */
  touchedFiles: string[];
  /** Parsed output (worker-specific structure). */
  parsedOutput: ParsedOutput | null;
  /** Failure reason if not successful. */
  failureReason?: string;
  /** Whether execution timed out. */
  timedOut: boolean;
  /** Whether execution was killed. */
  killed: boolean;
  /** Duration in milliseconds. */
  durationMs: number;
}

/** Parsed output from worker execution. */
export interface ParsedOutput {
  /** Worker's response text. */
  response?: string;
  /** Token usage statistics. */
  stats?: TokenStats;
  /** Tools used during execution. */
  tools?: ToolUsage[];
  /** Error message from worker. */
  error?: string;
  /** Worker-specific metadata. */
  metadata?: Record<string, unknown>;
}

/** Token usage statistics. */
export interface TokenStats {
  /** Input tokens. */
  tokensIn?: number;
  /** Output tokens. */
  tokensOut?: number;
  /** Total tokens. */
  totalTokens?: number;
  /** Execution duration reported by worker. */
  durationMs?: number;
}

/** Tool usage record. */
export interface ToolUsage {
  /** Tool name. */
  name: string;
  /** Number of times used. */
  count: number;
}

// --- Failure Classification ---

/** Classification of execution failure. */
export type FailureKind =
  | 'timeout' // Execution timed out
  | 'stall' // No output for extended period
  | 'crash' // Process crashed
  | 'auth_error' // Authentication failure
  | 'rate_limit' // Rate limited by provider
  | 'context_overflow' // Context too large
  | 'parse_error' // Failed to parse output
  | 'verification_failed' // Task completed but verification failed
  | 'scope_violation' // Edited files outside owned scope
  | 'unknown'; // Unclassified failure

/** Detailed failure classification. */
export interface FailureClassification {
  /** Type of failure. */
  kind: FailureKind;
  /** Human-readable message. */
  message: string;
  /** Whether failure is retryable. */
  retryable: boolean;
  /** Suggested retry delay in ms. */
  retryDelayMs?: number;
  /** Suggested continuation prompt if retryable. */
  continuationPrompt?: string;
}

// --- Routing ---

/** Decision about which worker should handle a task. */
export interface RoutingDecision {
  /** Selected worker. */
  worker: WorkerKind;
  /** Reason for selection. */
  reason: string;
  /** Confidence score 0-1. */
  confidence: number;
  /** Alternative workers considered. */
  alternatives: WorkerKind[];
}

/** Factors considered in routing. */
export interface RoutingFactors {
  /** Task type affinity. */
  taskTypeAffinity: Record<WorkerKind, number>;
  /** Context artifact relevance. */
  contextRelevance: Record<WorkerKind, number>;
  /** Historical success rate. */
  successRate: Record<WorkerKind, number>;
  /** Manual preference if set. */
  manualPreference?: WorkerKind;
}

// --- Preflight ---

/** Result of worker preflight check. */
export interface WorkerPreflightResult {
  /** Worker kind. */
  worker: WorkerKind;
  /** Whether worker is available. */
  available: boolean;
  /** CLI path if found. */
  cliPath?: string;
  /** CLI version if available. */
  version?: string;
  /** Whether authentication is configured. */
  authConfigured: boolean;
  /** Detected credential source when available. */
  authSource?: string;
  /** Capabilities if available. */
  capabilities?: WorkerCapabilities;
  /** Warnings (non-blocking issues). */
  warnings: string[];
  /** Errors (blocking issues). */
  errors: string[];
}

// --- Ledger State Snapshot ---

/** Snapshot of ledger state for prompt building. */
export interface LedgerState {
  /** Tasks state. */
  tasks: TasksState;
  /** Runtime execution state. */
  runtime: RuntimeState;
}

// --- Worker Driver Interface ---

/**
 * Provider-neutral worker driver interface.
 *
 * Both GeminiDriver and CopilotDriver implement this interface,
 * allowing the scheduler to treat them uniformly.
 */
export interface WorkerDriver {
  /** Worker kind identifier. */
  readonly kind: WorkerKind;

  /** Run preflight checks (CLI available, auth configured, etc.). */
  preflight(): Promise<WorkerPreflightResult>;

  /** Discover context artifacts relevant to this worker. */
  discoverContextArtifacts(): Promise<ContextArtifact[]>;

  /** Build a prompt for task execution. */
  buildPrompt(
    task: LedgerTask,
    context: ContextArtifact[],
    ledgerState: LedgerState,
  ): string;

  /** Start execution with the given prompt. */
  startExecution(
    prompt: string,
    options: ExecutionOptions,
  ): Promise<ExecutionHandle>;

  /** Wait for execution to complete and get result. */
  waitForCompletion(handle: ExecutionHandle): Promise<ExecutionResult>;

  /** Parse raw output into structured format. */
  parseOutput(raw: string): ParsedOutput | null;

  /** Classify a failure for retry decisions. */
  classifyFailure(result: ExecutionResult): FailureClassification;

  /** Continue execution after a stall or partial completion. */
  continueExecution(
    handle: ExecutionHandle,
    continuationPrompt: string,
  ): Promise<ExecutionResult>;

  /** Extract list of files touched from execution result. */
  extractTouchedFiles(result: ExecutionResult): string[];

  /** Get worker capabilities. */
  capabilities(): WorkerCapabilities;
}
