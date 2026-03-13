import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Archive,
  ArrowRight,
  FolderOpen,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  Calendar,
  Layers,
  CheckCircle2,
  ChevronRight,
  History,
  Zap,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useAuthStore } from '../store/authStore';
import { useOnboardingStore } from '../store/onboardingStore';
import { dbService } from '../lib/db';
import { getAIProviders } from '../lib/ai';
import { Project, Stage, Step } from '../types';
import { cn } from '../lib/utils';
import { formatNumberWithCommas, formatRelativeTimestamp, formatStepCount, roundPercent } from '../lib/formatting';
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
import { NewProjectModal } from '@/components/NewProjectModal';
import WelcomeModal from '../components/onboarding/WelcomeModal';
import OnboardingChecklist from '../components/onboarding/OnboardingChecklist';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';

const PROJECT_COLORS = ['#eb5e28', '#34d399', '#38bdf8', '#fbbf24', '#a78bfa', '#f472b6'];

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: EASE_OUT_EXPO,
    },
  },
};

const slideInVariants = {
  hidden: { width: 0, opacity: 0 },
  visible: { 
    width: 320, 
    opacity: 1,
    transition: { duration: 0.3, ease: EASE_OUT_EXPO }
  },
  exit: { 
    width: 0, 
    opacity: 0,
    transition: { duration: 0.25, ease: EASE_OUT_EXPO }
  }
};

type ProjectCardData = {
  project: Project;
  stages: Stage[];
  steps: Step[];
  nextStep: Step | null;
  activeStepCount: number;
};

