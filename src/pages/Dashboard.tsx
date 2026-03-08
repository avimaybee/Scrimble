import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Hexagon, ArrowRight, MoreVertical, Archive, Eye, Check } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuthStore } from '../store/authStore';
import { dbService } from '../lib/db';
import { Project } from '../types';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import ErrorBoundary from '../components/ErrorBoundary';

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

export default function Dashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [greeting, setGreeting] = useState('Good morning.');
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    const hour = new Date().getHours();

    if (hour < 12) {
      setGreeting('Good morning.');
    } else if (hour < 18) {
      setGreeting('Good afternoon.');
    } else {
      setGreeting('Good evening.');
    }
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    async function fetchProjects() {
      try {
        const data = await dbService.getProjectsByUserId(user.uid);
        setProjects(data);
      } catch (error) {
        console.error('Error fetching projects:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchProjects();
  }, [user]);

  const handleArchiveProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    try {
      await dbService.updateProject(projectId, { status: 'archived' });
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: 'archived' } : p));
      toast.success('Project archived');
    } catch (error) {
      console.error('Error archiving project:', error);
      toast.error('Failed to archive project');
    }
  };

  const handleUnarchiveProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    try {
      await dbService.updateProject(projectId, { status: 'active' });
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: 'active' } : p));
      toast.success('Project restored');
    } catch (error) {
      console.error('Error restoring project:', error);
      toast.error('Failed to restore project');
    }
  };

  const filteredProjects = projects.filter(p => showArchived ? p.status === 'archived' : p.status === 'active');

  return (
    <motion.main
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="mx-auto w-full max-w-6xl px-6 pb-24 pt-24 font-sans"
    >
      <motion.header
        variants={containerVariants}
        className="mb-12 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"
      >
        <motion.div variants={itemVariants}>
          <h1 className="mb-2 text-4xl font-serif tracking-[-0.03em] text-text-primary">
            {greeting}
          </h1>
        </motion.div>

        <motion.div variants={itemVariants} className="flex items-center gap-3">
          {projects.some(p => p.status === 'archived') && (
            <button 
              onClick={() => setShowArchived(!showArchived)}
              className={cn(
                "btn-ghost flex items-center gap-2 px-4 h-10 rounded-lg text-sm transition-all",
                showArchived ? "bg-bg-elevated text-text-primary" : "text-text-tertiary"
              )}
            >
              <Archive className="w-4 h-4" />
              {showArchived ? 'Active projects' : 'View archive'}
            </button>
          )}
          <Link to="/new" className="btn-primary inline-flex items-center gap-2 rounded-[8px]">
            <Plus className="h-4 w-4" />
            Start something new
          </Link>
        </motion.div>
      </motion.header>

      {loading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[240px] rounded-[14px] border border-border-default bg-bg-surface p-6 shadow-panel">
              <div className="mb-6 flex items-start justify-between">
                <div className="space-y-2">
                  <div className="skeleton-block h-6 w-48" />
                  <div className="skeleton-block h-4 w-32" />
                </div>
                <div className="skeleton-block h-8 w-8 rounded-lg" />
              </div>
              <div className="space-y-4">
                <div className="flex justify-between">
                  <div className="skeleton-block h-4 w-16" />
                  <div className="skeleton-block h-4 w-8" />
                </div>
                <div className="skeleton-block h-2 w-full rounded-full" />
                <div className="pt-4 flex justify-between">
                  <div className="flex gap-2">
                    <div className="skeleton-block h-4 w-12" />
                    <div className="skeleton-block h-4 w-12" />
                  </div>
                  <div className="skeleton-block h-4 w-16" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <motion.div
          variants={itemVariants}
          className="rounded-[14px] border border-dashed border-border-strong bg-bg-surface p-16 text-center shadow-panel"
        >
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[14px] border border-accent-border bg-accent-primary-muted shadow-[0_0_20px_rgba(235,94,40,0.1)]">
            <Hexagon className="h-8 w-8 text-accent-primary" />
          </div>
          <h2 className="mb-2 text-2xl font-serif tracking-[-0.03em] text-text-primary">
            {showArchived ? 'No archived projects' : 'Ready to build?'}
          </h2>
          <p className="mx-auto mb-8 max-w-sm text-text-secondary">
            {showArchived 
              ? 'Archived projects will appear here. You can restore them anytime.' 
              : 'Describe your idea naturally. Scrimble will break it down into a plan you can actually finish.'}
          </p>
          {!showArchived && (
            <Link to="/new" className="btn-primary inline-flex items-center gap-2 rounded-[8px]">
              Build my first plan
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </motion.div>
      ) : (
      <ErrorBoundary
        fallback={
          <div className="w-full rounded-[14px] border border-border-default bg-bg-surface p-16 text-center shadow-panel">
            <p className="mb-6 text-text-primary font-medium">Couldn't load your projects.</p>
            <button 
              onClick={() => window.location.reload()}
              className="btn-primary"
            >
              Retry
            </button>
          </div>
        }
      >
        <motion.div
          variants={containerVariants}
          className="grid grid-cols-1 gap-6 md:grid-cols-2"
        >
          {filteredProjects.map((project) => {
            const stack = JSON.parse(project.stack || '{}') as {
              frontend?: string;
              database?: string;
            };

            return (
              <motion.div
                key={project.id}
                variants={itemVariants}
                onClick={() => navigate(`/project/${project.id}`)}
                className="group relative cursor-pointer overflow-hidden rounded-[14px] border border-border-default bg-bg-surface p-6 shadow-panel transition-all duration-300 hover:border-accent-border hover:shadow-panel-hover"
              >
                <div className="absolute left-0 top-0 h-full w-1 bg-accent-primary opacity-0 transition-opacity group-hover:opacity-100" />

                <div className="mb-6 flex items-start justify-between">
                  <div>
                    <h3 className="mb-1 text-xl font-medium text-text-primary transition-colors group-hover:text-accent-primary">
                      {project.name}
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono uppercase tracking-wider text-text-tertiary">
                        {project.project_type.replace('_', ' ')}
                      </span>
                      <span className="text-text-muted">•</span>
                      <span className="text-xs text-text-tertiary">
                        Updated {formatDistanceToNow(new Date(project.updated_at))} ago
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e: any) => e.stopPropagation()}>
                        <button className="p-2 hover:bg-bg-elevated rounded-lg text-text-tertiary transition-colors">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="bg-bg-surface border-border-default shadow-panel min-w-[160px]">
                        <DropdownMenuItem onClick={() => navigate(`/project/${project.id}`)} className="flex items-center gap-2 py-2">
                          <Eye className="w-4 h-4" />
                          <span>Open project</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border-subtle" />
                        {project.status === 'archived' ? (
                          <DropdownMenuItem onClick={() => { handleUnarchiveProject({ stopPropagation: () => {} } as any, project.id); }} className="flex items-center gap-2 py-2 text-accent-primary">
                            <Check className="w-4 h-4" />
                            <span>Restore project</span>
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => { handleArchiveProject({ stopPropagation: () => {} } as any, project.id); }} className="flex items-center gap-2 py-2 text-status-error">
                            <Archive className="w-4 h-4" />
                            <span>Archive project</span>
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((stage) => (
                        <div
                          key={stage}
                          className={cn(
                            "h-1.5 w-1.5 rounded-full transition-all duration-500",
                            stage <= Math.ceil((project.progress / 100) * 8)
                              ? 'bg-accent-primary shadow-[0_0_6px_rgba(235,94,40,0.5)]'
                              : 'bg-bg-elevated'
                          )}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">Progress</span>
                    <span className="font-mono font-medium text-accent-primary">{project.progress}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
                    <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${project.progress}%` }}
                            transition={{ 
                              type: "spring",
                              stiffness: 100,
                              damping: 20
                            }}
                      className="relative h-full bg-accent-primary"
                    >
                      <div className="absolute right-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                    </motion.div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-4">
                    <div className="flex gap-2">
                      {stack.frontend ? (
                        <span className="rounded-[6px] bg-bg-elevated px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-text-muted">
                          {stack.frontend}
                        </span>
                      ) : null}
                      {stack.database ? (
                        <span className="rounded-[6px] bg-bg-elevated px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-text-muted">
                          {stack.database}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 text-accent-primary opacity-0 transition-all group-hover:translate-x-1 group-hover:opacity-100">
                      <span className="text-xs font-medium">Continue</span>
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </ErrorBoundary>
      )}
    </motion.main>
  );
}
