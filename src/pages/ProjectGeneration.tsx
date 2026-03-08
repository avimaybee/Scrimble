import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Hexagon, TriangleAlert } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { dbService } from '../lib/db';
import { cn } from '../lib/utils';
import type {
  ArchitectureReviewResponse,
  GenerationBatchName,
  PreferredIde,
  Project,
  ProjectGenerationActivity,
  ProjectGenerationEvent,
  ProjectGenerationStatusResponse,
} from '../types';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;
const INITIAL_ESTIMATE_SECONDS = 12 * 60;

const generationBatches: Array<{
  id: GenerationBatchName;
  heading: string;
  shortLabel: string;
}> = [
  { id: 'batch_1_research_stack', heading: 'Identifying your stack', shortLabel: 'Stack' },
  { id: 'batch_2_fetch_and_read', heading: 'Reading the docs', shortLabel: 'Docs' },
  { id: 'batch_3_architect', heading: 'Designing your architecture', shortLabel: 'Arch' },
  { id: 'batch_4_plan_build', heading: 'Building your plan', shortLabel: 'Plan' },
  { id: 'batch_5_enrich_steps', heading: 'Writing step details', shortLabel: 'Steps' },
  { id: 'batch_6_generate_files', heading: 'Preparing your files', shortLabel: 'Files' },
];

const reviewIdeOptions: Array<{ id: PreferredIde; label: string; hint: string }> = [
  { id: 'cursor', label: 'Cursor', hint: 'Workspace-ready MCP JSONC for Cursor.' },
  { id: 'windsurf', label: 'Windsurf', hint: 'Rules and MCP instructions tuned for Windsurf.' },
  { id: 'vscode', label: 'VS Code / Copilot', hint: 'Best fit for GitHub Copilot and VS Code MCP.' },
  { id: 'claude_desktop', label: 'Claude Desktop', hint: 'Use when you want Claude Desktop MCP wiring.' },
];

type ActivityFeedItem = ProjectGenerationActivity & {
  key: string;
};

