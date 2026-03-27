import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Archive,
  ArrowRight,
  FolderOpen,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useAuthStore } from '../store/authStore';
import { dbService } from '../lib/db';
import { Project, Stage, Step } from '../types';
import { cn } from '../lib/utils';
import { getDashboardGenerationAction } from '../lib/generation-session';
import { UI_COPY } from '../lib/ui-copy';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/Skeleton';
import { Brain, LucideIcon, Sparkles } from 'lucide-react';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: EASE_OUT_EXPO,
    },
  },
};

const WORKSPACE_NUDGE_DISMISSED_KEY = 'scrimble-workspace-nudge-dismissed';
const ACTIVE_GENERATION_STORAGE_KEY = 'scrimble_active_generation';

type ProjectCardData = {
  project: Project;
  stages: Stage[];
  steps: Step[];
  nextStep: Step | null;
  activeStepCount: number;
};

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return 'Good morning.';
  }

  if (hour < 18) {
    return 'Good afternoon.';
  }

  return 'Good evening.';
}

function getNextStep(steps: Step[]) {
  const orderedSteps = [...steps].sort((left, right) => left.order_index - right.order_index);

  return orderedSteps.find((step) => step.status === 'needs_review')
    ?? orderedSteps.find((step) => step.status === 'agent_working')
    ?? orderedSteps.find((step) => step.status === 'active' || step.status === 'waiting')
    ?? orderedSteps.find((step) => step.status === 'locked')
    ?? orderedSteps.find((step) => step.status !== 'complete' && step.status !== 'skipped')
    ?? null;
}

