import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, Hexagon, TriangleAlert } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { dbService } from '../lib/db';
import { cn } from '../lib/utils';
import type {
  ArchitectureReviewResponse,
  GenerationPreparationState,
  GenerationBatchName,
  PreferredIde,
  Project,
  ProjectGenerationEvent,
  ProjectGenerationThinking,
  ProjectGenerationStatusResponse,
} from '../types';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const generationBatches: Array<{
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

const reviewIdeOptions: Array<{ id: PreferredIde; label: string; hint: string }> = [
  { id: 'cursor', label: 'Cursor', hint: 'Workspace-ready MCP JSONC for Cursor.' },
  { id: 'windsurf', label: 'Windsurf', hint: 'Rules and MCP instructions tuned for Windsurf.' },
  { id: 'vscode', label: 'VS Code / Copilot', hint: 'Best fit for GitHub Copilot and VS Code MCP.' },
  { id: 'claude_desktop', label: 'Claude Desktop', hint: 'Use when you want Claude Desktop MCP wiring.' },
];

type ActivityFeedItem = {
  key: string;
  kind: 'activity' | 'thinking';
  icon: string;
  message: string;
  timestamp: string;
};

function normalizeFeedMessage(message: string) {
  return message.replace(/\s+/g, ' ').trim();
}

function formatFeedMessage(entry: ActivityFeedItem, options?: { prefixThinking?: boolean }) {
  if (entry.kind === 'thinking') {
    return `${options?.prefixThinking === false ? '' : 'Thinking: '}${entry.message}`;
  }

  return entry.message;
}

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
      return 'Review approved — queuing the next planning batch...';
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
  const location = useLocation();
  const navigate = useNavigate();
  const initialPreparationState =
    ((location.state as { preparation?: GenerationPreparationState } | null)?.preparation as
      | GenerationPreparationState
      | undefined) || null;
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<ProjectGenerationStatusResponse | null>(null);
  const [activeBatch, setActiveBatch] = useState<GenerationBatchName | null>(null);
  const [streamEvents, setStreamEvents] = useState<ProjectGenerationEvent[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityFeedItem[]>([]);
  const [currentActivity, setCurrentActivity] = useState<ActivityFeedItem | null>(null);
  const [reviewData, setReviewData] = useState<ArchitectureReviewResponse | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [preferredIde, setPreferredIde] = useState<PreferredIde>('cursor');
  const [error, setError] = useState('');
  const [isResuming, setIsResuming] = useState(false);
  const [showResumeBadge, setShowResumeBadge] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [hasEditedReview, setHasEditedReview] = useState(false);
  const [hasEditedPreferredIde, setHasEditedPreferredIde] = useState(false);
  const [hasPreparationCompleted, setHasPreparationCompleted] = useState(!initialPreparationState);
  const [generationPreparation] = useState<GenerationPreparationState | null>(initialPreparationState);
  const [streamConnectionKey, setStreamConnectionKey] = useState(0);
  const hasNavigatedRef = useRef(false);
  const activityKeysRef = useRef(new Set<string>());
  const currentActivityRef = useRef<ActivityFeedItem | null>(null);
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

  const pushActivityToHistory = useCallback((entry: ActivityFeedItem | null) => {
    if (!entry) {
      return;
    }

    const normalizedMessage = normalizeFeedMessage(entry.message);
    if (!normalizedMessage) {
      return;
    }

    setActivityFeed((previous) => [...previous, { ...entry, message: normalizedMessage }].slice(-120));
  }, []);

  const replaceCurrentActivity = useCallback((nextEntry: ActivityFeedItem | null) => {
    const previousEntry = currentActivityRef.current;
    if (previousEntry && previousEntry.key !== nextEntry?.key) {
      pushActivityToHistory(previousEntry);
    }

    currentActivityRef.current = nextEntry;
    setCurrentActivity(nextEntry);
  }, [pushActivityToHistory]);

  const appendThinkingActivity = useCallback((delta: string, timestamp: string) => {
    const normalizedDelta = normalizeFeedMessage(delta);
    if (!normalizedDelta) {
      return;
    }

    const previousEntry = currentActivityRef.current;
    if (previousEntry?.kind === 'thinking') {
      const updatedEntry = {
        ...previousEntry,
        message: normalizeFeedMessage(`${previousEntry.message}${delta}`),
        timestamp,
      };
      currentActivityRef.current = updatedEntry;
      setCurrentActivity(updatedEntry);
      return;
    }

    if (previousEntry) {
      pushActivityToHistory(previousEntry);
    }

    const nextEntry: ActivityFeedItem = {
      key: `thinking-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'thinking',
      icon: '✦',
      message: normalizedDelta,
      timestamp,
    };

    currentActivityRef.current = nextEntry;
    setCurrentActivity(nextEntry);
  }, [pushActivityToHistory]);

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
      setError(err instanceof Error ? err.message : 'Failed to load your review.');
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

    if (projectData.generation_status === 'intake') {
      navigate(`/new?intake=${id}`, { replace: true });
      return;
    }

    setProject(projectData);
    setStatus(statusData);

    setShowResumeBadge(statusData.can_resume && (statusData.execution_stale || statusData.is_failed));

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


  const needsPreparationNudge = Boolean(
    generationPreparation &&
      (!generationPreparation.has_brave_search ||
        !generationPreparation.has_github_token ||
        !generationPreparation.has_context7),
  );

  useEffect(() => {
    if (!generationPreparation) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => {
        setHasPreparationCompleted(true);
      },
      needsPreparationNudge ? 2500 : 0,
    );

    return () => window.clearTimeout(timeoutId);
  }, [generationPreparation, needsPreparationNudge]);

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
    if (!id || !hasPreparationCompleted) {
      return;
    }

    const controller = new AbortController();

    void dbService
      .streamProjectGeneration(id, {
        signal: controller.signal,
        onBatchStart: (event) => {
          replaceCurrentActivity(null);
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
          replaceCurrentActivity({
            ...event,
            key,
            kind: 'activity' as const,
            message: normalizeFeedMessage(event.message),
          });
        },
        onThinking: (event: ProjectGenerationThinking) => {
          appendThinkingActivity(event.content, event.timestamp);
        },
        onBatchCompleted: (event) => {
          setStreamEvents((previous) => {
            const next = previous.filter((item) => item.batch !== event.batch);
            next.push(event);
            return next;
          });
        },
        onCheckpoint: () => {
          replaceCurrentActivity(null);
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
          replaceCurrentActivity(null);
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
          replaceCurrentActivity(null);
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
  }, [
    appendThinkingActivity,
    hasPreparationCompleted,
    id,
    loadReviewData,
    replaceCurrentActivity,
    scheduleProjectNavigation,
    streamConnectionKey,
    syncProjectState,
  ]);

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



  const liveActivity = currentActivity ?? {
    key: `live-placeholder-${status?.generation_status ?? currentBatch.id}`,
    kind: 'activity' as const,
    icon: '•',
    message: getPlaceholderMessage(status, currentBatch.id),
    timestamp: project?.generation_started_at ?? new Date(0).toISOString(),
  };

  const showReviewPanel = Boolean(status?.is_review_required && !status?.is_complete && !status?.is_failed);
  const showPreparationScreen = Boolean(generationPreparation && !hasPreparationCompleted);
  const preparationBadges = useMemo(() => {
    if (!generationPreparation) {
      return [];
    }

    return [
      {
        key: 'web-search',
        label: generationPreparation.has_brave_search ? 'Web search' : 'Web search — not connected',
        active: generationPreparation.has_brave_search,
      },
      {
        key: 'github',
        label: generationPreparation.has_github_token ? 'GitHub — authenticated' : 'GitHub — public only',
        active: true,
      },
      {
        key: 'live-docs',
        label: generationPreparation.has_context7
          ? 'Live docs via Context7'
          : 'Live docs — not connected',
        active: generationPreparation.has_context7,
      },
    ];
  }, [generationPreparation]);
  const researchBadges = useMemo(() => {
    if (!reviewData) {
      return [];
    }

    const communityUsed = reviewData.research_sources.some((source) =>
      ['Brave Search', 'Web search'].includes(source.tool),
    );
    const githubUsed = reviewData.research_sources.some((source) => source.tool === 'GitHub');
    const liveDocsUsed = reviewData.research_sources.some((source) =>
      ['Context7', 'Live docs', 'Docs', 'Web fetch'].includes(source.tool),
    );

    return [
      {
        key: 'web-search',
        label: 'Web search',
        active: communityUsed,
      },
      {
        key: 'github',
        label: reviewData.data_quality.has_github_token || githubUsed ? 'GitHub' : 'GitHub — not connected',
        active: reviewData.data_quality.has_github_token || githubUsed,
      },
      {
        key: 'live-docs',
        label: reviewData.data_quality.has_context7 || liveDocsUsed ? 'Live docs' : 'Live docs — not connected',
        active: reviewData.data_quality.has_context7 || liveDocsUsed,
      },
      {
        key: 'brave-search',
        label: reviewData.data_quality.has_brave_search ? 'Brave Search' : 'Brave Search — not connected',
        active: reviewData.data_quality.has_brave_search,
      },
    ];
  }, [reviewData]);
  const connectedResearchToolCount = useMemo(() => {
    if (!reviewData) {
      return 0;
    }

    return [
      reviewData.data_quality.has_brave_search,
      reviewData.data_quality.has_github_token,
      reviewData.data_quality.has_context7,
    ].filter(Boolean).length;
  }, [reviewData]);

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
      setError(err instanceof Error ? err.message : 'Failed to approve your review.');
    } finally {
      setIsSubmittingReview(false);
    }
  }, [id, preferredIde, reviewFeedback, syncProjectState]);

  const handleResume = useCallback(async () => {
    if (!id || isResuming) {
      return;
    }

    setIsResuming(true);
    setError('');

    try {
      await dbService.resumeProjectGeneration(id);
      toast.success('Resuming generation pipeline...');
      setShowResumeBadge(false);
      setStreamConnectionKey((prev) => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume project generation.');
    } finally {
      setIsResuming(false);
    }
  }, [id, isResuming]);

  const [isNudging, setIsNudging] = useState(false);
  const handleNudge = useCallback(async () => {
    if (!id || isNudging) {
      return;
    }

    setIsNudging(true);

    try {
      const result = await dbService.nudgeProjectGeneration(id);
      toast.success(result.message || 'Nudged! If the pipeline is working, it will continue shortly.');
      setStreamConnectionKey((prev) => prev + 1);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to nudge.';
      if (errMsg.includes('still active')) {
        toast.info('Pipeline is actively working — no need to nudge!');
      } else {
        toast.error(errMsg);
      }
    } finally {
      setIsNudging(false);
    }
  }, [id, isNudging]);

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
          className="mb-8 text-accent-primary"
        >
          <Hexagon className="h-10 w-10" />
        </motion.div>

        <AnimatePresence mode="wait">
          {showPreparationScreen ? (
            <motion.div
              key="preparation-panel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
              className="w-full max-w-[720px]"
            >
              <div className="mx-auto max-w-[620px] rounded-[18px] border border-border-default/80 bg-bg-surface/78 px-6 py-7 text-left shadow-panel backdrop-blur-sm">
                <div className="font-serif text-[24px] tracking-[-0.02em] text-text-primary">
                  Getting ready to research
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  {preparationBadges.map((badge) => (
                    <span
                      key={badge.key}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1 font-sans text-[12px]',
                        badge.active
                          ? 'border border-[rgba(52,211,153,0.2)] bg-[rgba(52,211,153,0.1)] text-status-secure'
                          : 'border border-[rgba(204,197,185,0.1)] bg-[rgba(204,197,185,0.05)] text-text-muted',
                      )}
                    >
                      <span aria-hidden="true">{badge.active ? '✓' : '✗'}</span>
                      <span>{badge.label}</span>
                    </span>
                  ))}
                </div>
                {needsPreparationNudge ? (
                  <a
                    href="/settings#mcp-servers"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-5 inline-flex items-center gap-2 font-sans text-[13px] text-text-secondary transition-colors hover:text-text-primary"
                  >
                    <span>
                      Your plan will still be great. Connect more tools in Settings to go deeper next time.
                    </span>
                    <ExternalLink className="h-4 w-4 text-accent-primary" />
                  </a>
                ) : null}
              </div>
            </motion.div>
          ) : showReviewPanel ? (
            <motion.div
              key="review-panel"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
              className="w-full max-w-[720px] text-left"
            >
              <div className="mb-8">
                <div className="section-label">Your review</div>
                <h1 className="mt-4 font-serif text-[32px] leading-[1.02] tracking-[-0.03em] text-text-primary">
                  Before I build the rest, does this look right?
                </h1>
                <p className="mt-3 max-w-[560px] font-sans text-[15px] leading-7 text-text-secondary">
                  I&apos;ve drafted the setup. Change anything you want before the full plan is written out.
                </p>
              </div>

              {error ? (
                <div className="mb-5 flex items-center gap-2 rounded-[14px] border border-status-warning/30 bg-status-warning/10 px-3 py-3 text-[13px] text-status-warning">
                  <TriangleAlert className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              <div className="space-y-5">
                <section className="surface-panel rounded-[16px] p-5">
                  <div className="mb-4">
                    <h2 className="font-serif text-[22px] tracking-[-0.02em] text-text-primary">Research depth</h2>
                    <p className="mt-1 font-sans text-[13px] text-text-tertiary">
                      A quick look at how much live research informed this planning pass.
                    </p>
                  </div>

                  {reviewData ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-sans text-[13px] text-text-secondary">Research used:</span>
                        {researchBadges.map((badge) => (
                          <span
                            key={badge.key}
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1 font-sans text-[12px]',
                                badge.active
                                ? 'border border-[rgba(52,211,153,0.2)] bg-[rgba(52,211,153,0.1)] text-status-secure'
                                : 'border border-[rgba(204,197,185,0.1)] bg-[rgba(204,197,185,0.05)] text-text-muted',
                              )}
                          >
                            <span aria-hidden="true">{badge.active ? '✓' : '✗'}</span>
                            <span>{badge.label}</span>
                          </span>
                        ))}
                      </div>

                      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
                        Researched {reviewData.data_quality.technologies_researched} technologies across {reviewData.data_quality.urls_fetched} sources
                      </div>

                      {reviewData.data_quality.partial_failures.length > 0 ? (
                        <div className="rounded-[14px] border border-status-warning/20 bg-status-warning/8 px-4 py-3 font-sans text-[13px] text-status-warning">
                          <div className="font-medium">
                            Some research sources were partially degraded during this run.
                          </div>
                          <div className="mt-1 text-[12px] text-text-secondary">
                            Impacted tools: {reviewData.data_quality.degraded_tools.join(', ')}
                          </div>
                          <ul className="mt-2 space-y-1 text-[12px] text-text-secondary">
                            {reviewData.data_quality.partial_failures.slice(0, 3).map((failure, index) => (
                              <li key={`${failure.tool}-${failure.technology || 'global'}-${index}`}>
                                {failure.tool}
                                {failure.technology ? ` (${failure.technology})` : ''}: {failure.message}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {connectedResearchToolCount < 2 ? (
                        <div className="rounded-[14px] border border-status-warning/20 bg-status-warning/8 px-4 py-3 font-sans text-[13px] text-status-warning">
                          Connect more research tools in{' '}
                          <a href="/settings#mcp-servers" className="underline underline-offset-4">
                            Settings
                          </a>{' '}
                          for deeper analysis next time.
                        </div>
                      ) : null}

                      <details className="rounded-[14px] border border-border-default/70 bg-bg-base/76 px-4 py-3">
                        <summary className="cursor-pointer list-none font-sans text-[14px] font-medium text-text-primary">
                          What I read
                        </summary>
                        <div className="mt-4 space-y-3">
                          {reviewData.research_sources.map((source) => (
                            <div key={`${source.tool}-${source.url}`} className="rounded-[14px] border border-border-default/60 bg-bg-surface/72 px-3 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
                                  {source.tool}
                                </span>
                                {source.technology ? (
                                  <span className="font-sans text-[12px] text-text-tertiary">{source.technology}</span>
                                ) : null}
                              </div>
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 block font-sans text-[13px] font-medium text-text-primary underline-offset-4 hover:underline"
                              >
                                {source.title || source.url}
                              </a>
                              {source.summary ? (
                                <p className="mt-2 font-sans text-[13px] leading-6 text-text-secondary">{source.summary}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  ) : (
                    <div className="rounded-[14px] border border-border-default/70 bg-bg-base/70 px-4 py-5 font-sans text-[14px] text-text-secondary">
                      Loading the research depth summary...
                    </div>
                  )}
                </section>

                <section className="surface-panel rounded-[16px] p-5">
                  <div className="mb-4">
                    <h2 className="font-serif text-[22px] tracking-[-0.02em] text-text-primary">Your stack</h2>
                    <p className="mt-1 font-sans text-[13px] text-text-tertiary">
                      The recommended packages and services this plan will be built around.
                    </p>
                  </div>

                  {isReviewLoading && !reviewData ? (
                    <div className="rounded-[14px] border border-border-default/70 bg-bg-base/70 px-4 py-5 font-sans text-[14px] text-text-secondary">
                      Loading your review...
                    </div>
                  ) : (
                    reviewData && reviewData.stack_cards.length > 0 ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        {reviewData.stack_cards.map((card) => (
                          <div
                            key={`${card.technology}-${card.package_name}-${card.version}`}
                            className="rounded-[14px] border border-border-default/70 bg-bg-base/76 p-4"
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
                                    <div className="mt-3 flex cursor-help items-center gap-2 rounded-[10px] border border-status-warning/20 bg-status-warning/8 px-3 py-2 text-[12px] text-status-warning">
                                      <span aria-hidden="true">⚠️</span>
                                      <span className="min-w-0 truncate">{card.gotcha_issue}</span>
                                    </div>
                                  </TooltipTrigger>
                                   <TooltipContent className="max-w-[260px] whitespace-normal px-3 py-2 text-[12px] leading-5">
                                     {card.gotcha_mitigation}
                                   </TooltipContent>
                                 </Tooltip>
                               </TooltipProvider>
                             ) : null}
                           </div>
                         ))}
                       </div>
                     ) : (
                      <div className="rounded-[14px] border border-border-default/70 bg-bg-base/70 px-4 py-5 font-sans text-[14px] text-text-secondary">
                        The setup is ready, but the stack summary isn&apos;t loaded yet.
                      </div>
                    )
                  )}
                </section>

                <section className="surface-panel rounded-[16px] p-5">
                  <div className="mb-4">
                    <h2 className="font-serif text-[22px] tracking-[-0.02em] text-text-primary">How it&apos;s built</h2>
                    <p className="mt-1 font-sans text-[13px] text-text-tertiary">
                      A quick sanity check of the core data model before the plan is expanded.
                    </p>
                  </div>

                  {reviewData && reviewData.data_model.length > 0 ? (
                    <div className="grid gap-3">
                      {reviewData.data_model.map((table) => (
                        <div
                          key={table.table}
                          className="rounded-[14px] border border-border-default/70 bg-bg-base/76 px-4 py-3"
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

                <section className="surface-panel rounded-[16px] p-5">
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
                    className="min-h-[124px] w-full resize-y rounded-[14px] border border-border-default bg-bg-base/82 px-4 py-3 font-sans text-[14px] leading-6 text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent-primary/70 focus:ring-2 focus:ring-accent-primary/20"
                  />
                </section>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                <button
                  type="button"
                  onClick={() => feedbackRef.current?.focus()}
                  className="btn-ghost"
                >
                  Let me adjust
                </button>
                <button
                  type="button"
                  onClick={() => void handleApproveReview()}
                  disabled={isSubmittingReview || isReviewLoading || !reviewData}
                  className="btn-primary px-5"
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
                <div className="w-full rounded-[16px] border border-status-warning/30 bg-status-warning/10 p-6 text-left shadow-panel backdrop-blur-sm">
                  <div className="flex items-start gap-3">
                    <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-status-warning" />
                    <div>
                      <div className="font-serif text-[24px] tracking-[-0.02em] text-text-primary">The plan builder hit a snag</div>
                      <p className="mt-2 font-sans text-[14px] leading-6 text-text-secondary">
                        {error || status.generation_error || 'Project generation failed.'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void handleResume();
                    }}

                    className="btn-primary mt-5"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <>
                  <div className="w-full rounded-[16px] border border-border-default/80 bg-bg-surface/72 p-4 text-left shadow-panel backdrop-blur-sm">
                    <div className="border-b border-border-subtle pb-4">
                      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                        Currently working
                      </div>
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                          key={liveActivity.key}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
                          className="flex items-start gap-3"
                        >
                          <motion.span
                            aria-hidden="true"
                            className="mt-[10px] h-[3px] w-[3px] shrink-0 rounded-full bg-accent-primary"
                            animate={{ opacity: [0.45, 1, 0.45], scale: [1, 1.8, 1] }}
                            transition={{ duration: 1.4, ease: 'easeInOut', repeat: Infinity }}
                          />
                          <span
                            title={formatFeedMessage(liveActivity, { prefixThinking: false })}
                            className={cn(
                              'block min-w-0 flex-1 truncate text-[14px] leading-6 text-text-primary',
                              liveActivity.kind === 'thinking' ? 'font-mono' : 'font-sans font-medium tracking-[-0.01em]',
                            )}
                          >
                            {formatFeedMessage(liveActivity, { prefixThinking: false })}
                          </span>
                        </motion.div>
                      </AnimatePresence>
                    </div>

                    <div className="mt-3 flex items-center gap-2 rounded-[8px] bg-bg-base/50 px-3 py-2">
                      <svg className="h-4 w-4 shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-[12px] text-text-muted">
                        This takes 1-5 minutes — AI analysis speed depends on your model and context size
                      </span>
                      <button
                        type="button"
                        onClick={handleNudge}
                        disabled={isNudging}
                        className="ml-auto shrink-0 rounded-[6px] bg-bg-base/80 px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-base hover:text-text-primary disabled:opacity-50"
                      >
                        {isNudging ? 'Nudging...' : 'Nudge'}
                      </button>
                    </div>

                    <div ref={logContainerRef} className="mt-4 max-h-[280px] overflow-y-auto pr-2">
                      {activityFeed.length === 0 ? (
                        <div className="rounded-[12px] border border-border-subtle bg-bg-base/38 px-3 py-3 font-sans text-[13px] text-text-muted">
                          Recent updates will collect here as the plan builder works.
                        </div>
                      ) : (
                        <AnimatePresence initial={false}>
                          {activityFeed.map((entry) => (
                            <motion.div
                              key={entry.key}
                              initial={{ opacity: 0, y: -10 }}
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
                              <span
                                className={cn(
                                  'min-w-0 flex-1 text-[13px] leading-6',
                                  entry.kind === 'thinking'
                                    ? 'font-mono text-text-primary/88'
                                    : 'font-sans text-text-secondary',
                                )}
                              >
                                {formatFeedMessage(entry)}
                              </span>
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      )}
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


                  {error && !showResumeBadge ? (
                    <div className="mt-4 flex items-center gap-2 rounded-[12px] border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[12px] text-status-warning">
                      <TriangleAlert className="h-4 w-4" />
                      <span>{error}</span>
                    </div>
                  ) : null}

                  {showResumeBadge ? (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-6 flex flex-col items-center gap-3 rounded-[16px] border border-border-default/80 bg-bg-surface/60 p-4"
                    >
                      <div className="flex items-center gap-2 font-sans text-[13px] text-text-secondary">
                        <TriangleAlert className="h-4 w-4 text-accent-primary" />
                        <span>{status?.is_failed ? 'Build stopped before finishing.' : 'Build seems stalled.'}</span>
                      </div>
                      <button
                        onClick={handleResume}
                        disabled={isResuming}
                        className="rounded-[10px] bg-accent-primary px-4 py-2 font-sans text-[13px] font-medium text-white transition-all hover:bg-accent-secondary hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isResuming ? 'Resuming...' : 'Resume Build'}
                      </button>
                    </motion.div>
                  ) : null}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </main>
  );
}
