import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { StepStatus, RiskLevel } from '../types';
import { cn } from '../lib/utils';
import { AlertTriangle, CheckCircle2, Circle, Lock, PlayCircle, SkipForward, RefreshCw, Flag, Sparkles } from 'lucide-react';

import { motion } from 'framer-motion';

interface StepCardData {
  title: string;
  type: string;
  category: string;
  status: StepStatus;
  riskLevel: RiskLevel;
  progress: number;
  isGate: boolean;
  isMilestone: boolean;
  milestoneLabel?: string;
}

function StepCard({ data, selected }: { data: StepCardData; selected?: boolean }) {
  const isLocked = data.status === 'locked';
  const isActive = data.status === 'active';
  const isComplete = data.status === 'complete';
  const isSkipped = data.status === 'skipped';
  const isWaiting = data.status === 'waiting';
  const needsReview = data.status === 'needs_review';
  const isAgentWorking = data.status === 'agent_working';

  if (data.isMilestone) {
    return (
      <div className={cn(
        "milestone-card group",
        selected && "milestone-card--selected",
        isLocked && "milestone-card--locked",
        isActive && "milestone-card--active",
        isComplete && "milestone-card--complete",
        needsReview && "milestone-card--needs-review",
      )}>
        <div className="p-4 flex items-center gap-4">
          <div className={cn(
            "milestone-icon-container",
            isComplete ? "bg-status-secure/10 text-status-secure border-status-secure/20" : 
            needsReview ? "bg-status-warning/10 text-status-warning border-status-warning/20 animate-pulse" :
            "bg-bg-elevated text-text-tertiary border-border-default"
          )}>
            {isComplete ? <CheckCircle2 className="w-5 h-5" /> : <Flag className="w-5 h-5" />}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-text-tertiary">
                Milestone
              </span>
              {data.isGate && (
                <div className="px-1.5 py-0.5 rounded-full bg-status-warning/10 border border-status-warning/20">
                  <span className="text-[8px] font-bold uppercase text-status-warning">Human Gate</span>
                </div>
              )}
            </div>
            <h3 className="font-serif text-lg text-text-primary truncate">
              {data.milestoneLabel || data.title}
            </h3>
          </div>

          {isActive && !needsReview && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-wider">In progress</span>
            </div>
          )}
        </div>

        <Handle type="target" position={Position.Left} className="step-card__handle" />
        <Handle type="source" position={Position.Right} className="step-card__handle" />
      </div>
    );
  }

  return (
    <div className={cn(
      "step-card group",
      selected && "step-card--selected",
      isLocked && "step-card--locked",
      isActive && "step-card--active",
      isComplete && "step-card--complete",
      isSkipped && "step-card--skipped",
      isWaiting && "step-card--waiting",
      needsReview && "step-card--needs-review",
      isAgentWorking && "step-card--working",
    )}>
      {needsReview && (
        <motion.div 
          initial={{ y: -8, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="review-badge"
        >
          Your input needed
        </motion.div>
      )}
      
      {/* Category Stripe */}
      <div className={`step-card__stripe step-card__stripe--${data.category.toLowerCase()}`} />
      
      <div className="p-3">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-1.5">
            {isLocked && <Lock className="w-3 h-3 text-text-tertiary" />}
            {isActive && <PlayCircle className="w-3.5 h-3.5 text-accent-primary animate-pulse" />}
            {isComplete && <CheckCircle2 className="w-3.5 h-3.5 text-status-secure" />}
            {isWaiting && <Circle className="w-3.5 h-3.5 text-status-warning animate-pulse" />}
            {needsReview && <AlertTriangle className="w-3.5 h-3.5 text-status-warning animate-pulse" />}
            {isAgentWorking && <RefreshCw className="w-3.5 h-3.5 text-accent-primary animate-spin" />}
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-tertiary">
              {data.type}
            </span>
          </div>
          
          {data.isGate && (
            <div className="rounded-[6px] border border-status-warning/20 bg-status-warning/10 px-1.5 py-0.5">
              <span className="text-[8px] font-bold uppercase text-status-warning">Review</span>
            </div>
          )}
        </div>

        <h3 className="text-xs font-medium text-text-primary leading-snug mb-1 line-clamp-2">
          {data.title}
        </h3>

        {isAgentWorking && (
          <div className="agent-progress-bar mb-3" />
        )}

        <div className="flex items-center justify-between mt-auto">
          <div className="flex items-center gap-1">
            <AlertTriangle className={cn(
              "w-2.5 h-2.5",
              data.riskLevel === 'critical' ? "text-status-error" : 
              data.riskLevel === 'high' ? "text-status-warning" : "text-text-muted"
            )} />
            <span className="text-[9px] text-text-tertiary uppercase font-medium">
              {data.riskLevel}
            </span>
          </div>
          
          <div className="h-1 w-12 overflow-hidden rounded-[2px] bg-bg-elevated">
            <div 
              className="h-full bg-accent-primary transition-all duration-500" 
              style={{ width: `${data.progress}%` }} 
            />
          </div>
        </div>
      </div>

      <Handle type="target" position={Position.Left} className="step-card__handle" />
      <Handle type="source" position={Position.Right} className="step-card__handle" />
    </div>
  );
}

export default memo(StepCard);
