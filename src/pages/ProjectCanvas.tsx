import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge as FlowEdge,
  Node as FlowNode,
  Panel
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Project,
  Plan,
  Stage,
  Step,
  Edge as AppEdge,
  ChecklistItem,
  StepStatus,
  WorkflowUpdateActivity,
} from '../types';
import StepCard from '../components/StepCard';
import DetailPanel from '../components/DetailPanel';
import UnlockToast from '../components/ui/UnlockToast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Hexagon, Download, LayoutPanelTop, Pencil, Check, X, FileJson, FileText, Info, RotateCcw } from 'lucide-react';
import { dbService } from '../lib/db';
import { cn } from '../lib/utils';
import ErrorBoundary from '../components/ErrorBoundary';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import StageGroup from '../components/StageGroup';

import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const nodeTypes = {
  custom: StepCard,
  stageGroup: StageGroup,
};

export default function ProjectCanvas() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [appSteps, setAppSteps] = useState<Step[]>([]);
  const [appEdges, setAppEdges] = useState<AppEdge[]>([]);
  
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDownloadingAiFiles, setIsDownloadingAiFiles] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const [updateActivities, setUpdateActivities] = useState<WorkflowUpdateActivity[]>([]);
  const [showUnlockToast, setShowUnlockToast] = useState(false);
  const [unlockedCount, setUnlockedCount] = useState(0);
  
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [guideStep, setGuideStep] = useState<number | null>(null);
  const updateActivityLogRef = useRef<HTMLDivElement | null>(null);

  const fetchProjectData = useCallback(async () => {
    if (!id) return;
    try {
      const proj = await dbService.getProject(id);
      if (!proj) {
        setProject(null);
        return;
      }

      if (proj.generation_status !== 'complete') {
        navigate(`/project/${id}/generating`, { replace: true });
        return;
      }

      setProject(proj);

      const fetchedStages = await dbService.getStagesByProjectId(id);
      setStages(fetchedStages);

      const fetchedSteps = await dbService.getStepsByProjectId(id);
      setAppSteps((fetchedSteps.map(s => ({
        ...s,
        status: s.status as StepStatus
      }))) as Step[]);

      const fetchedEdges = await dbService.getEdgesByProjectId(id);
      setAppEdges(fetchedEdges);
    } catch (error) {
      console.error("Error fetching project data:", error);
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchProjectData();
  }, [fetchProjectData]);

  useEffect(() => {
    if (!loading && project) {
      const hasSeenGuide = localStorage.getItem(`scrimble-guide-${project.id}`);
      if (!hasSeenGuide && appSteps.length > 0) {
        setGuideStep(1);
      }
    }
  }, [loading, project, appSteps.length]);

  const handleRename = async () => {
    if (!project || !newName.trim() || newName === project.name) {
      setIsEditingName(false);
      return;
    }

    try {
      await dbService.updateProject(project.id, { name: newName });
      setProject({ ...project, name: newName });
      toast.success('Project renamed');
    } catch (error) {
      toast.error('Failed to rename project');
    } finally {
      setIsEditingName(false);
    }
  };

  const dismissGuide = () => {
    if (project) {
      localStorage.setItem(`scrimble-guide-${project.id}`, 'true');
      setGuideStep(null);
    }
  };

  const handlePlanUpdate = async () => {
    if (!project || !updateMessage.trim()) return;
    
    setIsUpdating(true);
    setUpdateActivities([]);

    try {
      const plan = await dbService.getPlanByProjectId(project.id);
      if (!plan) {
        throw new Error('Could not find the current workflow.');
      }

      const result = await dbService.updateWorkflow(
        plan.id,
        { message: updateMessage },
        {
          onActivity: (activity) => {
            setUpdateActivities((previous) => [...previous, activity]);
          },
        },
      );

      toast.success(result.summary);
      
      // Refresh data
      await fetchProjectData();
      
      setTimeout(() => {
        setShowUpdateModal(false);
        setUpdateMessage('');
        setUpdateActivities([]);
      }, 500);
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : "Failed to update your plan";
      setUpdateActivities((previous) => [
        ...previous,
        {
          icon: '⚠️',
          message: errorMessage,
          timestamp: new Date().toISOString(),
        },
      ]);
      toast.error(errorMessage);
    } finally {
      setIsUpdating(false);
    }
  };

  useEffect(() => {
    const container = updateActivityLogRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [updateActivities]);

  useEffect(() => {
    if (appSteps.length === 0) return;

    const flowNodes: FlowNode[] = [];
    
    // 1. Create stage group nodes
    stages.forEach((stage) => {
      const stageSteps = appSteps.filter(s => s.stage_id === stage.id);
      if (stageSteps.length === 0) return;
      
      const minX = Math.min(...stageSteps.map(s => s.position_x));
      const minY = Math.min(...stageSteps.map(s => s.position_y));
      const maxX = Math.max(...stageSteps.map(s => s.position_x));
      const maxY = Math.max(...stageSteps.map(s => s.position_y));
      
      const padding = 40;
      const width = maxX - minX + 320 + padding * 2; 
      const height = maxY - minY + 150 + padding * 2; 
      
      flowNodes.push({
        id: `stage-${stage.id}`,
        type: 'stageGroup',
        position: { x: minX - padding, y: minY - padding - 40 }, 
        style: { width, height },
        data: {
          label: stage.title,
          type: stage.type,
          status: 'active'
        },
        draggable: false,
        selectable: false,
        zIndex: -1,
      });
    });

    // 2. Create step nodes
    appSteps.forEach(step => {
      const stageGroupNode = flowNodes.find(n => n.id === `stage-${step.stage_id}`);
      
      let position = { x: step.position_x, y: step.position_y };
      
      if (stageGroupNode) {
        position = {
          x: step.position_x - stageGroupNode.position.x,
          y: step.position_y - stageGroupNode.position.y
        };
      }
      
      flowNodes.push({
        id: step.id,
        type: 'custom',
        position,
        parentId: stageGroupNode ? stageGroupNode.id : undefined,
        extent: 'parent',
        data: {
          title: step.title,
          type: step.type,
          category: step.category,
          status: step.status,
          riskLevel: step.risk_level,
          progress: step.status === 'complete' ? 100 : step.status === 'active' ? 25 : 0,
          isGate: step.is_gate,
        },
      });
    });

    const flowEdges: FlowEdge[] = appEdges.map(edge => ({
      id: edge.id,
      source: edge.source_step_id,
      target: edge.target_step_id,
      type: 'bezier',
      animated: appSteps.find(s => s.id === edge.source_step_id)?.status === 'active',
      style: { stroke: 'var(--color-border-strong)', strokeWidth: 1.5, opacity: 0.6 },
    }));

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [appSteps, appEdges, stages, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  const handleNodeClick = useCallback((event: React.MouseEvent, node: FlowNode) => {
    setSelectedStepId(node.id);
  }, []);

  const handleStepComplete = async (stepId: string) => {
    // Capture state for rollback
    const previousSteps = [...appSteps];
    
    // Optimistically update main step
    setAppSteps(prev => prev.map(s => s.id === stepId ? { ...s, status: 'complete' as StepStatus } : s));
    
    // Find downstream steps to unlock
    const downstreamEdges = appEdges.filter(e => e.source_step_id === stepId);
    const downstreamStepIds = downstreamEdges.map(e => e.target_step_id);
    
    if (downstreamStepIds.length > 0) {
      const lockableStepIds = appSteps
        .filter(s => downstreamStepIds.includes(s.id) && s.status === 'locked')
        .map(s => s.id);

      if (lockableStepIds.length > 0) {
        // Optimistically update downstream steps
        setAppSteps(prev => prev.map(s => 
          lockableStepIds.includes(s.id) ? { ...s, status: 'active' as StepStatus } : s
        ));
        
        setUnlockedCount(lockableStepIds.length);
        setShowUnlockToast(true);
        setTimeout(() => setShowUnlockToast(false), 4000);

        // Perform background updates
        try {
          await Promise.all(lockableStepIds.map(id => 
            dbService.updateStep(id, { status: 'active' })
          ));
        } catch (error) {
          console.error("Error unlocking steps:", error);
          toast.error("Couldn't unlock downstream steps. Try reloading.");
          // Rollback
          setAppSteps(previousSteps);
        }
      }
    }
  };

  const exportAsMarkdown = async () => {
    if (!project) return;

    let md = `# ${project.name}\n`;
    md += `**Progress:** ${project.progress}%\n\n`;

    const sortedStages = [...stages].sort((a, b) => a.order_index - b.order_index);

    for (const stage of sortedStages) {
      md += `## Stage: ${stage.title}\n\n`;
      
      const stageSteps = appSteps.filter(s => s.stage_id === stage.id).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
      for (const step of stageSteps) {
        const status = step.status === 'complete' ? '✅' 
                     : step.status === 'skipped'  ? '⏭️' 
                     : '⬜';
        md += `### ${status} ${step.title}\n`;
        if (step.objective) md += `**Goal:** ${step.objective}\n\n`;
        if (step.done_when) md += `**Done when:** ${step.done_when}\n\n`;
        
        const checklistItems = await dbService.getChecklistItemsByStepId(step.id);
        if (checklistItems.length) {
          checklistItems.forEach(item => {
            md += `- [${item.is_completed ? 'x' : ' '}] ${item.label}\n`;
          });
          md += '\n';
        }
      }
    }

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '-').toLowerCase()}-plan.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAsJSON = () => {
    if (!project) return;
    const data = {
      project,
      stages,
      steps: appSteps,
      edges: appEdges
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '-').toLowerCase()}-plan.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAiFiles = useCallback(async () => {
    if (!project || isDownloadingAiFiles) {
      return;
    }

    setIsDownloadingAiFiles(true);

    try {
      await dbService.downloadSkillFiles(project.id);
      toast.success('AI files download started');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download AI files.';
      toast.error(message);
    } finally {
      setIsDownloadingAiFiles(false);
    }
  }, [isDownloadingAiFiles, project]);

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base flex flex-col items-center justify-center">
        <motion.div
          animate={{ 
            scale: [0.95, 1.05, 0.95],
            opacity: [0.5, 1, 0.5] 
          }}
          transition={{ 
            duration: 2, 
            repeat: Infinity, 
            ease: "easeInOut" 
          }}
          className="mb-8 text-accent-primary"
        >
          <Hexagon className="w-12 h-12" />
        </motion.div>
        <div className="flex flex-col items-center gap-2">
          <h2 className="font-serif text-xl text-text-primary tracking-[-0.03em]">Opening your plan...</h2>
          <div className="flex gap-1.5 h-1 items-center">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                className="w-1 h-1 rounded-full bg-accent-primary"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const aiFilesReady = Boolean(project && project.generation_status === 'complete');

  return (
    <div className="flex-1 flex flex-col bg-bg-base font-sans overflow-hidden">
      <div className={cn(
        "flex-1 flex relative h-full transition-all duration-500 ease-[0.16, 1, 0.3, 1]",
        selectedStepId ? "pr-[440px]" : "pr-0"
      )}>
        {/* Sidebar */}
        <div className="w-[280px] bg-bg-surface border-r border-border-subtle flex flex-col shrink-0 z-10 h-full">
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
            <div className="inline-block px-2 py-0.5 bg-bg-elevated border border-border-default rounded text-xs text-text-secondary font-mono capitalize">
              {project?.project_type.replace('_', ' ')}
            </div>
            
            <div className="mt-6 flex items-center gap-4">
              <div className="relative w-12 h-12 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="24" cy="24" r="20" stroke="var(--color-bg-elevated)" strokeWidth="4" fill="none" />
                  <circle 
                    cx="24" cy="24" r="20" 
                    stroke="var(--color-accent-primary)" 
                    strokeWidth="4" fill="none" 
                    strokeDasharray="125.6" 
                    strokeDashoffset={125.6 - (125.6 * (project?.progress || 0) / 100)} 
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>
                <span className="absolute text-xs font-medium">
                  {project?.progress}%
                </span>
              </div>
              <div>
                <div className="text-sm font-medium text-text-primary">
                  {appSteps.filter(s => s.status === 'complete').length} of {appSteps.length} steps
                </div>
                <div className="text-xs text-text-secondary">done</div>
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
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                      isActive ? 'bg-accent-primary-muted text-accent-primary font-medium' : 'hover:bg-bg-elevated text-text-secondary'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-[2px] ${
                      isComplete ? 'bg-status-secure' : isActive ? 'bg-accent-primary' : 'bg-border-strong'
                    }`} />
                    {stage.title}
                  </div>
                );
              })}
            </div>
          </div>
          
          <div className="p-4 border-t border-border-subtle space-y-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block">
                    <button
                      type="button"
                      onClick={() => void handleDownloadAiFiles()}
                      disabled={!aiFilesReady || isDownloadingAiFiles}
                      className="btn-primary w-full flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Download className="w-4 h-4" />
                      {isDownloadingAiFiles ? 'Preparing AI files...' : 'Download AI files'}
                    </button>
                  </span>
                </TooltipTrigger>
                {!aiFilesReady ? (
                  <TooltipContent className="max-w-[240px] whitespace-normal px-3 py-2 text-[12px] leading-5">
                    Files will be ready when your plan is complete.
                  </TooltipContent>
                ) : null}
              </Tooltip>
            </TooltipProvider>
            <p className="px-1 font-sans text-[12px] leading-5 text-text-tertiary">
              Paste these into your IDE so your AI coding tool knows exactly what you&apos;re building.
            </p>
            <button 
              onClick={() => {
                setUpdateActivities([]);
                setShowUpdateModal(true);
              }}
              className="btn-ghost w-full flex items-center justify-center gap-2"
            >
              <LayoutPanelTop className="w-4 h-4 text-accent-primary" />
              Update plan
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger className="w-full">
                <button className="w-full flex items-center justify-center gap-2 text-text-tertiary hover:text-text-primary px-4 py-2 rounded-[8px] text-sm font-medium transition-colors">
                  <Download className="w-4 h-4" />
                  Export
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[248px]">
                <DropdownMenuItem onClick={exportAsMarkdown} className="flex gap-2">
                  <FileText className="w-4 h-4" />
                  <span>Download Markdown (.md)</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportAsJSON} className="flex gap-2">
                  <FileJson className="w-4 h-4" />
                  <span>Download plan (.json)</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex-1 relative">
          <ErrorBoundary
            fallback={
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-base p-8 text-center">
                <div className="mb-6 flex justify-center text-accent-primary">
                  <Hexagon className="h-10 w-10" />
                </div>
                <h3 className="text-2xl font-serif mb-3 text-text-primary">Something went wrong with your plan view.</h3>
                <button 
                  onClick={() => window.location.reload()}
                  className="btn-primary flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reload
                </button>
              </div>
            }
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={handleNodeClick}
              nodeTypes={nodeTypes}
              fitView
              className="bg-bg-base"
              minZoom={0.1}
              maxZoom={1.5}
              defaultEdgeOptions={{
                style: { stroke: 'var(--color-border-strong)', strokeWidth: 1.5, opacity: 0.6 },
                type: 'bezier',
              }}
            >
              <Background 
                color="rgba(204,197,185,0.08)" 
                gap={28} 
                size={1} 
                className="bg-bg-base"
              />
              <Controls 
                className="bg-bg-surface border-border-default fill-text-primary rounded-lg shadow-panel overflow-hidden" 
                showInteractive={false} 
              />
              <MiniMap 
                nodeColor={(n) => {
                  if (n.data?.status === 'complete') return 'var(--color-status-secure)';
                  if (n.data?.status === 'active') return 'var(--color-accent-primary)';
                  if (n.data?.status === 'needs_review') return 'var(--color-status-warning)';
                  return 'var(--color-border-strong)';
                }}
                maskColor="rgba(15, 14, 14, 0.7)"
                className="!bg-bg-surface/80 !backdrop-blur-md border border-border-default rounded-xl overflow-hidden shadow-lg !m-4"
                aria-label="Minimap"
              />
            </ReactFlow>
          </ErrorBoundary>
          
          {/* Empty State Overlay */}
          {!loading && appSteps.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="max-w-md p-8 bg-bg-surface border border-dashed border-border-strong rounded-[14px] shadow-panel text-center pointer-events-auto">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[8px] bg-accent-primary-muted/20">
                  <LayoutPanelTop className="h-8 w-8 text-accent-primary" />
                </div>

                <h3 className="text-2xl font-serif mb-2">Ready to build?</h3>
                <p className="text-text-secondary mb-6 leading-relaxed">
                  Tell Scrimble what changed and it will reshape the plan from here.
                </p>
                <button 
                  onClick={() => {
                    setUpdateActivities([]);
                    setShowUpdateModal(true);
                  }}
                  className="btn-primary"
                >
                  Update this plan
                </button>
              </div>
            </div>
          )}

          {/* User Guide Tooltips */}
          <AnimatePresence>
            {guideStep === 1 && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 10 }}
                className="absolute left-64 top-[50%] z-[60] ml-8 w-64 rounded-[16px] border border-accent-border bg-bg-overlay p-5 text-text-primary shadow-modal"
              >
                <div className="flex gap-1 mb-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-[2px] bg-border-default">
                    <div className="h-full w-1/3 bg-accent-primary" />
                  </div>
                </div>
                <h4 className="font-bold mb-1 flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  1. Your plan
                </h4>
                <p className="mb-4 text-sm leading-relaxed text-text-secondary">
                  This sidebar shows every stage. Use it to see progress and update the whole plan when things change.
                </p>
                <div className="flex justify-between items-center">
                  <button onClick={dismissGuide} className="text-xs font-medium text-text-muted hover:text-text-primary">Skip</button>
                  <button onClick={() => setGuideStep(2)} className="btn-primary min-h-0 px-3 py-1.5 text-xs">Next</button>
                </div>
                <div className="absolute left-[-8px] top-[50%] translate-y-[-50%] w-0 h-0 border-y-8 border-y-transparent border-r-8 border-r-bg-overlay" />
              </motion.div>
            )}

            {guideStep === 2 && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, x: 10 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9, x: 10 }}
                className="absolute left-[50%] top-[40%] z-[60] w-64 -translate-x-1/2 rounded-[16px] border border-accent-border bg-bg-overlay p-5 text-text-primary shadow-modal"
              >
                <div className="flex gap-1 mb-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-[2px] bg-border-default">
                    <div className="h-full w-2/3 bg-accent-primary" />
                  </div>
                </div>
                <h4 className="font-bold mb-1 flex items-center gap-2">
                  <LayoutPanelTop className="w-4 h-4" />
                  2. Your plan view
                </h4>
                <p className="mb-4 text-sm leading-relaxed text-text-secondary">
                  Every step lives here. Click any card to open the work panel and see what to do next.
                </p>
                <div className="flex justify-between items-center">
                  <button onClick={dismissGuide} className="text-xs font-medium text-text-muted hover:text-text-primary">Skip</button>
                  <button onClick={() => setGuideStep(3)} className="btn-primary min-h-0 px-3 py-1.5 text-xs">Next</button>
                </div>
              </motion.div>
            )}

            {guideStep === 3 && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -10 }}
                className="absolute right-8 bottom-32 z-[60] w-64 rounded-[16px] border border-accent-border bg-bg-overlay p-5 text-text-primary shadow-modal"
              >
                <div className="flex gap-1 mb-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-[2px] bg-border-default">
                    <div className="h-full w-full bg-accent-primary" />
                  </div>
                </div>
                <h4 className="font-bold mb-1 flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  3. Keep it moving
                </h4>
                <p className="mb-4 text-sm leading-relaxed text-text-secondary">
                  Update the plan when things change, or export it when you&apos;re ready to build.
                </p>
                <div className="flex justify-end items-center">
                  <button onClick={dismissGuide} className="btn-primary min-h-0 px-4 py-1.5 text-xs">Got it</button>
                </div>
                <div className="absolute right-24 bottom-[-8px] h-0 w-0 border-x-8 border-x-transparent border-t-8 border-t-bg-overlay" />
              </motion.div>
            )}
          </AnimatePresence>
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

      {/* Update Modal */}
      <Dialog
        open={showUpdateModal}
        onOpenChange={(open) => {
          if (isUpdating) {
            return;
          }

          if (!open) {
            setUpdateActivities([]);
          }

          setShowUpdateModal(open);
        }}
      >
        <DialogContent className="sm:max-w-[560px] bg-bg-surface border-border-default shadow-modal">
          <DialogHeader>
            <DialogTitle className="text-heading">Update your build plan</DialogTitle>
            <DialogDescription className="text-body">
              Describe what changed and your plan will adapt.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-2">
            <textarea 
              value={updateMessage}
              onChange={(e) => setUpdateMessage(e.target.value)}
              placeholder="e.g. I want to use Supabase instead of Firebase&#10;Add a mobile app to the plan&#10;Remove the blog section"
              className="w-full h-32 bg-bg-elevated border border-border-default focus:border-accent-border focus:ring-1 focus:ring-accent-border rounded-[8px] p-4 text-text-primary placeholder:text-text-tertiary transition-all duration-200 outline-none resize-none font-sans text-[15px]"
              disabled={isUpdating}
            />
          </div>
          
          {(isUpdating || updateActivities.length > 0) && (
            <div className="rounded-[14px] border border-border-default bg-bg-elevated/70 p-4">
              <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-text-primary">
                <Activity className={cn("h-4 w-4", isUpdating && "animate-pulse text-accent-primary")} />
                <span>Update activity</span>
              </div>
              <div ref={updateActivityLogRef} className="max-h-[180px] space-y-2 overflow-y-auto pr-1">
                {updateActivities.map((activity, index) => (
                  <div key={`${activity.timestamp}-${index}`} className="flex items-start gap-3 rounded-[10px] bg-bg-base/60 px-3 py-2">
                    <span className="text-sm leading-5">{activity.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-sans text-[13px] leading-6 text-text-secondary">{activity.message}</div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
                        {new Date(activity.timestamp).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false,
                        })}
                      </div>
                    </div>
                  </div>
                ))}
                {isUpdating && updateActivities.length === 0 ? (
                  <div className="font-sans text-[13px] leading-6 text-text-secondary">
                    Waiting for the update pipeline to respond...
                  </div>
                ) : null}
              </div>
            </div>
          )}
          
          <DialogFooter>
            <button 
              onClick={() => {
                if (isUpdating) {
                  return;
                }

                setUpdateActivities([]);
                setShowUpdateModal(false);
              }}
              className="btn-ghost"
              disabled={isUpdating}
            >
              Cancel
            </button>
            <button 
              onClick={handlePlanUpdate}
              className="btn-primary"
              disabled={isUpdating || !updateMessage.trim()}
            >
              {isUpdating ? 'Updating...' : 'Update'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
