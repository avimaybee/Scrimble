import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
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
import { Project, Plan, Stage, Step, Edge as AppEdge, ChecklistItem } from '../types';
import StepCard from '../components/StepCard';
import DetailPanel from '../components/DetailPanel';
import UnlockToast from '../components/ui/UnlockToast';
import { motion, AnimatePresence } from 'framer-motion';
import { Hexagon, Download, Sparkles } from 'lucide-react';
import { updatePlan as aiUpdatePlan } from '../lib/ai';
import { dbService } from '../lib/db';

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
  const [updateStatus, setUpdateStatus] = useState('');
  const [updateMessage, setUpdateMessage] = useState('');
  const [showUnlockToast, setShowUnlockToast] = useState(false);
  const [unlockedCount, setUnlockedCount] = useState(0);

  const fetchProjectData = useCallback(async () => {
    if (!id) return;
    try {
      const proj = await dbService.getProject(id);
      if (proj) setProject(proj);

      const fetchedStages = await dbService.getStagesByProjectId(id);
      setStages(fetchedStages);

      const fetchedSteps = await dbService.getStepsByProjectId(id);
      setAppSteps(fetchedSteps);

      const fetchedEdges = await dbService.getEdgesByProjectId(id);
      setAppEdges(fetchedEdges);
    } catch (error) {
      console.error("Error fetching project data:", error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProjectData();
  }, [fetchProjectData]);

  const handlePlanUpdate = async () => {
    if (!project || !updateMessage.trim()) return;
    
    setIsUpdating(true);
    setUpdateStatus('Thinking about your changes...');

    try {
      const planSummary = stages.map(stage => ({
        stage: stage.title,
        steps: appSteps
          .filter(s => s.stage_id === stage.id)
          .map(s => ({ id: s.id, title: s.title, status: s.status }))
      }));

      const diff = await aiUpdatePlan(planSummary, project.stack, updateMessage);
      
      setUpdateStatus(`Applying update: "${diff.summary}"`);
      await dbService.applyPlanDiff(diff, project.id);
      
      setUpdateStatus('Done!');
      toast.success(diff.summary);
      
      // Refresh data
      await fetchProjectData();
      
      setTimeout(() => {
        setShowUpdateModal(false);
        setUpdateMessage('');
      }, 500);
    } catch (err: any) {
      console.error(err);
      setUpdateStatus('Something went wrong. Let me try again.');
      toast.error(err.message || "Failed to update your plan");
    } finally {
      setIsUpdating(false);
    }
  };

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
    // Update local state for immediate feedback
    setAppSteps(prev => prev.map(s => s.id === stepId ? { ...s, status: 'complete' } : s));
    
    // Find downstream steps to unlock
    const downstreamEdges = appEdges.filter(e => e.source_step_id === stepId);
    const downstreamStepIds = downstreamEdges.map(e => e.target_step_id);
    
    if (downstreamStepIds.length > 0) {
      let count = 0;
      const updatedSteps = appSteps.map(s => {
        if (downstreamStepIds.includes(s.id) && s.status === 'locked') {
          // Update in DB
          dbService.updateStep(s.id, { status: 'active' }).catch(console.error);
          count++;
          return { ...s, status: 'active' };
        }
        return s;
      });
      
      if (count > 0) {
        setAppSteps(updatedSteps);
        setUnlockedCount(count);
        setShowUnlockToast(true);
        setTimeout(() => setShowUnlockToast(false), 4000);
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
        if (step.objective) md += `**Objective:** ${step.objective}\n\n`;
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

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <Hexagon className="w-8 h-8 text-accent-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-bg-base font-sans overflow-hidden">
      <div className="flex-1 flex relative h-full">
        {/* Sidebar */}
        <div className="w-[280px] bg-bg-surface border-r border-border-subtle flex flex-col shrink-0 z-10 h-full">
          <div className="p-6 border-b border-border-subtle">
            <h2 className="text-panel-title truncate mb-1">{project?.name}</h2>
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
                <div className="text-xs text-text-secondary">completed</div>
              </div>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-1">
              {stages.sort((a, b) => a.order_index - b.order_index).map(stage => {
                const stageSteps = appSteps.filter(s => s.stage_id === stage.id);
                const isComplete = stageSteps.length > 0 && stageSteps.every(s => s.status === 'complete');
                const isActive = stageSteps.some(s => s.status === 'active' || s.status === 'waiting');
                
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
            <button 
              onClick={() => setShowUpdateModal(true)}
              className="btn-ghost w-full flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-accent-primary" />
              Update plan
            </button>
            <button 
              onClick={exportAsMarkdown}
              className="w-full flex items-center justify-center gap-2 text-text-tertiary hover:text-text-primary px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative bg-[radial-gradient(circle,rgba(204,197,185,0.05)_1px,transparent_1px)] bg-[size:28px_28px]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={handleNodeClick}
            nodeTypes={nodeTypes}
            fitView
            className="bg-transparent"
            minZoom={0.1}
            maxZoom={1.5}
            defaultEdgeOptions={{
              style: { stroke: 'var(--color-border-strong)', strokeWidth: 1.5, opacity: 0.6 },
              type: 'bezier',
            }}
          >
            <Controls className="bg-bg-surface border-border-default fill-text-primary" showInteractive={false} />
            <MiniMap 
              nodeColor={(n) => {
                if (n.data?.status === 'complete') return 'var(--color-status-secure)';
                if (n.data?.status === 'active') return 'var(--color-accent-primary)';
                return 'var(--color-border-strong)';
              }}
              maskColor="var(--color-bg-base)"
              className="bg-bg-surface border border-border-default rounded-lg overflow-hidden"
            />
          </ReactFlow>
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
      <Dialog open={showUpdateModal} onOpenChange={(open) => !isUpdating && setShowUpdateModal(open)}>
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
          
          {isUpdating && (
            <div className="flex items-center gap-2 text-sm text-accent-primary">
              <Sparkles className="w-4 h-4 animate-pulse" />
              <span>{updateStatus}</span>
              <span className="flex gap-0.5">
                <motion.span animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0 }}>.</motion.span>
                <motion.span animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }}>.</motion.span>
                <motion.span animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.4 }}>.</motion.span>
              </span>
            </div>
          )}
          
          <DialogFooter>
            <button 
              onClick={() => !isUpdating && setShowUpdateModal(false)}
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
