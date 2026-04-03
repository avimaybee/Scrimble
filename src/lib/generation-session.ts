import type {
  GenerationBatchName,
  GenerationFailureClass,
  GenerationLifecycleStatus,
  Project,
  ProjectGenerationEvent,
  ProjectGenerationStatusResponse,
  Step,
} from '../types';

export const GENERATION_BATCHES: Array<{
  id: GenerationBatchName;
  heading: string;
  shortLabel: string;
}> = [
  { id: 'batch_1_research_stack', heading: 'Identifying your stack', shortLabel: 'Stack' },
  { id: 'batch_2_fetch_and_read', heading: 'Reading the docs', shortLabel: 'Docs' },
  { id: 'batch_3_architect', heading: "Planning how it's built", shortLabel: 'Build' },
  { id: 'batch_4_plan_build', heading: 'Building your plan', shortLabel: 'Plan' },
  { id: 'batch_5_enrich_steps', heading: 'Writing step details', shortLabel: 'Steps' },
  { id: 'batch_6_generate_files', heading: 'Preparing your files', shortLabel: 'Files' },
];

const RESUMABLE_FAILURE_CLASSES = new Set<Exclude<GenerationFailureClass, null>>([
  'run_failed',
  'quality_gate',
  'stalled',
  'cancelled',
]);

export function isGenerationBatchName(value: string | null | undefined): value is GenerationBatchName {
  return GENERATION_BATCHES.some((batch) => batch.id === value);
}

export function mergeCompletedGenerationEvents(
  status: ProjectGenerationStatusResponse | null,
  streamEvents: ProjectGenerationEvent[] = [],
): ProjectGenerationEvent[] {
  const eventMap = new Map<GenerationBatchName, ProjectGenerationEvent>();

  for (const event of status?.completed_batches || []) {
    eventMap.set(event.batch, event);
  }

  for (const event of streamEvents) {
    eventMap.set(event.batch, event);
  }

  return GENERATION_BATCHES
    .map((batch) => eventMap.get(batch.id))
    .filter((event): event is ProjectGenerationEvent => Boolean(event));
}

export interface FrontendGenerationSession {
  runtime: ProjectGenerationStatusResponse['generation_runtime'] | null;
  lifecycleStatus: GenerationLifecycleStatus | null;
  currentBatchId: GenerationBatchName;
  currentBatchIndex: number;
  completedEvents: ProjectGenerationEvent[];
  completedBatchCount: number;
  isFailed: boolean;
  isCancelled: boolean;
  isComplete: boolean;
  isReviewRequired: boolean;
  isRunningLifecycle: boolean;
  isTerminal: boolean;
  canResume: boolean;
  isAgentWorking: boolean;
  hasResumableFailure: boolean;
}

export function buildGenerationSessionViewModel(
  status: ProjectGenerationStatusResponse | null,
  options: {
    streamEvents?: ProjectGenerationEvent[];
    preferredBatch?: GenerationBatchName | null;
  } = {},
): FrontendGenerationSession {
  const completedEvents = mergeCompletedGenerationEvents(status, options.streamEvents || []);
  const completedBatchCount = completedEvents.length;
  const runtime = status?.generation_runtime ?? null;
  const lifecycleStatus = runtime?.lifecycleStatus ?? null;
  const isFailed = lifecycleStatus === 'failed';
  const isCancelled = lifecycleStatus === 'cancelled';
  const isComplete = lifecycleStatus === 'complete';
  const isReviewRequired = runtime?.isReviewRequired ?? false;
  const isTerminal = runtime?.isTerminal ?? false;
  const canResume = runtime?.canResume ?? false;
  const runtimeCurrentBatch = isGenerationBatchName(runtime?.currentBatch) ? runtime.currentBatch : null;
  const preferredBatch = isGenerationBatchName(options.preferredBatch) ? options.preferredBatch : null;
  const fallbackBatchIndex = isComplete
    ? GENERATION_BATCHES.length - 1
    : Math.min(completedBatchCount, GENERATION_BATCHES.length - 1);
  const currentBatchId = isComplete
    ? GENERATION_BATCHES[GENERATION_BATCHES.length - 1].id
    : lifecycleStatus === 'approved' && !runtimeCurrentBatch
      ? GENERATION_BATCHES[fallbackBatchIndex].id
      : runtimeCurrentBatch ?? preferredBatch ?? GENERATION_BATCHES[fallbackBatchIndex].id;
  const currentBatchIndex = Math.max(
    0,
    GENERATION_BATCHES.findIndex((batch) => batch.id === currentBatchId),
  );
  const isRunningLifecycle = lifecycleStatus === 'running'
    || lifecycleStatus === 'queued'
    || lifecycleStatus === 'approved';
  const isAgentWorking = (
    !isTerminal
      && lifecycleStatus !== 'intake'
      && !isReviewRequired
  );
  const hasResumableFailure = Boolean(
    canResume
      || isFailed
      || isCancelled
      || (runtime?.failureClass ? RESUMABLE_FAILURE_CLASSES.has(runtime.failureClass) : false),
  );

  return {
    runtime,
    lifecycleStatus,
    currentBatchId,
    currentBatchIndex,
    completedEvents,
    completedBatchCount,
    isFailed,
    isCancelled,
    isComplete,
    isReviewRequired,
    isRunningLifecycle,
    isTerminal,
    canResume,
    isAgentWorking,
    hasResumableFailure,
  };
}

