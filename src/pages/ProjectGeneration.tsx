import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import {
  BookOpenText,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ExternalLink,
  FileDown,
  Github,
  Globe,
  Hexagon,
  LoaderCircle,
  Search,
  Sparkles,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import FullscreenStatus from '../components/ui/FullscreenStatus';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { dbService, type GenerationStreamConnectionState } from '../lib/db';
import {
  getAIModelRoles,
  getAIProviders,
  saveAIModelRoles,
  type AIModelRoles,
  type AIProvider,
} from '../lib/ai';
import { resolveModelRoleDisplay } from '../lib/model-roles';
import {
  buildGenerationSessionViewModel,
  GENERATION_BATCHES,
  isGenerationBatchName,
} from '../lib/generation-session';
import { UI_COPY } from '../lib/ui-copy';
import { cn } from '../lib/utils';
import type {
  ArchitectureReviewResponse,
  GenerationPreparationState,
  GenerationBatchName,
  Project,
  ProjectGenerationEvent,
  ProjectGenerationCheckpointEvent,
  ProjectGenerationInvariantEvent,
  ProjectGenerationThinking,
  ProjectGenerationStatusResponse,
} from '../types';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;
const MAX_VISIBLE_RESEARCH_SOURCES = 5;
const RUNNER_WAITING_LABEL_THRESHOLD_MS = 60_000;
const MANUAL_RUNNER_CHECK_THRESHOLD_MS = 10 * 60_000;
const automaticRecoveryAttempts = new Set<string>();
const ACTIVE_GENERATION_STORAGE_KEY = 'scrimble_active_generation';

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

function toTimestampMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function pickLatestTimestamp(...values: Array<string | null | undefined>) {
  let latest: string | null = null;
  let latestMs = -Infinity;

  for (const value of values) {
    const valueMs = toTimestampMs(value);
    if (valueMs === null || valueMs <= latestMs) {
      continue;
    }

    latest = value;
    latestMs = valueMs;
  }

  return latest;
}

function formatDurationShort(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    return minutes < 10 && seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}

function getConnectionMeta(
  state: GenerationStreamConnectionState,
  isAutoRecovering: boolean,
) {
  if (isAutoRecovering) {
    return {
      label: 'Recovering',
      chipClass: 'border-[rgba(244,187,102,0.24)] bg-[rgba(244,187,102,0.08)] text-status-warning',
      copy: 'Requesting a resume from the latest completed checkpoint.',
    };
  }

  switch (state) {
    case 'live':
      return {
        label: 'Live feed',
        chipClass: 'border-[rgba(52,211,153,0.2)] bg-[rgba(52,211,153,0.1)] text-status-secure',
        copy: 'Streaming runner events as they happen.',
      };
    case 'reconnecting':
      return {
        label: 'Reconnecting',
        chipClass: 'border-border-default bg-bg-elevated/50 text-text-secondary',
        copy: 'Pulling the live runner feed back in now.',
      };
    case 'closed':
      return {
        label: 'Closed',
        chipClass: 'border-border-default bg-bg-elevated/50 text-text-secondary',
        copy: 'The live runner feed is closed.',
      };
    case 'connecting':
    default:
      return {
        label: 'Connecting',
        chipClass: 'border-border-default bg-bg-elevated/50 text-text-secondary',
        copy: 'Connecting to the live activity feed.',
      };
  }
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
  switch (status?.generation_runtime?.lifecycleStatus) {
    case 'intake':
      return 'Waiting for your intake confirmation...';
    case 'queued':
      return 'Waiting for the agent to pick up your brief...';
    case 'approved':
      return 'Review approved — queuing the next planning batch...';
    case 'running':
      return `Continuing ${currentBatch.replace(/_/g, ' ')}...`;
    default:
      return 'Connecting to the live activity feed...';
  }
}

function formatReviewSourceUrl(url: string) {
  try {
    const parsed = new URL(url);
    const compactPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    return `${parsed.hostname.replace(/^www\./, '')}${compactPath}`;
  } catch {
    return url;
  }
}

function getReviewSourceToolMeta(tool: string) {
  const normalized = tool.trim().toLowerCase();

  if (normalized.includes('gitmcp')) {
    return {
      label: 'GitMCP',
      icon: Github,
      toneClass: 'text-status-secure',
    };
  }

  if (normalized === 'github_api' || normalized.includes('github api')) {
    return {
      label: 'GitHub API',
      icon: Github,
      toneClass: 'text-text-primary',
    };
  }

  if (normalized.includes('github')) {
    return {
      label: 'GitHub',
      icon: Github,
      toneClass: 'text-text-primary',
    };
  }

  if (normalized.includes('jina')) {
    return {
      label: normalized === 'jina_search' || normalized.includes('search') ? 'Jina Search' : 'Jina Reader',
      icon: Search,
      toneClass: 'text-status-secure',
    };
  }

  if (
    normalized === 'cf_scrape'
    || normalized.includes('cloudflare scrape')
    || normalized.includes('cf scrape')
    || normalized.includes('scrape')
  ) {
    return {
      label: 'Cloudflare Scrape',
      icon: Globe,
      toneClass: 'text-accent-primary',
    };
  }

  if (normalized.includes('context7')) {
    return {
      label: 'Context7',
      icon: BookOpenText,
      toneClass: 'text-accent-soft',
    };
  }

  if (normalized.includes('brave') || normalized.includes('web search')) {
    return {
      label: normalized.includes('brave') ? 'Brave Search' : 'Web search',
      icon: Search,
      toneClass: 'text-accent-primary',
    };
  }

  return {
    label: 'Fetch',
    icon: Globe,
    toneClass: 'text-text-tertiary',
  };
}

function getResearchRelevanceTone(relevance: string | undefined) {
  switch ((relevance || '').toLowerCase()) {
    case 'high':
      return 'text-status-secure';
    case 'low':
      return 'text-text-muted';
    case 'medium':
    default:
      return 'text-text-tertiary';
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
  const [isPrdExpanded, setIsPrdExpanded] = useState(true);
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [error, setError] = useState('');
  const [isResuming, setIsResuming] = useState(false);
  const [showResumeBadge, setShowResumeBadge] = useState(false);
  const [modelRoleDisplay, setModelRoleDisplay] = useState<{ fast: string; deep: string }>({
    fast: 'default model',
    deep: 'default model',
  });
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [modalRoleType, setModalRoleType] = useState<'fast' | 'deep'>('fast');
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [modelRoles, setModelRoles] = useState<AIModelRoles | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReviewLoading, setIsReviewLoading] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [hasEditedReview, setHasEditedReview] = useState(false);
  const [isResearchDisclosureOpen, setIsResearchDisclosureOpen] = useState(false);
  const [showAllResearchSources, setShowAllResearchSources] = useState(false);
  const [hasPreparationCompleted, setHasPreparationCompleted] = useState(!initialPreparationState);
  const [generationPreparation] = useState<GenerationPreparationState | null>(initialPreparationState);
  const [streamConnectionKey, setStreamConnectionKey] = useState(0);
  const [streamConnectionState, setStreamConnectionState] = useState<GenerationStreamConnectionState>('connecting');
  const [lastProgressAt, setLastProgressAt] = useState<string | null>(null);
  const [isAutoRecovering, setIsAutoRecovering] = useState(false);
  const [autoRecoveryFailed, setAutoRecoveryFailed] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const hasNavigatedRef = useRef(false);
  const activityKeysRef = useRef(new Set<string>());
  const currentActivityRef = useRef<ActivityFeedItem | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const feedbackRef = useRef<HTMLTextAreaElement | null>(null);
  const statusRef = useRef<ProjectGenerationStatusResponse | null>(null);
  const reviewDataRef = useRef<ArchitectureReviewResponse | null>(null);

  const applyStatusUpdate = useCallback((
    updater:
      | ProjectGenerationStatusResponse
      | null
      | ((previous: ProjectGenerationStatusResponse | null) => ProjectGenerationStatusResponse | null),
  ) => {
    setStatus((previous) => {
      const nextStatus =
        typeof updater === 'function'
          ? (updater as (previous: ProjectGenerationStatusResponse | null) => ProjectGenerationStatusResponse | null)(previous)
          : updater;
      statusRef.current = nextStatus;
      return nextStatus;
    });
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    reviewDataRef.current = reviewData;
  }, [reviewData]);

  const noteProgressTimestamp = useCallback((timestamp: string | null | undefined) => {
    setLastProgressAt((previous) => pickLatestTimestamp(previous, timestamp));
  }, []);

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

    const MAX_THINKING_LENGTH = 50_000;

    const previousEntry = currentActivityRef.current;
    if (previousEntry?.kind === 'thinking') {
      let combined = `${previousEntry.message}${delta}`;
      if (combined.length > MAX_THINKING_LENGTH) {
        combined = combined.slice(-MAX_THINKING_LENGTH);
      }
      const updatedEntry = {
        ...previousEntry,
        message: normalizeFeedMessage(combined),
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
      reviewDataRef.current = review;
      setReviewFeedback((previous) => (hasEditedReview ? previous : review.review_feedback));
    } catch (err) {
      setError(err instanceof Error ? err.message : UI_COPY.generation.reviewLoadFailed);
    } finally {
      setIsReviewLoading(false);
    }
  }, [hasEditedReview, id]);

  const syncProjectState = useCallback(async () => {
    if (!id) {
      return;
    }

    const [projectData, statusData] = await Promise.all([
      dbService.getProject(id),
      dbService.getProjectGenerationStatus(id),
    ]);
    const currentStatus = statusRef.current;
    const currentReviewData = reviewDataRef.current;

    if (!projectData) {
      throw new Error('Project not found.');
    }

    if (projectData.generation_runtime?.lifecycleStatus === 'intake') {
      navigate(`/new?intake=${id}`, { replace: true });
      return;
    }

    setProject(projectData);
    applyStatusUpdate(statusData);
    noteProgressTimestamp(statusData.generation_runtime?.heartbeatAt);

    setShowResumeBadge(statusData.generation_runtime?.canResume === true && statusData.execution_stale);

    if (isGenerationBatchName(statusData.generation_runtime?.currentBatch)) {
      setActiveBatch(statusData.generation_runtime.currentBatch);
    }

    if ((statusData.generation_runtime?.isReviewRequired ?? false) && (!currentReviewData || currentReviewData.project_id !== id)) {
      void loadReviewData();
    }

    const isFailed = statusData.generation_runtime?.lifecycleStatus === 'failed';
    if (isFailed && statusData.generation_error) {
      setError(statusData.generation_error);
    } else if (!isFailed) {
      setError('');
    }

    if (statusData.generation_runtime?.lifecycleStatus === 'complete') {
      scheduleProjectNavigation();
    }
  }, [applyStatusUpdate, id, loadReviewData, noteProgressTimestamp, scheduleProjectNavigation]);


  const needsPreparationNudge = Boolean(
    generationPreparation &&
      (!generationPreparation.has_brave_search ||
        !generationPreparation.has_github_token ||
        !generationPreparation.has_context7),
  );

  useEffect(() => {
    let cancelled = false;

    const loadModelData = async () => {
      try {
        const [providersData, rolesData] = await Promise.all([getAIProviders(), getAIModelRoles()]);
        if (cancelled) return;
        setProviders(providersData);
        setModelRoles(rolesData);
        setModelRoleDisplay(resolveModelRoleDisplay(providersData, rolesData));
      } catch (err) {
        if (!cancelled) {
          setModelRoleDisplay({
            fast: 'default model',
            deep: 'default model',
          });
        }
      }
    };

    void loadModelData();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleOpenModelModal = useCallback((type: 'fast' | 'deep') => {
    setModalRoleType(type);
    setIsModelModalOpen(true);
  }, []);

  const handleSelectModel = useCallback(async (providerId: string, modelName: string | null) => {
    if (!modelRoles) return;

    const nextRoles: AIModelRoles = {
      ...modelRoles,
      [modalRoleType === 'fast' ? 'fast_model_provider_id' : 'deep_model_provider_id']: providerId,
      [modalRoleType === 'fast' ? 'fast_model_name' : 'deep_model_name']: modelName,
    };

    try {
      const saved = await saveAIModelRoles(nextRoles);
      setModelRoles(saved);
      setModelRoleDisplay(resolveModelRoleDisplay(providers, saved));
      setIsModelModalOpen(false);
      toast.success(`Switched ${modalRoleType} model to ${modelName || 'default'}. Changes will apply to the next stage.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : UI_COPY.generation.switchModelFailed);
    }
  }, [modalRoleType, modelRoles, providers]);

  useEffect(() => {
    if (status?.generation_runtime?.lifecycleStatus === 'complete') {
      return;
    }

    const intervalId = window.setInterval(() => {
      setClockNow(Date.now());
    }, 1_000);

    return () => window.clearInterval(intervalId);
  }, [status?.generation_runtime?.lifecycleStatus]);

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
    setIsResearchDisclosureOpen(false);
    setShowAllResearchSources(false);
  }, [reviewData?.project_id]);

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

      setError(err instanceof Error ? err.message : UI_COPY.generation.loadFailed);
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    // Only poll when the SSE stream is NOT live — avoids state regression from stale poll data
    const intervalId = window.setInterval(() => {
      if (streamConnectionState === 'live') {
        return;
      }

      void syncProjectState().catch((err: unknown) => {
        if (!isMounted) {
          return;
        }

        setError(err instanceof Error ? err.message : UI_COPY.generation.loadFailed);
      });
    }, 3000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [id, navigate, streamConnectionState, syncProjectState]);

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
          setAutoRecoveryFailed(false);
          noteProgressTimestamp(new Date().toISOString());
          applyStatusUpdate((previous) =>
            previous
              ? {
                  ...previous,
                  generation_runtime: previous.generation_runtime
                    ? {
                      ...previous.generation_runtime,
                      lifecycleStatus: 'running',
                      currentBatch: event.batch,
                      isTerminal: false,
                      isReviewRequired: false,
                      failureClass: null,
                    }
                    : previous.generation_runtime,
                  is_review_required: false,
                  is_approved: false,
                  is_failed: false,
                  generation_error: null,
                }
              : previous,
          );
        },
        onActivity: (event) => {
          noteProgressTimestamp(event.timestamp);
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
          noteProgressTimestamp(event.timestamp);
          appendThinkingActivity(event.content, event.timestamp);
        },
        onBatchCompleted: (event) => {
          noteProgressTimestamp(event.completed_at || new Date().toISOString());
          setStreamEvents((previous) => {
            const next = previous.filter((item) => item.batch !== event.batch);
            next.push(event);
            return next;
          });
        },
        onInvariant: (event: ProjectGenerationInvariantEvent) => {
          noteProgressTimestamp(event.timestamp);
          const key = `${event.timestamp}-invariant-${event.drift_type}`;
          if (activityKeysRef.current.has(key)) {
            return;
          }

          activityKeysRef.current.add(key);
          replaceCurrentActivity({
            key,
            kind: 'activity' as const,
            icon: '⚠️',
            message: `Runner invariant: ${event.message}`,
            timestamp: event.timestamp,
          });
        },
        onCheckpoint: (event: ProjectGenerationCheckpointEvent) => {
          const currentStatus = statusRef.current;
          if (!currentStatus) {
            return;
          }

          const currentRunId = currentStatus?.generation_runtime?.runId || null;
          const isStaleRun = Boolean(event.run_id && currentRunId && event.run_id !== currentRunId);
          const shouldIgnore = isStaleRun;

          if (shouldIgnore) {
            return;
          }

          replaceCurrentActivity(null);
          noteProgressTimestamp(new Date().toISOString());
          applyStatusUpdate((previous) =>
            previous
              ? {
                  ...previous,
                  generation_runtime: previous.generation_runtime
                    ? {
                      ...previous.generation_runtime,
                      lifecycleStatus: 'awaiting_review',
                      currentBatch: null,
                      isTerminal: false,
                      isReviewRequired: true,
                      failureClass: null,
                    }
                    : previous.generation_runtime,
                  is_review_required: true,
                  is_approved: false,
                }
              : previous,
          );
          void loadReviewData();
        },
        onComplete: () => {
          replaceCurrentActivity(null);
          noteProgressTimestamp(new Date().toISOString());
          applyStatusUpdate((previous) =>
            previous
              ? {
                  ...previous,
                  generation_runtime: previous.generation_runtime
                    ? {
                      ...previous.generation_runtime,
                      lifecycleStatus: 'complete',
                      currentBatch: null,
                      isTerminal: true,
                      isReviewRequired: false,
                      failureClass: null,
                    }
                    : previous.generation_runtime,
                  is_complete: true,
                  is_failed: false,
                  generation_error: null,
                }
              : previous,
          );
          try {
            localStorage.removeItem(ACTIVE_GENERATION_STORAGE_KEY);
          } catch {
            // Ignore storage errors.
          }
          void syncProjectState().finally(() => scheduleProjectNavigation());
        },
        onFailed: ({ message, failureClass }) => {
          replaceCurrentActivity(null);
          noteProgressTimestamp(new Date().toISOString());
          const displayMessage = failureClass === 'quality_gate'
            ? `Plan quality gate failed after approval: ${message}`
            : message;
          setError(displayMessage);
          applyStatusUpdate((previous) =>
            previous
              ? {
                  ...previous,
                  generation_runtime: previous.generation_runtime
                    ? {
                      ...previous.generation_runtime,
                      lifecycleStatus: 'failed',
                      currentBatch: null,
                      isTerminal: true,
                      isReviewRequired: false,
                      failureClass: failureClass || 'run_failed',
                    }
                    : previous.generation_runtime,
                  is_failed: true,
                  generation_error: displayMessage,
                }
              : previous,
          );
          try {
            localStorage.removeItem(ACTIVE_GENERATION_STORAGE_KEY);
          } catch {
            // Ignore storage errors.
          }
          void syncProjectState();
        },
        onConnectionStateChange: (nextState) => {
          setStreamConnectionState(nextState);
        },
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setError(err instanceof Error ? err.message : UI_COPY.generation.streamFailed);
      });

    return () => controller.abort();
  }, [
    appendThinkingActivity,
    applyStatusUpdate,
    hasPreparationCompleted,
    id,
    loadReviewData,
    noteProgressTimestamp,
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

  const session = useMemo(
    () => buildGenerationSessionViewModel(status, { streamEvents, preferredBatch: activeBatch }),
    [activeBatch, status, streamEvents],
  );

  const runtime = session.runtime;
  const lifecycleStatus = session.lifecycleStatus;
  const isFailed = session.isFailed;
  const isCancelled = session.isCancelled;
  const isComplete = session.isComplete;
  const isReviewRequired = session.isReviewRequired;
  const completedBatchCount = session.completedBatchCount;
  const resolvedCurrentBatchIndex = session.currentBatchIndex;
  const currentBatch = GENERATION_BATCHES[resolvedCurrentBatchIndex] || GENERATION_BATCHES[0];
  const showReviewPanel = Boolean(isReviewRequired && !isComplete && !isFailed);
  const showPreparationScreen = Boolean(generationPreparation && !hasPreparationCompleted);
  const latestProgressTimestamp = pickLatestTimestamp(
    lastProgressAt,
    status?.generation_runtime?.heartbeatAt,
  );
  const quietDurationMs = latestProgressTimestamp
    ? Math.max(0, clockNow - (toTimestampMs(latestProgressTimestamp) || clockNow))
    : 0;
  const connectionMeta = getConnectionMeta(streamConnectionState, isAutoRecovering);
  const showManualCheckIn =
    quietDurationMs >= MANUAL_RUNNER_CHECK_THRESHOLD_MS &&
    !isFailed &&
    !showReviewPanel &&
    !isComplete &&
    streamConnectionState === 'live' &&
    !showResumeBadge &&
    !isAutoRecovering;
  const showReconnectFeed =
    streamConnectionState !== 'live' &&
    !isFailed &&
    !showReviewPanel &&
    !isComplete &&
    !isAutoRecovering;
  const canCancelGeneration = Boolean(
    status &&
      !isComplete &&
      !isFailed &&
      !isCancelled &&
      lifecycleStatus !== 'intake',
  );
  const autoRecoveryKey = `${id ?? 'unknown'}:${runtime?.runId ?? lifecycleStatus ?? 'pending'}:${completedBatchCount}`;



  const liveActivity = currentActivity;
  const quietDurationLabel = quietDurationMs > 0 ? formatDurationShort(quietDurationMs) : null;
  const stageCounterLabel = isComplete
    ? `${GENERATION_BATCHES.length} of ${GENERATION_BATCHES.length} stages complete`
    : `${completedBatchCount} of ${GENERATION_BATCHES.length} stages complete`;
  const runnerStatusHeadline = showReviewPanel
    ? 'Waiting for your review'
    : isComplete
      ? 'Generation finished'
      : isFailed
        ? 'Runner needs attention'
        : isAutoRecovering
          ? 'Requesting a checkpoint resume'
          : streamConnectionState === 'reconnecting'
            ? 'Reconnecting to live runner events'
            : streamConnectionState === 'connecting'
              ? 'Connecting to live runner events'
              : streamConnectionState === 'closed'
                ? 'Live runner feed paused'
                : liveActivity?.kind === 'thinking'
                  ? 'Receiving model reasoning'
                    : quietDurationMs >= RUNNER_WAITING_LABEL_THRESHOLD_MS
                      ? 'Waiting on the current model or tool call'
                    : `Stage ${Math.min(resolvedCurrentBatchIndex + 1, GENERATION_BATCHES.length)} is actively running`;
  const runnerStatusDetail = showReviewPanel
    ? 'Approve the architecture when it looks right, then Scrimble will continue immediately.'
    : isComplete
      ? 'All generation stages are done and the final project handoff is ready.'
      : quietDurationMs >= RUNNER_WAITING_LABEL_THRESHOLD_MS && streamConnectionState === 'live'
        ? `No fixed ETA while this call is in flight${quietDurationLabel ? ` · last runner signal ${quietDurationLabel} ago` : ''}.`
        : quietDurationLabel
          ? `Last runner signal ${quietDurationLabel} ago.`
          : 'Fresh runner updates will appear here as soon as they are emitted.';

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

    const hasGithubApi = reviewData.data_quality.has_github_token;
    const hasContext7 = reviewData.data_quality.has_context7;
    const hasBraveSearch = reviewData.data_quality.has_brave_search;
    const sourceCount = reviewData.data_quality.urls_fetched || reviewData.research_sources.length;
    const technologyCount = reviewData.data_quality.technologies_researched;

    return [
      {
        key: 'source-depth',
        label: `${sourceCount} sources read across ${technologyCount} technologies`,
        active: true,
      },
      {
        key: 'jina-reader',
        label: 'Jina Reader',
        active: true,
      },
      {
        key: 'gitmcp',
        label: 'GitMCP',
        active: true,
      },
      {
        key: 'github-api',
        label: hasGithubApi ? 'GitHub API' : 'GitHub API — public-only',
        active: hasGithubApi,
      },
      {
        key: 'context7-docs',
        label: hasContext7 ? 'Context7' : 'Context7 — optional',
        active: hasContext7,
      },
      {
        key: 'brave-search',
        label: hasBraveSearch ? 'Brave Search' : 'Brave Search — optional',
        active: hasBraveSearch,
      },
    ];
  }, [reviewData]);
  const researchDepthContextNote = useMemo(() => {
    if (!reviewData) {
      return null;
    }

    const quality = reviewData.data_quality;
    const sourceCount = quality.urls_fetched || reviewData.research_sources.length;

    if (quality.truncated_to_fit_context) {
      return {
        message: 'Truncated to fit model context — consider a larger context model for deeper research.',
        tone: 'warning' as const,
      };
    }

    if (quality.used_full_context_window) {
      return {
        message: `Used full context window — ${sourceCount} sources read.`,
        tone: 'positive' as const,
      };
    }

    return null;
  }, [reviewData]);
  const limitedResearchNotice = useMemo(() => {
    if (!reviewData) {
      return null;
    }

    const sourceCount = reviewData.data_quality.urls_fetched || reviewData.research_sources.length;
    if (sourceCount >= 3) {
      return null;
    }

    return `Research was limited for this plan — some fetches failed. Your plan is based on ${sourceCount} source${sourceCount === 1 ? '' : 's'}. You can regenerate for a deeper result.`;
  }, [reviewData]);
  const visibleResearchSources = useMemo(() => {
    if (!reviewData) {
      return [];
    }

    return showAllResearchSources
      ? reviewData.research_sources
      : reviewData.research_sources.slice(0, MAX_VISIBLE_RESEARCH_SOURCES);
  }, [reviewData, showAllResearchSources]);
  const hasHiddenResearchSources = useMemo(
    () => Boolean(reviewData && reviewData.research_sources.length > MAX_VISIBLE_RESEARCH_SOURCES),
    [reviewData],
  );
  const hasPrdContent = useMemo(
    () => Boolean(reviewData?.prd_document_markdown?.trim()),
    [reviewData],
  );

  const hasStructuredPrdDocument = useMemo(
    () => Boolean(reviewData?.prd_document_markdown?.trim()),
    [reviewData?.prd_document_markdown],
  );

  const handleDownloadPRD = useCallback(() => {
    if (!reviewData?.prd_document_markdown) return;

    const blob = new Blob([reviewData.prd_document_markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reviewData.project_name.toLowerCase().replace(/\s+/g, '_')}_prd.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success('PRD downloaded as Markdown.');
  }, [reviewData]);

  const handleApproveReview = useCallback(async () => {
    if (!id) {
      return;
    }

    setError('');
    setIsSubmittingReview(true);

    try {
      await dbService.approveArchitectureReview(id, reviewFeedback);
      applyStatusUpdate((previous) =>
        previous
          ? {
              ...previous,
              generation_runtime: previous.generation_runtime
                ? {
                  ...previous.generation_runtime,
                  lifecycleStatus: 'approved',
                  currentBatch: null,
                  isTerminal: false,
                  isReviewRequired: false,
                  failureClass: null,
                }
                : previous.generation_runtime,
              is_review_required: false,
              is_approved: true,
            }
          : previous,
      );
      setActiveBatch('batch_4_plan_build');
      void syncProjectState();
    } catch (err) {
      setError(err instanceof Error ? err.message : UI_COPY.generation.approveReviewFailed);
    } finally {
      setIsSubmittingReview(false);
    }
  }, [applyStatusUpdate, id, reviewFeedback, syncProjectState]);

  useEffect(() => {
    if (!id) {
      return;
    }

    const runtimeState = status?.generation_runtime;
    const hasActiveGeneration = Boolean(
      runtimeState
        ? runtimeState.lifecycleStatus !== 'intake' && !runtimeState.isTerminal
        : false,
    );

    try {
      if (hasActiveGeneration) {
        localStorage.setItem(ACTIVE_GENERATION_STORAGE_KEY, id);
      } else {
        const storedProjectId = localStorage.getItem(ACTIVE_GENERATION_STORAGE_KEY);
        if (storedProjectId === id) {
          localStorage.removeItem(ACTIVE_GENERATION_STORAGE_KEY);
        }
      }
    } catch {
      // Ignore storage errors.
    }
  }, [id, status?.generation_runtime]);

  const reconnectLiveFeed = useCallback(() => {
    setError('');
    setStreamConnectionState('connecting');
    setStreamConnectionKey((previous) => previous + 1);
  }, []);

  const requestResume = useCallback(async (mode: 'automatic' | 'manual') => {
    if (!id || isResuming) {
      return;
    }

    setIsResuming(true);
    setError('');
    if (mode === 'automatic') {
      setIsAutoRecovering(true);
      setAutoRecoveryFailed(false);
    }

    try {
      await dbService.resumeProjectGeneration(id);
      setShowResumeBadge(false);
      applyStatusUpdate((previous) =>
        previous
          ? {
            ...previous,
            generation_runtime: previous.generation_runtime
              ? {
                ...previous.generation_runtime,
                lifecycleStatus: 'queued',
                currentBatch: null,
                isTerminal: false,
                canResume: false,
                isReviewRequired: false,
                failureClass: null,
              }
              : previous.generation_runtime,
          }
          : previous,
      );
      noteProgressTimestamp(new Date().toISOString());
      toast.success(
        mode === 'automatic'
          ? 'The runner stayed quiet for too long, so I asked Scrimble to resume from the last completed checkpoint.'
          : 'Resuming generation pipeline...',
      );
      setShowResumeBadge(false);
      setStreamConnectionKey((prev) => prev + 1);
      void syncProjectState();
    } catch (err) {
      const message = err instanceof Error ? err.message : UI_COPY.generation.resumeFailed;
      setError(message);
      if (mode === 'automatic') {
        setAutoRecoveryFailed(true);
      }
    } finally {
      setIsResuming(false);
      if (mode === 'automatic') {
        setIsAutoRecovering(false);
      }
    }
  }, [id, isResuming, noteProgressTimestamp, syncProjectState]);

  const handleResume = useCallback(() => {
    void requestResume('manual');
  }, [requestResume]);

  const [isNudging, setIsNudging] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const isRunningLifecycle = session.isRunningLifecycle;
  const handleCheckIn = useCallback(async () => {
    if (!id || isNudging) {
      return;
    }

    setIsNudging(true);

    try {
      const result = await dbService.nudgeProjectGeneration(id);
      noteProgressTimestamp(result.nudgedAt || new Date().toISOString());
      toast.success(result.message || 'I asked the background runner to check back in.');
      setStreamConnectionKey((prev) => prev + 1);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : UI_COPY.generation.nudgeFailed;
      if (errMsg.includes('still active')) {
        reconnectLiveFeed();
        toast.info('The runner is still active. I refreshed the live feed instead of restarting anything.');
      } else {
        toast.error(errMsg);
      }
    } finally {
      setIsNudging(false);
    }
  }, [id, isNudging, noteProgressTimestamp, reconnectLiveFeed]);

  const handleCancel = useCallback(async () => {
    if (!id || isCancelling) return;
    setIsCancelling(true);
    try {
      const result = await dbService.cancelProjectGeneration(id);
      if (result.success) {
        toast.success('Generation cancelled.');
        applyStatusUpdate((prev) => (prev
          ? {
            ...prev,
            generation_runtime: prev.generation_runtime
              ? {
                ...prev.generation_runtime,
                lifecycleStatus: 'cancelled',
                currentBatch: null,
                isTerminal: true,
                isReviewRequired: false,
                failureClass: 'cancelled',
              }
              : prev.generation_runtime,
            is_failed: true,
          }
          : prev));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : UI_COPY.generation.cancelFailed);
    } finally {
      setIsCancelling(false);
    }
  }, [applyStatusUpdate, id, isCancelling]);

  useEffect(() => {
    if (!showResumeBadge || autoRecoveryFailed || isAutoRecovering || isResuming) {
      return;
    }

    if (automaticRecoveryAttempts.has(autoRecoveryKey)) {
      return;
    }

    automaticRecoveryAttempts.add(autoRecoveryKey);
    void requestResume('automatic');
  }, [autoRecoveryFailed, autoRecoveryKey, isAutoRecovering, isResuming, requestResume, showResumeBadge]);

  if (isLoading && !status) {
    return (
      <FullscreenStatus
        label="Reopening your build"
        title="Pulling the latest progress back in"
        description="Rebuilding the live activity feed and checking where the pipeline left off."
      />
    );
  }

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

      <section className="relative z-10 flex w-full max-w-[960px] flex-col items-center text-center">
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
              className="w-full max-w-[920px] text-left"
            >
              <TooltipProvider>
                <div className="overflow-hidden rounded-[28px] border border-border-default/80 bg-[linear-gradient(180deg,rgba(30,29,27,0.98),rgba(18,17,16,0.98))] shadow-panel backdrop-blur-sm">
                  <div className="relative px-6 py-7 sm:px-8 md:px-10 md:py-10">
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,rgba(235,94,40,0.12),transparent_72%)]" />
                    <div className="relative">
                      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">Your review</div>
                      <h1 className="mt-4 max-w-[720px] font-serif text-[clamp(28px,4vw,40px)] leading-[1.02] tracking-[-0.03em] text-text-primary">
                        Before I build the rest, does this look right?
                      </h1>
                      <p className="mt-4 max-w-[620px] font-sans text-[15px] leading-[1.7] text-text-secondary">
                        I&apos;ve mapped out exactly what we&apos;re building. Read through it, then tell me anything you want changed.
                      </p>

                      {error ? (
                        <div className="mt-6 flex items-center gap-2 rounded-[14px] border border-status-warning/30 bg-status-warning/10 px-3 py-3 text-[13px] text-status-warning">
                          <TriangleAlert className="h-4 w-4 shrink-0" />
                          <span>{error}</span>
                        </div>
                      ) : null}

                      {isReviewLoading && !reviewData ? (
                        <div className="mt-8 rounded-[18px] border border-border-default/70 bg-bg-base/74 px-5 py-6 font-sans text-[14px] text-text-secondary">
                          Loading your project brief...
                        </div>
                      ) : reviewData ? (
                        <div className="mt-8">
                          <div className="border-t border-border-subtle" />

                          <section className="py-7">
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">What we&apos;re building</div>
                            <h2 className="mt-4 font-serif text-[32px] leading-[1.05] tracking-[-0.03em] text-text-primary">
                              {reviewData.project_name}
                            </h2>
                            <p className="mt-4 max-w-[760px] font-sans text-[15px] leading-[1.7] text-text-secondary">
                              {reviewData.project_summary}
                            </p>
                          </section>

                          <div className="border-t border-border-subtle" />

                          {hasPrdContent ? (
                            <section className="py-7">
                              <div className="flex items-center justify-between">
                                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">Product requirements (PRD)</div>
                                <button
                                  type="button"
                                  onClick={handleDownloadPRD}
                                  className="group flex items-center gap-1.5 rounded-full border border-border-default/60 bg-bg-surface/40 px-3 py-1.5 font-sans text-[11px] font-medium text-text-tertiary transition-colors hover:border-accent-border/40 hover:text-accent-soft"
                                >
                                  <FileDown className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5" />
                                  <span>Download .md</span>
                                </button>
                              </div>

                              <div className="mt-5 rounded-[14px] border border-border-subtle/70 bg-bg-base/45">
                                <button
                                  type="button"
                                  onClick={() => setIsPrdExpanded((previous) => !previous)}
                                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                                >
                                  <span className="font-sans text-[13px] font-medium text-text-primary">
                                    {isPrdExpanded ? 'Hide full PRD document' : 'Show full PRD document'}
                                  </span>
                                  {isPrdExpanded ? (
                                    <ChevronUp className="h-4 w-4 text-text-tertiary" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4 text-text-tertiary" />
                                  )}
                                </button>

                                {isPrdExpanded ? (
                                  <div className="border-t border-border-subtle/70 px-4 py-6">
                                    <div className="markdown-content">
                                      <ReactMarkdown>{reviewData.prd_document_markdown}</ReactMarkdown>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </section>
                          ) : null}

                          <div className="border-t border-border-subtle" />

                          <section className="py-7">
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">How it&apos;s put together</div>
                            <div className="mt-5 space-y-4">
                              {reviewData.stack_sections.map((section) => (
                                <div
                                  key={section.id}
                                  className="grid gap-3 border-b border-border-subtle/70 pb-4 last:border-b-0 last:pb-0 md:grid-cols-[132px,1fr]"
                                >
                                  <div className="font-sans text-[13px] font-medium text-text-primary">{section.label}</div>
                                  <div>
                                    {section.chips.length > 0 ? (
                                      <div className="flex flex-wrap gap-2">
                                        {section.chips.map((chip) => (
                                          <span
                                            key={`${section.id}-${chip}`}
                                            className="inline-flex items-center rounded-full border border-accent-border/70 bg-accent-primary/8 px-2.5 py-1 font-mono text-[11px] text-accent-soft"
                                          >
                                            {chip}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="font-mono text-[11px] text-text-muted">—</div>
                                    )}
                                    <p className="mt-2 font-sans text-[13px] leading-6 text-text-tertiary">
                                      {section.description}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </section>

                          <div className="border-t border-border-subtle" />

                          <section className="py-7">
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">How the pieces connect</div>
                            <p className="mt-4 max-w-[760px] font-sans text-[15px] leading-[1.7] text-text-secondary">
                              {reviewData.how_it_connects}
                            </p>
                          </section>

                          <div className="border-t border-border-subtle" />

                          <section className="py-7">
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">Core data</div>
                            <div className="mt-5 space-y-4">
                              {reviewData.data_model.slice(0, 8).map((table) => (
                                <div
                                  key={table.table}
                                  className="rounded-[14px] border border-border-subtle/60 bg-bg-base/40 px-4 py-3"
                                >
                                  <div className="flex items-baseline gap-3">
                                    <div className="font-mono text-[13px] font-medium text-text-primary">
                                      {table.table}
                                    </div>
                                    <div className="font-sans text-[12px] leading-5 text-text-tertiary">
                                      {table.description}
                                    </div>
                                  </div>
                                  {table.columns.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {table.columns.slice(0, 12).map((col) => (
                                        <span
                                          key={`${table.table}-${col}`}
                                          className="inline-flex items-center rounded-[6px] border border-border-subtle/50 bg-bg-surface/50 px-2 py-0.5 font-mono text-[10px] text-text-muted"
                                        >
                                          {col}
                                        </span>
                                      ))}
                                      {table.columns.length > 12 && (
                                        <span className="inline-flex items-center px-1 py-0.5 font-mono text-[10px] text-text-muted">
                                          +{table.columns.length - 12} more
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </section>

                          <div className="border-t border-border-subtle" />

                          <section className="py-7">
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">Things to watch out for</div>
                            {reviewData.gotchas.length > 0 ? (
                              <div className="mt-5 space-y-2">
                                {reviewData.gotchas.slice(0, 6).map((gotcha) => (
                                  <Tooltip key={`${gotcha.technology}-${gotcha.issue}`}>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        className="flex w-full items-center gap-3 overflow-hidden rounded-[12px] border border-status-warning/20 bg-status-warning/8 px-3 py-2.5 text-left font-sans text-[13px] text-status-warning"
                                      >
                                        <span aria-hidden="true" className="shrink-0">⚠</span>
                                        <span className="min-w-0 flex-1 truncate">{gotcha.issue}</span>
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[320px] whitespace-normal px-3 py-2 text-[12px] leading-5">
                                      <div className="font-medium text-text-primary">{gotcha.technology}</div>
                                      <div className="mt-1 text-text-secondary">{gotcha.issue}</div>
                                      <div className="mt-2 text-text-secondary">Mitigation: {gotcha.mitigation}</div>
                                    </TooltipContent>
                                  </Tooltip>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-4 font-sans text-[13px] leading-6 text-text-tertiary">
                                Nothing risky jumped out from the current research pass.
                              </p>
                            )}
                          </section>

                          <div className="border-t border-border-subtle" />

                          <section className="py-7">
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">Research depth</div>
                            <div className="mt-4 flex flex-wrap gap-2">
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

                            <div className="mt-4 font-sans text-[13px] text-text-tertiary">
                              Researched {reviewData.data_quality.technologies_researched} technologies · {reviewData.data_quality.urls_fetched || reviewData.research_sources.length} sources
                            </div>
                            {researchDepthContextNote ? (
                              <div
                                className={cn(
                                  'mt-2 font-sans text-[12px] leading-5',
                                  researchDepthContextNote.tone === 'warning' ? 'text-status-warning' : 'text-status-secure',
                                )}
                              >
                                {researchDepthContextNote.message}
                              </div>
                            ) : null}

                            {limitedResearchNotice ? (
                              <div className="mt-3 rounded-[12px] border border-status-warning/30 bg-status-warning/10 px-3 py-2 font-sans text-[12px] leading-5 text-status-warning">
                                {limitedResearchNotice}
                              </div>
                            ) : null}

                            {reviewData.data_quality.partial_failures.length > 0 ? (
                              <div className="mt-3 font-sans text-[12px] leading-5 text-status-warning">
                                Some sources were partially degraded during this pass: {reviewData.data_quality.degraded_tools.join(', ')}.
                              </div>
                            ) : null}

                            <div className="mt-5 rounded-[16px] border border-border-default/70 bg-bg-base/64 px-4 py-4">
                              <button
                                type="button"
                                onClick={() => {
                                  setIsResearchDisclosureOpen((previous) => !previous);
                                  if (isResearchDisclosureOpen) {
                                    setShowAllResearchSources(false);
                                  }
                                }}
                                className="flex w-full items-center justify-between gap-4 text-left"
                                aria-expanded={isResearchDisclosureOpen}
                              >
                                <span className="font-sans text-[14px] font-medium text-text-primary">
                                  What I read ({reviewData.research_sources.length} sources)
                                </span>
                                {isResearchDisclosureOpen ? (
                                  <ChevronUp className="h-4 w-4 text-text-tertiary" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-text-tertiary" />
                                )}
                              </button>

                              {isResearchDisclosureOpen ? (
                                <div className="mt-4 space-y-2">
                                  {visibleResearchSources.map((source) => {
                                    const toolMeta = getReviewSourceToolMeta(source.tool);
                                    const ToolIcon = toolMeta.icon;

                                   return (
                                      <a
                                        key={`${source.tool}-${source.url}`}
                                        href={source.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="group grid gap-2 rounded-[14px] border border-border-default/60 bg-bg-surface/74 px-3 py-3 transition-colors hover:border-accent-border/70"
                                      >
                                        <div className="flex min-w-0 items-center gap-3">
                                          <span className={cn('shrink-0', toolMeta.toneClass)}>
                                            <ToolIcon className="h-4 w-4" />
                                          </span>
                                          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
                                            {toolMeta.label}
                                          </span>
                                          {source.technology ? (
                                            <span className="truncate font-sans text-[12px] text-text-tertiary">
                                              {source.technology}
                                            </span>
                                          ) : null}
                                        </div>
                                        <div className="min-w-0 font-sans text-[13px] font-medium text-text-primary group-hover:text-accent-soft">
                                          <span title={source.url} className="block truncate">
                                            {formatReviewSourceUrl(source.url)}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
                                          <span>{(source.chars_read || source.summary?.length || 0).toLocaleString()} chars</span>
                                          <span aria-hidden="true">·</span>
                                          <span className={getResearchRelevanceTone(source.relevance)}>
                                            {source.relevance || 'medium'} relevance
                                          </span>
                                        </div>
                                        <div className="min-w-0 font-sans text-[12px] text-text-tertiary">
                                          <span
                                            title={source.insight || source.summary || source.title || source.url}
                                            className="block truncate"
                                          >
                                            {source.insight || source.summary || source.title || 'Source opened for architecture validation.'}
                                          </span>
                                        </div>
                                      </a>
                                    );
                                  })}

                                  {hasHiddenResearchSources ? (
                                    <button
                                      type="button"
                                      onClick={() => setShowAllResearchSources((previous) => !previous)}
                                      className="pt-1 font-sans text-[13px] font-medium text-accent-soft transition-colors hover:text-accent-primary"
                                    >
                                      {showAllResearchSources ? 'Show less' : `Show all ${reviewData.research_sources.length} sources`}
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </section>

                          <div className="border-t border-border-subtle" />

                          <section className="py-7">
                            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">Anything to change?</div>
                            <textarea
                              ref={feedbackRef}
                              value={reviewFeedback}
                              onChange={(event) => {
                                setHasEditedReview(true);
                                setReviewFeedback(event.target.value);
                              }}
                              placeholder="e.g. use Drizzle instead of Prisma, remove payments for now, add Resend for email..."
                              className="mt-4 min-h-[148px] w-full resize-y rounded-[16px] border border-border-default bg-bg-base/82 px-4 py-4 font-sans text-[15px] leading-[1.7] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent-primary/70 focus:ring-2 focus:ring-accent-primary/20"
                            />
                          </section>
                        </div>
                      ) : (
                        <div className="mt-8 rounded-[18px] border border-border-default/70 bg-bg-base/74 px-5 py-6 font-sans text-[14px] text-text-secondary">
                          The review brief is ready, but the document details haven&apos;t loaded yet.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-border-subtle bg-bg-base/50 px-6 py-4 sm:px-8 md:px-10">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
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
                  </div>
                </div>
              </TooltipProvider>
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
              <div className="mb-5 flex items-center justify-center gap-2 font-mono text-[11px] leading-5 text-text-muted">
                <button
                  type="button"
                  onClick={() => handleOpenModelModal('fast')}
                  className={cn(
                    "group flex items-center gap-1.5 rounded-full border border-border-default/50 bg-bg-surface/40 px-3 py-0.5 transition-all hover:border-accent-primary/40 hover:bg-bg-surface/60",
                    currentBatch.id.includes('research') || currentBatch.id.includes('fetch') 
                      ? "border-accent-primary/30 bg-accent-primary/5 text-accent-soft ring-1 ring-accent-primary/10" 
                      : ""
                  )}
                >
                  <span className="opacity-60">Fast:</span>
                  <span className="font-medium text-text-secondary group-hover:text-accent-soft">{modelRoleDisplay.fast}</span>
                </button>
                <span className="opacity-30">·</span>
                <button
                  type="button"
                  onClick={() => handleOpenModelModal('deep')}
                  className={cn(
                    "group flex items-center gap-1.5 rounded-full border border-border-default/50 bg-bg-surface/40 px-3 py-0.5 transition-all hover:border-accent-primary/40 hover:bg-bg-surface/60",
                    !currentBatch.id.includes('research') && !currentBatch.id.includes('fetch')
                      ? "border-status-secure/30 bg-status-secure/5 text-status-secure-dim ring-1 ring-status-secure/10"
                      : ""
                  )}
                >
                  <span className="opacity-60">Deep:</span>
                  <span className="font-medium text-text-secondary group-hover:text-status-secure-dim">{modelRoleDisplay.deep}</span>
                </button>
              </div>

              <div className="mb-6 w-full rounded-[18px] border border-border-default/80 bg-bg-surface/72 p-4 text-left shadow-panel backdrop-blur-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                      Stage progress
                    </div>
                    <div className="mt-2 font-serif text-[24px] tracking-[-0.02em] text-text-primary">
                      {stageCounterLabel}
                    </div>
                    <div className="mt-2 font-sans text-[13px] leading-6 text-text-secondary">
                      {runnerStatusHeadline}
                    </div>
                    <div className="font-sans text-[12px] leading-5 text-text-tertiary">
                      {runnerStatusDetail}
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-border-subtle bg-bg-base/60 px-3 py-2 text-right">
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">Current stage</div>
                    <div className="mt-1 font-sans text-[13px] font-medium text-text-primary">
                      {isComplete ? 'Complete' : `${Math.min(resolvedCurrentBatchIndex + 1, GENERATION_BATCHES.length)} / ${GENERATION_BATCHES.length}`}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-6 gap-2">
                  {GENERATION_BATCHES.map((batch, index) => {
                    const isStageComplete = index < completedBatchCount || isComplete;
                    const isCurrent = !isStageComplete && index === resolvedCurrentBatchIndex && !isFailed && isRunningLifecycle;

                    return (
                      <div key={`progress-${batch.id}`} className="space-y-2">
                        <div className="relative h-2 overflow-hidden rounded-full bg-bg-base">
                          {isStageComplete ? (
                            <div className="h-full w-full rounded-full bg-status-secure" />
                          ) : isCurrent ? (
                            <motion.div
                              className="absolute inset-y-0 left-[-30%] w-1/2 rounded-full bg-[linear-gradient(90deg,rgba(235,94,40,0),rgba(235,94,40,0.95),rgba(235,94,40,0))]"
                              animate={{ x: ['0%', '190%'] }}
                              transition={{ duration: 1.6, ease: 'easeInOut', repeat: Infinity }}
                            />
                          ) : null}
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                          {batch.shortLabel}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {isCancelled ? (
                <div className="w-full rounded-[16px] border border-border-default/70 bg-bg-surface/60 p-6 text-left shadow-panel backdrop-blur-sm">
                  <div className="flex items-start gap-3">
                    <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-text-muted" />
                    <div>
                      <div className="font-serif text-[24px] tracking-[-0.02em] text-text-primary">Generation stopped</div>
                      <p className="mt-2 font-sans text-[14px] leading-6 text-text-secondary">
                        You cancelled this generation run. Checkpoints from completed stages are preserved.
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 flex gap-3">
                    <button
                      type="button"
                      onClick={handleResume}
                      disabled={isResuming}
                      className="btn-primary"
                    >
                      {isResuming ? 'Resuming…' : 'Resume from checkpoint'}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/dashboard')}
                      className="btn-ghost"
                    >
                      Back to dashboard
                    </button>
                  </div>
                </div>
              ) : isFailed && !isAutoRecovering ? (
                <div className="w-full rounded-[16px] border border-status-warning/30 bg-status-warning/10 p-6 text-left shadow-panel backdrop-blur-sm">
                  <div className="flex items-start gap-3">
                    <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-status-warning" />
                    <div>
                          <div className="font-serif text-[24px] tracking-[-0.02em] text-text-primary">The generation runner needs attention</div>
                          <p className="mt-2 font-sans text-[14px] leading-6 text-text-secondary">
                            {error || status.generation_error || 'Project generation failed.'}
                          </p>
                          {status?.generation_runtime?.failureClass === 'quality_gate' ? (
                            <p className="mt-2 font-sans text-[13px] leading-6 text-status-warning">
                              Your Stage 3 approval succeeded. Batch 4 failed a quality gate and stopped before producing a safe plan.
                            </p>
                          ) : null}
                          <p className="mt-2 font-sans text-[13px] leading-6 text-text-tertiary">
                            Durable checkpoints are preserved as each stage completes, so resuming picks up from the latest finished checkpoint instead of starting over.
                          </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleResume}
                    className="btn-primary mt-5"
                  >
                    Try again
                  </button>
                </div>
              ) : isAutoRecovering ? (
                <div className="w-full rounded-[16px] border border-[rgba(244,187,102,0.24)] bg-[rgba(244,187,102,0.08)] p-6 text-left shadow-panel backdrop-blur-sm">
                  <div className="flex items-start gap-3">
                    <LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-status-warning" />
                    <div>
                      <div className="font-serif text-[24px] tracking-[-0.02em] text-text-primary">Rechecking the runner</div>
                      <p className="mt-2 font-sans text-[14px] leading-6 text-text-secondary">
                        The runner stayed quiet for longer than expected, so I&apos;m requesting a checkpoint resume now.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="w-full rounded-[16px] border border-border-default/80 bg-bg-surface/72 p-4 text-left shadow-panel backdrop-blur-sm">
                    <div className="border-b border-border-subtle pb-4">
                      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                        Live transcript
                      </div>
                      <AnimatePresence mode="wait" initial={false}>
                        {liveActivity ? (
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
                                'block min-w-0 flex-1 whitespace-pre-wrap break-words text-[14px] leading-6 text-text-primary',
                                liveActivity.kind === 'thinking'
                                  ? 'max-h-[168px] overflow-y-auto rounded-[12px] bg-bg-base/52 px-3 py-3 font-mono text-[13px] text-text-primary/92'
                                  : 'font-sans font-medium tracking-[-0.01em]',
                              )}
                            >
                              {formatFeedMessage(liveActivity, { prefixThinking: false })}
                            </span>
                          </motion.div>
                        ) : (
                          <div className="rounded-[12px] border border-border-subtle bg-bg-base/42 px-3 py-3 text-[13px] text-text-muted">
                            {getPlaceholderMessage(status, currentBatch.id)}
                          </div>
                        )}
                      </AnimatePresence>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[10px] bg-bg-base/50 px-3 py-2">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]',
                          connectionMeta.chipClass,
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            streamConnectionState === 'live' && !isAutoRecovering
                              ? 'bg-status-secure'
                              : streamConnectionState === 'reconnecting' || isAutoRecovering
                                ? 'bg-status-warning'
                                : 'bg-text-muted',
                          )}
                        />
                        {connectionMeta.label}
                      </span>
                      <span className="text-[12px] text-text-muted">{connectionMeta.copy}</span>
                      <span className="hidden h-1 w-1 rounded-full bg-border-default sm:inline-block" />
                      <span className="text-[12px] text-text-muted">{runnerStatusHeadline}</span>
                      {latestProgressTimestamp ? (
                        <>
                          <span className="hidden h-1 w-1 rounded-full bg-border-default sm:inline-block" />
                          <span className="text-[12px] text-text-muted">
                            Last update {formatTimestamp(latestProgressTimestamp)}
                          </span>
                        </>
                      ) : null}
                      {showManualCheckIn ? (
                        <button
                          type="button"
                          onClick={handleCheckIn}
                          disabled={isNudging}
                          className="ml-auto shrink-0 rounded-[6px] bg-bg-base/80 px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-base hover:text-text-primary disabled:opacity-50"
                        >
                          {isNudging ? 'Checking runner...' : 'Check runner'}
                        </button>
                      ) : null}
                      {showReconnectFeed ? (
                        <button
                          type="button"
                          onClick={reconnectLiveFeed}
                          className="ml-auto shrink-0 rounded-[6px] bg-bg-base/80 px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-base hover:text-text-primary"
                        >
                          Reconnect feed
                        </button>
                      ) : null}
                      {canCancelGeneration ? (
                        <button
                          type="button"
                          onClick={() => void handleCancel()}
                          disabled={isCancelling}
                          className="shrink-0 rounded-[6px] bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300 disabled:opacity-50"
                        >
                          {isCancelling ? (
                            <span className="flex items-center gap-1">
                              <LoaderCircle className="h-3 w-3 animate-spin" />
                              Stopping…
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <XCircle className="h-3 w-3" />
                              Stop generation
                            </span>
                          )}
                        </button>
                      ) : null}
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

                  {error && !showResumeBadge ? (
                    <div className="mt-4 flex items-center gap-2 rounded-[12px] border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[12px] text-status-warning">
                      <TriangleAlert className="h-4 w-4" />
                      <span>{error}</span>
                    </div>
                  ) : null}

                  {showResumeBadge && autoRecoveryFailed ? (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-6 flex flex-col items-center gap-3 rounded-[16px] border border-border-default/80 bg-bg-surface/60 p-4"
                    >
                      <div className="flex items-center gap-2 font-sans text-[13px] text-text-secondary">
                        <TriangleAlert className="h-4 w-4 text-accent-primary" />
                        <span>{isFailed ? 'The runner stopped before finishing.' : 'The runner stayed quiet for too long.'}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleResume}
                        disabled={isResuming}
                        className="btn-primary px-4 py-2 text-[13px]"
                      >
                        {isResuming ? 'Resuming...' : 'Resume build'}
                      </button>
                    </motion.div>
                  ) : null}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <Dialog open={isModelModalOpen} onOpenChange={setIsModelModalOpen}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Switch {modalRoleType === 'fast' ? 'Fast' : 'Deep'} Model</DialogTitle>
            <DialogDescription>
              Select which model should handle {modalRoleType === 'fast' ? 'research and tool calls' : 'architecture and file generation'}.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto px-6 py-2 space-y-4">
            {providers.map((provider) => (
              <div key={provider.id} className="space-y-2">
                <div className="pl-1 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  {provider.name}
                </div>
                {provider.models && provider.models.length > 0 ? (
                  provider.models.map((model) => {
                    const isFastSlot = modelRoles?.fast_model_provider_id === provider.id && modelRoles?.fast_model_name === model.name;
                    const isDeepSlot = modelRoles?.deep_model_provider_id === provider.id && modelRoles?.deep_model_name === model.name;
                    const isSelected = modalRoleType === 'fast' ? isFastSlot : isDeepSlot;

                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => void handleSelectModel(provider.id, model.name)}
                        className={cn(
                          'group flex w-full items-center justify-between rounded-xl border p-3 text-left transition-all duration-200',
                          isSelected
                            ? 'border-accent-border bg-accent-primary-muted'
                            : 'border-border-default bg-bg-elevated/40 hover:border-border-strong hover:bg-bg-elevated/60',
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              'flex h-8 w-8 items-center justify-center rounded-lg border transition-colors',
                              isSelected
                                ? 'border-accent-border bg-bg-surface text-accent-primary'
                                : 'border-border-default bg-bg-surface text-text-tertiary group-hover:text-text-secondary',
                            )}
                          >
                            <Sparkles className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-[14px] font-medium text-text-primary">
                              {model.name}
                            </div>
                            <div className="flex gap-1 mt-0.5">
                              {isFastSlot && (
                                <span className="text-[9px] font-mono text-accent-primary uppercase tracking-wider bg-accent-primary-muted px-1.5 py-0.5 rounded">Fast</span>
                              )}
                              {isDeepSlot && (
                                <span className="text-[9px] font-mono text-status-secure-dim uppercase tracking-wider bg-status-secure/10 px-1.5 py-0.5 rounded">Deep</span>
                              )}
                            </div>
                          </div>
                        </div>
                        {isSelected && (
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-primary text-white">
                            <ChevronRight className="h-3 w-3" />
                          </div>
                        )}
                      </button>
                    );
                  })
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSelectModel(provider.id, null)}
                    className={cn(
                      'group flex w-full items-center justify-between rounded-xl border p-3 text-left transition-all duration-200',
                      (modalRoleType === 'fast' 
                        ? (modelRoles?.fast_model_provider_id === provider.id && !modelRoles?.fast_model_name)
                        : (modelRoles?.deep_model_provider_id === provider.id && !modelRoles?.deep_model_name))
                        ? 'border-accent-border bg-accent-primary-muted'
                        : 'border-border-default bg-bg-elevated/40 hover:border-border-strong hover:bg-bg-elevated/60',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-lg border transition-colors',
                          (modalRoleType === 'fast' 
                            ? (modelRoles?.fast_model_provider_id === provider.id && !modelRoles?.fast_model_name)
                            : (modelRoles?.deep_model_provider_id === provider.id && !modelRoles?.deep_model_name))
                            ? 'border-accent-border bg-bg-surface text-accent-primary'
                            : 'border-border-default bg-bg-surface text-text-tertiary group-hover:text-text-secondary',
                        )}
                      >
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-[14px] font-medium text-text-primary">
                          {provider.model || 'Default Model'}
                        </div>
                        <div className="flex gap-1 mt-0.5">
                          {(modelRoles?.fast_model_provider_id === provider.id && !modelRoles?.fast_model_name) && (
                            <span className="text-[9px] font-mono text-accent-primary uppercase tracking-wider bg-accent-primary-muted px-1.5 py-0.5 rounded">Fast</span>
                          )}
                          {(modelRoles?.deep_model_provider_id === provider.id && !modelRoles?.deep_model_name) && (
                            <span className="text-[9px] font-mono text-status-secure-dim uppercase tracking-wider bg-status-secure/10 px-1.5 py-0.5 rounded">Deep</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                )}
              </div>
            ))}
          </div>

          <DialogFooter className="border-t border-border-default bg-bg-elevated/30 p-4">
            <button
              type="button"
              onClick={() => setIsModelModalOpen(false)}
              className="btn-ghost py-2 text-sm"
            >
              Cancel
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
