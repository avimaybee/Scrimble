import type { AIProvider, InteractionMode, WorkerKind } from '@scrimble/shared';

export type AgentToolAction =
  | 'inspect_repo'
  | 'check_setup'
  | 'configure_ai'
  | 'generate_or_update_tasks'
  | 'show_plan'
  | 'execute_tasks'
  | 'check_status'
  | 'show_logs'
  | 'doctor';

export interface AgentPlanStep {
  action: AgentToolAction;
  summary: string;
  mutating: boolean;
}

export interface AgentToolCall {
  id: string;
  action: AgentToolAction;
  args: Record<string, unknown>;
  mutating: boolean;
}

export interface AgentPlan {
  id: string;
  request: string;
  goal: string;
  calls: AgentToolCall[];
  steps: AgentPlanStep[];
  previewResults: AgentToolResult[];
  requiresConfirmation: boolean;
  createdAt: string;
}

export interface AgentSetupInput {
  provider?: AIProvider;
  model?: string;
  apiKey?: string;
  interactionMode?: InteractionMode;
}

export interface AgentToolResult {
  action: AgentToolAction;
  summary: string;
  details: string[];
  callId?: string;
  dryRun?: boolean;
  setupRequired?: boolean;
}

export interface AgentExecutionResult {
  summary: string;
  results: AgentToolResult[];
}

export interface ExecutePlanOptions {
  setup?: AgentSetupInput;
  worker?: 'auto' | WorkerKind;
  parallel?: number;
  timeoutMs?: number;
  maxTasks?: number;
  planId?: string;
  onProgress?: (line: string) => void;
}

export type OperatorRunStatus = 'completed' | 'paused' | 'blocked' | 'redirected' | 'failed';

export interface OperatorBoundary {
  id: string;
  action: AgentToolAction;
  actionSummary: string;
  reason: string;
  scope: {
    parallel: number;
    maxTasks: number;
    args: Record<string, unknown>;
  };
  choices: Array<'proceed' | 'pause' | 'redirect'>;
}

export type OperatorBoundaryResolution =
  | { kind: 'proceed' }
  | { kind: 'pause' }
  | { kind: 'redirect'; request: string };

export interface OperatorStep {
  action: AgentToolAction;
  args: Record<string, unknown>;
  actionSummary: string;
  rationale: string;
  requiresConfirmation: boolean;
  expectedOutcome: string;
  pauseCondition: string;
}

export interface OperatorStepResult {
  step: OperatorStep;
  status: 'completed' | 'paused' | 'blocked' | 'redirected' | 'failed';
  result?: AgentToolResult;
  reason?: string;
}

export interface OperatorPauseState {
  reason: string;
  boundary?: OperatorBoundary;
  nextSuggestedAction?: string;
}

export interface OperatorRunOptions {
  setup?: AgentSetupInput;
  interactionMode: InteractionMode;
  autoConfirm?: boolean;
  maxSteps?: number;
  resolveBoundary?: (boundary: OperatorBoundary) => Promise<OperatorBoundaryResolution>;
  onEvent?: (event: OperatorEvent) => void;
}

export interface OperatorEvent {
  type:
    | 'planning'
    | 'resumed'
    | 'step_started'
    | 'step_completed'
    | 'boundary_requested'
    | 'redirected'
    | 'paused'
    | 'blocked'
    | 'completed';
  message: string;
  request: string;
  plan?: AgentPlan;
  action?: AgentToolAction;
  result?: AgentToolResult;
  boundary?: OperatorBoundary;
  summary?: string;
  reason?: string;
}

export interface OperatorRunResult {
  status: OperatorRunStatus;
  summary: string;
  lastRequest: string;
  nextSuggestedAction?: string;
  boundary?: OperatorBoundary;
  reason?: string;
  results: AgentToolResult[];
}