function parseStack(stackValue: string) {
  try {
    return JSON.parse(stackValue) as Record<string, string>;
  } catch {
    return {};
  }
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [projectCards, setProjectCards] = useState<ProjectCardData[]>([]);
  const [builderProfileCount, setBuilderProfileCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [workspaceNudgeDismissed, setWorkspaceNudgeDismissed] = useState(false);

  const loadDashboard = useCallback(async () => {
    if (!user) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [projects, userTools] = await Promise.all([
        dbService.getProjectsByUserId(),
        dbService.getUserTools(),
      ]);
      const cards = await Promise.all(
        projects.map(async (project) => {
          const [steps, stages] = await Promise.all([
            dbService.getStepsByProjectId(project.id),
            dbService.getStagesByProjectId(project.id),
          ]);

          return {
            project,
            stages,
            steps,
            nextStep: getNextStep(steps),
            activeStepCount: steps.filter((step) => ['active', 'agent_working', 'needs_review', 'waiting'].includes(step.status)).length,
          };
        }),
      );

      setProjectCards(cards);
      setBuilderProfileCount(userTools.length);
    } catch (loadError) {
      console.error('Error fetching projects:', loadError);
      setError(loadError instanceof Error ? loadError.message : UI_COPY.dashboard.loadProjects);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    let cancelled = false;

    const resumeActiveGeneration = async () => {
      let activeGeneration: string | null = null;
      try {
        activeGeneration = localStorage.getItem(ACTIVE_GENERATION_STORAGE_KEY);
      } catch {
        return;
      }

      if (!activeGeneration) {
        return;
      }

      try {
        const status = await dbService.getProjectGenerationStatus(activeGeneration);
        if (cancelled) {
          return;
        }

        const runtime = status.generation_runtime;
        if (runtime && runtime.lifecycleStatus !== 'intake' && !runtime.isTerminal) {
          navigate(`/project/${activeGeneration}/generating`, { replace: true });
        } else {
          try {
            localStorage.removeItem(ACTIVE_GENERATION_STORAGE_KEY);
          } catch {
            // Ignore storage errors.
          }
        }
      } catch {
        try {
          localStorage.removeItem(ACTIVE_GENERATION_STORAGE_KEY);
        } catch {
          // Ignore storage errors.
        }
      }
    };

    void resumeActiveGeneration();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    try {
      setWorkspaceNudgeDismissed(localStorage.getItem(WORKSPACE_NUDGE_DISMISSED_KEY) === '1');
    } catch {
      setWorkspaceNudgeDismissed(false);
    }
  }, []);

  const handleArchiveProject = async (projectId: string) => {
    try {
      await dbService.updateProject(projectId, { status: 'archived' });
      setProjectCards((current) =>
        current.map((entry) =>
          entry.project.id === projectId
            ? { ...entry, project: { ...entry.project, status: 'archived' } }
            : entry,
        ),
      );
      toast.success('Project moved to the archive.');
    } catch (error) {
      console.error('Error archiving project:', error);
      toast.error(UI_COPY.dashboard.archiveProject);
    }
  };

  const handleRestoreProject = async (projectId: string) => {
    try {
      await dbService.updateProject(projectId, { status: 'active' });
      setProjectCards((current) =>
        current.map((entry) =>
          entry.project.id === projectId
            ? { ...entry, project: { ...entry.project, status: 'active' } }
            : entry,
        ),
      );
      toast.success('Project restored.');
    } catch (error) {
      console.error('Error restoring project:', error);
      toast.error(UI_COPY.dashboard.restoreProject);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectToDelete) return;

    setIsDeleting(true);
    try {
      await dbService.deleteProject(projectToDelete);
      setProjectCards((current) => current.filter((entry) => entry.project.id !== projectToDelete));
      toast.success('Project deleted permanently.');
      setProjectToDelete(null);
    } catch (error) {
      console.error('Error deleting project:', error);
      toast.error(UI_COPY.dashboard.deleteProject);
    } finally {
      setIsDeleting(false);
    }
  };

  const visibleCards = useMemo(
    () => projectCards.filter((entry) => (showArchived ? entry.project.status === 'archived' : entry.project.status === 'active')),
    [projectCards, showArchived],
  );

  const activeProjectCard = useMemo(() => {
    if (showArchived) {
      return null;
    }

    const candidates = projectCards
      .filter((entry) => entry.project.status === 'active')
      .map((entry) => ({
        ...entry,
        descriptor: getDashboardGenerationAction(entry.project, entry.nextStep),
      }))
      .sort((left, right) => {
        if (left.descriptor.priority !== right.descriptor.priority) {
          return left.descriptor.priority - right.descriptor.priority;
        }

        return Date.parse(right.project.updated_at) - Date.parse(left.project.updated_at);
      });

    return candidates[0] || null;
  }, [projectCards, showArchived]);

  const secondaryCards = useMemo(() => {
    if (!activeProjectCard) {
      return visibleCards;
    }

    return visibleCards.filter((entry) => entry.project.id !== activeProjectCard.project.id);
  }, [activeProjectCard, visibleCards]);

  const hasArchivedProjects = projectCards.some((entry) => entry.project.status === 'archived');

  return (
    <motion.main
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="mx-auto w-full max-w-6xl px-6 pb-8 pt-20 font-sans"
    >
      <motion.header
        variants={containerVariants}
        className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"
      >
        <motion.div variants={itemVariants} className="max-w-[640px]">
          <div className="section-label">Daily re-entry</div>
          <h1 className="mt-4 text-heading">{getGreeting()}</h1>
          <p className="mt-3 text-body">
            Here&apos;s where your projects stand and what you should look at next.
          </p>
        </motion.div>

        <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-3">
          {hasArchivedProjects ? (
            <button
              type="button"
              onClick={() => setShowArchived((current) => !current)}
              className="btn-ghost"
            >
              <Archive className="h-4 w-4" />
              {showArchived ? 'Back to active' : 'View archive'}
            </button>
          ) : null}
          <Link to="/new" className="btn-primary">
            <Plus className="h-4 w-4" />
            Start something new
          </Link>
        </motion.div>
      </motion.header>

      {loading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="surface-card p-6">
              <div className="mb-6 flex items-start justify-between gap-6">
                <div className="space-y-3">
                  <Skeleton variant="heading" className="w-48" />
                  <Skeleton variant="body" className="w-32" />
                </div>
                <Skeleton variant="circle" className="h-10 w-10 rounded-[10px]" />
              </div>
              <div className="space-y-4">
                <Skeleton className="h-14 w-full rounded-[12px]" />
                <Skeleton className="h-[3px] w-full" />
                <div className="flex justify-between gap-4">
                  <div className="flex gap-2">
                    <Skeleton variant="badge" className="w-20" />
                    <Skeleton variant="badge" className="w-20" />
                  </div>
                  <Skeleton variant="badge" className="w-16" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <motion.div variants={itemVariants} className="surface-card px-8 py-10">
          <div className="max-w-[520px]">
            <div className="section-label">Couldn&apos;t reopen your projects</div>
            <h2 className="mt-4 text-[32px] font-serif tracking-[-0.03em] text-text-primary">
              I couldn&apos;t rebuild your dashboard just now.
            </h2>
            <p className="mt-3 text-body">
              {error}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void loadDashboard()}
                className="btn-primary"
              >
                <RotateCcw className="h-4 w-4" />
                Try again
              </button>
              <Link to="/new" className="btn-ghost">
                <Plus className="h-4 w-4" />
                Start something new
              </Link>
            </div>
          </div>
        </motion.div>
      ) : visibleCards.length === 0 ? (
        <motion.div variants={itemVariants} className="surface-card px-8 py-14 text-center">
          <div className="mb-5 flex justify-center">
            <FolderOpen className="h-9 w-9 text-accent-primary" />
          </div>
          <h2 className="text-[32px] font-serif tracking-[-0.03em] text-text-primary">
            {showArchived ? 'Nothing is archived right now.' : 'You haven’t started anything yet.'}
          </h2>
          <p className="mx-auto mt-3 max-w-[420px] text-body">
            {showArchived
              ? 'When you archive a project, it will stay here until you want it back.'
              : 'Tell me what you want to build and I’ll turn it into a plan you can come back to every morning.'}
          </p>
          {!showArchived ? (
            <Link to="/new" className="btn-primary mt-8">
              Start something new
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : null}
        </motion.div>
      ) : (
        <div className="space-y-8">
          {activeProjectCard ? (
            <motion.section variants={itemVariants} className="surface-card p-7">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <div className="section-label">Active project</div>
                  <h2 className="mt-3 text-[30px] font-serif tracking-[-0.03em] text-text-primary">
                    {activeProjectCard.project.name}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em] text-text-muted">
                    <span>{activeProjectCard.project.project_type.replace('_', ' ')}</span>
                    <span>•</span>
                    <span>Updated {formatDistanceToNow(new Date(activeProjectCard.project.updated_at))} ago</span>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Open actions for ${activeProjectCard.project.name}`}
                      className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-border-default bg-bg-elevated/60 text-text-tertiary transition-colors hover:text-text-primary"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => navigate(`/project/${activeProjectCard.project.id}`)}>
                      <FolderOpen className="mr-2 h-4 w-4" />
                      Open project
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => void handleArchiveProject(activeProjectCard.project.id)}
                      className="text-status-error hover:text-accent-soft"
                    >
                      <Archive className="mr-2 h-4 w-4" />
                      Archive project
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setProjectToDelete(activeProjectCard.project.id)}
                      className="text-status-error hover:bg-status-error/10"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete project
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <button
                type="button"
                onClick={() => navigate(activeProjectCard.descriptor.destination)}
                aria-label={`${activeProjectCard.descriptor.ctaLabel} for ${activeProjectCard.project.name}`}
                className={cn(
                  'group w-full rounded-[14px] border px-5 py-5 text-left transition-colors',
                  activeProjectCard.descriptor.isAgentWorking
                    ? 'border-accent-border/50 bg-accent-primary-muted/20 hover:border-accent-border'
                    : 'border-border-default bg-bg-elevated/35 hover:border-accent-border/60',
                )}
              >
                <div className="flex items-center justify-between gap-4">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-[8px] border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em]',
                      activeProjectCard.descriptor.badgeClassName,
                    )}
                  >
                    {activeProjectCard.descriptor.statusLabel}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-primary transition-colors group-hover:text-accent-primary-hover">
                    {activeProjectCard.descriptor.ctaLabel}
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 text-[16px] font-medium tracking-[-0.01em] text-text-primary">
                  {activeProjectCard.descriptor.isAgentWorking ? (
                    <Brain className="h-4 w-4 text-accent-primary animate-pulse" />
                  ) : (
                    <ArrowRight className="h-4 w-4 text-accent-primary" />
                  )}
                  <span>{activeProjectCard.descriptor.focusCopy}</span>
                </div>
                <div className="mt-4 flex items-center justify-between text-[12px] text-text-secondary">
                  <span>
                    {activeProjectCard.steps.filter((step) => step.status === 'complete').length}/{activeProjectCard.steps.length || 0} steps complete
                  </span>
                  <span>{activeProjectCard.activeStepCount > 0 ? `${activeProjectCard.activeStepCount} active` : 'No active steps yet'}</span>
                </div>
              </button>
            </motion.section>
          ) : null}

          {secondaryCards.length > 0 ? (
            <motion.div variants={containerVariants} className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {secondaryCards.map(({ project, nextStep, activeStepCount }) => {
                const stack = parseStack(project.stack || '{}');
                const descriptor = getDashboardGenerationAction(project, nextStep);

                return (
                  <motion.article
                    key={project.id}
                    variants={itemVariants}
                    className="surface-card p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-[22px] font-serif tracking-[-0.02em] text-text-primary">
                          {project.name}
                        </h3>
                        <div className="mt-1 text-[11px] font-mono uppercase tracking-[0.12em] text-text-muted">
                          Updated {formatDistanceToNow(new Date(project.updated_at))} ago
                        </div>
                      </div>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-[8px] border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em]',
                          descriptor.badgeClassName,
                        )}
                      >
                        {descriptor.statusLabel}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => navigate(descriptor.destination)}
                      aria-label={`${descriptor.ctaLabel} for ${project.name}`}
                      className="mt-4 w-full rounded-[10px] border border-border-default bg-bg-elevated/45 px-4 py-3 text-left transition-colors hover:border-accent-border/60"
                    >
                      <div className="text-[14px] font-medium text-text-primary">{descriptor.focusCopy}</div>
                      <div className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-accent-primary">
                        {descriptor.ctaLabel}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </div>
                    </button>

                    <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-3">
                      <div className="flex flex-wrap gap-2">
                        {Object.values(stack).filter(Boolean).slice(0, 2).map((item) => (
                          <span
                            key={`${project.id}-${item}`}
                            className="rounded-[6px] border border-border-default bg-bg-elevated/70 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-text-muted"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                      <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-text-muted">
                        {activeStepCount > 0 ? `${activeStepCount} in play` : 'Quiet'}
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </motion.div>
          ) : null}
        </div>
      )}

      {!loading && !showArchived && visibleCards.length > 0 && builderProfileCount < 3 && !workspaceNudgeDismissed ? (
        <motion.div
          variants={itemVariants}
          className="mt-4 flex items-center justify-between gap-4 rounded-[12px] border border-border-default bg-bg-elevated/45 px-4 py-3 text-sm text-text-secondary"
        >
          <Link
            to="/settings#workspace"
            className="text-[13px] leading-6 text-text-secondary transition-colors hover:text-text-primary"
          >
            Add your tools in Settings to get more specific plans.
          </Link>
          <button
            type="button"
            onClick={() => {
              setWorkspaceNudgeDismissed(true);
              try {
                localStorage.setItem(WORKSPACE_NUDGE_DISMISSED_KEY, '1');
              } catch {
                // Ignore storage failures and keep the UI responsive.
              }
            }}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted transition-colors hover:text-text-secondary"
          >
            Dismiss
          </button>
        </motion.div>
      ) : null}

      {!loading && visibleCards.length > 0 ? (
        <motion.div variants={itemVariants} className="mt-8 text-sm text-text-muted">
          Open any project to see the full plan, finish the current step, or ask Scrimble to rework it.
        </motion.div>
      ) : null}

      <Dialog open={!!projectToDelete} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this project? This action cannot be undone and all associated data will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => setProjectToDelete(null)}
              className="btn-ghost"
              disabled={isDeleting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteProject}
              className="btn-primary bg-status-error hover:bg-status-error/90 border-status-error/20"
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete permanently'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.main>
  );
}
