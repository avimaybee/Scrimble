import type {
  AIModelStrategy,
  AIProfileAuthStrategy,
  AIProvider,
  DiscoveryMode,
  ModelAvailabilityStatus,
  ProviderCapabilitySource,
  TaskStatus,
} from '@scrimble/shared';
import type { OperatorFailureContext, OperatorRunResult } from '../agent/types.js';
import type { FoundationAnswers } from '../discovery/foundation.js';

export type ValidationScenarioName =
  | 'greenfield_build'
  | 'brownfield_feature'
  | 'brownfield_repair'
  | 'provider_no_active_profile'
  | 'provider_stale_capabilities'
  | 'provider_invalid_copilot_auth'
  | 'provider_copilot_env_token'
  | 'provider_explicit_model_unavailable';

export type ValidationFixtureName =
  | 'greenfield_build'
  | 'brownfield_feature'
  | 'brownfield_repair';

export type ValidationFlowKind = 'shell_adjacent' | 'plaintext_oneshot';

export type ValidationFailureCategory =
  | 'weak_foundation_capture'
  | 'low_quality_task_graph'
  | 'bad_ownership_inference'
  | 'missing_verification_inference'
  | 'inappropriate_approval_pause'
  | 'failed_resume_recovery'
  | 'stale_runtime_state'
  | 'repetitive_next_actions'
  | 'stale_provider_capability_data'
  | 'invalid_auth_source_detection'
  | 'unusable_active_profile_not_caught_early'
  | 'misleading_setup_recommendation';

export interface ValidationFailure {
  category: ValidationFailureCategory;
  severity: 'low' | 'medium' | 'high';
  message: string;
  evidence: string[];
}

export interface ValidationOutcomeSummary {
  status: OperatorRunResult['status'];
  summary: string;
  reason?: string;
  nextSuggestedAction?: string;
  recoveryKind?: string;
  recoveryActions: string[];
  lastFailure?: OperatorFailureContext;
}

export interface ValidationTimelineEvent {
  type: string;
  action?: string;
  message: string;
  reason?: string;
}

export interface ValidationBoundaryDecision {
  action: string;
  reason: string;
  decision: 'proceed' | 'pause' | 'redirect';
}

export interface ValidationRecoveryEvent {
  kind: string;
  summary: string;
  source: ValidationFlowKind;
}

export interface ValidationTaskQualitySignals {
  totalTasks: number;
  taskStatusCounts: Record<TaskStatus, number>;
  ownershipCoverage: number;
  verificationCoverage: number;
  lowOwnershipCount: number;
  missingVerificationCount: number;
  planningWarningCount: number;
}

export interface ValidationFoundationSummary {
  status: 'not_started' | 'in_progress' | 'draft_ready' | 'approved' | 'skipped';
  mode?: DiscoveryMode;
  projectName?: string;
  goal?: string;
  targetUsers?: string;
  qualityPreference?: 'prototype' | 'production' | 'enterprise';
  timeline?: 'asap' | 'flexible' | 'long_term';
  successCriteriaCount: number;
  nonGoalsCount: number;
}

export interface ValidationLedgerSnapshot {
  taskCount: number;
  activeExecutionTaskId?: string;
  activeExecutionPhase?: string;
  lastRunStatus?: string;
  lastRunSummary?: string;
  consistencyIssue?: string;
}

export interface ValidationScenarioReport {
  scenario: ValidationScenarioName;
  flow: ValidationFlowKind;
  status: 'passed' | 'failed';
  fixturePath: string;
  foundation: ValidationFoundationSummary;
  qualitySignals: ValidationTaskQualitySignals;
  ledgerSnapshot: ValidationLedgerSnapshot;
  outcomes: ValidationOutcomeSummary[];
  timeline: ValidationTimelineEvent[];
  boundaryDecisions: ValidationBoundaryDecision[];
  recoveryEvents: ValidationRecoveryEvent[];
  provider: ValidationProviderSummary;
  failures: ValidationFailure[];
  warnings: string[];
  nextSuggestedAction?: string;
}

export interface ValidationProviderSummary {
  hasActiveProfile: boolean;
  profileName?: string;
  provider?: AIProvider;
  usableNow: boolean;
  authStatus?: 'ready' | 'missing' | 'invalid';
  authSource?: string;
  capabilitySource?: ProviderCapabilitySource;
  validationFreshness?: 'fresh' | 'stale';
  modelAvailability?: ModelAvailabilityStatus;
}

export interface RankedFailureCategory {
  category: ValidationFailureCategory;
  count: number;
  highestSeverity: 'low' | 'medium' | 'high';
  scenarios: ValidationScenarioName[];
}

export interface ValidationRunReport {
  generatedAt: string;
  reportVersion: 1;
  scenarioReports: ValidationScenarioReport[];
  rankedFailures: RankedFailureCategory[];
}

export interface ValidationScenarioDefinition {
  name: ValidationScenarioName;
  description: string;
  fixtureName: ValidationFixtureName;
  prompt: string;
  envOverrides?: Record<string, string | undefined>;
  providerSetup?: {
    clearProfiles?: boolean;
    provider?: AIProvider;
    authStrategy?: AIProfileAuthStrategy;
    modelStrategy?: AIModelStrategy;
    model?: string;
    seedStaleCapabilities?: boolean;
  };
  discovery: {
    shellMode: DiscoveryMode;
    customBrief?: string;
    interactiveAnswers?: FoundationAnswers;
  };
  shellFlow: {
    pauseAtFirstExecutionBoundary?: boolean;
    injectConsistencyMismatch?: boolean;
  };
  oneShotFlow: {
    autoApproveDiscovery: boolean;
    autoConfirmExecution: boolean;
  };
  expected: {
    foundationStatus: 'approved' | 'skipped';
    minTaskCount: number;
    minOwnershipCoverage: number;
    minVerificationCoverage: number;
    requireResumePath?: boolean;
    requireRecoveryPath?: boolean;
    provider?: {
      requireUsableProfile?: boolean;
      expectedAuthSource?: string;
      requireFreshValidation?: boolean;
      expectEarlyGate?: boolean;
    };
  };
}
