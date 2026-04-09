import type {
  AIModelStrategy,
  ModelAvailabilityStatus,
  ProviderCapabilitySource,
  AIProvider,
  DiscoveryMode,
  DiscoveryStep,
  InteractionMode,
  Intent,
  RepoScanSummary,
} from '@scrimble/shared';
import type { OperatorBoundary } from '../../lib/agent/types.js';

export type TranscriptKind =
  | 'startup'
  | 'user_input'
  | 'agent_summary'
  | 'step_started'
  | 'step_completed'
  | 'approval_needed'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'system'
  | 'error';

export interface TranscriptEntry {
  id: string;
  kind: TranscriptKind;
  message: string;
  details?: string[] | undefined;
}

export type ShellRecoveryState =
  | 'idle'
  | 'resumable'
  | 'pending_approval'
  | 'blocked'
  | 'failed'
  | 'completed'
  | 'inconsistent';

export interface StartupRecoveryAction {
  kind: string;
  label: string;
  description: string;
}

export interface StartupRecentOutcome {
  status: string;
  request: string;
  summary: string;
  completedAt: string;
}

export interface StartupContext {
  repoName: string;
  repoPath: string;
  branch?: string | undefined;
  mode: InteractionMode;
  profileName?: string | undefined;
  provider?: AIProvider | undefined;
  modelStrategy?: AIModelStrategy | undefined;
  model?: string | undefined;
  modelAvailability?: ModelAvailabilityStatus | undefined;
  capabilitySource?: ProviderCapabilitySource | undefined;
  validationFreshness?: 'fresh' | 'stale' | undefined;
  validatedAt?: string | undefined;
  authStatus?: 'ready' | 'missing' | 'invalid' | undefined;
  authSource?: string | undefined;
  profileValid: boolean;
  hasConfig: boolean;
  hasScrimbleDir: boolean;
  activeRunRequest?: string | undefined;
  pendingBoundary?: OperatorBoundary | undefined;
  lastPauseReason?: string | undefined;
  lastOutcomeSummary?: string | undefined;
  lastOutcomeStatus?: string | undefined;
  foundationReady: boolean;
  discoveryMode?: DiscoveryMode | undefined;
  discoveryStep?: DiscoveryStep | undefined;
  discoveryQuestionIndex?: number | undefined;
  discoveryScan?: RepoScanSummary | undefined;
  discoveryDraft?: Intent | undefined;
  activeExecutionTaskId?: string | undefined;
  activeExecutionPhase?: string | undefined;
  activeExecutionStatusMessage?: string | undefined;
  lastCompletedStep?: string | undefined;
  blockedTaskId?: string | undefined;
  blockedTaskReason?: string | undefined;
  failedTaskId?: string | undefined;
  failedTaskReason?: string | undefined;
  recoveryState: ShellRecoveryState;
  recoveryMessage?: string | undefined;
  recoveryActions: StartupRecoveryAction[];
  recentOutcomes: StartupRecentOutcome[];
}
