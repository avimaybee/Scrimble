import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Project,
  Stage,
  Step,
  Edge as AppEdge,
  ChecklistItem,
  StepStatus,
  WorkflowBriefDrift,
  WorkflowUpdateActivity,
} from '../types';
import StepCard from '../components/StepCard';
import DetailPanel from '../components/DetailPanel';
import UnlockToast from '../components/ui/UnlockToast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Activity, 
  Hexagon, 
  Download, 
  LayoutPanelTop, 
  Pencil, 
  Check, 
  X, 
  FileJson, 
  FileText, 
  Info, 
  RotateCcw, 
  Trash2, 
  ChevronRight,
  Sparkles,
  Brain,
  LucideIcon
} from 'lucide-react';
import { dbService } from '../lib/db';
import { WorkflowBriefDriftError } from '../lib/db';
import { updatePlan } from '../lib/ai';
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
import { Skeleton } from '@/components/ui/Skeleton';
import { ThinkingBubble } from '@/components/ui/ThinkingBubble';

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isApplyingDiff, setIsApplyingDiff] = useState(false);
  const [isDownloadingAiFiles, setIsDownloadingAiFiles] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const [showQuickPlanEditor, setShowQuickPlanEditor] = useState(false);
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const [isSavingPlanEdit, setIsSavingPlanEdit] = useState(false);
  const [newStageTitle, setNewStageTitle] = useState('');
  const [newStageType, setNewStageType] = useState('build');
  const [newStepTitle, setNewStepTitle] = useState('');
  const [newStepObjective, setNewStepObjective] = useState('');
  const [newStepStageId, setNewStepStageId] = useState('');
  const [newEdgeSourceId, setNewEdgeSourceId] = useState('');
  const [newEdgeTargetId, setNewEdgeTargetId] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showUnlockToast, setShowUnlockToast] = useState(false);
  const [unlockedCount, setUnlockedCount] = useState(0);
  
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [guideStep, setGuideStep] = useState<number | null>(null);
  const [updateActivities, setUpdateActivities] = useState<WorkflowUpdateActivity[]>([]);
  const [workflowDrift, setWorkflowDrift] = useState<WorkflowBriefDrift | null>(null);
  const [pendingDriftResolution, setPendingDriftResolution] = useState<'apply_now' | 'save_for_later' | null>(null);
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
      if (!proj.generation_runtime) {
        throw new Error('Project runtime state is unavailable.');
      }

      if (proj.generation_runtime.lifecycleStatus === 'intake') {
        navigate(`/new?intake=${id}`, { replace: true });
        return;
      }

      if (proj.generation_runtime.lifecycleStatus !== 'complete') {
        navigate(`/project/${id}/generating`, { replace: true });
        return;
      }

      setProject(proj);

      const [fetchedStages, fetchedSteps, fetchedEdges] = await Promise.all([
        dbService.getStagesByProjectId(id),
        dbService.getStepsByProjectId(id),
        dbService.getEdgesByProjectId(id),
      ]);

      setStages(fetchedStages);
      setAppSteps((fetchedSteps.map(s => ({
        ...s,
        status: s.status as StepStatus
      }))) as Step[]);
      setAppEdges(fetchedEdges);
    } catch (error) {
      console.error('Error fetching project data:', error);
      setLoadError(
        error instanceof Error ? error.message : "Couldn't reopen this project right now.",
      );
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

  useEffect(() => {
    if (!newStepStageId && stages.length > 0) {
      setNewStepStageId(stages[0].id);
    }
  }, [newStepStageId, stages]);

  useEffect(() => {
    if (appSteps.length === 0) {
      setNewEdgeSourceId('');
      setNewEdgeTargetId('');
      return;
    }

    if (!newEdgeSourceId || !appSteps.some((step) => step.id === newEdgeSourceId)) {
      setNewEdgeSourceId(appSteps[0].id);
    }

    if (!newEdgeTargetId || !appSteps.some((step) => step.id === newEdgeTargetId)) {
      const fallbackTarget = appSteps.find((step) => step.id !== appSteps[0].id)?.id || appSteps[0].id;
      setNewEdgeTargetId(fallbackTarget);
    }
  }, [appSteps, newEdgeSourceId, newEdgeTargetId]);

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

  const handlePlanUpdate = async (driftResolution?: 'apply_now' | 'save_for_later') => {
    if (!project || !updateMessage.trim()) return;
    
    setIsUpdating(true);
    if (!driftResolution) {
      setUpdateActivities([]);
    }
    setWorkflowDrift(null);

    try {
      const plan = await dbService.getPlanByProjectId(project.id);
      if (!plan) {
        throw new Error('Could not find the current workflow.');
      }

      const result = await dbService.updateWorkflow(
        plan.id,
        { message: updateMessage, driftResolution },
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
        setWorkflowDrift(null);
      }, 500);
    } catch (err) {
      console.error(err);
      if (err instanceof WorkflowBriefDriftError) {
        setWorkflowDrift(err.drift);
        setUpdateActivities((previous) => [
          ...previous,
          {
            icon: '⚠️',
            message: err.message,
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }
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
      setPendingDriftResolution(null);
    }
  };

  const handleDeleteProject = async () => {
    if (!project) return;
    
    setIsDeleting(true);
    try {
      await dbService.deleteProject(project.id);
      toast.success('Project deleted permanently');
      navigate('/', { replace: true });
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete project');
    } finally {
      setIsDeleting(false);
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
        style: step.is_milestone ? { width: (stageGroupNode?.style?.width as number || 400) - 80 } : undefined,
        data: {
          title: step.title,
          type: step.type,
          category: step.category,
          status: step.status,
          riskLevel: step.risk_level,
          progress: step.status === 'complete' ? 100 : step.status === 'active' ? 25 : 0,
          isGate: step.is_gate,
          isMilestone: step.is_milestone,
          milestoneLabel: step.milestone_label,
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

  const onConnect = useCallback((params: Connection) => {
    if (!project || !params.source || !params.target) {
      return;
    }

    const optimisticId = `temp-${crypto.randomUUID()}`;
    setEdges((existing) =>
      addEdge(
        {
          ...params,
          id: optimisticId,
          type: 'bezier',
        },
        existing,
      ),
    );

    void (async () => {
      try {
        await dbService.createEdge({
          project_id: project.id,
          source_step_id: params.source,
          target_step_id: params.target,
          edge_type: 'default',
          condition: '',
        });
        toast.success('Connection saved.');
        await fetchProjectData();
      } catch (error) {
        setEdges((existing) => existing.filter((edge) => edge.id !== optimisticId));
        const message = error instanceof Error ? error.message : 'Could not save this connection.';
        toast.error(message);
      }
    })();
  }, [fetchProjectData, project, setEdges]);

  const handleNodeClick = useCallback((event: React.MouseEvent, node: FlowNode) => {
    if (node.type !== 'custom') {
      return;
    }
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
      toast.success('Project plan download started');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download project plan.';
      toast.error(message);
    } finally {
      setIsDownloadingAiFiles(false);
    }
  }, [isDownloadingAiFiles, project]);

  const ensureWorkflowExists = useCallback(async (): Promise<void> => {
    if (!project) {
      throw new Error('Project is unavailable.');
    }

    const existingPlan = await dbService.getPlanByProjectId(project.id);
    if (existingPlan) {
      return;
    }

    await dbService.createPlan({
      project_id: project.id,
      version: 1,
      canvas_state: '{}',
    });
  }, [project]);

  const handleCreateStage = useCallback(async () => {
    if (!project || !newStageTitle.trim()) {
      return;
    }

    setIsSavingPlanEdit(true);
    try {
      await ensureWorkflowExists();
      const nextOrder = stages.length > 0
        ? Math.max(...stages.map((stage) => stage.order_index)) + 1
        : 0;
      await dbService.createStage({
        project_id: project.id,
        title: newStageTitle.trim(),
        type: newStageType.trim() || 'build',
        order_index: nextOrder,
        status: 'active',
      });

      setNewStageTitle('');
      toast.success('Stage added to your plan.');
      await fetchProjectData();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not add a stage.';
      toast.error(message);
    } finally {
      setIsSavingPlanEdit(false);
    }
  }, [ensureWorkflowExists, fetchProjectData, newStageTitle, newStageType, project, stages]);

  const handleCreateStep = useCallback(async () => {
    if (!project || !newStepTitle.trim() || !newStepStageId) {
      return;
    }

    const stage = stages.find((item) => item.id === newStepStageId);
    if (!stage) {
      toast.error('Choose a valid stage first.');
      return;
    }

    const stageSteps = appSteps.filter((item) => item.stage_id === stage.id);
    const nextOrder = stageSteps.length > 0
      ? Math.max(...stageSteps.map((item) => item.order_index || 0)) + 1
      : 0;
    const nextX = stageSteps.length > 0
      ? Math.max(...stageSteps.map((item) => item.position_x || 0)) + 260
      : stage.order_index * 260 + 120;
    const nextY = stageSteps.length > 0
      ? Math.max(...stageSteps.map((item) => item.position_y || 0))
      : stage.order_index * 240 + 120;

    setIsSavingPlanEdit(true);
    try {
      await ensureWorkflowExists();
      await dbService.createStep({
        project_id: project.id,
        stage_id: stage.id,
        title: newStepTitle.trim(),
        type: 'task',
        category: stage.type,
        position_x: nextX,
        position_y: nextY,
        status: appSteps.length === 0 ? 'active' : 'locked',
        is_gate: false,
        is_milestone: false,
        risk_level: 'low',
        objective: newStepObjective.trim(),
        why_it_matters: '',
        done_when: '',
        ai_output: '',
        prompts: '[]',
        navigation_links: '[]',
        is_ai_enriched: false,
        order_index: nextOrder,
      });

      setNewStepTitle('');
      setNewStepObjective('');
      toast.success('Step added.');
      await fetchProjectData();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not add this step.';
      toast.error(message);
    } finally {
      setIsSavingPlanEdit(false);
    }
  }, [
    appSteps,
    ensureWorkflowExists,
    fetchProjectData,
    newStepObjective,
    newStepStageId,
    newStepTitle,
    project,
    stages,
  ]);

  const handleCreateEdge = useCallback(async () => {
    if (!project || !newEdgeSourceId || !newEdgeTargetId) {
      return;
    }

    if (newEdgeSourceId === newEdgeTargetId) {
      toast.error('Choose two different steps for this connection.');
      return;
    }

    setIsSavingPlanEdit(true);
    try {
      await ensureWorkflowExists();
      await dbService.createEdge({
        project_id: project.id,
        source_step_id: newEdgeSourceId,
        target_step_id: newEdgeTargetId,
        edge_type: 'default',
        condition: '',
      });
      toast.success('Step connection added.');
      await fetchProjectData();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not connect these steps.';
      toast.error(message);
    } finally {
      setIsSavingPlanEdit(false);
    }
  }, [ensureWorkflowExists, fetchProjectData, newEdgeSourceId, newEdgeTargetId, project]);

  const handleApplyAiDiff = useCallback(async () => {
    if (!project || !updateMessage.trim()) {
      return;
    }

    setIsApplyingDiff(true);
    try {
      const planSummary = stages
        .slice()
        .sort((left, right) => left.order_index - right.order_index)
        .map((stage) => ({
          id: stage.id,
          title: stage.title,
          type: stage.type,
          order_index: stage.order_index,
          steps: appSteps
            .filter((step) => step.stage_id === stage.id)
            .sort((left, right) => (left.order_index || 0) - (right.order_index || 0))
            .map((step) => ({
              id: step.id,
              title: step.title,
              type: step.type,
              objective: step.objective || '',
              why_it_matters: step.why_it_matters || '',
              done_when: step.done_when || '',
              suggested_tools: step.suggested_tools || '[]',
            })),
        }));

      const diff = await updatePlan(planSummary, project.stack, updateMessage);
      await dbService.applyPlanDiff(diff, project.id);
      toast.success(diff.summary || 'Plan diff applied.');
      await fetchProjectData();
      setShowUpdateModal(false);
      setUpdateMessage('');
      setUpdateActivities([]);
      setWorkflowDrift(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not apply this plan diff.';
      toast.error(message);
    } finally {
      setIsApplyingDiff(false);
    }
  }, [appSteps, fetchProjectData, project, stages, updateMessage]);

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-6xl space-y-8">
          <div className="flex gap-8">
            <div className="w-[280px] shrink-0 space-y-6">
              <Skeleton className="h-24 w-full" />
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            </div>
            <div className="flex-1 space-y-8">
              <div className="grid grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <Skeleton key={i} className="h-32 w-full rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-64 w-full rounded-2xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-bg-base px-6 py-16">
        <div className="mx-auto flex max-w-[640px] flex-col items-start gap-5 rounded-[18px] border border-border-default bg-bg-surface p-8 shadow-panel">
          <div className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-status-warning/30 bg-status-warning/10 text-status-warning">
            <RotateCcw className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-serif text-3xl tracking-[-0.03em] text-text-primary">
              I couldn&apos;t reopen this plan yet.
            </h1>
            <p className="mt-3 max-w-[520px] text-sm leading-relaxed text-text-secondary">
              {loadError}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void fetchProjectData()}
              className="btn-primary flex items-center gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Try again
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
      </div>
    );
  }

  const aiFilesReady = Boolean(project?.generation_runtime?.lifecycleStatus === 'complete');
  const currentStep = useMemo(() => {
    const ordered = [...appSteps].sort((left, right) => (left.order_index || 0) - (right.order_index || 0));
    return ordered.find((step) => step.status === 'needs_review')
      ?? ordered.find((step) => step.status === 'agent_working')
      ?? ordered.find((step) => step.status === 'active' || step.status === 'waiting')
      ?? ordered.find((step) => step.status === 'locked')
      ?? null;
  }, [appSteps]);
  const currentStage = useMemo(
    () => stages.find((stage) => stage.id === currentStep?.stage_id) || null,
    [currentStep?.stage_id, stages],
  );
  const blockedReason = useMemo(() => {
    if (!currentStep) {
      return appSteps.length === 0 ? 'Plan structure is still loading.' : null;
    }

    if (currentStep.status === 'needs_review') {
      return 'A review decision is needed before this path can continue.';
    }

    if (currentStep.status === 'agent_working') {
      return 'Scrimble is actively working on this step right now.';
    }

    if (currentStep.status === 'locked') {
      return 'Complete earlier steps to unlock this one.';
    }

    return null;
  }, [appSteps.length, currentStep]);
  const remainingStepCount = appSteps.filter((step) => step.status !== 'complete' && step.status !== 'skipped').length;

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
                  <button
                    type="button"
                    onClick={handleRename}
                    aria-label="Save project name"
                    className="p-1 text-status-secure hover:bg-bg-elevated rounded"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <h2 className="text-panel-title truncate pr-6 group relative">
                    {project?.name}
                    <button 
                      type="button"
                      onClick={() => {
                        setNewName(project?.name || '');
                        setIsEditingName(true);
                      }}
                      aria-label="Rename project"
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

            <div className="mt-6 rounded-[12px] border border-border-default bg-bg-elevated/45 px-3 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">Guided map</div>
              <div className="mt-2 text-[13px] font-medium text-text-primary">
                {currentStep?.title || 'No active step yet'}
              </div>
              <div className="mt-1 text-[12px] text-text-secondary">
                {currentStage ? `Stage: ${currentStage.title}` : 'Stage path will appear here.'}
              </div>
              <div className="mt-2 text-[11px] text-text-muted">
                {remainingStepCount > 0 ? `${remainingStepCount} step${remainingStepCount === 1 ? '' : 's'} left on this path.` : 'All mapped steps are complete.'}
              </div>
              {blockedReason ? (
                <div className="mt-2 rounded-[8px] border border-border-subtle bg-bg-base/50 px-2.5 py-2 text-[11px] text-text-tertiary">
                  {blockedReason}
                </div>
              ) : null}
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-1">
              {[...stages].sort((a, b) => a.order_index - b.order_index).map(stage => {
                const stageSteps = appSteps.filter(s => s.stage_id === stage.id);
                const isComplete = stageSteps.length > 0 && stageSteps.every(s => s.status === 'complete');
                const isActive = stageSteps.some((s) =>
                  ['active', 'waiting', 'agent_working', 'needs_review'].includes(s.status),
                );
                
                return (
                  <button
                    type="button"
                    key={stage.id}
                    onClick={() => {
                      const stageFirstStep = stageSteps
                        .slice()
                        .sort((left, right) => (left.order_index || 0) - (right.order_index || 0))[0];
                      if (stageFirstStep) {
                        setSelectedStepId(stageFirstStep.id);
                      }
                    }}
                    aria-label={`Open stage ${stage.title}`}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                      isActive ? 'bg-accent-primary-muted text-accent-primary font-medium' : 'hover:bg-bg-elevated text-text-secondary'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-[2px] ${
                      isComplete ? 'bg-status-secure' : isActive ? 'bg-accent-primary' : 'bg-border-strong'
                    }`} />
                    {stage.title}
                  </button>
                );
              })}
            </div>
          </div>
          
          <div className="p-4 border-t border-border-subtle space-y-4">
            <button 
              type="button"
              onClick={() => {
                setUpdateActivities([]);
                setShowUpdateModal(true);
              }}
              aria-label="Open plan update"
              className="group w-full flex items-center justify-between px-4 py-3 rounded-xl bg-bg-elevated border border-border-default hover:border-accent-primary/30 transition-all hover:shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-accent-primary/10 text-accent-primary group-hover:bg-accent-primary group-hover:text-white transition-colors">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-text-primary">Update plan</div>
                  <div className="text-[10px] text-text-tertiary">Reshape the build</div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-text-tertiary group-hover:translate-x-0.5 transition-transform" />
            </button>

            <div className="space-y-3">
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
                      {isDownloadingAiFiles ? 'Preparing plan.md...' : 'Download plan.md'}
                    </button>
                  </span>
                </TooltipTrigger>
                {!aiFilesReady ? (
                  <TooltipContent className="max-w-[240px] whitespace-normal px-3 py-2 text-[12px] leading-5">
                    Plan will be ready when your project generation is complete.
                  </TooltipContent>
                ) : null}
              </Tooltip>
            </TooltipProvider>

            <button
              type="button"
              onClick={() => {
                setIsAdvancedMode((current) => {
                  const next = !current;
                  if (!next) {
                    setShowQuickPlanEditor(false);
                  }
                  return next;
                });
              }}
              className="btn-ghost w-full flex items-center justify-center gap-2"
            >
              <Pencil className="w-4 h-4 text-accent-primary" />
              {isAdvancedMode ? 'Advanced mode: on' : 'Advanced mode: off'}
            </button>

            {isAdvancedMode ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowQuickPlanEditor((current) => !current)}
                  className="btn-ghost w-full flex items-center justify-center gap-2"
                >
                  <Pencil className="w-4 h-4 text-accent-primary" />
                  {showQuickPlanEditor ? 'Hide quick edit' : 'Quick edit plan'}
                </button>

                {showQuickPlanEditor ? (
                  <div className="space-y-3 rounded-[10px] border border-border-default bg-bg-elevated/35 p-3">
                    <div className="space-y-2">
                      <label className="block text-[10px] font-mono uppercase tracking-[0.14em] text-text-tertiary">
                        Add stage
                      </label>
                      <input
                        type="text"
                        value={newStageTitle}
                        onChange={(event) => setNewStageTitle(event.target.value)}
                        placeholder="Stage title"
                        className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-[12px] text-text-primary outline-none focus:border-accent-border"
                      />
                      <input
                        type="text"
                        value={newStageType}
                        onChange={(event) => setNewStageType(event.target.value)}
                        placeholder="Stage type (e.g. discover)"
                        className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-[12px] text-text-primary outline-none focus:border-accent-border"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCreateStage()}
                        disabled={isSavingPlanEdit || !newStageTitle.trim()}
                        className="btn-secondary w-full text-[12px] disabled:opacity-60"
                      >
                        Add stage
                      </button>
                    </div>

                    <div className="space-y-2 border-t border-border-default pt-3">
                      <label className="block text-[10px] font-mono uppercase tracking-[0.14em] text-text-tertiary">
                        Add step
                      </label>
                      <select
                        value={newStepStageId}
                        onChange={(event) => setNewStepStageId(event.target.value)}
                        className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-[12px] text-text-primary outline-none focus:border-accent-border"
                      >
                        <option value="">Select stage</option>
                        {stages.map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.title}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={newStepTitle}
                        onChange={(event) => setNewStepTitle(event.target.value)}
                        placeholder="Step title"
                        className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-[12px] text-text-primary outline-none focus:border-accent-border"
                      />
                      <input
                        type="text"
                        value={newStepObjective}
                        onChange={(event) => setNewStepObjective(event.target.value)}
                        placeholder="Optional objective"
                        className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-[12px] text-text-primary outline-none focus:border-accent-border"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCreateStep()}
                        disabled={isSavingPlanEdit || !newStepTitle.trim() || !newStepStageId}
                        className="btn-secondary w-full text-[12px] disabled:opacity-60"
                      >
                        Add step
                      </button>
                    </div>

                    <div className="space-y-2 border-t border-border-default pt-3">
                      <label className="block text-[10px] font-mono uppercase tracking-[0.14em] text-text-tertiary">
                        Connect steps
                      </label>
                      <select
                        value={newEdgeSourceId}
                        onChange={(event) => setNewEdgeSourceId(event.target.value)}
                        className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-[12px] text-text-primary outline-none focus:border-accent-border"
                      >
                        <option value="">Source step</option>
                        {appSteps.map((step) => (
                          <option key={step.id} value={step.id}>
                            {step.title}
                          </option>
                        ))}
                      </select>
                      <select
                        value={newEdgeTargetId}
                        onChange={(event) => setNewEdgeTargetId(event.target.value)}
                        className="w-full rounded-lg border border-border-default bg-bg-base px-3 py-2 text-[12px] text-text-primary outline-none focus:border-accent-border"
                      >
                        <option value="">Target step</option>
                        {appSteps.map((step) => (
                          <option key={step.id} value={step.id}>
                            {step.title}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleCreateEdge()}
                        disabled={isSavingPlanEdit || !newEdgeSourceId || !newEdgeTargetId}
                        className="btn-secondary w-full text-[12px] disabled:opacity-60"
                      >
                        Add connection
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="rounded-[10px] border border-border-default bg-bg-elevated/35 px-3 py-2 text-[11px] leading-5 text-text-tertiary">
                Guided mode keeps editing controls hidden by default.
              </p>
            )}

            <button
              type="button"
              onClick={() => setShowDeleteDialog(true)}
              className="btn-ghost w-full flex items-center justify-center gap-2 text-text-tertiary hover:text-status-error hover:bg-status-error/5"
            >
              <Trash2 className="w-4 h-4" />
              Delete project
            </button>

            {isAdvancedMode ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="w-full flex items-center justify-center gap-2 rounded-[8px] px-4 py-2 text-sm font-medium text-text-tertiary transition-colors hover:text-text-primary">
                  <Download className="w-4 h-4" />
                  Export
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
            ) : null}
            </div>
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
                  type="button"
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
              onNodesChange={isAdvancedMode ? onNodesChange : undefined}
              onEdgesChange={isAdvancedMode ? onEdgesChange : undefined}
              onConnect={isAdvancedMode ? onConnect : undefined}
              onNodeClick={handleNodeClick}
              nodeTypes={nodeTypes}
              fitView
              className="bg-bg-base"
              minZoom={0.1}
              maxZoom={1.5}
              nodesDraggable={isAdvancedMode}
              nodesConnectable={isAdvancedMode}
              elementsSelectable={isAdvancedMode}
              defaultEdgeOptions={{
                style: { stroke: 'var(--color-border-strong)', strokeWidth: 1.5, opacity: 0.6 },
                type: 'bezier',
              }}
            >
              <Background 
                color="rgba(204,197,185,0.18)" 
                gap={28} 
                size={1} 
                className="bg-bg-base"
                variant={BackgroundVariant.Dots}
              />
              <Controls 
                className="bg-bg-surface border-border-default fill-text-primary rounded-lg shadow-panel overflow-hidden" 
                showInteractive={false} 
              />
              <MiniMap 
                nodeColor={(n) => {
                  if (n.data?.isMilestone) return 'var(--color-status-warning)';
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
          
          {/* Canvas Subtle Empty State */}
          {!loading && appSteps.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
              <div className="flex flex-col items-center gap-4 opacity-40">
                <div className="p-4 rounded-full bg-bg-surface border border-dashed border-border-strong">
                  <LayoutPanelTop className="h-6 w-6 text-text-tertiary" />
                </div>
                <p className="text-sm font-medium text-text-tertiary">
                  Your plan is being built...
                </p>
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
                  <button type="button" onClick={dismissGuide} className="text-xs font-medium text-text-muted hover:text-text-primary">Skip</button>
                  <button type="button" onClick={() => setGuideStep(2)} className="btn-primary min-h-0 px-3 py-1.5 text-xs">Next</button>
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
                  <button type="button" onClick={dismissGuide} className="text-xs font-medium text-text-muted hover:text-text-primary">Skip</button>
                  <button type="button" onClick={() => setGuideStep(3)} className="btn-primary min-h-0 px-3 py-1.5 text-xs">Next</button>
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
                  <button type="button" onClick={dismissGuide} className="btn-primary min-h-0 px-4 py-1.5 text-xs">Got it</button>
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
          onProjectUpdated={fetchProjectData}
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
          if (isUpdating || isApplyingDiff) {
            return;
          }

          if (!open) {
            setUpdateActivities([]);
            setWorkflowDrift(null);
            setPendingDriftResolution(null);
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

          {workflowDrift ? (
            <div className="rounded-[14px] border border-[rgba(244,187,102,0.24)] bg-[rgba(244,187,102,0.08)] p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-status-warning">
                Brief drift detected
              </div>
              <p className="mt-2 text-sm leading-7 text-text-primary">
                {workflowDrift.message}
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    setPendingDriftResolution('save_for_later');
                    void handlePlanUpdate('save_for_later');
                  }}
                  disabled={isUpdating}
                  className="btn-ghost"
                >
                  {pendingDriftResolution === 'save_for_later' && isUpdating
                    ? 'Saving...'
                    : workflowDrift.recommendation_save_for_later}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingDriftResolution('apply_now');
                    void handlePlanUpdate('apply_now');
                  }}
                  disabled={isUpdating}
                  className="btn-primary"
                >
                  {pendingDriftResolution === 'apply_now' && isUpdating
                    ? 'Updating brief...'
                    : workflowDrift.recommendation_add_now}
                </button>
              </div>
            </div>
          ) : null}
          
          {(isUpdating || updateActivities.length > 0) && (
            <div className="space-y-4">
              {isUpdating && (
                <ThinkingBubble 
                   content={updateActivities.find(a => a.icon === '🧠' || a.icon === '💬')?.message}
                   isStreaming={isUpdating}
                   className="animate-in fade-in slide-in-from-bottom-2 duration-500"
                />
              )}
              
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
            </div>
          )}
          
          <DialogFooter>
            <button 
              type="button"
              onClick={() => {
                if (isUpdating || isApplyingDiff) {
                  return;
                }

                setUpdateActivities([]);
                setWorkflowDrift(null);
                setPendingDriftResolution(null);
                setShowUpdateModal(false);
              }}
              className="btn-ghost"
              disabled={isUpdating || isApplyingDiff}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleApplyAiDiff()}
              className="btn-ghost"
              disabled={isUpdating || isApplyingDiff || !updateMessage.trim()}
            >
              {isApplyingDiff ? 'Applying diff...' : 'Apply AI diff'}
            </button>
            <button 
              type="button"
              onClick={() => void handlePlanUpdate()}
              className="btn-primary"
              disabled={isUpdating || isApplyingDiff || !updateMessage.trim()}
            >
              {isUpdating ? 'Updating...' : 'Update'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={(open) => !open && setShowDeleteDialog(false)}>
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
              onClick={() => setShowDeleteDialog(false)}
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
    </div>
  );
}
