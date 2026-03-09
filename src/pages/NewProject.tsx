import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Workflow, Key } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { dbService } from '../lib/db';
import { cn } from '../lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: EASE_OUT_EXPO,
    },
  },
};

export default function NewProject() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingSteps, setLoadingSteps] = useState<string[]>([]);
  const [error, setError] = useState('');

  const resizeTextarea = () => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = '0px';
    textarea.style.height = `${Math.max(160, textarea.scrollHeight)}px`;
  };

  useEffect(() => {
    resizeTextarea();
  }, [prompt]);

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim();

    if (!user || !trimmedPrompt) {
      return;
    }

    setLoading(true);
    setLoadingSteps([]);
    setError('');

    try {
      setLoadingSteps(prev => [...prev, 'Saving your brief...']);
      const project = await dbService.createProject({
        description: trimmedPrompt,
      });

      setLoadingSteps(prev => [...prev.slice(-2), 'Queueing the generation run...']);
      window.setTimeout(() => {
        navigate(`/project/${project.id}/generating`);
      }, 250);
    } catch (err: unknown) {
      console.error('Error generating plan:', err);
      setLoading(false);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to start your project generation. Please check your AI key and try again.',
      );
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-bg-base font-sans text-text-primary px-6">
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            rotate: [0, 90, 180, 270, 360],
          }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
          className="mb-12 flex h-20 w-20 items-center justify-center rounded-[16px] bg-accent-primary-muted/20 border border-accent-primary/20 shadow-[0_0_40px_rgba(235,94,40,0.1)]"
        >
          <Workflow className="h-10 w-10 text-accent-primary" />
        </motion.div>
        
        <div className="w-full max-w-[320px] space-y-4">
          <AnimatePresence mode="popLayout">
            {loadingSteps.map((step, idx) => (
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
                className="flex items-center gap-3"
              >
                <div className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  idx === loadingSteps.length - 1 ? "bg-accent-primary animate-pulse" : "bg-status-secure"
                )} />
                <span className={cn(
                  "text-[15px] font-medium tracking-[-0.03em] transition-colors duration-300",
                  idx === loadingSteps.length - 1 ? "text-text-primary" : "text-text-tertiary"
                )}>
                  {step}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="mt-12 overflow-hidden h-1 w-48 rounded-full bg-bg-elevated"
        >
          <motion.div 
            className="h-full bg-accent-primary"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          />
        </motion.div>
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-16 pt-24 font-sans">
      <AnimatePresence mode="wait">
        <motion.div
          key="chat-input"
          initial="hidden"
          animate="visible"
          exit={{ opacity: 0, y: -20 }}
          variants={containerVariants}
          className="space-y-8"
        >
          <motion.div variants={itemVariants} className="mb-12 text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[14px] bg-bg-elevated shadow-node">
              <Workflow className="h-8 w-8 text-accent-primary" />
            </div>
            <h1 className="mb-4 text-4xl font-serif tracking-[-0.03em] text-text-primary md:text-5xl">
              What do you want to build?
            </h1>
            <p className="mx-auto max-w-xl text-lg text-text-secondary">
              Tell us what you want to build. Scrimble will break it down into a plan you can actually follow.
            </p>
          </motion.div>

          <motion.div variants={itemVariants} className="group relative">
            <div className="absolute -inset-1 rounded-[16px] bg-gradient-to-r from-accent-primary to-accent-primary-muted blur opacity-20 transition duration-1000 group-hover:opacity-40 group-hover:duration-200" />
            <div className="relative rounded-[16px] border border-border-default focus-within:border-border-strong focus-within:ring-1 focus-within:ring-border-strong transition-colors duration-200 bg-bg-surface p-2 shadow-panel">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="I want to build a tool for freelancers to track invoices, send reminders, and see what got paid."
                className="min-h-[160px] w-full resize-none overflow-hidden bg-transparent p-4 font-sans text-[17px] leading-relaxed text-text-primary outline-none placeholder:text-text-tertiary"
                autoFocus
              />
                <div className="flex flex-col gap-4 px-4 pb-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex items-center gap-2">
                    <div className="text-[13px] text-text-tertiary">The more detail, the better.</div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Key className="h-3.5 w-3.5 text-text-tertiary opacity-70 hover:opacity-100 transition-opacity" />
                        </TooltipTrigger>
                        <TooltipContent className="bg-bg-elevated border-border-default text-text-primary text-xs">
                          <p>Runs through your saved AI provider</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  <div className="flex items-center gap-3 self-end">
                    <button
                      onClick={handleGenerate}
                      disabled={!prompt.trim()}
                      className="btn-primary flex items-center gap-2 rounded-[8px] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Build my plan
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </button>
                  </div>
                </div>
            </div>
          </motion.div>

          {error ? (
            <motion.div
              variants={itemVariants}
              className="rounded-[14px] bg-status-error/10 p-4 text-center text-status-error"
            >
              <p>{error}</p>
              {error.includes('settings') ? (
                <button onClick={() => navigate('/settings')} className="mt-2 text-sm font-medium underline">
                  Go to Settings
                </button>
              ) : null}
            </motion.div>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}
