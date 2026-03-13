import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  Project,
  Plan,
  Stage,
  Step,
  Edge as AppEdge,
  ChecklistItem,
  StepStatus,
  WorkflowBriefDrift,
  WorkflowUpdateActivity,
} from '../types';
import DetailPanel from '../components/DetailPanel';
import UnlockToast from '../components/ui/UnlockToast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { Lock, Activity, Hexagon, Download, LayoutPanelTop, Pencil, Check, X, FileJson, FileText, Info, RotateCcw, Trash2, Sparkles } from 'lucide-react';
import { dbService } from '../lib/db';
import { WorkflowBriefDriftError } from '../lib/db';
import { cn } from '../lib/utils';
import { formatStepCount, roundPercent } from '../lib/formatting';
import ErrorBoundary from '../components/ErrorBoundary';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function TimelineStepCard({ step, onClick, isActive, checklists }: { step: Step, onClick: () => void, isActive: boolean, checklists: ChecklistItem[] }) {
  const isCompleted = step.status === 'complete';
  const isCurrent = step.status === 'active' || step.status === 'needs_review';
  const isLocked = step.status === 'locked';
  const isAvailable = !isCompleted && !isCurrent && !isLocked;

  const totalTasks = checklists.length;
  const doneTasks = checklists.filter(t => t.is_completed).length;
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : (isCompleted ? 100 : 0);

  return (
    <div className="relative group cursor-pointer ml-8 py-2" onClick={isLocked ? undefined : onClick}>
      {/* Spine Line connecting to next */}
      <div className={cn(
        "absolute -left-[23px] top-8 bottom-[-40px] w-0.5 z-0",
        isCompleted ? "bg-status-secure" : 
        isCurrent ? "bg-accent-primary" : 
        "border-l-[2px] border-dashed border-white/10 bg-transparent"
      )} />

      {/* Timeline node element for this step */}
      <div className="absolute -left-[30px] top-6 w-4 h-4 rounded-full flex items-center justify-center bg-bg-base z-10">
        {isCompleted ? (
           <div className="w-4 h-4 rounded-full bg-status-secure flex items-center justify-center text-bg-base">
             <Check className="w-3 h-3 stroke-[3]" />
           </div>
        ) : isCurrent ? (
           <div className="w-3 h-3 rounded-full bg-accent-primary animate-pulse shadow-[0_0_8px_rgba(235,94,40,0.6)]" />
        ) : (
           <div className={cn("w-2 h-2 rounded-full", isLocked ? "bg-white/10" : "bg-border-strong")} />
        )}
      </div>

      <div className={cn(
        "rounded-[12px] p-4 transition-all duration-200",
        isCompleted ? "bg-[#141414] border border-border-default hover:border-border-strong" :
        isCurrent ? "bg-accent-primary/5 border border-accent-primary/40 shadow-[0_4px_24px_rgba(235,94,40,0.05)]" :
        isLocked ? "opacity-50 grayscale cursor-not-allowed border border-border-subtle" :
        "bg-bg-surface border border-border-default hover:border-border-strong hover:bg-bg-elevated"
      )}>
        <div className="flex justify-between items-start mb-1">
          <h4 className={cn(
             "text-[15px] font-semibold tracking-tight transition-colors",
             isCompleted ? "text-text-secondary line-through decoration-text-secondary/40" : "text-text-primary"
          )}>
            {step.title}
          </h4>
          <div className="flex items-center gap-2">
            {step.status === 'needs_review' && (
               <span className="px-2 py-0.5 rounded-[4px] bg-accent-primary/20 text-accent-primary text-[10px] font-bold tracking-wider uppercase">
                 Your Review
               </span>
            )}
            {isLocked && <Lock className="w-3.5 h-3.5 text-text-muted" />}
          </div>
        </div>
        
        <p className="text-[14px] text-text-secondary w-full truncate max-w-[480px]">
          {step.objective || step.title}
        </p>

        {(isCurrent || isAvailable) && totalTasks > 0 && (
          <div className="mt-4 flex items-center gap-3">
             <div className="flex-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden max-w-[160px]">
                <div className="h-full bg-text-secondary transition-all" style={{ width: `${progressPct}%` }} />
             </div>
             <span className="text-[12px] text-text-muted">
               {progressPct}% · {formatStepCount(doneTasks, totalTasks)}
             </span>
           </div>
        )}
      </div>
    </div>
  );
}

