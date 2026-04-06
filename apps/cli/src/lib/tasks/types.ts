import type { VerificationStatus } from '@scrimble/shared';

export type TaskProviderKind = 'conductor' | 'legacy';
export type UnifiedTaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export interface UnifiedTask {
  id: string;
  title: string;
  status: UnifiedTaskStatus;
  prompt: string;
  provider: TaskProviderKind;
  manualVerification: boolean;
  doneWhen?: string;
  doNotTouch?: string;
  verificationSignals?: string[];
  trackId?: string;
  trackTitle?: string;
}

export interface CompleteTaskOptions {
  force: boolean;
  reason?: string;
  skipVerification: boolean;
  verifyCommands?: string[];
  cloud: boolean;
}

export interface CompleteTaskResult {
  completedTask: UnifiedTask;
  nextTask?: UnifiedTask;
  verificationStatus?: VerificationStatus | null;
  cloudRecorded?: boolean;
  cloudError?: string;
}

export interface SkipTaskResult {
  skippedTask: UnifiedTask;
  nextTask?: UnifiedTask;
}

export interface ActivateNextTaskResult {
  activatedTask?: UnifiedTask;
  alreadyActiveTask?: UnifiedTask;
}

export interface PromptPayload {
  task: UnifiedTask;
  prompt: string;
}

export interface TaskProviderSummary {
  kind: TaskProviderKind;
  statusLabel: string;
  progressLabel?: string;
  activeTask?: UnifiedTask;
  nextTask?: UnifiedTask;
  warnings: string[];
  nextAction: string;
  quickActions: string[];
}

export interface TaskProvider {
  kind: TaskProviderKind;
  getActiveTask(): Promise<UnifiedTask | null>;
  getNextTask(): Promise<UnifiedTask | null>;
  getPromptPayload(): Promise<PromptPayload | null>;
  completeTask(options: CompleteTaskOptions): Promise<CompleteTaskResult | null>;
  skipTask(reason: string): Promise<SkipTaskResult | null>;
  activateNextTask(): Promise<ActivateNextTaskResult>;
  getSummary(): Promise<TaskProviderSummary>;
}