export interface DashboardGenerationAction {
  kind: 'intake' | 'review' | 'resume' | 'working' | 'next';
  priority: number;
  statusLabel: string;
  ctaLabel: string;
  destination: string;
  focusCopy: string;
  badgeClassName: string;
  isAgentWorking: boolean;
}

type DashboardProject = Pick<Project, 'id' | 'generation_runtime'>;
type DashboardStep = Pick<Step, 'status' | 'title'>;

export function getDashboardGenerationAction(
  project: DashboardProject,
  nextStep: DashboardStep | null,
): DashboardGenerationAction {
  const runtime = project.generation_runtime;
  const isAgentWorking = (
    !runtime.isTerminal
      && runtime.lifecycleStatus !== 'intake'
      && !runtime.isReviewRequired
  ) || nextStep?.status === 'agent_working';

  if (runtime.lifecycleStatus === 'intake') {
    return {
      kind: 'intake',
      priority: 1,
      statusLabel: 'Continuing your brief',
      ctaLabel: 'Resume intake',
      destination: `/new?intake=${project.id}`,
      focusCopy: 'Finish the intake conversation.',
      badgeClassName: 'border-[rgba(244,187,102,0.24)] bg-[rgba(244,187,102,0.08)] text-status-warning',
      isAgentWorking: false,
    };
  }

  if (runtime.isReviewRequired || nextStep?.status === 'needs_review') {
    return {
      kind: 'review',
      priority: 0,
      statusLabel: 'Your review',
      ctaLabel: 'Review build',
      destination: `/project/${project.id}/generating`,
      focusCopy: nextStep?.title ?? 'Review the architecture checkpoint.',
      badgeClassName: 'border-[rgba(244,187,102,0.24)] bg-[rgba(244,187,102,0.08)] text-status-warning',
      isAgentWorking: false,
    };
  }

  if (
    runtime.canResume
    || runtime.lifecycleStatus === 'failed'
    || runtime.lifecycleStatus === 'cancelled'
    || (runtime.failureClass ? RESUMABLE_FAILURE_CLASSES.has(runtime.failureClass) : false)
  ) {
    return {
      kind: 'resume',
      priority: 2,
      statusLabel: 'Needs attention',
      ctaLabel: 'Resume build',
      destination: `/project/${project.id}/generating`,
      focusCopy: runtime.lifecycleStatus === 'cancelled'
        ? 'Restart this cancelled run from the latest checkpoint.'
        : 'Reopen the run and continue from the latest checkpoint.',
      badgeClassName: 'border-[rgba(248,113,113,0.22)] bg-[rgba(248,113,113,0.08)] text-status-error',
      isAgentWorking: false,
    };
  }

  if (isAgentWorking) {
    return {
      kind: 'working',
      priority: 3,
      statusLabel: 'Working now',
      ctaLabel: 'Watch progress',
      destination: `/project/${project.id}/generating`,
      focusCopy: nextStep?.title ?? 'Scrimble is still building this plan.',
      badgeClassName: 'border-accent-border/70 bg-accent-primary-muted/25 text-accent-soft',
      isAgentWorking: true,
    };
  }

  return {
    kind: 'next',
    priority: 4,
    statusLabel: 'Next up',
    ctaLabel: 'Open plan',
    destination: `/project/${project.id}`,
    focusCopy: nextStep?.title ?? 'Plan details are ready whenever you are.',
    badgeClassName: 'border-border-default bg-bg-elevated/55 text-text-secondary',
    isAgentWorking: false,
  };
}