export default function ProjectCanvas() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [appSteps, setAppSteps] = useState<Step[]>([]);
  const [appEdges, setAppEdges] = useState<AppEdge[]>([]);
  const [checklists, setChecklists] = useState<Record<string, ChecklistItem[]>>({});

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDownloadingAiFiles, setIsDownloadingAiFiles] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const [updateActivities, setUpdateActivities] = useState<WorkflowUpdateActivity[]>([]);
  const [workflowDrift, setWorkflowDrift] = useState<WorkflowBriefDrift | null>(null);
  const [pendingDriftResolution, setPendingDriftResolution] = useState<'apply_now' | 'save_for_later' | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showUnlockToast, setShowUnlockToast] = useState(false);
  const [unlockedCount, setUnlockedCount] = useState(0);

  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const updateActivityLogRef = useRef<HTMLDivElement | null>(null);

  const fetchProjectData = useCallback(async () => {
    if (!id) return;

    setLoading(true);
    setLoadError(null);
    try {
      const proj = await dbService.getProject(id);
      if (!proj) {
        setProject(null);
        return;
      }

      if (proj.generation_status === 'intake') {
        navigate(`/new?intake=${id}`, { replace: true });
        return;
      }

      setProject(proj);

      const [fetchedStages, fetchedSteps, fetchedEdges] = await Promise.all([
        dbService.getStagesByProjectId(id),
        dbService.getStepsByProjectId(id),
        dbService.getEdgesByProjectId(id)
      ]);

      setStages(fetchedStages);
      setAppSteps(fetchedSteps);
      setAppEdges(fetchedEdges);

      const allChecklists: Record<string, ChecklistItem[]> = {};
      const itemsArrays = await Promise.all(fetchedSteps.map(step => dbService.getChecklistItemsByStepId(step.id).catch(() => [])));
      fetchedSteps.forEach((step, idx) => {
         allChecklists[step.id] = itemsArrays[idx];
      });
      setChecklists(allChecklists);

    } catch (error) {
      console.error('Error fetching project data:', error);
      setLoadError(error instanceof Error ? error.message : 'Error fetching project data');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    void fetchProjectData();
  }, [fetchProjectData]);

  useEffect(() => {
    document.title = project?.name ? `${project.name} — Scrimble` : 'Plan — Scrimble';
  }, [project?.name]);

  // Handle updates scrolling
  useEffect(() => {
    const container = updateActivityLogRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [updateActivities]);

  const handleStepComplete = async (stepId: string) => {
    const previousSteps = [...appSteps];
    setAppSteps(prev => prev.map(s => s.id === stepId ? { ...s, status: 'complete' as StepStatus } : s));

    const downstreamEdges = appEdges.filter(e => e.source_step_id === stepId);
    const downstreamStepIds = downstreamEdges.map(e => e.target_step_id);
    let newUnlockedCount = 0;

    const newStatuses = new Map<string, StepStatus>();
    for (const targetId of downstreamStepIds) {
      const targetStep = previousSteps.find(s => s.id === targetId);
      if (!targetStep || targetStep.status !== 'locked') continue;

      const incomingEdges = appEdges.filter(e => e.target_step_id === targetId);
      const blockerIds = incomingEdges.map(e => e.source_step_id);
      
      const allOtherBlockersFinished = blockerIds
        .filter(id => id !== stepId)
        .every(id => {
          const blocker = previousSteps.find(s => s.id === id);
          return blocker?.status === 'complete';
        });

      if (allOtherBlockersFinished) {
        newUnlockedCount++;
        newStatuses.set(targetId, 'active');
      }
    }

    if (newUnlockedCount > 0) {
      setAppSteps(prev => prev.map(s => {
        if (newStatuses.has(s.id)) {
          return { ...s, status: newStatuses.get(s.id)! };
        }
        return s;
      }));
      setUnlockedCount(newUnlockedCount);
      setShowUnlockToast(true);
    }

    try {
      await dbService.updateStep(stepId, { status: 'complete' });
      if (newStatuses.size > 0) {
        for (const [targetId, status] of newStatuses.entries()) {
          await dbService.updateStep(targetId, { status });
        }
      }

      if (project) {
        const remainingSteps = appSteps.length;
        const completeSteps = previousSteps.filter(s => s.id !== stepId && s.status === 'complete').length + 1;
        const progress = Math.round((completeSteps / remainingSteps) * 100);
        
        await dbService.updateProject(project.id, { progress });
        setProject(prev => prev ? { ...prev, progress } : null);
      }
    } catch (err) {
      setAppSteps(previousSteps);
      toast.error("Failed to complete step");
      console.error(err);
    }
  };

  const handleRename = async () => {
    if (!project || !newName.trim()) return;
    try {
      await dbService.updateProject(project.id, { name: newName.trim() });
      setProject({ ...project, name: newName.trim() });
      setIsEditingName(false);
      toast.success('Project renamed');
    } catch (error) {
      console.error('Failed to rename:', error);
      toast.error('Failed to rename project');
    }
  };

  const handleDelete = async () => {
    if (!project) return;
    setIsDeleting(true);
    try {
      await dbService.deleteProject(project.id);
      navigate('/', { replace: true });
    } catch (error) {
      console.error('Failed to delete project:', error);
      toast.error('Failed to delete project');
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const exportAsMarkdown = () => {
    // Basic Markdown Export
    let md = `# ${project?.name}\n\n`;
    stages.forEach(stage => {
      md += `## ${stage.title}\n`;
      const stageSteps = appSteps.filter(s => s.stage_id === stage.id);
      stageSteps.forEach(step => {
        md += `### [${step.status.toUpperCase()}] ${step.title}\n`;
        md += `${step.objective || ''}\n\n`;
      });
    });
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `\${project?.name.replace(/\s+/g, '_')}_plan.md`;
    a.click();
  };

  const exportAsJSON = () => {
    const data = {
      project, stages, steps: appSteps, edges: appEdges
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `\${project?.name.replace(/\s+/g, '_')}_plan.json`;
    a.click();
  };

  const handlePlanUpdate = async () => {
    if (!updateMessage.trim() || !project) return;
    setIsUpdating(true);
    
    setTimeout(() => {
      setIsUpdating(false);
      setShowUpdateModal(false);
      setUpdateMessage('');
      toast.success("Plan updated (SIMULATED)");
    }, 2000);
  };

  const handleDownloadAiFiles = async () => {
    setIsDownloadingAiFiles(true);
    setTimeout(() => {
      setIsDownloadingAiFiles(false);
      toast.success("AI contextual zip ready (SIMULATED)");
    }, 1000);
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh] bg-bg-base">
        <div className="w-[800px] h-[500px]" />
      </div>
    );
  }

  if (loadError || !project) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh] bg-bg-base">
        <p className="text-status-error mb-4">{loadError || 'Project not found'}</p>
        <button className="btn-primary" onClick={() => navigate('/dashboard')}>
          Go to Dashboard
        </button>
      </div>
    );
  }

  const aiFilesReady = project.generation_status === 'complete';
  const sortedStages = [...stages].sort((a, b) => a.order_index - b.order_index);
  const roundedProjectProgress = roundPercent(project.progress);

  return (
    <div className="flex-1 flex flex-col bg-bg-base font-sans overflow-hidden">
      <div className={cn(
        "flex-1 flex relative h-full transition-all duration-500 ease-[0.16, 1, 0.3, 1]",
        selectedStepId ? "pr-[340px]" : "pr-0"
      )}>
        {/* Sidebar */}
        <div className="w-[280px] bg-bg-surface border-r border-border-subtle flex flex-col shrink-0 z-10 h-full shadow-[4px_0_24px_rgba(0,0,0,0.2)] relative">
          <div className="p-6 border-b border-border-subtle">
            <div className="flex items-start justify-between mb-1">
              {isEditingName ? (
                <div className="flex items-center gap-1 w-full">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename();
                      if (e.key === 'Escape') setIsEditingName(false);
                    }}
                    className="flex-1 bg-bg-elevated border border-accent-primary/30 rounded px-2 py-1 text-sm text-text-primary outline-none focus:ring-1 focus:ring-accent-primary"
                  />
                  <button onClick={handleRename} className="p-1 text-status-secure hover:bg-bg-elevated rounded">
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <h2 className="text-panel-title truncate pr-6 group relative">
                    {project?.name}
                    <button 
                      onClick={() => {
                        setNewName(project?.name || '');
                        setIsEditingName(true);
                      }}
                      className="ml-2 p-1 text-text-tertiary hover:text-text-primary transition-colors inline-block"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </h2>
                </>
              )}
            </div>
            <div className="inline-block mt-2 px-2 py-0.5 bg-[#1a1a1a] border border-border-default rounded text-xs text-text-secondary font-mono capitalize">
              {project?.project_type.replace('_', ' ')}
            </div>
            
            <div className="mt-8 flex items-center gap-4">
              <div className="relative w-14 h-14 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="28" cy="28" r="24" stroke="var(--color-bg-elevated)" strokeWidth="4.5" fill="none" />
                  <circle 
                    cx="28" cy="28" r="24" 
                    stroke="var(--color-accent-primary)" 
                    strokeWidth="4.5" fill="none" 
                    strokeDasharray="150.7" 
                    strokeDashoffset={150.7 - (150.7 * roundedProjectProgress / 100)} 
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>
                <span className="absolute text-xs font-semibold">
                  {roundedProjectProgress}%
                </span>
              </div>
              <div>
                <div className="text-[15px] font-medium text-text-primary">
                  {formatStepCount(appSteps.filter((step) => step.status === 'complete').length, appSteps.length)}
                </div>
                <div className="text-xs text-text-muted uppercase tracking-wider font-bold">Steps Done</div>
              </div>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-1">
              {stages.sort((a, b) => a.order_index - b.order_index).map(stage => {
                const stageSteps = appSteps.filter(s => s.stage_id === stage.id);
                const isComplete = stageSteps.length > 0 && stageSteps.every(s => s.status === 'complete');
                const isActive = stageSteps.some((s) =>
                  ['active', 'waiting', 'agent_working', 'needs_review'].includes(s.status),
                );
                
                return (
                  <div 
                    key={stage.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer \${
                      isActive ? 'bg-accent-primary-muted text-accent-primary font-medium' : 'hover:bg-bg-elevated text-text-secondary'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-[2px] \${
                      isComplete ? 'bg-status-secure' : isActive ? 'bg-accent-primary shadow-[0_0_8px_rgba(235,94,40,0.6)]' : 'bg-border-strong'
                    }`} />
                    {stage.title}
                  </div>
                );
              })}
            </div>
          </div>
          
          <div className="p-4 border-t border-border-subtle flex flex-col gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block w-full">
                    <button
                      type="button"
                      onClick={() => void handleDownloadAiFiles()}
                      disabled={!aiFilesReady || isDownloadingAiFiles}
                      className="btn-primary w-full flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Download className="w-4 h-4" />
                      {isDownloadingAiFiles ? 'Preparing AI files...' : 'Download AI context'}
                    </button>
                  </span>
                </TooltipTrigger>
                {!aiFilesReady ? (
                  <TooltipContent>
                    Files will be ready when plan is complete.
                  </TooltipContent>
                ) : null}
              </Tooltip>
            </TooltipProvider>

            <button 
              onClick={() => {
                setUpdateActivities([]);
                setShowUpdateModal(true);
              }}
              className="btn-ghost w-full flex items-center justify-center gap-2 hover:bg-bg-elevated text-text-secondary hover:text-text-primary h-10 rounded-lg text-sm font-medium transition-colors"
            >
              <LayoutPanelTop className="w-4 h-4 text-text-muted" />
              Update timeline
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger className="w-full">
                <button className="w-full flex items-center justify-center gap-2 hover:bg-bg-elevated text-text-secondary hover:text-text-primary px-4 py-2 h-10 rounded-lg text-sm font-medium transition-colors">
                  <Download className="w-4 h-4 text-text-muted" />
                  Export plan
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[248px]">
                <DropdownMenuItem onClick={exportAsMarkdown} className="flex gap-2">
                  <FileText className="w-4 h-4" />
                  <span>Download Markdown (.md)</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportAsJSON} className="flex gap-2">
                  <FileJson className="w-4 h-4" />
                  <span>Download JSON (.json)</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <button 
              onClick={() => setShowDeleteDialog(true)}
              className="mt-2 w-full flex items-center justify-center gap-2 text-text-tertiary hover:text-status-error hover:bg-status-error/10 h-10 rounded-lg text-[13px] font-medium transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete project
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto bg-bg-base relative isolate flex flex-col pt-8">
          <div className="max-w-[700px] w-full mx-auto py-8 px-12">
            
            <div className="mb-12">
               <h1 className="text-[32px] font-serif tracking-tight text-text-primary mb-2">Project Roadmap</h1>
               <p className="text-text-secondary text-[15px] leading-relaxed">
                 Follow these steps in sequence. Click a card to see instructions and check off tasks.
               </p>
            </div>

            {appSteps.length === 0 ? (
              <div className="text-text-muted italic py-8">No steps generated yet.</div>
            ) : (
              <div className="relative">
                <div className="flex flex-col gap-0 pb-16">
                  {sortedStages.map(stage => {
                    const stageSteps = appSteps.filter(s => s.stage_id === stage.id).sort((a,b) => (a.order_index || 0) - (b.order_index || 0));
                    if (stageSteps.length === 0) return null;
                    return (
                      <div key={stage.id} className="relative z-10 flex flex-col mb-4">
                        <div className="h-10 pt-4 flex items-center mb-2 pl-4">
                           <h3 className="text-text-muted text-[11px] font-bold uppercase tracking-widest relative z-10 bg-bg-base pr-4">
                             {stage.title}
                           </h3>
                           <div className="h-px bg-border-subtle flex-1 -ml-4" />
                        </div>
                        <div className="pl-4 flex flex-col gap-0 relative">
                          {stageSteps.map((step, idx) => (
                            <TimelineStepCard 
                              key={step.id} 
                              step={step} 
                              onClick={() => setSelectedStepId(step.id)}
                              isActive={selectedStepId === step.id}
                              checklists={checklists[step.id] || []}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Detail Panel Overlay */}
        <DetailPanel 
          stepId={selectedStepId} 
          project={project}
          onClose={() => setSelectedStepId(null)} 
          onStepComplete={handleStepComplete}
        />
        
        <UnlockToast 
          show={showUnlockToast} 
          count={unlockedCount} 
          onClose={() => setShowUnlockToast(false)} 
        />
      </div>

      <Dialog open={showUpdateModal} onOpenChange={(open) => { if (!isUpdating) setShowUpdateModal(open); }}>
        <DialogContent className="max-w-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-accent-primary" />
              Update your plan
            </DialogTitle>
            <DialogDescription>
              Describe what changed in your project. Scrimble will adjust existing steps and add new ones if needed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
             <textarea
               value={updateMessage}
               onChange={(e) => setUpdateMessage(e.target.value)}
               placeholder="I want to add a Stripe payment gateway..."
               className="h-32 w-full resize-none rounded-lg border border-border-default bg-bg-base p-3 text-sm focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
               disabled={isUpdating}
             />
             {updateActivities.length > 0 && (
                <div ref={updateActivityLogRef} className="max-h-48 overflow-y-auto rounded bg-bg-elevated p-3 font-mono text-[11px]">
                  {updateActivities.map((act, i) => (
                    <div key={i} className="mb-2 last:mb-0 text-text-secondary flex gap-2">
                      <span>{act.icon}</span> <span>{act.message}</span>
                    </div>
                  ))}
                </div>
             )}
          </div>
          <DialogFooter>
            <button onClick={() => void handlePlanUpdate()} disabled={isUpdating || !updateMessage.trim()} className="btn-primary">
              {isUpdating ? 'Updating...' : 'Update Plan'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={(open) => { if (!isDeleting) setShowDeleteDialog(open); }}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this project? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button onClick={() => setShowDeleteDialog(false)} disabled={isDeleting} className="btn-ghost">
              Cancel
            </button>
            <button onClick={() => void handleDelete()} disabled={isDeleting} className="btn-danger">
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
