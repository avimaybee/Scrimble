import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Hexagon, Sparkles, X, ArrowRight, Loader2, Check, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { dbService } from '../lib/db';
import { getAIProviders, type AIProvider } from '../lib/ai';
import { useAuthStore } from '../store/authStore';
import { cn } from '../lib/utils';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const TEMPLATES = [
  {
    id: 'saas',
    label: 'SaaS MVP',
    description: 'multi-tenant SaaS with authentication, subscriptions, dashboard, and CRUD operations',
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    description: 'personal portfolio with responsive design, project showcase, and contact form',
  },
  {
    id: 'api',
    label: 'API Service',
    description: 'REST/GraphQL API with authentication, rate limiting, and OpenAPI documentation',
  },
  {
    id: 'landing',
    label: 'Landing Page',
    description: 'high-converting landing page with hero, features, testimonials, and pricing sections',
  },
];

const PROGRESS_STEPS = [
  { key: 'analyzing', label: 'Analyzing your idea...' },
  { key: 'structuring', label: 'Structuring your build phases...' },
  { key: 'generating', label: 'Generating step details...' },
  { key: 'finalizing', label: 'Finalizing your roadmap...' },
];

interface NewProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewProjectModal({ open, onOpenChange }: NewProjectModalProps) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState('');
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [hasAiKey, setHasAiKey] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectStats, setProjectStats] = useState({ phases: 0, steps: 0 });

  const characterCount = prompt.length;
  const maxCharacters = 2000;
  const isOverLimit = characterCount > maxCharacters;
  const canSubmit = prompt.trim().length > 0 && !isOverLimit && hasAiKey && !isLoading;

  useEffect(() => {
    if (!open) {
      setPrompt('');
      setIsLoading(false);
      setLoadingStep(0);
      setError('');
      setCreatedProjectId(null);
      setProjectName('');
    }
  }, [open]);

  useEffect(() => {
    const loadProviders = async () => {
      try {
        const providerList = await getAIProviders();
        setProviders(providerList);
        const defaultProvider = providerList.find((p) => p.is_default) || providerList[0];
        if (defaultProvider) {
          setSelectedProviderId(defaultProvider.id);
        }
        setHasAiKey(providerList.length > 0);
      } catch (err) {
        console.error('Failed to load providers:', err);
        setHasAiKey(false);
      }
    };
    if (open) {
      loadProviders();
    }
  }, [open]);

  const triggerConfetti = useCallback(() => {
    const duration = 2000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };

    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      const timeLeft = animationEnd - Date.now();
      if (timeLeft <= 0) {
        return clearInterval(interval);
      }
      const particleCount = 50 * (timeLeft / duration);
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
        colors: ['#eb5e28', '#f39f7e', '#fffcf2', '#34d399'],
      });
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
        colors: ['#eb5e28', '#f39f7e', '#fffcf2', '#34d399'],
      });
    }, 250);

    setTimeout(() => clearInterval(interval), duration);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !user) return;

    setIsLoading(true);
    setError('');
    setLoadingStep(0);

    const stepInterval = setInterval(() => {
      setLoadingStep((prev) => {
        if (prev < PROGRESS_STEPS.length - 1) {
          return prev + 1;
        }
        return prev;
      });
    }, 2500);

    try {
      const session = await dbService.startProjectIntake({
        description: prompt.trim(),
        providerId: selectedProviderId || undefined,
      });

      clearInterval(stepInterval);
      setLoadingStep(PROGRESS_STEPS.length - 1);

      const nameMatch = prompt.trim().match(/^(?:i\s+(?:want\s+to|am\s+building|need\s+to|have\s+a|creating)\s+)?(.{1,50})/i);
      const extractedName = nameMatch ? nameMatch[1].trim() : 'New Project';
      setProjectName(extractedName.charAt(0).toUpperCase() + extractedName.slice(1));

      setCreatedProjectId(session.project_id);

      await dbService.confirmProjectIntake(session.project_id, {
        providerId: selectedProviderId || undefined,
      });

      const steps = await dbService.getStepsByProjectId(session.project_id);
      const stages = await dbService.getStagesByProjectId(session.project_id);
      setProjectStats({ phases: stages.length, steps: steps.length });

      triggerConfetti();

      setTimeout(() => {
        onOpenChange(false);
        navigate(`/project/${session.project_id}/generating`);
      }, 2000);

    } catch (err) {
      clearInterval(stepInterval);
      console.error('Failed to start project:', err);
      setError(err instanceof Error ? err.message : 'Failed to create project. Please try again.');
      setIsLoading(false);
    }
  }, [canSubmit, user, prompt, selectedProviderId, navigate, onOpenChange, triggerConfetti]);

  const handleTemplateClick = useCallback((template: typeof TEMPLATES[0]) => {
    const text = `I want to build a ${template.description}`;
    setPrompt(text);
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  const handleSettingsClick = useCallback(() => {
    onOpenChange(false);
    navigate('/settings');
  }, [navigate, onOpenChange]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-bg-base/80 backdrop-blur-md"
            onClick={() => !isLoading && onOpenChange(false)}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
            className="relative z-10 w-full max-w-[600px] overflow-hidden rounded-2xl border border-border-default bg-bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
          >
            <div className="max-h-[70vh] overflow-y-auto">
              {!isLoading ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.1 }}
                >
                  <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
                    <h2 className="font-serif text-xl font-semibold tracking-tight text-text-primary">
                      New Project
                    </h2>
                    <button
                      onClick={() => onOpenChange(false)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-all hover:bg-bg-elevated hover:text-text-primary"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="p-6 space-y-5">
                    <div>
                      <h3 className="font-serif text-[24px] leading-tight tracking-tight text-text-primary">
                        What do you want to build?
                      </h3>
                      <p className="mt-2 text-sm text-text-secondary">
                        Describe your idea in your own words. The more detail, the better your plan.
                      </p>
                    </div>

                    <div className="relative">
                      <div className="absolute inset-0 rounded-xl border border-border-default bg-bg-elevated/30 pointer-events-none" />
                      <textarea
                        ref={textareaRef}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder='e.g. "I want to build a tool for freelancers to track invoices, send reminders, and see what got paid."'
                        className={cn(
                          "relative w-full min-h-[120px] max-h-[240px] resize-none rounded-xl border bg-[#121212] px-4 py-3 text-[15px] leading-relaxed text-text-primary outline-none placeholder:text-text-tertiary transition-all",
                          "focus:border-accent-border focus:ring-2 focus:ring-accent-primary/20",
                          isOverLimit ? "border-status-error/50" : "border-transparent"
                        )}
                        disabled={isLoading}
                      />
                      <div className={cn(
                        "absolute bottom-3 right-3 font-mono text-[11px] tracking-wider",
                        isOverLimit ? "text-status-error" : "text-text-muted"
                      )}>
                        {characterCount} / {maxCharacters}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <Sparkles className="h-3.5 w-3.5 text-accent-primary" />
                      {hasAiKey ? (
                        <span>
                          Powered by {providers.find(p => p.id === selectedProviderId)?.name || 'your AI key'}
                        </span>
                      ) : (
                        <button
                          onClick={handleSettingsClick}
                          className="flex items-center gap-1 text-status-warning hover:underline"
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                          No AI key configured
                          <span className="inline-link">Add one in Settings</span>
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    <div className="relative flex items-center gap-4">
                      <div className="h-px flex-1 bg-border-default" />
                      <span className="text-xs font-medium text-text-muted uppercase tracking-wider">or</span>
                      <div className="h-px flex-1 bg-border-default" />
                    </div>

                    <div>
                      <p className="mb-3 text-xs font-medium text-text-secondary uppercase tracking-wider">
                        Start from a template
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {TEMPLATES.map((template) => (
                          <button
                            key={template.id}
                            onClick={() => handleTemplateClick(template)}
                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-transparent px-4 py-2 text-sm font-medium text-text-secondary transition-all hover:border-white/20 hover:bg-white/5 hover:text-text-primary"
                          >
                            {template.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {error && (
                      <div className="rounded-lg border border-status-error/30 bg-status-error/10 px-4 py-3 text-sm text-status-error">
                        {error}
                      </div>
                    )}

                    <button
                      onClick={handleSubmit}
                      disabled={!canSubmit}
                      className={cn(
                        "group relative w-full flex items-center justify-center gap-2 h-12 rounded-xl font-semibold text-[15px] transition-all",
                        canSubmit
                          ? "bg-accent-primary text-text-primary hover:bg-accent-primary-hover hover:shadow-[0_8px_24px_rgba(235,94,40,0.25)]"
                          : "bg-bg-elevated text-text-muted cursor-not-allowed"
                      )}
                    >
                      <span>Build my plan</span>
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </div>
                </motion.div>
              ) : !createdProjectId ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="px-6 py-12"
                >
                  <div className="flex flex-col items-center text-center">
                    <motion.div
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      className="mb-6 text-accent-primary"
                    >
                      <Hexagon className="h-10 w-10" />
                    </motion.div>

                    <div className="w-full max-w-[320px] space-y-4">
                      {PROGRESS_STEPS.map((step, index) => (
                        <motion.div
                          key={step.key}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ 
                            opacity: index <= loadingStep ? 1 : 0.3,
                            x: 0,
                          }}
                          transition={{ duration: 0.3, delay: index * 0.1 }}
                          className="flex items-center gap-3"
                        >
                          <div className="flex-shrink-0">
                            {index < loadingStep ? (
                              <Check className="h-4 w-4 text-status-secure" />
                            ) : index === loadingStep ? (
                              <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                              >
                                <Loader2 className="h-4 w-4 text-accent-primary" />
                              </motion.div>
                            ) : (
                              <div className="h-4 w-4 rounded-full border-2 border-text-muted" />
                            )}
                          </div>
                          <span className={cn(
                            "text-[15px] tracking-tight",
                            index <= loadingStep ? "text-text-primary" : "text-text-muted"
                          )}>
                            {step.label}
                          </span>
                        </motion.div>
                      ))}
                    </div>

                    <p className="mt-8 text-xs text-text-muted">
                      This usually takes 10–20 seconds.
                    </p>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="px-6 py-12"
                >
                  <div className="flex flex-col items-center text-center">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 300, damping: 20 }}
                      className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-status-secure/20"
                    >
                      <Check className="h-8 w-8 text-status-secure" />
                    </motion.div>

                    <h3 className="font-serif text-2xl font-semibold tracking-tight text-text-primary">
                      Your plan is ready.
                    </h3>
                    <p className="mt-2 text-[15px] text-text-secondary">
                      "{projectName}" — {projectStats.phases} phases, {projectStats.steps} steps
                    </p>

                    <button
                      onClick={() => {
                        onOpenChange(false);
                        if (createdProjectId) {
                          navigate(`/project/${createdProjectId}`);
                        }
                      }}
                      className="group mt-8 flex items-center gap-2 rounded-xl bg-accent-primary px-6 py-3 font-semibold text-text-primary transition-all hover:bg-accent-primary-hover hover:shadow-[0_8px_24px_rgba(235,94,40,0.25)]"
                    >
                      View your plan
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
