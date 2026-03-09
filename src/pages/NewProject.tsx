import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, ExternalLink, Hexagon, KeyRound } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { dbService } from '../lib/db';
import { getAIProviders } from '../lib/ai';
import { getMCPServers } from '../lib/mcp';
import { cn } from '../lib/utils';
import type { GenerationPreparationState } from '../types';

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
  const [generationPreparation, setGenerationPreparation] = useState<GenerationPreparationState | null>(null);
  const [isPreparationLoading, setIsPreparationLoading] = useState(true);

  const resizeTextarea = () => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = '0px';
    textarea.style.height = `${Math.max(170, textarea.scrollHeight)}px`;
  };

  useEffect(() => {
    resizeTextarea();
  }, [prompt]);

  useEffect(() => {
    let isMounted = true;

    const loadPreparationState = async () => {
      try {
        const [providers, servers] = await Promise.all([getAIProviders(), getMCPServers()]);
        const activeServers = servers.filter((server) => server.is_active);

        if (!isMounted) {
          return;
        }

        setGenerationPreparation({
          has_ai_provider: providers.length > 0,
          has_brave_search: activeServers.some((server) => server.server_type === 'brave-search'),
          has_github_token: activeServers.some((server) => server.server_type === 'github'),
          has_context7: activeServers.some((server) => server.server_type === 'context7'),
        });
      } catch (fetchError) {
        if (!isMounted) {
          return;
        }

        console.error('Failed to load generation preparation state:', fetchError);
        setError('Could not load your saved settings. Reload and try again.');
      } finally {
        if (isMounted) {
          setIsPreparationLoading(false);
        }
      }
    };

    void loadPreparationState();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleGenerate = async () => {
    const trimmedPrompt = prompt.trim();

    if (!user || !trimmedPrompt) {
      return;
    }

    if (!generationPreparation?.has_ai_provider) {
      setError('You need to add an AI key first.');
      return;
    }

    setLoading(true);
    setLoadingSteps([]);
    setError('');

    try {
      setLoadingSteps((previous) => [...previous, 'Saving your project brief...']);
      const project = await dbService.createProject({
        description: trimmedPrompt,
      });

      setLoadingSteps((previous) => [...previous.slice(-2), 'Starting the plan builder...']);
      window.setTimeout(() => {
        navigate(`/project/${project.id}/generating`, {
          state: {
            preparation: generationPreparation,
          },
        });
      }, 250);
    } catch (err: unknown) {
      console.error('Error generating plan:', err);
      setLoading(false);
      setError(
        err instanceof Error
          ? err.message
          : 'Could not start your plan. Check your AI key and try again.',
      );
    }
  };

  if (loading) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center bg-bg-base px-6 text-text-primary">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(235,94,40,0.08)_0%,transparent_32%)]" />
        <motion.div
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2.1, repeat: Infinity, ease: 'easeInOut' }}
          className="mb-10 text-accent-primary"
        >
          <Hexagon className="h-12 w-12" />
        </motion.div>

        <div className="w-full max-w-[340px] space-y-4">
          <AnimatePresence mode="popLayout">
            {loadingSteps.map((step, index) => (
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
                className="flex items-center gap-3"
              >
                <div
                  className={cn(
                    'h-1.5 w-1.5 rounded-full transition-colors',
                    index === loadingSteps.length - 1 ? 'bg-accent-primary' : 'bg-status-secure',
                  )}
                />
                <span
                  className={cn(
                    'text-[15px] tracking-[-0.02em] transition-colors',
                    index === loadingSteps.length - 1 ? 'text-text-primary' : 'text-text-tertiary',
                  )}
                >
                  {step}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="mt-10 h-[2px] w-52 overflow-hidden rounded-[2px] bg-bg-elevated">
          <motion.div
            className="h-full bg-accent-primary"
            animate={{ x: ['-100%', '100%'] }}
            transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
          />
        </div>
      </div>
    );
  }

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-[980px] items-center px-6 py-16 font-sans">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_14%,rgba(235,94,40,0.07)_0%,transparent_26%)]" />

      <AnimatePresence mode="wait">
        <motion.div
          key="new-project"
          initial="hidden"
          animate="visible"
          exit={{ opacity: 0, y: -20 }}
          variants={containerVariants}
          className="relative z-10 mx-auto w-full max-w-[760px]"
        >
          <motion.div variants={itemVariants} className="mb-10 text-center">
            <div className="mb-5 flex justify-center">
              <Hexagon className="h-10 w-10 text-accent-primary" />
            </div>
            <div className="section-label justify-center">New project</div>
            <h1 className="mt-4 text-heading">What do you want to build?</h1>
            <p className="mx-auto mt-3 max-w-[560px] text-body text-[16px]">
              Describe it in your own words. The more context you give, the better the plan will be.
            </p>
          </motion.div>

          <motion.div variants={itemVariants} className="surface-card p-3 sm:p-4">
            <div className="rounded-[12px] border border-border-default bg-bg-elevated/55 px-4 py-4 sm:px-5">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder='e.g. "I want to build a tool for freelancers to track invoices, send reminders, and see what got paid."'
                className="min-h-[170px] w-full resize-none overflow-hidden bg-transparent text-[18px] leading-8 text-text-primary outline-none placeholder:text-text-tertiary"
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-4 px-3 pb-2 pt-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-start gap-3 text-left">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-accent-primary" />
                <div>
                  <div className="text-sm text-text-secondary">
                    {isPreparationLoading
                      ? 'Checking your saved AI and research settings...'
                      : generationPreparation?.has_ai_provider
                        ? 'Scrimble will use the AI key you saved in settings.'
                        : 'You need to add an AI key first.'}
                  </div>
                  <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
                    Plain language works best here
                  </div>
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={!prompt.trim() || isPreparationLoading || !generationPreparation?.has_ai_provider}
                className="btn-primary self-end"
              >
                Build my plan
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </motion.div>


          {error ? (
            <motion.div
              variants={itemVariants}
              className="mt-5 rounded-[14px] border border-[rgba(248,113,113,0.22)] bg-status-skipped px-4 py-3 text-sm leading-6 text-status-error"
            >
              <p>{error}</p>
              {error.toLowerCase().includes('settings') ? (
                <button
                  onClick={() => navigate('/settings')}
                  className="mt-2 text-sm font-medium text-accent-primary hover:text-accent-primary-hover"
                >
                  Open settings
                </button>
              ) : null}
            </motion.div>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}
