import type {
  GenerationBatchName,
  GenerationFailureClass,
  GenerationLifecycleStatus,
  GenerationRuntime,
} from '../types';

export type RuntimeCompatiblePayload = {
  generation_runtime?: GenerationRuntime;
};

const GENERATION_BATCHES: GenerationBatchName[] = [
  'batch_1_research_stack',
  'batch_2_fetch_and_read',
  'batch_3_architect',
  'batch_4_plan_build',
  'batch_5_enrich_steps',
  'batch_6_generate_files',
];

const TERMINAL_LIFECYCLE_STATUSES = new Set<GenerationLifecycleStatus>(['complete', 'failed', 'cancelled']);

function isGenerationBatchName(value: string | null | undefined): value is GenerationBatchName {
  return typeof value === 'string' && GENERATION_BATCHES.includes(value as GenerationBatchName);
}

function isGenerationLifecycleStatus(value: string | null | undefined): value is GenerationLifecycleStatus {
  return value === 'intake'
    || value === 'queued'
    || value === 'running'
    || value === 'awaiting_review'
    || value === 'approved'
    || value === 'complete'
    || value === 'failed'
    || value === 'cancelled';
}

function toLifecycleStatusFromLegacyStatus(status: string | null | undefined): GenerationLifecycleStatus {
  if (status === 'intake') {
    return 'intake';
  }

  if (status === 'queued') {
    return 'queued';
  }

  if (isGenerationBatchName(status)) {
    return 'running';
  }

  if (status === 'awaiting_review') {
    return 'awaiting_review';
  }

  if (status === 'approved') {
    return 'approved';
  }

  if (status === 'complete') {
    return 'complete';
  }

  if (status === 'failed') {
    return 'failed';
  }

  if (status === 'cancelled') {
    return 'cancelled';
  }

  return 'complete';
}

function deriveFailureClass(
  lifecycleStatus: GenerationLifecycleStatus,
  canResume: boolean,
): GenerationFailureClass {
  if (lifecycleStatus === 'failed') {
    return 'run_failed';
  }

  if (lifecycleStatus === 'cancelled') {
    return 'cancelled';
  }

  if (lifecycleStatus === 'running' && canResume) {
    return 'stalled';
  }

  return null;
}

export function normalizeGenerationRuntime(payload: RuntimeCompatiblePayload): GenerationRuntime {
  const runtime = payload.generation_runtime;
  if (runtime && isGenerationLifecycleStatus(runtime.lifecycleStatus)) {
    return runtime;
  }

  return {
    runId: null,
    lifecycleStatus: 'intake',
    currentBatch: null,
    isTerminal: false,
    canResume: false,
    isReviewRequired: false,
    providerId: null,
    heartbeatAt: null,
    completedBatches: [],
    failureClass: null,
  };
}