function mergeCompletedEvents(
  status: ProjectGenerationStatusResponse | null,
  streamEvents: ProjectGenerationEvent[],
): ProjectGenerationEvent[] {
  const eventMap = new Map<GenerationBatchName, ProjectGenerationEvent>();

  for (const event of status?.completed_batches || []) {
    eventMap.set(event.batch, event);
  }

  for (const event of streamEvents) {
    eventMap.set(event.batch, event);
  }

  return generationBatches
    .map((batch) => eventMap.get(batch.id))
    .filter((event): event is ProjectGenerationEvent => Boolean(event));
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--:--';
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function formatRemainingTime(totalSeconds: number) {
  const safeSeconds = Math.max(totalSeconds, 0);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function isGenerationBatchName(value: string | null | undefined): value is GenerationBatchName {
  return generationBatches.some((batch) => batch.id === value);
}

function getActivityToneClass(icon: ActivityFeedItem['icon']) {
  switch (icon) {
    case '⚠️':
      return 'text-status-warning';
    case '✅':
      return 'text-status-secure';
    case '📦':
      return 'text-accent-soft';
    case '🏗️':
      return 'text-accent-primary';
    case '📝':
      return 'text-accent-primary';
    default:
      return 'text-text-primary';
  }
}

function getPlaceholderMessage(status: ProjectGenerationStatusResponse | null, currentBatch: GenerationBatchName) {
  switch (status?.generation_status) {
    case 'queued':
      return 'Waiting for the agent to pick up your brief...';
    case 'approved':
      return 'Architecture approved — queuing the next planning batch...';
    case 'batch_4_plan_build':
    case 'batch_5_enrich_steps':
    case 'batch_6_generate_files':
      return `Continuing ${currentBatch.replace(/_/g, ' ')}...`;
    default:
      return 'Connecting to the live activity feed...';
  }
}

export default function ProjectGeneration() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<ProjectGenerationStatusResponse | null>(null);
  const [activeBatch, setActiveBatch] = useState<GenerationBatchName | null>(null);
  const [streamEvents, setStreamEvents] = useState<ProjectGenerationEvent[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityFeedItem[]>([]);
  const [reviewData, setReviewData] = useState<ArchitectureReviewResponse | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [preferredIde, setPreferredIde] = useState<PreferredIde>('cursor');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [hasEditedReview, setHasEditedReview] = useState(false);
  const [hasEditedPreferredIde, setHasEditedPreferredIde] = useState(false);
  const [streamConnectionKey, setStreamConnectionKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const hasNavigatedRef = useRef(false);
  const activityKeysRef = useRef(new Set<string>());
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const feedbackRef = useRef<HTMLTextAreaElement | null>(null);

  const scheduleProjectNavigation = useCallback(() => {
    if (!id || hasNavigatedRef.current) {
      return;
    }

    hasNavigatedRef.current = true;
    toast.success('Your project plan is ready.');
    window.setTimeout(() => navigate(`/project/${id}`, { replace: true }), 1500);
  }, [id, navigate]);

  const loadReviewData = useCallback(async () => {
    if (!id) {
      return;
    }

    setIsReviewLoading(true);

    try {
      const review = await dbService.getArchitectureReview(id);
      setError('');
      setReviewData(review);
      setReviewFeedback((previous) => (hasEditedReview ? previous : review.review_feedback));
      setPreferredIde((previous) => (hasEditedPreferredIde ? previous : review.preferred_ide));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the architecture review.');
    } finally {
      setIsReviewLoading(false);
    }
  }, [hasEditedPreferredIde, hasEditedReview, id]);

  const syncProjectState = useCallback(async () => {
    if (!id) {
      return;
    }

    const [projectData, statusData] = await Promise.all([
      dbService.getProject(id),
      dbService.getProjectGenerationStatus(id),
    ]);

    if (!projectData) {
      throw new Error('Project not found.');
    }

    setProject(projectData);
    setStatus(statusData);

    if (isGenerationBatchName(statusData.generation_status)) {
      setActiveBatch(statusData.generation_status);
    }

    if (statusData.is_review_required && (!reviewData || reviewData.project_id !== id)) {
      void loadReviewData();
    }

    if (statusData.is_failed && statusData.generation_error) {
      setError(statusData.generation_error);
    } else if (!statusData.is_failed) {
      setError('');
    }

    if (statusData.is_complete) {
      scheduleProjectNavigation();
    }
  }, [id, loadReviewData, reviewData, scheduleProjectNavigation]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!id) {
      navigate('/new', { replace: true });
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError('');

    void syncProjectState()
      .catch((err: unknown) => {
        if (!isMounted) {
          return;
        }

        setError(err instanceof Error ? err.message : 'Failed to load generation status.');
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    const intervalId = window.setInterval(() => {
      void syncProjectState().catch((err: unknown) => {
        if (!isMounted) {
          return;
        }

        setError(err instanceof Error ? err.message : 'Failed to refresh generation status.');
      });
    }, 3000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [id, navigate, syncProjectState]);

  useEffect(() => {
    if (!id) {
      return;
    }

    const controller = new AbortController();

    void dbService
      .streamProjectGeneration(id, {
        signal: controller.signal,
        onBatchStart: (event) => {
          setActiveBatch(event.batch);
          setError('');
          setStatus((previous) =>
            previous
              ? {
                  ...previous,
                  generation_status: event.batch,
                  is_failed: false,
                  generation_error: null,
                }
              : previous,
          );
        },
        onActivity: (event) => {
          const key = `${event.timestamp}-${event.icon}-${event.message}`;
          if (activityKeysRef.current.has(key)) {
            return;
          }

          activityKeysRef.current.add(key);
          setActivityFeed((previous) => [...previous, { ...event, key }].slice(-120));
        },
        onBatchCompleted: (event) => {
          setStreamEvents((previous) => {
            const next = previous.filter((item) => item.batch !== event.batch);
            next.push(event);
            return next;
          });
        },
        onCheckpoint: () => {
          setStatus((previous) =>
            previous
              ? {
                  ...previous,
                  generation_status: 'awaiting_review',
                  is_review_required: true,
                  is_approved: false,
                }
              : previous,
          );
          void loadReviewData();
        },
        onComplete: () => {
          setStatus((previous) =>
            previous
              ? {
                  ...previous,
                  generation_status: 'complete',
                  is_complete: true,
                  is_failed: false,
                  generation_error: null,
                }
              : previous,
          );
          void syncProjectState().finally(() => scheduleProjectNavigation());
        },
        onFailed: (message) => {
          setError(message);
          setStatus((previous) =>
            previous
              ? {
                  ...previous,
                  generation_status: 'failed',
                  is_failed: true,
                  generation_error: message,
                }
              : previous,
          );
          void syncProjectState();
        },
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setError(err instanceof Error ? err.message : 'Failed to connect to the generation stream.');
      });

    return () => controller.abort();
  }, [id, loadReviewData, scheduleProjectNavigation, streamConnectionKey, syncProjectState]);

  useEffect(() => {
    const container = logContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [activityFeed]);

  const completedEvents = useMemo(
    () => mergeCompletedEvents(status, streamEvents),
    [status, streamEvents],
  );

  const completedBatchCount = completedEvents.length;
  const fallbackBatchIndex = status?.is_complete
    ? generationBatches.length - 1
    : Math.min(completedBatchCount, generationBatches.length - 1);
  const currentBatchId = status?.is_complete
    ? generationBatches[generationBatches.length - 1].id
    : status?.generation_status === 'approved'
      ? generationBatches[fallbackBatchIndex]?.id ?? generationBatches[0].id
      : activeBatch ?? (isGenerationBatchName(status?.generation_status) ? status.generation_status : null) ?? generationBatches[fallbackBatchIndex]?.id ?? generationBatches[0].id;
  const currentBatchIndex = generationBatches.findIndex((batch) => batch.id === currentBatchId);
  const resolvedCurrentBatchIndex = currentBatchIndex >= 0 ? currentBatchIndex : fallbackBatchIndex;
  const currentBatch = generationBatches[resolvedCurrentBatchIndex] || generationBatches[0];

  const elapsedSeconds = useMemo(() => {
    if (!project?.generation_started_at) {
      return 0;
    }

    const startedAt = Date.parse(project.generation_started_at);
    if (Number.isNaN(startedAt)) {
      return 0;
    }

    return Math.max(Math.floor((now - startedAt) / 1000), 0);
  }, [now, project?.generation_started_at]);

  const estimatedRemainingSeconds = useMemo(() => {
    if (status?.is_complete) {
      return 0;
    }

    if (completedBatchCount === 0) {
      return Math.max(INITIAL_ESTIMATE_SECONDS - elapsedSeconds, 0);
    }

    const reportedDurationSeconds = completedEvents.reduce((total, event) => total + ((event.duration_ms ?? 0) / 1000), 0);
    if (reportedDurationSeconds > 0) {
      const averageBatchSeconds = reportedDurationSeconds / completedBatchCount;
      const estimatedTotalSeconds = Math.max(Math.round(averageBatchSeconds * generationBatches.length), elapsedSeconds);
      return Math.max(estimatedTotalSeconds - elapsedSeconds, 0);
    }

    const completedAtValues = completedEvents
      .map((event) => event.completed_at)
      .filter((value): value is string => Boolean(value))
      .map((value) => Date.parse(value))
      .filter((value) => !Number.isNaN(value));

    const startedAt = project?.generation_started_at ? Date.parse(project.generation_started_at) : Number.NaN;

    if (completedAtValues.length === 0 || Number.isNaN(startedAt)) {
      return Math.max(INITIAL_ESTIMATE_SECONDS - elapsedSeconds, 0);
    }

    const totalCompletedDurationSeconds = Math.max(
      Math.floor((completedAtValues[completedAtValues.length - 1] - startedAt) / 1000),
      1,
    );
    const averageBatchSeconds = totalCompletedDurationSeconds / completedBatchCount;
    const estimatedTotalSeconds = Math.max(Math.round(averageBatchSeconds * generationBatches.length), elapsedSeconds);

    return Math.max(estimatedTotalSeconds - elapsedSeconds, 0);
  }, [completedBatchCount, completedEvents, elapsedSeconds, project?.generation_started_at, status?.is_complete]);

  const visibleFeed = activityFeed.length > 0
    ? activityFeed
    : [
        {
          key: 'placeholder',
          icon: '✦',
          message: getPlaceholderMessage(status, currentBatch.id),
          timestamp: new Date().toISOString(),
        },
      ];

  const showReviewPanel = Boolean(status?.is_review_required && !status?.is_complete && !status?.is_failed);

  const handleApproveReview = useCallback(async () => {
    if (!id) {
      return;
    }

    setError('');
    setIsSubmittingReview(true);

    try {
      await dbService.approveArchitectureReview(id, reviewFeedback, preferredIde);
      setStatus((previous) =>
        previous
          ? {
              ...previous,
              generation_status: 'approved',
              is_review_required: false,
              is_approved: true,
            }
          : previous,
      );
      setActiveBatch('batch_4_plan_build');
      void syncProjectState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve the architecture review.');
    } finally {
      setIsSubmittingReview(false);
    }
  }, [id, preferredIde, reviewFeedback, syncProjectState]);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg-base px-6 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(235,94,40,0.12),transparent_38%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,252,242,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,252,242,0.08) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      <section className="relative z-10 flex w-full max-w-[720px] flex-col items-center text-center">
        <motion.div
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2, ease: 'easeInOut', repeat: Infinity }}
          className="mb-8 flex h-20 w-20 items-center justify-center rounded-[22px] border border-accent-primary/20 bg-accent-primary/8 shadow-[0_0_80px_rgba(235,94,40,0.18)]"
        >
          <Hexagon className="h-10 w-10 text-accent-primary" />
        </motion.div>

        <AnimatePresence mode="wait">
          {showReviewPanel ? (
            <motion.div
              key="review-panel"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
              className="w-full max-w-[720px] text-left"
            >
              <div className="mb-8">
                <h1 className="font-serif text-[32px] leading-[1.02] tracking-[-0.03em] text-text-primary">
                  Here&apos;s what I found
                </h1>
                <p className="mt-3 max-w-[560px] font-sans text-[15px] leading-7 text-text-secondary">
                  Before I build your plan, make sure this looks right. You can adjust anything.
                </p>
              </div>

              {error ? (
                <div className="mb-5 flex items-center gap-2 rounded-[14px] border border-status-warning/30 bg-status-warning/10 px-3 py-3 text-[13px] text-status-warning">
                  <TriangleAlert className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              <div className="space-y-5">
                <section className="rounded-[24px] border border-border-default/80 bg-bg-surface/78 p-5 shadow-panel backdrop-blur-sm">
                  <div className="mb-4">
                    <h2 className="font-serif text-[22px] tracking-[-0.02em] text-text-primary">Your stack</h2>
                    <p className="mt-1 font-sans text-[13px] text-text-tertiary">
                      The recommended packages and services this plan will be built around.
                    </p>
                  </div>

                  {isReviewLoading && !reviewData ? (
                    <div className="rounded-[18px] border border-border-default/70 bg-bg-base/70 px-4 py-5 font-sans text-[14px] text-text-secondary">
                      Loading the architecture review...
                    </div>
                  ) : (
                    reviewData && reviewData.stack_cards.length > 0 ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        {reviewData.stack_cards.map((card) => (
                          <div
                            key={`${card.technology}-${card.package_name}-${card.version}`}
                            className="rounded-[18px] border border-border-default/70 bg-bg-base/76 p-4"
                          >
                            <div className="font-sans text-[15px] font-semibold text-text-primary">{card.technology}</div>
                            <div className="mt-1 font-mono text-[12px] text-text-muted">
                              {card.package_name} @ {card.version}
                            </div>
                            <p className="mt-3 font-sans text-[13px] leading-6 text-text-secondary">{card.reason}</p>

                            {card.gotcha_issue ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="mt-3 flex cursor-help items-center gap-2 rounded-[12px] border border-status-warning/20 bg-status-warning/8 px-3 py-2 text-[12px] text-status-warning">
                                      <span aria-hidden="true">⚠️</span>
                                      <span className="min-w-0 truncate">{card.gotcha_issue}</span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[260px] whitespace-normal bg-text-primary px-3 py-2 text-[12px] leading-5 text-bg-base">
                                    {card.gotcha_mitigation}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[18px] border border-border-default/70 bg-bg-base/70 px-4 py-5 font-sans text-[14px] text-text-secondary">
                        The architecture is ready, but the stack summary hasn&apos;t been materialized yet.
                      </div>
                    )
                  )}
                </section>

                <section className="rounded-[24px] border border-border-default/80 bg-bg-surface/78 p-5 shadow-panel backdrop-blur-sm">
                  <div className="mb-4">
                    <h2 className="font-serif text-[22px] tracking-[-0.02em] text-text-primary">How it&apos;s structured</h2>
                    <p className="mt-1 font-sans text-[13px] text-text-tertiary">
                      A quick sanity check of the core data model before the plan is expanded.
                    </p>
                  </div>

                  {reviewData && reviewData.data_model.length > 0 ? (
                    <div className="grid gap-3">
                      {reviewData.data_model.map((table) => (
                        <div
                          key={table.table}
                          className="rounded-[16px] border border-border-default/70 bg-bg-base/76 px-4 py-3"
                        >
                          <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-text-muted">
                            {table.table}
                          </div>
                          <div className="mt-2 font-sans text-[13px] leading-6 text-text-secondary">
                            {table.columns.join(', ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[16px] border border-border-default/70 bg-bg-base/70 px-4 py-5 font-sans text-[14px] text-text-secondary">
                      Loading the proposed data model...
                    </div>
                  )}
                </section>

                <section className="rounded-[24px] border border-border-default/80 bg-bg-surface/78 p-5 shadow-panel backdrop-blur-sm">
                  <div className="mb-4">
                    <h2 className="font-serif text-[22px] tracking-[-0.02em] text-text-primary">Anything to change?</h2>
                    <p className="mt-1 font-sans text-[13px] text-text-tertiary">
                      I&apos;ll fold any changes you add here directly into the plan builder.
                    </p>
                  </div>

                  <div className="mb-5">
                    <div className="font-sans text-[13px] font-medium text-text-primary">Which IDE should the MCP file target?</div>
                    <p className="mt-1 font-sans text-[12px] text-text-tertiary">
                      I&apos;ll tailor <span className="font-mono">scrimble-mcp.json</span> to the setup you&apos;ll paste into.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {reviewIdeOptions.map((option) => {
                        const isSelected = preferredIde === option.id;

                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => {
                              setHasEditedPreferredIde(true);
                              setPreferredIde(option.id);
                            }}
                            className={cn(
                              'rounded-[14px] border px-4 py-3 text-left transition-all',
                              isSelected
                                ? 'border-accent-primary bg-accent-primary/10 shadow-[0_0_0_1px_rgba(235,94,40,0.18)]'
                                : 'border-border-default bg-bg-base/76 hover:border-accent-primary/35',
                            )}
                          >
                            <div className="font-sans text-[14px] font-medium text-text-primary">{option.label}</div>
                            <div className="mt-1 font-sans text-[12px] leading-5 text-text-tertiary">{option.hint}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <textarea
                    ref={feedbackRef}
                    value={reviewFeedback}
                    onChange={(event) => {
                      setHasEditedReview(true);
                      setReviewFeedback(event.target.value);
                    }}
                    placeholder="e.g. use Drizzle instead of Prisma, add Resend for email, keep it simpler..."
                    className="min-h-[124px] w-full resize-y rounded-[16px] border border-border-default bg-bg-base/82 px-4 py-3 font-sans text-[14px] leading-6 text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent-primary/70 focus:ring-2 focus:ring-accent-primary/20"
                  />
                </section>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                <button
                  type="button"
                  onClick={() => feedbackRef.current?.focus()}
                  className="inline-flex items-center justify-center rounded-[var(--radius-btn)] border border-border-default bg-transparent px-4 py-3 font-sans text-[14px] font-medium text-text-secondary transition-colors hover:border-accent-primary/40 hover:text-text-primary"
                >
                  Let me adjust
                </button>
                <button
                  type="button"
                  onClick={() => void handleApproveReview()}
                  disabled={isSubmittingReview || isReviewLoading || !reviewData}
                  className="inline-flex items-center justify-center rounded-[var(--radius-btn)] bg-accent-primary px-5 py-3 font-sans text-[14px] font-medium text-bg-base transition-all hover:translate-y-[-1px] hover:bg-accent-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmittingReview ? 'Building your plan...' : 'Looks right, build my plan →'}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="activity-feed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
              className="flex w-full max-w-[640px] flex-col items-center text-center"
            >
              <AnimatePresence mode="wait">
                <motion.h1
                  key={currentBatch.id}
                  initial={{ y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -8, opacity: 0 }}
                  transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
                  className="mb-8 text-[clamp(34px,6vw,52px)] font-serif leading-[1.02] tracking-[-0.03em] text-text-primary"
                >
                  {currentBatch.heading}
                </motion.h1>
              </AnimatePresence>

              {status?.is_failed ? (
                <div className="w-full rounded-[22px] border border-status-warning/30 bg-status-warning/10 p-6 text-left shadow-panel backdrop-blur-sm">
                  <div className="flex items-start gap-3">
                    <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-status-warning" />
                    <div>
                      <div className="font-serif text-[24px] tracking-[-0.02em] text-text-primary">The agent hit a snag</div>
                      <p className="mt-2 font-sans text-[14px] leading-6 text-text-secondary">
                        {error || status.generation_error || 'Project generation failed.'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setStreamConnectionKey((previous) => previous + 1);
                      void syncProjectState();
                    }}
                    className="mt-5 inline-flex items-center justify-center rounded-[var(--radius-btn)] bg-accent-primary px-4 py-3 font-sans text-[14px] font-medium text-bg-base transition-all hover:translate-y-[-1px] hover:bg-accent-primary-hover"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <>
                  <div className="w-full rounded-[22px] border border-border-default/80 bg-bg-surface/72 p-4 text-left shadow-panel backdrop-blur-sm">
                    <div ref={logContainerRef} className="max-h-[280px] overflow-y-auto pr-2">
                      <AnimatePresence initial={false}>
                        {visibleFeed.map((entry) => (
                          <motion.div
                            key={entry.key}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
                            className="flex items-start gap-3 py-2"
                          >
                            <span className={cn('mt-[1px] text-base leading-none', getActivityToneClass(entry.icon))} aria-hidden="true">
                              {entry.icon}
                            </span>
                            <span className="w-[68px] shrink-0 pt-[1px] font-mono text-[11px] text-text-muted">
                              {formatTimestamp(entry.timestamp)}
                            </span>
                            <span className="min-w-0 flex-1 font-sans text-[13px] leading-6 text-text-secondary">
                              {entry.message}
                            </span>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>

                  <div className="mt-8 w-full px-1">
                    <div className="relative mx-auto flex w-full items-start justify-between">
                      <div className="absolute left-[8%] right-[8%] top-[11px] h-px bg-border-default" />
                      {generationBatches.map((batch, index) => {
                        const isComplete = index < completedBatchCount || status?.is_complete;
                        const isCurrent = !isComplete && index === resolvedCurrentBatchIndex && !status?.is_failed;

                        return (
                          <div key={batch.id} className="relative z-10 flex flex-1 flex-col items-center gap-3">
                            <div
                              className={cn(
                                'h-[22px] w-[22px] rounded-full border transition-all duration-300',
                                isComplete
                                  ? 'border-status-secure bg-status-secure shadow-[0_0_0_4px_rgba(16,185,129,0.12)]'
                                  : isCurrent
                                    ? 'border-accent-primary bg-accent-primary shadow-[0_0_18px_rgba(235,94,40,0.45)]'
                                    : 'border-border-default bg-bg-base',
                              )}
                            />
                            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                              {batch.shortLabel}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-8 flex flex-col items-center gap-2">
                    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
                      Estimated time remaining
                    </div>
                    <div className="font-serif text-[30px] tracking-[-0.03em] text-text-primary">
                      {formatRemainingTime(estimatedRemainingSeconds)}
                    </div>
                    {isLoading ? (
                      <div className="text-[12px] font-sans text-text-tertiary">Loading the current generation state...</div>
                    ) : null}
                    {error ? (
                      <div className="mt-2 flex items-center gap-2 rounded-[12px] border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[12px] text-status-warning">
                        <TriangleAlert className="h-4 w-4" />
                        <span>{error}</span>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </main>
  );
}
