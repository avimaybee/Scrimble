import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Send, Check, RefreshCw } from 'lucide-react';
import { Step, ChecklistItem, Project } from '../types';
import { cn } from '../lib/utils';
import { dbService } from '../lib/db';
import { callAIProxy, getAIProviders, type AIProvider } from '../lib/ai';
import ReactMarkdown from 'react-markdown';
import confetti from 'canvas-confetti';
import { toast } from 'sonner';
import { useStepExecution } from '../hooks/useStepExecution';

interface DetailPanelProps {
  stepId: string | null;
  project: Project | null;
  onClose: () => void;
  onStepComplete: (stepId: string) => void;
  onProjectUpdated?: () => Promise<void> | void;
}

export default function DetailPanel({
  stepId,
  project,
  onClose,
  onStepComplete,
  onProjectUpdated,
}: DetailPanelProps) {
  const [step, setStep] = useState<Step | null>(null);
  const [tasks, setTasks] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [askingAi, setAskingAi] = useState(false);
  const [showAiChat, setShowAiChat] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const [aiHistory, setAiHistory] = useState<{ role: 'user' | 'ai', content: string }[]>([]);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);
  const [providerLoadError, setProviderLoadError] = useState<string | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState('');

  const loadStepData = useCallback(async () => {
    if (!stepId || !project) {
      setStep(null);
      setTasks([]);
      return;
    }

    setLoading(true);
    try {
      const [fetchedStep, fetchedTasks] = await Promise.all([
        dbService.getStep(stepId),
        dbService.getChecklistItemsByStepId(stepId),
      ]);
      setStep(fetchedStep || null);
      setTasks(fetchedTasks || []);
    } catch (err) {
      console.error('Failed to load step details:', err);
      toast.error('Could not load this step right now.');
    } finally {
      setLoading(false);
    }
  }, [project, stepId]);

  const loadProviders = useCallback(async () => {
    if (!project || !stepId) {
      setProviders([]);
      setSelectedProviderId('');
      return;
    }

    setIsLoadingProviders(true);
    setProviderLoadError(null);
    try {
      const providerList = await getAIProviders();
      setProviders(providerList);
      const defaultProvider = providerList.find((provider) => provider.is_default) || providerList[0];
      setSelectedProviderId((current) => {
        if (current && providerList.some((provider) => provider.id === current)) {
          return current;
        }
        return defaultProvider?.id || '';
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load AI providers.';
      setProviderLoadError(message);
    } finally {
      setIsLoadingProviders(false);
    }
  }, [project, stepId]);

  const { executeStep, cancelExecution, isExecuting, streamingOutput } = useStepExecution({
    onSuccess: () => {
      void loadStepData();
      void onProjectUpdated?.();
    },
    onError: (message) => {
      setAiHistory((prev) => [...prev, { role: 'ai', content: `I couldn't refresh this step yet: ${message}` }]);
    },
  });

  useEffect(() => {
    void loadStepData();
  }, [loadStepData]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    setAiHistory([]);
    setAiMessage('');
    setReviewFeedback('');
    setShowAiChat(false);
  }, [stepId]);

  const toggleTask = async (task: ChecklistItem) => {
    const newStatus = !task.is_completed;
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_completed: newStatus } : t));
    try {
      await dbService.toggleChecklistItem(task.id, newStatus);
    } catch {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_completed: !newStatus } : t));
    }
  };

  const updateTask = async (task: ChecklistItem, newLabel: string) => {
    const trimmed = newLabel.trim();
    if (!trimmed || trimmed === task.label) return;

    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, label: trimmed } : t));
    try {
      await dbService.updateChecklistItem(task.id, { label: trimmed });
    } catch {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, label: task.label } : t));
      toast.error('Failed to update task.');
    }
  };

  const handleCompleteStep = async () => {
    if (!step) {
      return;
    }

    try {
      await dbService.updateStep(step.id, { status: 'complete' });
      confetti({
        particleCount: 40,
        spread: 60,
        colors: ['#EB5E28', '#FFFFFF'],
        origin: { x: 0.8, y: 0.5 },
      });
      onStepComplete(step.id);
      setStep((current) => (current ? { ...current, status: 'complete' } : current));
      await onProjectUpdated?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not mark this step complete.';
      toast.error(message);
    }
  };

  const handleAskAI = async () => {
    if (!aiMessage.trim() || !step || !project) {
      return;
    }

    if (!selectedProviderId) {
      toast.error('Select an AI provider first.');
      return;
    }

    const newMessage = aiMessage.trim();
    setAiMessage('');
    setAiHistory((prev) => [...prev, { role: 'user', content: newMessage }]);
    setAskingAi(true);

    try {
      const response = await callAIProxy({
        providerId: selectedProviderId,
        projectId: project.id,
        stepId: step.id,
        system: `You are Scrimble's step coach. Give concise, practical implementation guidance for one step.
Use markdown with short bullets when useful. Keep advice specific to the project's stack.`,
        prompt: [
          `Project: ${project.name}`,
          `Stack: ${project.stack || 'Unknown stack'}`,
          `Step: ${step.title}`,
          `Objective: ${step.objective || 'Not specified'}`,
          `Current guidance: ${step.ai_output || step.why_it_matters || 'None yet'}`,
          `Question: ${newMessage}`,
        ].join('\n'),
      });

      setAiHistory((prev) => [...prev, { role: 'ai', content: response.trim() || 'No response received.' }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI request failed.';
      setAiHistory((prev) => [...prev, { role: 'ai', content: `I couldn't answer yet: ${message}` }]);
    } finally {
      setAskingAi(false);
    }
  };

  const handleRefreshStepGuidance = async () => {
    if (!step || !project) {
      return;
    }

    if (!selectedProviderId) {
      toast.error('Select an AI provider first.');
      return;
    }

    setShowAiChat(true);
    setAiHistory((prev) => [
      ...prev,
      {
        role: 'ai',
        content: 'Refreshing this step guidance now. I will update the notes when the stream finishes.',
      },
    ]);

    await executeStep(step.id, project.id, {
      providerId: selectedProviderId,
      editedOutput: step.ai_output || step.why_it_matters || '',
    });
  };

  const handleReviewDecision = async (decision: 'approve' | 'reject') => {
    if (!step) {
      return;
    }

    const normalizedFeedback = reviewFeedback.trim();
    if (decision === 'reject' && !normalizedFeedback) {
      toast.error('Add feedback before requesting changes.');
      return;
    }

    try {
      const response = await dbService.submitReview(step.id, {
        decision,
        feedback: normalizedFeedback || undefined,
        edited_output: step.ai_output || undefined,
      });

      setReviewFeedback('');
      toast.success(
        decision === 'approve'
          ? `Review approved${response.unlockedStepIds?.length ? ` (${response.unlockedStepIds.length} step${response.unlockedStepIds.length === 1 ? '' : 's'} unlocked)` : ''}.`
          : 'Feedback sent. The step is ready for another pass.',
      );
      await loadStepData();
      await onProjectUpdated?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not submit this review.';
      toast.error(message);
    }
  };

  return (
    <AnimatePresence>
      {stepId && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm transition-opacity"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%', opacity: 0.5 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0.5 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="fixed right-0 top-0 z-50 flex h-screen w-[340px] flex-col border-l border-border-default bg-bg-surface shadow-[0_0_40px_rgba(0,0,0,0.1)]"
          >
            {loading ? (
              <div className="flex-1 p-6 flex items-center justify-center text-text-muted">Loading...</div>
            ) : step ? (
              <>
                <div className="flex items-center justify-between border-b border-border-subtle p-6">
                  <h2 className="text-xl font-semibold text-text-primary tracking-tight">{step.title}</h2>
                  <button onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-bg-elevated hover:text-text-primary transition-colors">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
                  {step.objective && (
                    <div className="text-[14px] leading-relaxed text-text-secondary">
                      {step.objective}
                    </div>
                  )}

                  <div className="rounded-[12px] bg-[#121212] border border-border-subtle p-5 relative overflow-hidden">
                    <div className="flex items-center gap-1.5 mb-3">
                      <Sparkles className="h-3.5 w-3.5 text-accent-primary" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-accent-primary">AI Notes</span>
                    </div>
                    <div className="text-[13px] leading-relaxed text-text-primary prose prose-invert max-w-none">
                      <ReactMarkdown>{step.ai_output || step.why_it_matters || "Scrimble suggests starting with your core user and working backwards from their specific problem."}</ReactMarkdown>
                    </div>
                  </div>

                  {tasks.length > 0 && (
                    <div>
                      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-text-muted">Tasks</h3>
                      <div className="flex flex-col gap-2">
                        {tasks.map(task => (
                          <div key={task.id} className="flex items-start gap-3 group">
                             <button
                               onClick={() => void toggleTask(task)}
                               className={cn(
                               "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors duration-150 cursor-pointer",
                               task.is_completed ? "border-accent-primary bg-accent-primary text-white" : "border-border-strong text-transparent hover:border-accent-primary"
                             )}>
                               <Check className="h-3 w-3 stroke-[3]" />
                             </button>
                             <input
                               type="text"
                               defaultValue={task.label}
                               onBlur={(e) => void updateTask(task, e.target.value)}
                               onKeyDown={(e) => {
                                 if (e.key === 'Enter') {
                                   e.currentTarget.blur();
                                 }
                               }}
                               className={cn(
                                 "text-[14px] leading-snug transition-colors duration-150 flex-1 bg-transparent border-none outline-none focus:ring-1 focus:ring-accent-primary/50 focus:bg-bg-elevated rounded px-1 -ml-1",
                                 task.is_completed ? "text-text-muted line-through" : "text-text-primary"
                               )}
                             />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {showAiChat && (
                    <div className="mt-4 border-t border-border-subtle pt-4 flex flex-col gap-3">
                      <div className="grid grid-cols-1 gap-2">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                          AI provider
                        </label>
                        <select
                          value={selectedProviderId}
                          onChange={(event) => setSelectedProviderId(event.target.value)}
                          disabled={isLoadingProviders || providers.length === 0 || askingAi || isExecuting}
                          className="w-full rounded-lg border border-border-strong bg-bg-base px-3 py-2 text-[13px] text-text-primary focus:border-accent-primary focus:outline-none disabled:opacity-70"
                        >
                          <option value="">
                            {isLoadingProviders
                              ? 'Loading providers...'
                              : providers.length > 0
                                ? 'Select provider'
                                : 'No providers configured'}
                          </option>
                          {providers.map((provider) => (
                            <option key={provider.id} value={provider.id}>
                              {provider.name}{provider.model ? ` · ${provider.model}` : ''}
                            </option>
                          ))}
                        </select>
                        {providerLoadError ? (
                          <p className="text-[12px] text-status-error">{providerLoadError}</p>
                        ) : null}
                        {providers.length === 0 && !isLoadingProviders ? (
                          <p className="text-[12px] text-text-muted">
                            Add an AI key in Settings to use assistant features.
                          </p>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleRefreshStepGuidance()}
                          disabled={!selectedProviderId || isExecuting || askingAi}
                          className="flex items-center gap-2 rounded-lg border border-border-strong px-3 py-2 text-[12px] font-medium text-text-secondary hover:bg-bg-elevated hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <RefreshCw className={cn('h-3.5 w-3.5', isExecuting && 'animate-spin')} />
                          {isExecuting ? 'Refreshing notes...' : 'Refresh step notes'}
                        </button>
                        {isExecuting ? (
                          <button
                            type="button"
                            onClick={cancelExecution}
                            className="rounded-lg border border-status-warning/30 px-3 py-2 text-[12px] font-medium text-status-warning hover:bg-status-warning/10"
                          >
                            Stop
                          </button>
                        ) : null}
                      </div>

                      {isExecuting ? (
                        <div className="rounded-lg border border-accent-primary/20 bg-accent-primary/5 px-3 py-2 text-[12px] text-text-secondary">
                          Streaming new guidance from your provider...
                          {streamingOutput ? (
                            <div className="mt-2 line-clamp-4 whitespace-pre-wrap font-mono text-[11px] text-text-tertiary">
                              {streamingOutput}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto">
                        {aiHistory.map((msg, i) => (
                          <div key={i} className={cn("text-[13px] p-3 rounded-lg", msg.role === 'user' ? "bg-bg-elevated ml-4" : "bg-accent-primary/10 border border-accent-primary/20 mr-4")}>
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                        ))}
                        {askingAi ? <div className="text-[13px] p-3 text-text-muted animate-pulse">Thinking...</div> : null}
                      </div>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Ask Scrimble for help..."
                          value={aiMessage}
                          onChange={(e) => setAiMessage(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              void handleAskAI();
                            }
                          }}
                          disabled={!selectedProviderId || askingAi || isExecuting}
                          className="w-full rounded-lg border border-border-strong bg-bg-base px-3 py-2 pr-10 text-[13px] text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none disabled:opacity-70"
                        />
                        <button
                          onClick={() => void handleAskAI()}
                          disabled={!selectedProviderId || askingAi || isExecuting || !aiMessage.trim()}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-accent-primary hover:text-accent-hover p-1 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {step.is_gate && step.status === 'needs_review' ? (
                    <div className="rounded-[12px] border border-status-warning/30 bg-status-warning/10 p-4">
                      <h3 className="text-[11px] font-bold uppercase tracking-wider text-status-warning">Gate review</h3>
                      <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
                        This step is waiting for your review before the plan continues.
                      </p>
                      <textarea
                        value={reviewFeedback}
                        onChange={(event) => setReviewFeedback(event.target.value)}
                        placeholder="Optional for approve, required when requesting changes."
                        className="mt-3 h-24 w-full rounded-lg border border-border-strong bg-bg-base px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none resize-none"
                      />
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleReviewDecision('approve')}
                          className="rounded-lg bg-status-secure px-3 py-2 text-[12px] font-medium text-white hover:bg-status-secure/90"
                        >
                          Approve step
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReviewDecision('reject')}
                          className="rounded-lg border border-status-warning/35 px-3 py-2 text-[12px] font-medium text-status-warning hover:bg-status-warning/15"
                        >
                          Request changes
                        </button>
                      </div>
                    </div>
                  ) : null}

                </div>

                <div className="border-t border-border-subtle p-6 flex flex-col gap-3 bg-bg-surface">
                  <button 
                    onClick={handleCompleteStep}
                    disabled={step.status === 'complete' || step.status === 'needs_review'}
                    className="w-full flex items-center justify-center py-3 px-4 bg-accent-primary hover:bg-accent-hover text-white rounded-lg font-medium tracking-tight transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {step.status === 'complete'
                      ? 'Completed'
                      : step.status === 'needs_review'
                        ? 'Submit review to continue'
                        : 'Mark step complete →'}
                  </button>
                  <button 
                    onClick={() => setShowAiChat(!showAiChat)}
                    className="w-full flex items-center justify-center py-2.5 px-4 bg-transparent border border-border-strong hover:bg-bg-elevated text-text-secondary hover:text-text-primary rounded-lg text-[13px] font-medium transition-colors"
                  >
                    {showAiChat ? 'Hide AI assistant' : 'Ask AI for help'}
                  </button>
                </div>
              </>
            ) : null}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
