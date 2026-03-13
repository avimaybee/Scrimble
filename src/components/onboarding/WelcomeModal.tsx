import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Hexagon, ArrowRight, Check, Loader2, Sparkles, Cpu } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useOnboardingStore, ONBOARDING_STEPS } from '../../store/onboardingStore';
import { saveAIProvider, getAIProviders } from '../../lib/ai';
import { dbService } from '../../lib/db';
import { BUILDER_PROFILE_CATEGORIES, type BuilderProfileCategory } from '../../lib/builder-profile';
import { cn } from '../../lib/utils';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

interface WelcomeModalProps {
  onComplete?: () => void;
}

const PROVIDER_ICONS: Record<string, { icon: string; color: string }> = {
  openai: { icon: '⬡', color: '#10a37f' },
  anthropic: { icon: '◈', color: '#d97757' },
  gemini: { icon: '◎', color: '#8eabf4' },
  groq: { icon: '◇', color: '#ff4d4d' },
};

const providerOptions = [
  { value: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
  { value: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
  { value: 'gemini', label: 'Gemini', placeholder: 'AIza...' },
  { value: 'groq', label: 'Groq', placeholder: 'gsk_...' },
];

function StepIndicator({ currentStep, completedSteps }: { currentStep: number; completedSteps: number[] }) {
  return (
    <div className="flex items-center justify-center gap-3">
      {ONBOARDING_STEPS.map((_, index) => {
        const isCompleted = completedSteps.includes(index);
        const isCurrent = index === currentStep;
        
        return (
          <div key={index} className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <motion.div
                initial={false}
                animate={{
                  scale: isCurrent ? 1.2 : 1,
                  backgroundColor: isCompleted 
                    ? 'var(--color-status-secure)' 
                    : isCurrent 
                      ? 'var(--color-accent-primary)' 
                      : 'var(--color-text-tertiary)',
                }}
                className="relative flex h-3 w-3 items-center justify-center"
              >
                {isCompleted ? (
                  <Check className="h-2 w-2 text-bg-base" strokeWidth={3} />
                ) : (
                  <div 
                    className={cn(
                      "h-2 w-2 rounded-full transition-colors",
                      isCurrent ? "bg-accent-primary" : "bg-text-tertiary/40"
                    )} 
                  />
                )}
              </motion.div>
            </div>
            {index < ONBOARDING_STEPS.length - 1 && (
              <div className={cn(
                "h-px w-8 transition-colors",
                completedSteps.includes(index + 1) || completedSteps.includes(index)
                  ? "bg-status-secure" 
                  : "bg-border-default"
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepLabel({ currentStep }: { currentStep: number }) {
  const labels = ['Add your first AI key', 'Quick builder profile', 'Start your first project'];
  return (
    <div className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-text-tertiary">
      {labels[currentStep]}
    </div>
  );
}

function Step1AddKey({ 
  onNext, 
  onSkip 
}: { 
  onNext: () => void; 
  onSkip: () => void;
}) {
  const [selectedProvider, setSelectedProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError('Please add an API key');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      await saveAIProvider({
        name: `${providerOptions.find(p => p.value === selectedProvider)?.label} key`,
        provider: selectedProvider as 'openai' | 'anthropic' | 'gemini' | 'groq',
        apiKey: apiKey.trim(),
        isDefault: true,
      });
      
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#eb5e28', '#34d399', '#38bdf8'],
      });
      
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save key');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
    >
      <div className="mb-6">
        <div className="section-label mb-2">Step 1</div>
        <h3 className="text-xl font-serif font-semibold text-text-primary tracking-tight">
          Add your first AI key
        </h3>
        <p className="mt-2 text-sm text-text-secondary">
          Scrimble uses your API key to build project plans. Your key stays on your device.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        {providerOptions.map((provider) => (
          <button
            key={provider.value}
            type="button"
            onClick={() => setSelectedProvider(provider.value)}
            className={cn(
              "flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-all duration-200",
              selectedProvider === provider.value
                ? "border-accent-border bg-accent-primary-muted"
                : "border-border-default bg-bg-elevated/40 hover:border-border-strong hover:bg-bg-elevated"
            )}
          >
            <div 
              className="h-10 w-10 rounded-lg flex items-center justify-center text-lg"
              style={{ backgroundColor: PROVIDER_ICONS[provider.value]?.color + '20', color: PROVIDER_ICONS[provider.value]?.color }}
            >
              {PROVIDER_ICONS[provider.value]?.icon || '◇'}
            </div>
            <span className="text-sm font-medium text-text-primary">{provider.label}</span>
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={providerOptions.find(p => p.value === selectedProvider)?.placeholder}
            className="field-input w-full"
            autoFocus
          />
        </div>

        {error && (
          <p className="text-sm text-status-error">{error}</p>
        )}

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-text-tertiary hover:text-text-secondary transition-colors"
          >
            Skip this step →
          </button>
          <button
            type="submit"
            disabled={isSaving || !apiKey.trim()}
            className="btn-primary"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                Save & continue
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </motion.div>
  );
}

function Step2Profile({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  const topCategories = BUILDER_PROFILE_CATEGORIES.slice(0, 3);

  const handleToggle = async (category: BuilderProfileCategory, tool: string) => {
    const key = `${category}:${tool}`;
    const newSelected = new Set(selectedTools);
    
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedTools(newSelected);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      for (const key of selectedTools) {
        const [category, tool] = key.split(':') as [BuilderProfileCategory, string];
        await dbService.saveUserTool({
          category,
          name: tool,
          proficiency: 'comfortable',
        });
      }
      
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#eb5e28', '#34d399', '#38bdf8'],
      });
      
      onNext();
    } catch (err) {
      console.error('Failed to save profile:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
    >
      <div className="mb-6">
        <div className="section-label mb-2">Step 2</div>
        <h3 className="text-xl font-serif font-semibold text-text-primary tracking-tight">
          Quick builder profile
        </h3>
        <p className="mt-2 text-sm text-text-secondary">
          Pick the tools you use. Takes 30 seconds.
        </p>
      </div>

      <div className="space-y-4 mb-6">
        {topCategories.map((category) => (
          <div key={category.key}>
            <div className="text-[11px] font-mono uppercase tracking-wider text-text-tertiary mb-2">
              {category.label}
            </div>
            <div className="flex flex-wrap gap-2">
              {category.presets.slice(0, 6).map((preset) => {
                const key = `${category.key}:${preset}`;
                const isSelected = selectedTools.has(key);
                
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleToggle(category.key, preset)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200",
                      isSelected
                        ? "bg-accent-primary text-text-primary"
                        : "bg-bg-elevated border border-border-default text-text-secondary hover:border-accent-border hover:text-text-primary"
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3 inline mr-1" />}
                    {preset}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-text-tertiary hover:text-text-secondary transition-colors"
        >
          Skip this step →
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="btn-primary"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              Save & continue
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}

function Step3Project({ onComplete }: { onComplete: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setIsCreating(true);
    try {
      const session = await dbService.startProjectIntake({
        description: prompt.trim(),
      });

      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#eb5e28', '#34d399', '#38bdf8', '#fbbf24'],
      });

      setTimeout(() => {
        onComplete();
        navigate(`/project/${session.project_id}/generating`);
      }, 1200);
    } catch (err) {
      console.error('Failed to create project:', err);
      setIsCreating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
    >
      <div className="mb-6">
        <div className="section-label mb-2">Step 3</div>
        <h3 className="text-xl font-serif font-semibold text-text-primary tracking-tight">
          Start your first project
        </h3>
        <p className="mt-2 text-sm text-text-secondary">
          What do you want to build? Describe it in plain language.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="rounded-xl border border-border-default bg-bg-elevated/40 p-1 mb-6">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='e.g. "I want to build a booking app for independent dog walkers with recurring billing, client notes, and a clear daily checklist for each walk."'
            className="w-full min-h-[140px] resize-none bg-transparent text-[15px] text-text-primary placeholder:text-text-tertiary outline-none p-3"
            autoFocus
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isCreating || !prompt.trim()}
            className="btn-primary"
          >
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                Build my first plan
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </motion.div>
  );
}

export default function WelcomeModal({ onComplete }: WelcomeModalProps) {
  const { user } = useAuthStore();
  const { 
    currentStep, 
    completedSteps, 
    setCurrentStep, 
    completeStep,
    markOnboarded 
  } = useOnboardingStore();

  const [isOpen, setIsOpen] = useState(true);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    if (onComplete) onComplete();
  }, [onComplete]);

  const handleNext = useCallback(() => {
    const step = ONBOARDING_STEPS[currentStep];
    completeStep(step);
    
    if (currentStep < 2) {
      setCurrentStep(currentStep + 1);
    } else {
      markOnboarded();
      handleClose();
    }
  }, [currentStep, completeStep, setCurrentStep, markOnboarded, handleClose]);

  const handleSkip = useCallback(() => {
    if (currentStep < 2) {
      setCurrentStep(currentStep + 1);
    }
  }, [currentStep, setCurrentStep]);

  const handleComplete = useCallback(() => {
    markOnboarded();
    handleClose();
  }, [markOnboarded, handleClose]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-bg-base/80 backdrop-blur-md"
        />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
          className="relative z-10 w-full max-w-[480px] mx-4"
        >
          <div className="surface-card p-8">
            {currentStep === 0 && (
              <div className="text-center mb-8">
                <div className="flex justify-center mb-4">
                  <div className="h-10 w-10 rounded-xl bg-accent-primary/10 flex items-center justify-center">
                    <Hexagon className="h-5 w-5 text-accent-primary" />
                  </div>
                </div>
                <h2 className="text-2xl font-serif font-bold text-text-primary tracking-tight">
                  Welcome to Scrimble{user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}.
                </h2>
                <p className="mt-2 text-sm text-text-secondary">
                  Let's get you set up in 3 steps.
                </p>
              </div>
            )}

            <StepIndicator currentStep={currentStep} completedSteps={completedSteps} />
            <StepLabel currentStep={currentStep} />

            <div className="mt-8">
              <AnimatePresence mode="wait">
                {currentStep === 0 && (
                  <Step1AddKey key="step1" onNext={handleNext} onSkip={handleSkip} />
                )}
                {currentStep === 1 && (
                  <Step2Profile key="step2" onNext={handleNext} onSkip={handleSkip} />
                )}
                {currentStep === 2 && (
                  <Step3Project key="step3" onComplete={handleComplete} />
                )}
              </AnimatePresence>
            </div>

            {currentStep < 2 && (
              <div className="mt-8 pt-6 border-t border-border-default">
                <button
                  type="button"
                  onClick={handleClose}
                  className="text-sm text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  Skip for now
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