function getGreeting(name?: string | null) {
  const hour = new Date().getHours();
  const base = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${base}, ${name.split(' ')[0]}` : `${base}.`;
}

function getFormattedDate() {
  return format(new Date(), 'EEEE, MMMM d');
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

type ProjectStatusType = 'in_progress' | 'awaiting_input' | 'paused' | 'complete' | 'blocked';

function getProjectCardDescriptor(project: Project, nextStep: Step | null, isAgentWorking: boolean) {
  if (project.generation_status === 'intake') {
    return {
      status: 'awaiting_input' as ProjectStatusType,
      statusLabel: 'Awaiting Input',
      ctaLabel: 'Resume intake',
      destination: `/new?intake=${project.id}`,
      focusCopy: 'Finish the intake conversation.',
    };
  }
  if (project.generation_status === 'awaiting_review' || nextStep?.status === 'needs_review') {
    return {
      status: 'awaiting_input' as ProjectStatusType,
      statusLabel: 'Your Review',
      ctaLabel: 'Review build',
      destination: `/project/${project.id}/generating`,
      focusCopy: nextStep?.title ?? 'Review the architecture checkpoint.',
    };
  }
  if (project.generation_status === 'failed') {
    return {
      status: 'blocked' as ProjectStatusType,
      statusLabel: 'Blocked',
      ctaLabel: 'Recover build',
      destination: `/project/${project.id}/generating`,
      focusCopy: 'Reopen and recover from checkpoint.',
    };
  }
  if (isAgentWorking) {
    return {
      status: 'in_progress' as ProjectStatusType,
      statusLabel: 'In Progress',
      ctaLabel: 'Watch progress',
      destination: `/project/${project.id}/generating`,
      focusCopy: nextStep?.title ?? 'Scrimble is still building this plan.',
    };
  }
  if (project.status === 'completed') {
    return {
      status: 'complete' as ProjectStatusType,
      statusLabel: 'Complete',
      ctaLabel: 'Open project',
      destination: `/project/${project.id}`,
      focusCopy: 'All steps finished.',
    };
  }
  return {
    status: 'paused' as ProjectStatusType,
    statusLabel: 'Paused',
    ctaLabel: 'Open plan',
    destination: `/project/${project.id}`,
    focusCopy: nextStep?.title ?? 'Plan details are still coming together.',
  };
}

function ProjectStatusBadge({ status, label }: { status: ProjectStatusType; label: string }) {
  const styles: Record<ProjectStatusType, string> = {
    in_progress: 'bg-accent-primary text-text-primary border-transparent',
    awaiting_input: 'bg-transparent text-status-warning border-status-warning/40',
    paused: 'bg-bg-elevated text-text-secondary border-transparent',
    complete: 'bg-status-secure text-bg-base border-transparent',
    blocked: 'bg-status-error text-text-primary border-transparent',
  };

  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] whitespace-nowrap',
        styles[status]
      )}
    >
      {label}
    </span>
  );
}

function EmptyState({ onNewProject }: { onNewProject?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="h-10 w-10 rounded-2xl bg-accent-primary/10 flex items-center justify-center mb-6">
        <Sparkles className="h-5 w-5 text-accent-primary" />
      </div>
      <h2 className="text-2xl font-display font-bold text-text-primary tracking-tight">
        No projects yet
      </h2>
      <p className="mt-3 max-w-xs text-sm text-text-secondary font-light leading-relaxed">
        Describe your idea in plain language and Scrimble will build a custom path to help you ship it.
      </p>
      <button 
        onClick={onNewProject}
        className="btn-primary mt-8 h-12 px-8 rounded-xl font-bold tracking-tight"
      >
        Start your first project
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="max-w-md mx-auto px-6 py-12 text-center">
      <div className="rounded-2xl border border-red-900/30 bg-red-950/20 p-6">
        <div className="flex items-center justify-center gap-2 text-status-error mb-4">
          <AlertCircle className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-display font-semibold text-text-primary">Couldn't reach your projects.</h2>
        <p className="mt-2 text-sm text-text-secondary">{message}</p>
        <button onClick={onRetry} className="btn-ghost mt-6 h-10 px-5">
          <RotateCcw className="h-4 w-4" />
          Retry
        </button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { isOnboarded, isDismissed, hasSeenWelcome, markOnboarded, completedSteps, completeStep } = useOnboardingStore();
  const [projectCards, setProjectCards] = useState<ProjectCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [hasAIKey, setHasAIKey] = useState(false);
  const [hasBuilderProfile, setHasBuilderProfile] = useState(false);

  useEffect(() => {
    document.title = 'Projects — Scrimble';
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const [projects, userTools, providers] = await Promise.all([
        dbService.getProjectsByUserId(user.uid),
        dbService.getUserTools(),
        getAIProviders(),
      ]);
      
      const hasProviders = providers.length > 0;
      const hasTools = userTools.length > 0;
      const hasProjectsList = projects.length > 0;
      
      setHasAIKey(hasProviders);
      setHasBuilderProfile(hasTools);
      
      if (hasProviders && !completedSteps.includes(0)) {
        completeStep('key');
      }
      if (hasTools && !completedSteps.includes(1)) {
        completeStep('profile');
      }
      if (hasProjectsList && !completedSteps.includes(2)) {
        completeStep('project');
      }
      
      if (hasProviders && hasTools && hasProjectsList) {
        markOnboarded();
      }
      
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
            activeStepCount: steps.filter((s) => ['active', 'agent_working', 'needs_review', 'waiting'].includes(s.status)).length,
          };
        }),
      );
      setProjectCards(cards);
      if (cards.length > 0 && !selectedProjectId) {
        const firstActive = cards.find(c => c.project.status === 'active');
        if (firstActive) setSelectedProjectId(firstActive.project.id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your projects.');
    } finally {
      setLoading(false);
    }
  }, [user, selectedProjectId, completedSteps, completeStep, markOnboarded]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleArchiveProject = async (projectId: string) => {
    try {
      await dbService.updateProject(projectId, { status: 'archived' });
      setProjectCards((current) => current.map((e) => e.project.id === projectId ? { ...e, project: { ...e.project, status: 'archived' } } : e));
      toast.success('Project archived.');
    } catch (error) {
      toast.error('Could not archive project.');
    }
  };

  const handleRestoreProject = async (projectId: string) => {
    try {
      await dbService.updateProject(projectId, { status: 'active' });
      setProjectCards((current) => current.map((e) => e.project.id === projectId ? { ...e, project: { ...e.project, status: 'active' } } : e));
      toast.success('Project restored.');
    } catch (error) {
      toast.error('Could not restore project.');
    }
  };

  const handleDeleteProject = async () => {
    if (!projectToDelete) return;
    setIsDeleting(true);
    try {
      await dbService.deleteProject(projectToDelete);
      setProjectCards((current) => current.filter((e) => e.project.id !== projectToDelete));
      if (selectedProjectId === projectToDelete) setSelectedProjectId(null);
      toast.success('Project deleted.');
      setProjectToDelete(null);
    } catch (error) {
      toast.error('Could not delete project.');
    } finally {
      setIsDeleting(false);
    }
  };

  const visibleCards = useMemo(
    () => projectCards.filter((e) => (showArchived ? e.project.status === 'archived' : e.project.status === 'active')),
    [projectCards, showArchived],
  );

  const selectedProjectData = useMemo(
    () => projectCards.find((e) => e.project.id === selectedProjectId),
    [projectCards, selectedProjectId]
  );

  const hasArchivedProjects = projectCards.some((e) => e.project.status === 'archived');

  const stats = useMemo(() => {
    const active = projectCards.filter(c => c.project.status === 'active');
    const inProgress = active.filter(c => 
      ['queued', 'batch_1_research_stack', 'batch_2_fetch_and_read', 'batch_3_architect', 'batch_4_plan_build', 'batch_5_enrich_steps', 'batch_6_generate_files']
        .includes(c.project.generation_status || '') || c.nextStep?.status === 'agent_working'
    ).length;
    const awaiting = active.filter(c => 
      c.project.generation_status === 'awaiting_review' || c.nextStep?.status === 'needs_review'
    ).length;

    return {
      active: active.length,
      inProgress,
      awaiting
    };
  }, [projectCards]);

  const showWelcomeModal = !isOnboarded && !hasSeenWelcome;
  const showChecklist = !isOnboarded && !isDismissed && (hasSeenWelcome || completedSteps.length > 0);

  return (
    <div className="flex flex-col relative w-full">
      {showWelcomeModal && <WelcomeModal />}
      
      {/* Decorative Grid Background */}
      <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none" 
           style={{ backgroundImage: 'radial-gradient(var(--color-text-secondary) 0.5px, transparent 0.5px)', backgroundSize: '24px 24px' }} />
      
      {/* Dashboard Layout */}
      <div className="flex flex-1 overflow-hidden relative z-10">
        
        {/* Left Panel: Project List */}
        <main className="flex flex-col pb-20 lg:pb-0 w-full flex-1">
          <div className="w-full pt-8 pb-8 px-6 lg:px-8">
            {showChecklist && (
              <OnboardingChecklist 
                hasAIKey={hasAIKey}
                hasBuilderProfile={hasBuilderProfile}
                hasProjects={projectCards.length > 0}
              />
            )}
            <header className="mb-8">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-[12px] font-mono text-text-tertiary font-medium mb-1">
                    {getGreeting(user?.displayName)} · {getFormattedDate()}
                  </div>
                  <h1 className="text-title leading-none text-text-primary">
                    Projects
                  </h1>
                  {stats.active > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <div className="rounded-full border border-border-default/50 bg-bg-elevated/30 px-3 py-1 text-[11px] font-medium text-text-secondary">
                        {formatNumberWithCommas(stats.active)} Active Project{stats.active === 1 ? '' : 's'}
                      </div>
                      {stats.inProgress > 0 && (
                        <div className="rounded-full border border-accent-border/30 bg-accent-primary-muted/10 px-3 py-1 text-[11px] font-medium text-accent-soft">
                          {formatNumberWithCommas(stats.inProgress)} In Progress
                        </div>
                      )}
                      {stats.awaiting > 0 && (
                        <div className="rounded-full border border-status-warning/30 bg-status-warning/5 px-3 py-1 text-[11px] font-medium text-status-warning">
                          {formatNumberWithCommas(stats.awaiting)} Awaiting
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {hasArchivedProjects && (
                    <button onClick={() => setShowArchived(!showArchived)} className="btn-secondary h-10 px-4 text-sm">
                      <Archive className="h-4 w-4" />
                      {showArchived ? 'Active' : 'Archive'}
                    </button>
                  )}
                  <button onClick={() => setIsNewProjectModalOpen(true)} className="btn-primary h-10 px-5 font-semibold">
                    <Plus className="h-4 w-4" />
                    New Project
                  </button>
                </div>
              </div>
            </header>

            {loading ? (
              <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="surface-card p-5 border-transparent bg-bg-surface/20 rounded-[20px]">
                    <Skeleton className="h-40 w-full rounded-2xl" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <ErrorState message={error} onRetry={() => void loadDashboard()} />
            ) : visibleCards.length === 0 ? (
              <EmptyState onNewProject={() => setIsNewProjectModalOpen(true)} />
            ) : (
              <motion.div 
                variants={containerVariants} 
                initial="hidden" 
                animate="visible" 
                className="grid grid-cols-1 2xl:grid-cols-2 gap-6"
              >
                {visibleCards.map((entry) => {
                  const isSelected = selectedProjectId === entry.project.id;
                  const isAgentWorking = ['queued', 'batch_1_research_stack', 'batch_2_fetch_and_read', 'batch_3_architect', 'batch_4_plan_build', 'batch_5_enrich_steps', 'batch_6_generate_files'].includes(entry.project.generation_status || '') || entry.nextStep?.status === 'agent_working';
                  const descriptor = getProjectCardDescriptor(entry.project, entry.nextStep, isAgentWorking);
                  const roundedProgress = roundPercent(entry.project.progress);
                  const completedStepCount = entry.steps.filter((step) => step.status === 'complete').length;
                  
                  // Simple hash for project color
                  const colors = ['#eb5e28', '#34d399', '#38bdf8', '#fbbf24', '#a78bfa', '#f472b6'];
                  const projectColor = colors[entry.project.id.length % colors.length];

                  return (
                    <motion.article
                      key={entry.project.id}
                      variants={itemVariants}
                      onClick={() => setSelectedProjectId(entry.project.id)}
                      className={cn(
                        "group relative cursor-pointer overflow-hidden rounded-[20px] border bg-bg-surface/40 p-5 transition-[border-color,background-color] duration-150",
                        isSelected 
                          ? "border-accent-primary shadow-[0_8px_32px_rgba(0,0,0,0.2)] ring-1 ring-accent-primary/20" 
                          : "border-border-default/40 hover:border-white/[0.12] hover:bg-white/[0.02]"
                      )}
                    >
                      {/* Project Identifier Dot */}
                      <div className="absolute left-5 top-5 h-2.5 w-2.5 rounded-full shadow-[0_0_8px_currentcolor]" style={{ backgroundColor: projectColor, color: projectColor }} />
                      
                      {/* Overflow Menu (Hover only) */}
                      <div className="absolute right-4 top-4 opacity-0 transition-opacity group-hover:opacity-100 z-20">
                        <DropdownMenu>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-default bg-bg-elevated text-text-tertiary transition-colors hover:bg-bg-overlay hover:text-text-primary shadow-sm"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </button>
                              </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <TooltipContent>Project actions</TooltipContent>
                          </Tooltip>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => navigate(descriptor.destination)}>
                              <FolderOpen className="mr-2 h-4 w-4" />
                              Open project
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <div className="px-2 py-1.5">
                              <div className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider mb-2">Project Color</div>
                              <div className="flex gap-1.5">
                                {PROJECT_COLORS.map((color) => (
                                  <button
                                    key={color}
                                    onClick={() => {
                                      // TODO: Save color to project when implemented
                                      toast.success('Color updated');
                                    }}
                                    className={cn(
                                      "h-5 w-5 rounded-full transition-transform hover:scale-110",
                                      projectColor === color && "ring-2 ring-offset-2 ring-offset-bg-elevated ring-white"
                                    )}
                                    style={{ backgroundColor: color }}
                                  />
                                ))}
                              </div>
                            </div>
                            <DropdownMenuSeparator />
                            {entry.project.status === 'archived' ? (
                              <DropdownMenuItem onClick={() => void handleRestoreProject(entry.project.id)}>
                                <Undo2 className="mr-2 h-4 w-4" />
                                Restore project
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => void handleArchiveProject(entry.project.id)}
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
                                setProjectToDelete(entry.project.id);
                              }}
                              className="text-status-error hover:bg-status-error/10"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete project
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* Top Row: Title + Status */}
                      <div className="mb-3 flex items-start justify-between gap-3 pl-5 pr-6">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <h2 className="max-w-[240px] text-[16px] font-display font-bold tracking-tight text-text-primary truncate">
                              {entry.project.name}
                            </h2>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[260px] whitespace-normal">
                            {entry.project.name}
                          </TooltipContent>
                        </Tooltip>
                        <div className="shrink-0 -mt-0.5">
                          <ProjectStatusBadge status={descriptor.status} label={descriptor.statusLabel} />
                        </div>
                      </div>

                      {/* Second Row: Category + Updated */}
                      <div className="mb-4 flex items-center gap-2 pl-5 text-[11px] font-mono text-text-tertiary uppercase tracking-widest">
                        <span className="truncate max-w-[120px]">{entry.project.project_type.replace('_', ' ')}</span>
                        <span className="opacity-30">•</span>
                        <span>{formatRelativeTimestamp(entry.project.updated_at)}</span>
                      </div>

                      {/* Middle: Active Step Block (The Focus) */}
                      <div className={cn(
                        "mb-4 rounded-xl border px-3 py-3 relative overflow-hidden transition-colors cursor-pointer",
                        isAgentWorking 
                          ? "border-accent-border/40 bg-accent-primary-muted/10" 
                          : "border-accent-border/60 bg-accent-primary-muted/15 hover:border-accent-border"
                      )}>
                        {isAgentWorking && (
                          <motion.div
                            initial={{ left: '-100%' }}
                            animate={{ left: '100%' }}
                            transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
                            className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-accent-primary/5 to-transparent z-0"
                          />
                        )}
                        
                        <div className="text-[11px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5 relative z-10">
                          NEXT STEP
                        </div>
                        <div className="flex items-center gap-2 text-[13px] font-medium tracking-tight text-text-primary relative z-10 group/nextstep">
                          <span className="truncate group-hover/nextstep:translate-x-0.5 transition-transform duration-200">
                            {descriptor.focusCopy}
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 text-accent-primary shrink-0 opacity-60 group-hover/nextstep:translate-x-1 group-hover/nextstep:opacity-100 transition-all duration-200" />
                        </div>
                      </div>

                      {/* Bottom Row: Progress + Counter + Action */}
                      <div className="flex items-end justify-between gap-3 pt-1">
                        <div className="flex-1 min-w-0">
                          <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.1em] text-text-tertiary">
                            <span className="flex items-center gap-1.5">
                              <span className="h-1 w-1 rounded-full bg-accent-primary" />
                              {roundedProgress}% complete
                            </span>
                            <span className="font-mono bg-bg-elevated/60 px-2 py-0.5 rounded-md text-text-secondary border border-border-default/50">
                              {formatStepCount(completedStepCount, entry.steps.length)}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden relative">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${roundedProgress}%` }}
                              transition={{ duration: 1.2, ease: EASE_OUT_EXPO }}
                              className="absolute inset-y-0 left-0 rounded-full bg-accent-primary" 
                            />
                          </div>
                        </div>
                      </div>
                      
                      {/* Tech Stack Tags */}
                      <div className="mt-4 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          {Object.values(parseStack(entry.project.stack || '{}')).filter(Boolean).slice(0, 3).map((tool, idx) => (
                            <span key={idx} className="px-2 py-0.5 rounded border border-border-default/50 bg-bg-elevated/40 text-[9px] font-mono text-text-secondary uppercase tracking-wider truncate max-w-[80px]">
                              {tool}
                            </span>
                          ))}
                          {Object.values(parseStack(entry.project.stack || '{}')).filter(Boolean).length > 3 && (
                            <span className="text-[9px] font-mono text-text-tertiary">
                              +{Object.values(parseStack(entry.project.stack || '{}')).filter(Boolean).length - 3} more
                            </span>
                          )}
                        </div>
                        
                        <button 
                          onClick={(e) => { e.stopPropagation(); navigate(descriptor.destination); }}
                          className="flex items-center gap-1 text-[11px] font-semibold text-accent-primary hover:text-accent-soft transition-colors"
                        >
                          Continue
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </motion.article>
                  );
                })}
              </motion.div>
            )}
          </div>
        </main>

        {/* Right Panel: Contextual Detail */}
        <AnimatePresence>
        {selectedProjectId && selectedProjectData && (
          <motion.aside 
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={slideInVariants}
            className="hidden lg:flex flex-col overflow-hidden bg-bg-surface/40 backdrop-blur-sm border-l border-border-default/30 shrink-0"
          >
              <motion.div
                key={selectedProjectData.project.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
                className="flex flex-col h-full"
              >
                <div className="p-6 border-b border-border-default/30">
                  <div className="section-label mb-4">Project Details</div>
                  <h3 className="text-xl font-display font-bold text-text-primary tracking-tight mb-2">
                    {selectedProjectData.project.name}
                  </h3>
                  <p className="text-sm text-text-secondary font-light leading-relaxed mb-4">
                    {selectedProjectData.project.description || 'No description provided.'}
                  </p>
                  
                  <div className="flex flex-wrap gap-2">
                    {Object.values(parseStack(selectedProjectData.project.stack || '{}')).filter(Boolean).map(tool => (
                      <span key={tool} className="px-2 py-1 rounded-md border border-border-default bg-bg-elevated/50 text-[10px] font-mono text-text-primary uppercase tracking-wider">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex-1 p-6 space-y-6">
                  {/* Current Focus Card */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                      <div className="text-[11px] font-mono text-text-muted uppercase tracking-[0.2em] font-bold">Next Milestone</div>
                      <span className="text-[10px] font-mono text-accent-primary">
                        {formatStepCount(
                          Math.min(
                            selectedProjectData.steps.length,
                            selectedProjectData.steps.filter((step) => step.status === 'complete').length + 1,
                          ),
                          selectedProjectData.steps.length,
                        )}
                      </span>
                    </div>
                    
                    <div className="rounded-2xl border border-accent-border bg-accent-primary-muted/10 p-5 relative overflow-hidden group">
                      {selectedProjectData.nextStep ? (
                        <>
                          <h4 className="text-base font-semibold text-text-primary mb-2">{selectedProjectData.nextStep.title}</h4>
                          <p className="text-xs text-text-secondary leading-relaxed mb-4">
                            {selectedProjectData.nextStep.objective || 'Focus on completing this task to unlock downstream build steps.'}
                          </p>
                          <button 
                            onClick={() => navigate(getProjectCardDescriptor(selectedProjectData.project, selectedProjectData.nextStep, false).destination)}
                            className="btn-primary w-full h-10 rounded-xl font-semibold tracking-tight"
                          >
                            Continue
                            <ArrowRight className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <div className="text-center py-4">
                          <CheckCircle2 className="h-8 w-8 text-status-secure mx-auto mb-3" />
                          <p className="text-sm font-medium text-text-primary">Plan complete</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Build Health / Quick Stats */}
                  <div className="space-y-5">
                    <div className="text-[11px] font-mono text-text-muted uppercase tracking-[0.2em] font-bold px-1">Build Insights</div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-bg-elevated/40 rounded-2xl border border-border-default/50 p-4">
                        <div className="flex items-center gap-2 text-[10px] text-text-tertiary uppercase tracking-wider mb-2">
                          <Layers className="h-3 w-3" />
                          Stages
                        </div>
                        <div className="text-xl font-display font-bold text-text-primary">
                          {selectedProjectData.stages.filter((stage) => stage.status === 'complete').length} / {selectedProjectData.stages.length}
                        </div>
                      </div>
                      <div className="bg-bg-elevated/40 rounded-2xl border border-border-default/50 p-4">
                        <div className="flex items-center gap-2 text-[10px] text-text-tertiary uppercase tracking-wider mb-2">
                          <History className="h-3 w-3" />
                          Updated
                        </div>
                        <div className="text-[13px] font-medium text-text-primary">
                          {format(new Date(selectedProjectData.project.updated_at), 'MMM d')}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Quick Metadata */}
                  <div className="pt-4 border-t border-border-default/30 space-y-3">
                    <div className="flex items-center justify-between text-xs text-text-tertiary">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5" />
                        Created {format(new Date(selectedProjectData.project.created_at), 'MMMM yyyy')}
                      </div>
                      <button 
                        onClick={() => setSelectedProjectId(null)}
                        className="text-text-muted hover:text-text-primary"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
          </motion.aside>
        )}
        </AnimatePresence>
      </div>

      <Dialog open={!!projectToDelete} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this project? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6 flex gap-3">
            <button onClick={() => setProjectToDelete(null)} className="btn-secondary px-6">Cancel</button>
            <button onClick={handleDeleteProject} className="btn-danger px-6">
              {isDeleting ? 'Deleting...' : 'Delete permanently'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewProjectModal open={isNewProjectModalOpen} onOpenChange={setIsNewProjectModalOpen} />
    </div>
  );
}

