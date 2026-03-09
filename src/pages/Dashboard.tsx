import { useEffect, useMemo, useState } from 'react';
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
  const [showArchived, setShowArchived] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!user) {
      return;
    }

    async function fetchProjects() {
      setLoading(true);

      try {
        const [projects, userTools] = await Promise.all([
          dbService.getProjectsByUserId(user.uid),
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
      } catch (error) {
        console.error('Error fetching projects:', error);
        toast.error('Could not load your projects.');
      } finally {
        setLoading(false);
      }
    }

    void fetchProjects();
  }, [user]);

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
      toast.error('Could not archive that project.');
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
      toast.error('Could not restore that project.');
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
      toast.error('Could not delete project.');
    } finally {
      setIsDeleting(false);
    }
  };

  const visibleCards = useMemo(
    () => projectCards.filter((entry) => (showArchived ? entry.project.status === 'archived' : entry.project.status === 'active')),
    [projectCards, showArchived],
  );

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

      {!loading && !showArchived && builderProfileCount < 3 ? (
        <motion.div
          variants={itemVariants}
          className="mb-8 overflow-hidden rounded-[18px] border border-border-default bg-bg-surface"
        >
          <div className="flex h-full flex-col gap-5 border-l-[3px] border-accent-primary px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
            <div className="max-w-[560px]">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent-primary">
                ◈ {builderProfileCount === 0 ? 'Your builder profile is empty' : 'Your builder profile needs a little more detail'}
              </div>
              <p className="mt-3 text-[15px] leading-7 text-text-primary">
                {builderProfileCount === 0
                  ? "Without it, every plan I build will be generic. Tell me your tools once - I'll use them everywhere."
                  : 'Add a few more tools and I can stop defaulting to generic stack advice. Once you hit three, your plans get much sharper.'}
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end">
              <Link
                to="/settings#builder-profile"
                className="inline-flex items-center gap-2 text-[15px] font-medium text-accent-primary transition-colors hover:text-accent-primary-hover"
              >
                {builderProfileCount === 0 ? 'Set up my profile' : 'Finish my profile'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                {builderProfileCount === 0 ? '2 min setup' : `${builderProfileCount}/3 saved`}
              </span>
            </div>
          </div>
        </motion.div>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[1, 2, 3].map((item) => (
            <div key={item} className="surface-card p-6">
              <div className="mb-6 flex items-start justify-between gap-6">
                <div className="space-y-2">
                  <div className="skeleton-block h-7 w-48" />
                  <div className="skeleton-block h-4 w-36" />
                </div>
                <div className="skeleton-block h-10 w-10 rounded-[10px]" />
              </div>
              <div className="space-y-4">
                <div className="skeleton-block h-14 w-full rounded-[12px]" />
                <div className="skeleton-block h-[3px] w-full rounded-[2px]" />
                <div className="flex justify-between gap-4">
                  <div className="flex gap-2">
                    <div className="skeleton-block h-6 w-20 rounded-[6px]" />
                    <div className="skeleton-block h-6 w-20 rounded-[6px]" />
                  </div>
                  <div className="skeleton-block h-6 w-16 rounded-[6px]" />
                </div>
              </div>
            </div>
          ))}
        </div>
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
        <motion.div variants={containerVariants} className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {visibleCards.map(({ project, nextStep, stages, steps, activeStepCount }) => {
            const stack = parseStack(project.stack || '{}');
            const completedStageCount = stages.filter((stage) => stage.status === 'complete').length;
            const stageTotal = stages.length || 1;
            const stageProgress = Math.min(Math.max(completedStageCount, 0), stageTotal);
            const statusLabel = project.generation_status === 'intake'
              ? 'Continue intake'
              : nextStep?.status === 'needs_review'
                ? 'Your review'
                : nextStep?.status === 'agent_working'
                  ? 'Working now'
                  : 'Next up';

            return (
              <motion.article
                key={project.id}
                variants={itemVariants}
                onClick={() =>
                  navigate(
                    project.generation_status === 'intake'
                      ? `/new?intake=${project.id}`
                      : `/project/${project.id}`,
                  )
                }
                className="surface-card group cursor-pointer p-6 transition-transform duration-200 hover:-translate-y-1"
              >
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[24px] font-serif tracking-[-0.03em] text-text-primary">
                      {project.name}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em] text-text-muted">
                      <span>{project.project_type.replace('_', ' ')}</span>
                      <span>•</span>
                      <span>Updated {formatDistanceToNow(new Date(project.updated_at))} ago</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex items-center gap-1 pt-1">
                      {Array.from({ length: stageTotal }).map((_, index) => (
                        <span
                          key={`${project.id}-stage-${index}`}
                          className={cn(
                            'h-1.5 w-1.5 rounded-full transition-colors duration-300',
                            index < stageProgress
                              ? 'bg-accent-primary shadow-[0_0_8px_rgba(235,94,40,0.38)]'
                              : 'bg-bg-elevated',
                          )}
                        />
                      ))}
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-border-default bg-bg-elevated/60 text-text-tertiary transition-colors hover:text-text-primary"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/project/${project.id}`)}>
                          <FolderOpen className="mr-2 h-4 w-4" />
                          Open project
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {project.status === 'archived' ? (
                          <DropdownMenuItem onClick={() => void handleRestoreProject(project.id)}>
                            <Undo2 className="mr-2 h-4 w-4" />
                            Restore project
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => void handleArchiveProject(project.id)}
                            className="text-status-error hover:text-accent-soft"
                          >
                            <Archive className="mr-2 h-4 w-4" />
                            Archive project
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setProjectToDelete(project.id);
                          }}
                          className="text-status-error hover:bg-status-error/10"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete project
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className="rounded-[12px] border border-accent-border bg-accent-primary-muted/50 px-4 py-3">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-accent-primary">
                    {statusLabel}
                  </div>
                  <div className="flex items-center gap-2 text-[15px] font-medium tracking-[-0.01em] text-text-primary">
                    <ArrowRight className="h-4 w-4 text-accent-primary" />
                    <span>
                      {project.generation_status === 'intake'
                        ? 'Finish the intake conversation.'
                        : nextStep?.title ?? 'Plan details are still coming together.'}
                    </span>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between text-sm text-text-secondary">
                    <span>Progress</span>
                    <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-text-muted">
                      {project.progress}% · {steps.filter((step) => step.status === 'complete').length}/{steps.length || 0} done
                    </span>
                  </div>
                  <div className="relative h-[3px] overflow-hidden rounded-[2px] bg-bg-elevated">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${project.progress}%` }}
                      transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                      className="absolute inset-y-0 left-0 bg-accent-primary"
                    />
                    <motion.div
                      initial={{ left: 0 }}
                      animate={{ left: `${Math.max(project.progress - 2, 0)}%` }}
                      transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                      className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-accent-soft shadow-[0_0_10px_rgba(243,159,126,0.55)]"
                    />
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between gap-4 border-t border-border-subtle pt-4">
                  <div className="flex flex-wrap gap-2">
                    {Object.values(stack).filter(Boolean).slice(0, 3).map((item) => (
                      <span
                        key={`${project.id}-${item}`}
                        className="rounded-[6px] border border-border-default bg-bg-elevated/70 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-text-muted"
                      >
                        {item}
                      </span>
                    ))}
                  </div>

                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                    {activeStepCount > 0 ? `${activeStepCount} in play` : 'Quiet for now'}
                  </div>
                </div>
              </motion.article>
            );
          })}
        </motion.div>
      )}

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
              onClick={() => setProjectToDelete(null)}
              className="btn-ghost"
              disabled={isDeleting}
            >
              Cancel
            </button>
            <button
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
