import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, ExternalLink, RefreshCw, Copy, Activity } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import AnimatedCheckmark from './ui/AnimatedCheckmark';
import { Step, ChecklistItem, Project } from '../types';
import { cn } from '../lib/utils';
import { dbService } from '../lib/db';
import { useStepExecution } from '../hooks/useStepExecution';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { toast } from 'sonner';

interface DetailPanelProps {
  stepId: string | null;
  project: Project | null;
  onClose: () => void;
  onStepComplete: (stepId: string) => void;
}

interface PromptCard {
  label: string;
  content: string;
}

interface SuggestedTool {
  name: string;
  url: string;
}

function parseJsonArray<T>(value: string | undefined): T[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function splitResearchFooter(value: string) {
  const match = value.match(/\n{2}(Researched \d{4}-\d{2}-\d{2}.*)$/s);
  if (!match || match.index === undefined) {
    return { body: value, footer: '' };
  }

  return {
    body: value.slice(0, match.index).trimEnd(),
    footer: match[1].trim(),
  };
}

function getStepStatusLabel(status: Step['status']) {
  switch (status) {
    case 'agent_working':
      return 'Working';
    case 'needs_review':
      return 'Needs review';
    case 'waiting':
      return 'Waiting';
    default:
      return status;
  }
}

export default function DetailPanel({ stepId, project, onClose, onStepComplete }: DetailPanelProps) {
  const [step, setStep] = useState<Step | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSkipWarning, setShowSkipWarning] = useState(false);
  const [stepAction, setStepAction] = useState<'complete' | 'skip' | null>(null);

  // Step Execution Hook
  const { executeStep, isExecuting, streamingOutput, error: executionError } = useStepExecution({
    onSuccess: () => {
      if (stepId) fetchStepData(stepId);
    }
  });

  // Review states
  const [isEditing, setIsEditing] = useState(false);
  const [editedOutput, setEditedOutput] = useState('');
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
  const renderedAiOutput = useMemo(
    () => splitResearchFooter(editedOutput || step?.ai_output || 'No details generated.'),
    [editedOutput, step?.ai_output],
  );

  useEffect(() => {
    if (!stepId) {
      setStep(null);
      setChecklist([]);
      setLoadError(null);
      return;
    }

    setStep(null);
    setChecklist([]);
    setLoadError(null);
    void fetchStepData(stepId);
  }, [stepId, project]);

  async function fetchStepData(id: string) {
    setLoading(true);
    setLoadError(null);
    try {
      const [stepData, items] = await Promise.all([
        dbService.getStep(id),
        dbService.getChecklistItemsByStepId(id),
      ]);

      if (stepData) {
        setStep(stepData);
        setEditedOutput(splitResearchFooter(stepData.ai_output || '').body);

        if (stepData.is_ai_enriched === false && project && !isExecuting) {
          void enrichStep(stepData, project);
        }
      } else {
        setStep(null);
        setEditedOutput('');
      }

      setChecklist(items);
    } catch (error) {
      console.error('Error fetching step details:', error);
      setStep(null);
      setChecklist([]);
      setEditedOutput('');
      setLoadError(error instanceof Error ? error.message : 'Could not load this step right now.');
    } finally {
      setLoading(false);
    }
  }

  const enrichStep = async (stepData: Step, projectData: Project, options?: { feedback?: string; editedOutput?: string }) => {
    await executeStep(stepData.id, projectData.id, options);
  };

  const handleRegenerate = () => {
    if (step && project) {
      void enrichStep(step, project, {
        editedOutput: editedOutput.trim() || undefined,
      });
    }
  };

  const handleCheckToggle = async (itemId: string, currentStatus: boolean) => {
    const newStatus = !currentStatus;
    setChecklist(prev => prev.map(item => item.id === itemId ? { ...item, is_completed: newStatus } : item));
    
    try {
      await dbService.toggleChecklistItem(itemId, newStatus);
    } catch (error) {
      console.error("Error updating checklist item:", error);
      toast.error("Couldn't save that change. Try again.");
      // Revert on error
      setChecklist(prev => prev.map(item => item.id === itemId ? { ...item, is_completed: currentStatus } : item));
    }
  };

  const handleComplete = async () => {
    if (!step) return;

    setStepAction('complete');

    try {
      await dbService.updateStep(step.id, {
        status: 'complete',
      });
      onStepComplete(step.id);
      toast.success('Step marked as done.');
      onClose();
    } catch (error) {
      console.error('Error completing step:', error);
      toast.error(error instanceof Error ? error.message : "Couldn't save step completion.");
    } finally {
      setStepAction(null);
    }
  };

  const handleSkip = async () => {
    if (!step) return;

    setStepAction('skip');

    try {
      await dbService.updateStep(step.id, {
        status: 'skipped',
      });
      onStepComplete(step.id);
      toast.success('Step skipped.');
      onClose();
    } catch (error) {
      console.error('Error skipping step:', error);
      toast.error(error instanceof Error ? error.message : "Couldn't skip this step.");
    } finally {
      setStepAction(null);
    }
  };

  const allRequiredChecked = checklist.filter(i => i.is_required).every(i => i.is_completed);
  const suggestedTools = useMemo(() => parseJsonArray<SuggestedTool>(step?.suggested_tools), [step?.suggested_tools]);
  const promptCards = useMemo(() => parseJsonArray<PromptCard>(step?.prompts), [step?.prompts]);
  const enrichmentLoading = isExecuting || (!!step && !step.is_ai_enriched && !executionError && !loadError);
  const isSavingStepDecision = stepAction !== null;

  const handleApprove = async () => {
    if (!step) {
      return;
    }

    setReviewAction('approve');

    try {
      await dbService.submitReview(step.id, {
        decision: 'approve',
        edited_output: editedOutput.trim() || undefined,
      });
      toast.success('Step approved.');
      onStepComplete(step.id);
      onClose();
    } catch (error) {
      console.error('Error approving step:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to approve this step.');
    } finally {
      setReviewAction(null);
    }
  };

  const handleReject = async () => {
    if (!step || !project) {
      return;
    }

    const trimmedFeedback = feedback.trim();
    if (!trimmedFeedback) {
      return;
    }

    setReviewAction('reject');

    try {
      await dbService.submitReview(step.id, {
        decision: 'reject',
        feedback: trimmedFeedback,
        edited_output: editedOutput.trim() || undefined,
      });

      setIsRejectDialogOpen(false);
      setFeedback('');
      setStep((current) => (
        current
          ? {
              ...current,
              status: 'agent_working',
              is_ai_enriched: false,
              ai_output: editedOutput.trim() || current.ai_output,
            }
          : current
      ));

      await enrichStep(step, project, {
        feedback: trimmedFeedback,
        editedOutput: editedOutput.trim() || undefined,
      });
    } catch (error) {
      console.error('Error rejecting step:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to rework this step.');
    } finally {
      setReviewAction(null);
    }
  };

  return (
    <AnimatePresence>
      {stepId && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            "fixed top-0 right-0 bottom-0 h-screen w-[320px] bg-bg-surface border-l border-border-default shadow-panel z-40 flex flex-col font-sans overflow-hidden",
            step?.status === 'needs_review' ? "border-2 border-status-warning/40 shadow-[0_0_20px_rgba(234,179,8,0.2)]" : "border"
          )}
        >
          {step?.status === 'needs_review' && (
            <div className="absolute inset-0 bg-status-warning/5 animate-pulse pointer-events-none z-[-1]" />
          )}
          {step ? (
            <>
              {/* Header */}
              <div className="relative p-6 border-b border-border-subtle shrink-0">
                <div className={cn(
                  "absolute top-0 left-0 right-0 h-1",
                  `bg-stage-${step.category.toLowerCase()}`
                )} />
                <button 
                  onClick={onClose}
                  className="absolute top-4 right-4 p-2 text-text-tertiary hover:text-text-primary transition-colors rounded-[8px] hover:bg-bg-elevated"
                >
                  <X className="w-5 h-5" />
                </button>
                
                <div className="text-label mb-2">
                  {step.category} &gt; {step.type}
                </div>
                <h2 className="font-serif text-[20px] font-semibold text-text-primary leading-tight mb-3 pr-8">
                  {step.title}
                </h2>
                
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "px-2.5 py-1 rounded-[6px] text-xs font-medium uppercase tracking-wide",
                    step.status === 'locked' && "bg-status-locked text-text-secondary",
                    step.status === 'active' && "bg-accent-primary-muted text-accent-primary",
                    step.status === 'agent_working' && "bg-accent-primary-muted text-accent-primary",
                    step.status === 'complete' && "bg-status-secure/20 text-status-secure",
                    step.status === 'skipped' && "bg-status-skipped text-text-secondary",
                    step.status === 'waiting' && "bg-status-waiting text-status-warning",
                    step.status === 'needs_review' && "bg-status-warning/20 text-status-warning animate-pulse",
                  )}>
                    {getStepStatusLabel(step.status)}
                  </span>
                   
                  <span className={cn(
                    "px-2.5 py-1 rounded-[6px] text-xs font-medium flex items-center gap-1",
                    step.risk_level === 'low' && "bg-bg-elevated text-text-secondary",
                    step.risk_level === 'medium' && "bg-status-warning/20 text-status-warning",
                    step.risk_level === 'high' && "bg-accent-primary-muted text-accent-primary",
                    step.risk_level === 'critical' && "bg-status-skipped text-status-error",
                  )}>
                    <AlertTriangle className="w-3 h-3" />
                    How important: {step.risk_level}
                  </span>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {loadError ? (
                  <section className="rounded-[14px] border border-status-error/30 bg-status-error/8 p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-error" />
                      <div className="flex-1">
                        <h3 className="text-sm font-medium text-text-primary">
                          I couldn&apos;t reopen this step just now.
                        </h3>
                        <p className="mt-1 text-sm leading-relaxed text-text-secondary">{loadError}</p>
                      </div>
                      {stepId ? (
                        <button
                          type="button"
                          onClick={() => void fetchStepData(stepId)}
                          className="inline-flex items-center gap-2 rounded-[8px] border border-status-error/25 px-3 py-1.5 text-xs font-medium text-status-error transition-colors hover:bg-status-error/10"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Try again
                        </button>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {step.is_gate && step.status === 'needs_review' && (
                  <section className="review-prompt-container">
                    <h3 className="review-prompt-heading">Before I continue — does this look right?</h3>
                    <p className="text-sm text-text-secondary">
                      I&apos;ve drafted this step. Review the details below, make any edits you want, and approve it when it feels right.
                    </p>
                  </section>
                )}

                {/* Goal */}
                <section>
                  <h3 className="mb-2 text-sm font-medium text-text-primary">Goal</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">
                    {step.objective || 'No goal is saved for this step yet.'}
                  </p>
                </section>

                {/* Why this matters */}
                <section>
                  <h3 className="mb-2 text-sm font-medium text-text-primary">Why this matters</h3>
                  <div className="bg-bg-elevated border border-border-default rounded-[10px] p-4">
                    <p className="text-sm text-text-secondary leading-relaxed">
                      {step.why_it_matters || 'No extra context has been added yet.'}
                    </p>
                  </div>
                </section>

                {/* AI output section */}
                <section>
                  <h3 className="mb-2 text-sm font-medium text-text-primary">What the AI prepared</h3>
                   
                  {executionError && (
                    <div className="mb-4 p-3 bg-status-error/10 border border-status-error/20 rounded-[8px] text-xs text-status-error flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      <span>{executionError}</span>
                      <button 
                        onClick={handleRegenerate}
                        className="ml-auto underline font-medium"
                      >
                        Try again
                      </button>
                    </div>
                  )}

                  {(step?.is_ai_enriched || isExecuting) && !loading ? (
                    <div className="bg-bg-elevated border border-border-default rounded-[10px] p-4 relative group">
                      {isEditing ? (
                        <textarea
                          value={editedOutput}
                          onChange={(e) => setEditedOutput(e.target.value)}
                          className="w-full min-h-[160px] bg-transparent text-sm text-text-primary outline-none resize-y font-sans leading-relaxed"
                          autoFocus
                        />
                      ) : (
                        <div className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap font-sans">
                          {isExecuting ? (
                            <>
                              <div className="markdown-content">
                                <ReactMarkdown 
                                  components={{
                                    p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
                                    code: ({ children }) => <code>{children}</code>
                                  }}
                                >
                                  {streamingOutput}
                                </ReactMarkdown>
                              </div>
                              <span className="inline-block w-1.5 h-4 bg-accent-primary ml-1 animate-pulse" />
                            </>
                          ) : (
                            <div className="markdown-content">
                              <ReactMarkdown 
                                components={{
                                  p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
                                  code: ({ children }) => <code>{children}</code>
                                }}
                                >
                                {renderedAiOutput.body || "No details generated."}
                              </ReactMarkdown>
                              {renderedAiOutput.footer ? (
                                <div className="mt-4 border-t border-border-default pt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
                                  {renderedAiOutput.footer}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )}
                      
                      {!isExecuting && !isEditing && step?.is_ai_enriched && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button 
                              className="absolute top-2 right-2 p-1.5 text-text-tertiary hover:text-text-primary bg-bg-surface border border-border-default rounded-md opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs"
                              onClick={handleRegenerate}
                            >
                              <Activity className="w-3 h-3" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Refresh these details</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  ) : (
                    <div className="bg-bg-elevated border border-border-default rounded-[10px] p-5 space-y-3">
                      <div className="skeleton-block h-3 w-full" />
                      <div className="skeleton-block h-3 w-[90%]" />
                      <div className="skeleton-block h-3 w-[85%]" />
                      <div className="pt-2">
                        <span className="text-[10px] font-mono uppercase tracking-widest text-text-tertiary animate-pulse">Getting details for this step...</span>
                      </div>
                    </div>
                  )}
                </section>

                {/* Prompts section */}
                <section>
                  <h3 className="mb-2 text-sm font-medium text-text-primary">Prompts to use</h3>
                  
                  {step.is_ai_enriched && !enrichmentLoading && !loading ? (
                    <div className="space-y-3">
                      {promptCards.length > 0 ? promptCards.map((prompt, i) => (
                        <div key={i} className="prompt-item">
                          <div className="prompt-header">
                            <span className="prompt-label">{prompt.label}</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button 
                                  className="btn-copy"
                                  onClick={() => {
                                    navigator.clipboard.writeText(prompt.content);
                                    toast.success('Copied to clipboard');
                                  }}
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Copy prompt</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <div className="prompt-content">{prompt.content}</div>
                        </div>
                      )) : (
                        <div className="text-sm text-text-tertiary">No prompts available.</div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="skeleton-block h-20 w-full" />
                      <div className="skeleton-block h-20 w-full" />
                    </div>
                  )}
                </section>

                {/* Suggested Tools */}
                {suggestedTools.length > 0 && (
                  <section>
                    <h3 className="mb-3 text-sm font-medium text-text-primary">Suggested tools</h3>
                    <div className="flex flex-wrap gap-2">
                      {suggestedTools.map((tool, idx: number) => (
                        <a 
                          key={idx}
                          href={tool.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 bg-bg-elevated hover:bg-border-default border border-border-default px-3 py-1.5 rounded-[8px] text-sm text-text-primary transition-colors group"
                        >
                          {tool.name}
                          <ExternalLink className="w-3 h-3 text-text-tertiary group-hover:text-text-primary" />
                        </a>
                      ))}
                    </div>
                  </section>
                )}

                {/* Checklist */}
                <section>
                  <h3 className="text-sm font-medium text-text-primary mb-4 flex items-center justify-between">
                    Things to check
                    <span className="text-xs font-mono text-text-tertiary">
                      {checklist.filter(i => i.is_completed).length}/{checklist.length}
                    </span>
                  </h3>
                  <div className="space-y-3">
                    {!loading ? checklist.map(item => (
                      <label 
                        key={item.id} 
                        className={cn(
                          "checklist-item-container flex items-start gap-4 p-4 rounded-[14px] border cursor-pointer transition-all duration-300",
                          item.is_completed 
                            ? "bg-accent-primary-muted/10 border-accent-primary/20 shadow-sm" 
                            : "bg-bg-elevated/50 border-border-default hover:border-border-strong hover:bg-bg-elevated"
                        )}
                      >
                        <div className="mt-0.5 relative flex items-center justify-center w-5 h-5 shrink-0">
                          <input 
                            type="checkbox"
                            checked={item.is_completed}
                            onChange={() => handleCheckToggle(item.id, item.is_completed)}
                            className="checklist-checkbox peer"
                          />
                          <div className={cn(
                            "absolute inset-0 border-2 rounded transition-all duration-300 pointer-events-none",
                            item.is_completed ? "border-accent-primary bg-accent-primary" : "border-border-strong"
                          )} />
                          <AnimatedCheckmark 
                            isChecked={item.is_completed} 
                            className="absolute z-10 h-3.5 w-3.5 text-text-primary" 
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className={cn(
                            "checklist-label text-[15px] block leading-relaxed transition-all duration-300",
                            item.is_completed ? "item-completed" : "text-text-primary"
                          )}>
                            {item.label}
                            {item.is_required && <span className="text-status-secure ml-1.5 font-bold">*</span>}
                          </span>
                        </div>
                      </label>
                    )) : (
                      <>
                        <div className="skeleton-block h-14 w-full" />
                        <div className="skeleton-block h-14 w-full" />
                        <div className="skeleton-block h-14 w-full" />
                      </>
                    )}
                  </div>
                </section>

                {/* Done When */}
                <section>
                      <div className="bg-status-secure/10 border border-status-secure/30 rounded-[10px] p-4">
                        <h3 className="text-xs font-semibold text-status-secure uppercase tracking-wider mb-2">Done when...</h3>
                        <p className="text-sm text-text-primary leading-relaxed">
                       {step.done_when || 'Complete the items above.'}
                        </p>
                      </div>
                </section>
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-border-subtle bg-bg-surface shrink-0">
                {step.is_gate && step.status === 'needs_review' ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-3">
                        <button 
                          onClick={() => setIsEditing(!isEditing)}
                          disabled={reviewAction !== null}
                          className={cn(
                            "flex-1 py-2.5 rounded-[8px] text-sm font-medium border transition-all disabled:cursor-not-allowed disabled:opacity-60",
                            isEditing 
                              ? "bg-accent-primary text-text-primary border-accent-primary" 
                              : "bg-bg-elevated text-text-primary border-border-default hover:border-border-strong"
                        )}
                      >
                        {isEditing ? 'Save edits' : 'Edit'}
                      </button>
                        <button 
                          onClick={() => setIsRejectDialogOpen(true)}
                          disabled={reviewAction !== null}
                          className="flex-1 py-2.5 rounded-[8px] text-sm font-medium border border-status-warning/30 bg-status-warning/10 text-status-warning hover:bg-status-warning/20 transition-all disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Rework this
                        </button>
                      </div>
                      <button 
                        onClick={handleApprove}
                        disabled={reviewAction !== null}
                        className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {reviewAction === 'approve' ? 'Saving your approval...' : 'Looks good →'}
                      </button>
                    </div>
                ) : showSkipWarning ? (
                  <div className="bg-bg-elevated border border-status-warning rounded-[14px] p-4 mb-4">
                    <div className="flex items-start gap-3 mb-3">
                      <AlertTriangle className="w-5 h-5 text-status-warning shrink-0" />
                      <div>
                        <h4 className="text-sm font-semibold text-text-primary">Skipping is risky</h4>
                        <p className="text-xs text-text-secondary mt-1">
                          This step helps keep the plan steady. Skipping it could make later work harder.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setShowSkipWarning(false)}
                        disabled={isSavingStepDecision}
                        className="flex-1 bg-bg-surface border border-border-default hover:bg-border-default text-sm font-medium py-2 rounded-[8px] transition-colors"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={handleSkip}
                        disabled={isSavingStepDecision}
                        className="flex-1 bg-status-warning/20 text-status-warning hover:bg-status-warning/30 text-sm font-medium py-2 rounded-[8px] transition-colors"
                      >
                        {stepAction === 'skip' ? 'Skipping...' : 'Skip this step'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => setShowSkipWarning(true)}
                      disabled={isSavingStepDecision}
                      className="text-sm font-medium text-text-tertiary hover:text-text-primary transition-colors px-2"
                    >
                      Skip this
                    </button>
                    <button 
                      onClick={handleComplete}
                      disabled={!allRequiredChecked || isSavingStepDecision}
                      className="flex-1 btn-primary py-3"
                    >
                      {stepAction === 'complete' ? 'Saving...' : 'Mark as done'}
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-8 flex h-full items-center justify-center">
              <div className="max-w-[280px] text-center">
                <p className="text-sm text-text-secondary">
                  {loading
                    ? 'Opening this step...'
                    : loadError || 'This step is no longer available.'}
                </p>
                {stepId && !loading ? (
                  <button
                    type="button"
                    onClick={() => void fetchStepData(stepId)}
                    className="mt-4 inline-flex items-center gap-2 rounded-[8px] border border-border-default px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:border-border-strong"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Reload step
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Rejection Feedback Dialog */}
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent className="sm:max-w-[480px] bg-bg-surface border-border-default shadow-modal rounded-[16px]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl tracking-[-0.03em] text-text-primary">What should I change?</DialogTitle>
            <DialogDescription className="text-body mt-2">
              Tell me what feels off or what is missing. I&apos;ll rewrite this step around your feedback.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <textarea 
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="e.g. Keep the data structure simpler for now.&#10;Add a security check for the upload step."
              className="w-full h-32 bg-bg-elevated border border-border-default focus:border-accent-border focus:ring-1 focus:ring-accent-border rounded-[14px] p-4 text-text-primary placeholder:text-text-tertiary transition-all duration-200 outline-none resize-none font-sans text-[15px]"
              autoFocus
            />
          </div>
          
          <DialogFooter className="gap-2 sm:gap-0">
            <button 
              onClick={() => setIsRejectDialogOpen(false)}
              className="btn-ghost"
            >
              Cancel
            </button>
            <button 
              onClick={handleReject}
              disabled={!feedback.trim() || reviewAction !== null}
              className="btn-primary"
            >
              {reviewAction === 'reject' ? 'Reworking...' : 'Send feedback'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatePresence>
  );
}

