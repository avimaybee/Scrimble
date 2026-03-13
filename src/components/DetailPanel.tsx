import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Send, Check } from 'lucide-react';
import { Step, ChecklistItem, Project } from '../types';
import { cn } from '../lib/utils';
import { dbService } from '../lib/db';
import ReactMarkdown from 'react-markdown';
import confetti from 'canvas-confetti';

interface DetailPanelProps {
  stepId: string | null;
  project: Project | null;
  onClose: () => void;
  onStepComplete: (stepId: string) => void;
}

export default function DetailPanel({
  stepId,
  project,
  onClose,
  onStepComplete,
}: DetailPanelProps) {
  const [step, setStep] = useState<Step | null>(null);
  const [tasks, setTasks] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [askingAi, setAskingAi] = useState(false);
  const [showAiChat, setShowAiChat] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const [aiHistory, setAiHistory] = useState<{ role: 'user' | 'ai', content: string }[]>([]);

  useEffect(() => {
    if (!stepId || !project) {
      setStep(null);
      setTasks([]);
      return;
    }
    const loadStep = async () => {
      setLoading(true);
      try {
        const [fetchedStep, fetchedTasks] = await Promise.all([
          dbService.getStep(stepId),
          dbService.getChecklistItemsByStepId(stepId)
        ]);
        setStep(fetchedStep || null);
        setTasks(fetchedTasks || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadStep();
  }, [stepId, project]);

  const toggleTask = async (task: ChecklistItem) => {
    const newStatus = !task.is_completed;
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_completed: newStatus } : t));
    try {
      await dbService.toggleChecklistItem(task.id, newStatus);
    } catch {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_completed: !newStatus } : t));
    }
  };

  const handleCompleteStep = async () => {
     if (!step) return;
     confetti({
       particleCount: 40,
       spread: 60,
       colors: ['#EB5E28', '#FFFFFF'],
       origin: { x: 0.8, y: 0.5 }
     });
     onStepComplete(step.id);
  };

  const handleAskAI = async () => {
     if (!aiMessage.trim()) return;
     const newMessage = aiMessage;
     setAiMessage('');
     setAiHistory(prev => [...prev, { role: 'user', content: newMessage }]);
     setAskingAi(true);

     setTimeout(() => {
       setAiHistory(prev => [...prev, { role: 'ai', content: `Here is some help with "${newMessage}"...` }]);
       setAskingAi(false);
     }, 1000);
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
                       <ReactMarkdown>{step.why_it_matters || "Scrimble suggests starting with your core user and working backwards from their specific problem."}</ReactMarkdown>
                    </div>
                  </div>

                  {tasks.length > 0 && (
                    <div>
                      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-text-muted">Tasks</h3>
                      <div className="flex flex-col gap-2">
                        {tasks.map(task => (
                          <label key={task.id} className="flex items-start gap-3 cursor-pointer group" onClick={() => toggleTask(task)}>
                             <div className={cn(
                               "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors duration-150",
                               task.is_completed ? "border-accent-primary bg-accent-primary text-white" : "border-border-strong text-transparent group-hover:border-accent-primary"
                             )}>
                               <Check className="h-3 w-3 stroke-[3]" />
                             </div>
                             <span className={cn(
                               "text-[14px] leading-snug transition-colors duration-150 flex-1 select-none",
                               task.is_completed ? "text-text-muted line-through" : "text-text-primary"
                             )}>
                               {task.label}
                             </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {showAiChat && (
                     <div className="mt-4 border-t border-border-subtle pt-4 flex flex-col gap-3">
                        <div className="flex flex-col gap-2 max-h-[200px] overflow-y-auto">
                           {aiHistory.map((msg, i) => (
                              <div key={i} className={cn("text-[13px] p-3 rounded-lg", msg.role === 'user' ? "bg-bg-elevated ml-4" : "bg-accent-primary/10 border border-accent-primary/20 mr-4")}>
                                {msg.content}
                              </div>
                           ))}
                           {askingAi && <div className="text-[13px] p-3 text-text-muted animate-pulse">Thinking...</div>}
                        </div>
                        <div className="relative">
                          <input 
                            type="text" 
                            placeholder="Ask Scrimble for help..." 
                            value={aiMessage}
                            onChange={(e) => setAiMessage(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAskAI()}
                            className="w-full rounded-lg border border-border-strong bg-bg-base px-3 py-2 pr-10 text-[13px] text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
                          />
                          <button onClick={handleAskAI} className="absolute right-2 top-1/2 -translate-y-1/2 text-accent-primary hover:text-accent-hover p-1">
                             <Send className="h-4 w-4" />
                          </button>
                        </div>
                     </div>
                  )}

                </div>

                <div className="border-t border-border-subtle p-6 flex flex-col gap-3 bg-bg-surface">
                  <button 
                    onClick={handleCompleteStep}
                    disabled={step.status === 'complete'}
                    className="w-full flex items-center justify-center py-3 px-4 bg-accent-primary hover:bg-accent-hover text-white rounded-lg font-medium tracking-tight transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {step.status === 'complete' ? 'Completed' : 'Mark step complete →'}
                  </button>
                  <button 
                    onClick={() => setShowAiChat(!showAiChat)}
                    className="w-full flex items-center justify-center py-2.5 px-4 bg-transparent border border-border-strong hover:bg-bg-elevated text-text-secondary hover:text-text-primary rounded-lg text-[13px] font-medium transition-colors"
                  >
                    Ask AI for help
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
