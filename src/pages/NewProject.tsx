import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, ChevronRight, Hexagon, KeyRound, Sparkles } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { dbService } from '../lib/db';
import { getAIProviders, getAIModelRoles } from '../lib/ai';
import { getMCPServers } from '../lib/mcp';
import { cn } from '../lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import type { AIProvider, AIModelRoles } from '../lib/ai';
import { ThinkingBubble } from '@/components/ui/ThinkingBubble';
import type { GenerationPreparationState, ProjectBrief, ProjectIntakeSession } from '../types';

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

type IntakeScreenState = 'initial' | 'conversation' | 'confirm';

function formatDetailValue(brief: ProjectBrief, key: string) {
  switch (key) {
    case 'v1_scope':
      return `IN: ${brief.v1_scope.in.length > 0 ? brief.v1_scope.in.join(', ') : 'Not locked yet.'} | OUT: ${brief.v1_scope.out.length > 0 ? brief.v1_scope.out.join(', ') : 'Nothing explicitly out yet.'}`;
    case 'stack_context':
      return [
        `Confirmed: ${brief.stack_context.confirmed.length > 0 ? brief.stack_context.confirmed.join(', ') : 'Not locked yet.'}`,
        `Already have: ${brief.stack_context.existing_tools.length > 0 ? brief.stack_context.existing_tools.join(', ') : 'Not specified.'}`,
        `Open to: ${brief.stack_context.open_to.length > 0 ? brief.stack_context.open_to.join(', ') : 'Not specified.'}`,
        brief.stack_context.notes ? `Notes: ${brief.stack_context.notes}` : '',
      ]
        .filter(Boolean)
        .join(' ');
    case 'constraints':
      return [
        brief.constraints.timeline ? `Timeline: ${brief.constraints.timeline}` : '',
        brief.constraints.budget ? `Budget: ${brief.constraints.budget}` : '',
        brief.constraints.existing_codebase
          ? `Existing codebase: ${brief.constraints.existing_codebase}`
          : '',
        brief.constraints.dependencies.length > 0
          ? `Dependencies: ${brief.constraints.dependencies.join(', ')}`
          : '',
        brief.constraints.other.length > 0 ? `Other: ${brief.constraints.other.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' ') || 'No hard constraints confirmed yet.';
    default:
      return '';
  }
}

function getCurrentAgentMessage(session: ProjectIntakeSession | null) {
  if (!session) {
    return '';
  }

  const latestAgent = [...session.messages].reverse().find((message) => message.role === 'agent');
  return latestAgent?.content || session.agent_message || '';
}

export default function NewProject() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [prompt, setPrompt] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingSteps, setLoadingSteps] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [generationPreparation, setGenerationPreparation] = useState<GenerationPreparationState | null>(null);
  const [isPreparationLoading, setIsPreparationLoading] = useState(true);
  const [builderProfileCount, setBuilderProfileCount] = useState(0);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [modelRoles, setModelRoles] = useState<AIModelRoles | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [intakeSession, setIntakeSession] = useState<ProjectIntakeSession | null>(null);
  const [screenState, setScreenState] = useState<IntakeScreenState>('initial');
  const [isStartingIntake, setIsStartingIntake] = useState(false);
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [isResumingIntake, setIsResumingIntake] = useState(false);
  const [showBriefDetails, setShowBriefDetails] = useState(false);
  const [manualPrompt, setManualPrompt] = useState('');
  const [selectedChoice, setSelectedChoice] = useState('');

  const intakeProjectId = searchParams.get('intake');
  const currentQuestion = intakeSession?.current_question || null;
  const totalQuestions = intakeSession?.total_questions || intakeSession?.questions?.length || 0;
  const currentQuestionNumber = totalQuestions > 0
    ? Math.min((intakeSession?.current_question_index || 0) + 1, totalQuestions)
    : 0;
  const currentAgentMessage = manualPrompt || currentQuestion?.text || getCurrentAgentMessage(intakeSession);
  const needsAiSetup = !isPreparationLoading && !generationPreparation?.has_ai_provider;

  const preparationBadges = useMemo(() => {
    if (!generationPreparation) {
      return [];
    }

    return [
      {
        key: 'ai',
        label: generationPreparation.has_ai_provider ? 'AI ready' : 'AI key missing',
        tone: generationPreparation.has_ai_provider ? 'ready' : 'missing',
      },
      {
        key: 'github',
        label: generationPreparation.has_github_token ? 'GitHub connected' : 'GitHub public only',
        tone: generationPreparation.has_github_token ? 'ready' : 'partial',
      },
      {
        key: 'docs',
        label: generationPreparation.has_context7 ? 'Live docs connected' : 'Live docs not connected',
        tone: generationPreparation.has_context7 ? 'ready' : 'missing',
      },
    ] as const;
  }, [generationPreparation]);

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
    setSelectedChoice('');
    setReply('');
  }, [currentQuestion?.id]);

  const loadPreparationState = useCallback(async () => {
    setIsPreparationLoading(true);
    setError('');

    try {
      const [providerList, modelRolesResult, servers, userTools] = await Promise.all([
        getAIProviders(),
        getAIModelRoles(),
        getMCPServers(),
        dbService.getUserTools(),
      ]);
      const activeServers = servers.filter((server) => server.is_active);

      setProviders(providerList);
      setModelRoles(modelRolesResult);
      setBuilderProfileCount(userTools.length);
      
      if (modelRolesResult?.fast_model_name && modelRolesResult?.fast_model_provider_id) {
        setSelectedProviderId(null);
        setSelectedModelName(null);
      } else {
        const defaultProvider = providerList.find((provider) => provider.is_default) || providerList[0];
        if (defaultProvider) {
          setSelectedProviderId(defaultProvider.id);
          setSelectedModelName(null);
        }
      }

      setGenerationPreparation({
        has_ai_provider: providerList.length > 0,
        has_brave_search: activeServers.some((server) => server.server_type === 'brave-search'),
        has_github_token: activeServers.some((server) => server.server_type === 'github'),
        has_context7: activeServers.some((server) => server.server_type === 'context7'),
      });
      setError('');
    } catch (fetchError) {
      console.error('Failed to load generation preparation state:', fetchError);
      setGenerationPreparation(null);
      setError('Could not load your saved settings. Reload and try again.');
    } finally {
      setIsPreparationLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPreparationState();
  }, [loadPreparationState]);

  useEffect(() => {
    if (!user || !intakeProjectId) {
      if (!intakeProjectId) {
        setIntakeSession(null);
        setScreenState('initial');
        setManualPrompt('');
        setShowBriefDetails(false);
      }
      return;
    }

    let isMounted = true;
    setIsResumingIntake(true);

    const loadIntakeSession = async () => {
      try {
        const project = await dbService.getProject(intakeProjectId);
        if (!project) {
          if (isMounted) {
            setSearchParams({}, { replace: true });
            setScreenState('initial');
          }
          return;
        }

        if (project.generation_status !== 'intake') {
          if (project.generation_status === 'complete') {
            navigate(`/project/${intakeProjectId}`, { replace: true });
            return;
          }

          navigate(`/project/${intakeProjectId}/generating`, {
            replace: true,
            state: {
              preparation: generationPreparation,
            },
          });
          return;
        }

        const session = await dbService.getProjectIntake(intakeProjectId);
        if (!isMounted) {
          return;
        }

        setPrompt(session.brief.raw_description);
        setIntakeSession(session);
        setScreenState(session.ready ? 'confirm' : 'conversation');
        setManualPrompt('');
        setError('');
      } catch (loadError) {
        if (!isMounted) {
          return;
        }

        console.error('Failed to resume intake conversation:', loadError);
        setError(loadError instanceof Error ? loadError.message : 'Could not reopen this intake conversation.');
      } finally {
        if (isMounted) {
          setIsResumingIntake(false);
        }
      }
    };

    void loadIntakeSession();

    return () => {
      isMounted = false;
    };
  }, [generationPreparation, intakeProjectId, navigate, setSearchParams, user]);

  const handleConfirmIntake = async (sessionOverride?: ProjectIntakeSession) => {
    const targetSession = sessionOverride || intakeSession;
    if (!targetSession || !generationPreparation?.has_ai_provider) {
      return;
    }

    setLoading(true);
    setLoadingSteps(['Saving your brief...']);
    setError('');

    try {
      await dbService.confirmProjectIntake(targetSession.project_id, {
        providerId: selectedProviderId || undefined,
        modelName: selectedModelName || undefined,
      });
      setLoadingSteps((previous) => [...previous.slice(-2), 'Starting the research pipeline...']);
      window.setTimeout(() => {
        navigate(`/project/${targetSession.project_id}/generating`, {
          state: {
            preparation: generationPreparation,
          },
        });
      }, 250);
    } catch (confirmError: unknown) {
      console.error('Failed to confirm intake:', confirmError);
      setLoading(false);
      setError(
        confirmError instanceof Error
          ? confirmError.message
          : 'Could not start your plan. Check your AI key and try again.',
      );
    }
  };

  const handleStartIntake = async () => {
    const trimmedPrompt = prompt.trim();

    if (!user || !trimmedPrompt) {
      return;
    }

    if (!generationPreparation?.has_ai_provider) {
      setError('You need to add an AI key first.');
      return;
    }

    setIsStartingIntake(true);
    setError('');

    try {
      const session = await dbService.startProjectIntake({
        description: trimmedPrompt,
        providerId: selectedProviderId || undefined,
        modelName: selectedModelName || undefined,
      });

      setIntakeSession(session);
      setSearchParams({ intake: session.project_id }, { replace: true });
      setManualPrompt('');
      setSelectedChoice('');

      if (session.ready) {
        await handleConfirmIntake(session);
        return;
      }

      setScreenState('conversation');
    } catch (startError: unknown) {
      console.error('Error starting intake:', startError);
      setError(
        startError instanceof Error
          ? startError.message
          : 'Could not start the intake conversation. Try again.',
      );
    } finally {
      setIsStartingIntake(false);
    }
  };

  const handleReplySubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    const responseValue = currentQuestion?.type === 'choice' ? selectedChoice.trim() : reply.trim();
    if (!intakeSession || !responseValue) {
      return;
    }

    setIsSendingReply(true);
    setError('');

    try {
      const session = await dbService.respondToProjectIntake(intakeSession.project_id, {
        message: responseValue,
        providerId: selectedProviderId || undefined,
        modelName: selectedModelName || undefined,
      });

      setReply('');
      setSelectedChoice('');
      setIntakeSession(session);
      setManualPrompt('');

      if (session.ready) {
        await handleConfirmIntake(session);
        return;
      }

      setScreenState('conversation');
    } catch (replyError: unknown) {
      console.error('Error sending intake reply:', replyError);
      setError(
        replyError instanceof Error
          ? replyError.message
          : 'Could not send that reply. Try again.',
      );
    } finally {
      setIsSendingReply(false);
    }
  };

  const detailRows = intakeSession
    ? [
        { label: 'What it is', value: intakeSession.brief.what_it_is || 'Not locked yet.', key: 'what_it_is' },
        { label: "Who it's for", value: intakeSession.brief.who_its_for || 'Not locked yet.', key: 'who_its_for' },
        { label: 'Problem it solves', value: intakeSession.brief.problem_solved || 'Not locked yet.', key: 'problem_solved' },
        { label: 'V1 scope', value: formatDetailValue(intakeSession.brief, 'v1_scope'), key: 'v1_scope' },
        { label: 'Stack confirmed', value: formatDetailValue(intakeSession.brief, 'stack_context'), key: 'stack_context' },
        { label: 'Done when', value: intakeSession.brief.definition_done || 'Not locked yet.', key: 'definition_done' },
        { label: 'Constraints', value: formatDetailValue(intakeSession.brief, 'constraints'), key: 'constraints' },
      ]
    : [];

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
          key={screenState}
          initial="hidden"
          animate="visible"
          exit={{ opacity: 0, y: -20 }}
          variants={containerVariants}
          className="relative z-10 mx-auto w-full max-w-[760px]"
        >
          {screenState === 'initial' ? (
            <>
              <motion.div variants={itemVariants} className="mb-10 text-center">
                <div className="mb-5 flex justify-center">
                  <Hexagon className="h-10 w-10 text-accent-primary" />
                </div>
                <div className="section-label justify-center">New project</div>
                <h1 className="mt-4 text-heading">What do you want to build?</h1>
                <p className="mx-auto mt-3 max-w-[560px] text-body text-[16px]">
                  Describe it in your own words. The more context you give, the better the intake conversation starts.
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

                {!isPreparationLoading && builderProfileCount === 0 ? (
                  <div className="mx-3 mt-4 rounded-[12px] border border-[rgba(244,187,102,0.26)] bg-[rgba(244,187,102,0.08)] px-4 py-3 text-sm leading-6 text-status-warning sm:mx-2">
                    Your builder profile is empty - I'll have to ask more questions than usual. Add your tools in Settings to skip this every time.
                  </div>
                ) : null}

                {!isPreparationLoading && preparationBadges.length > 0 ? (
                  <div className="mx-3 mt-4 flex flex-wrap gap-2 sm:mx-2">
                    {preparationBadges.map((badge) => (
                      <span
                        key={badge.key}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-[8px] border px-3 py-1 font-sans text-[12px]',
                          badge.tone === 'ready'
                            ? 'border-[rgba(52,211,153,0.2)] bg-[rgba(52,211,153,0.1)] text-status-secure'
                            : badge.tone === 'partial'
                              ? 'border-border-default bg-bg-elevated/50 text-text-secondary'
                              : 'border-[rgba(244,187,102,0.24)] bg-[rgba(244,187,102,0.08)] text-status-warning',
                        )}
                      >
                        <span aria-hidden="true">
                          {badge.tone === 'ready' ? '✓' : badge.tone === 'partial' ? '•' : '!' }
                        </span>
                        <span>{badge.label}</span>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-col gap-4 px-3 pb-2 pt-4 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex items-start gap-3 text-left">
                    <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-accent-primary" />
                    <div>
                      <div className="text-sm text-text-secondary">
                        {isPreparationLoading
                          ? 'Checking your saved AI and research settings...'
                          : generationPreparation?.has_ai_provider
                            ? (
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  {modelRoles?.fast_model_name ? (
                                    <>
                                      <span>your preferred</span>
                                      <span className="inline-flex items-center gap-1 font-medium text-text-primary">
                                        {modelRoles.fast_model_name}
                                      </span>
                                      <span>(fast) and</span>
                                      <span className="inline-flex items-center gap-1 font-medium text-text-primary">
                                        {modelRoles.deep_model_name || 'default'}
                                      </span>
                                      <span>(deep) models</span>
                                    </>
                                  ) : (
                                    selectedProviderId ? (
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <span className="inline-flex items-center gap-1 font-medium text-text-primary">
                                          {providers.find((p) => p.id === selectedProviderId)?.name || 'Default key'}
                                        </span>
                                        {selectedModelName && (
                                          <>
                                            <span className="text-text-tertiary">/</span>
                                            <span className="inline-flex items-center gap-1 font-medium text-text-primary">
                                              {selectedModelName}
                                            </span>
                                          </>
                                        )}
                                      </div>
                                    ) : (
                                      <span>Default key</span>
                                    )
                                  )}
                                <button
                                  type="button"
                                  onClick={() => setIsModalOpen(true)}
                                  className="inline-flex items-center gap-0.5 font-medium text-accent-primary transition-colors hover:text-accent-primary-hover"
                                >
                                  (Change)
                                </button>
                              </div>
                            )
                            : 'You need to add an AI key first.'}
                      </div>
                      <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
                        Plain language works best here
                      </div>
                      {needsAiSetup ? (
                        <button
                          type="button"
                          onClick={() => navigate('/settings')}
                          className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-accent-primary transition-colors hover:text-accent-primary-hover"
                        >
                          Open settings
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <button
                    onClick={handleStartIntake}
                    disabled={!prompt.trim() || isPreparationLoading || !generationPreparation?.has_ai_provider || isStartingIntake}
                    className="btn-primary self-end"
                  >
                    {isStartingIntake ? 'Starting...' : "Let's figure this out"}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            </>
          ) : null}

          {screenState === 'conversation' ? (
            <motion.section
              variants={itemVariants}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -24 }}
              transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
              className="relative rounded-[24px] border border-border-default bg-bg-surface/90 px-6 py-7 shadow-panel sm:px-8"
            >
                <div className="mb-8 flex items-start justify-between gap-6">
                  <div>
                    <div className="section-label">Clarifying questions</div>
                    <p className="mt-3 max-w-[420px] text-body">
                      Quick questions so the plan is specific to your project and stack.
                    </p>
                    <p className="mt-2 max-w-[440px] text-[13px] leading-6 text-text-tertiary">
                      One question at a time. You can leave and come back without losing progress.
                    </p>
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                    {totalQuestions > 0 ? `Question ${Math.max(currentQuestionNumber, 1)} of ${totalQuestions}` : 'Preparing questions...'}
                  </div>
                </div>

              <div className="mb-8">
                <p className="max-w-[620px] font-serif text-[20px] leading-9 tracking-[-0.02em] text-text-primary">
                  {currentAgentMessage.replace(/^READY:\s*/, '')}
                </p>
              </div>

              <form onSubmit={handleReplySubmit} className="space-y-4">
                {currentQuestion?.type === 'choice' && currentQuestion.options && currentQuestion.options.length > 0 ? (
                  <div className="grid gap-2">
                    {currentQuestion.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setSelectedChoice(option)}
                        disabled={isSendingReply}
                        className={cn(
                          'rounded-full border px-4 py-2 text-left text-sm transition-colors',
                          selectedChoice === option
                            ? 'border-accent-border bg-accent-primary-muted text-accent-primary'
                            : 'border-border-default bg-bg-elevated/60 text-text-secondary hover:border-border-strong hover:text-text-primary',
                        )}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-[16px] border border-border-default bg-bg-elevated/60 px-4 py-3">
                    <input
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      placeholder="Your answer..."
                      className="h-11 flex-1 bg-transparent text-[15px] text-text-primary outline-none placeholder:text-text-tertiary"
                      autoFocus
                      disabled={isSendingReply}
                    />
                  </div>
                )}

                {isSendingReply && (
                  <ThinkingBubble
                    content={intakeSession?.agent_thinking}
                    isStreaming={isSendingReply}
                    className="mt-6 mb-2"
                  />
                )}

                <div className="flex items-center justify-between gap-4">
                  <button
                    type="button"
                    onClick={() => void handleConfirmIntake()}
                    className="text-sm text-text-tertiary transition-colors hover:text-text-secondary"
                  >
                    Skip and build from my description
                  </button>
                  <button
                    type="submit"
                    disabled={
                      isSendingReply
                      || (currentQuestion?.type === 'choice'
                        ? !selectedChoice.trim()
                        : !reply.trim())
                    }
                    className="btn-primary"
                  >
                    Next
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </form>
            </motion.section>
          ) : null}

          {screenState === 'confirm' && intakeSession ? (
            <motion.section
              variants={itemVariants}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -24 }}
              transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
              className="rounded-[24px] border border-border-default bg-bg-surface/92 px-6 py-7 shadow-panel sm:px-8"
            >
              <div className="mb-8">
                <div className="section-label">Ready to brief the pipeline</div>
                <h2 className="mt-4 font-serif text-[24px] tracking-[-0.03em] text-text-primary">
                  Here's what I understand
                </h2>
                <p className="mt-4 max-w-[640px] text-[16px] leading-8 text-text-secondary">
                  {intakeSession.brief.summary}
                </p>
                <p className="mt-3 max-w-[620px] text-[13px] leading-6 text-text-tertiary">
                  Once you confirm this, I&apos;ll keep the brief attached to the full planning run and take it from there.
                </p>
              </div>

              <div className="rounded-[16px] border border-border-default bg-bg-elevated/55 p-4">
                <button
                  type="button"
                  onClick={() => setShowBriefDetails((current) => !current)}
                  className="flex w-full items-center justify-between gap-4 text-left"
                >
                  <span className="font-medium text-text-primary">
                    {showBriefDetails ? 'Hide the details' : 'See the details ->'}
                  </span>
                  <ChevronRight
                    className={cn(
                      'h-4 w-4 text-accent-primary transition-transform',
                      showBriefDetails && 'rotate-90',
                    )}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {showBriefDetails ? (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
                      className="overflow-hidden"
                    >
                      <div className="mt-4 grid gap-4 sm:grid-cols-[140px_1fr]">
                        {detailRows.map((row) => (
                          <div key={row.key} className="contents">
                            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                              {row.label}
                            </div>
                            <div className="text-[14px] leading-7 text-text-secondary">{row.value}</div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setScreenState('conversation');
                    setManualPrompt('What part of that summary feels off, and what should I correct before I brief the pipeline?');
                    setReply('');
                  }}
                  className="btn-ghost"
                >
                  That's not right - let me clarify
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmIntake()}
                  className="btn-primary"
                >
                  Yes, build my plan
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </motion.section>
          ) : null}

          {isResumingIntake ? (
            <motion.div
              variants={itemVariants}
              className="mt-5 rounded-[14px] border border-border-default bg-bg-elevated/45 px-4 py-3 text-sm leading-6 text-text-secondary"
            >
              Reopening your intake conversation...
            </motion.div>
          ) : null}

          {error ? (
            <motion.div
              variants={itemVariants}
              className="mt-5 rounded-[14px] border border-[rgba(248,113,113,0.22)] bg-status-skipped px-4 py-3 text-sm leading-6 text-status-error"
            >
              <p>{error}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {!generationPreparation && !isPreparationLoading ? (
                  <button
                    type="button"
                    onClick={() => void loadPreparationState()}
                    className="text-sm font-medium text-accent-primary hover:text-accent-primary-hover"
                  >
                    Reload setup
                  </button>
                ) : null}
                {(error.toLowerCase().includes('settings') || needsAiSetup) ? (
                  <button
                    type="button"
                    onClick={() => navigate('/settings')}
                    className="text-sm font-medium text-accent-primary hover:text-accent-primary-hover"
                  >
                    Open settings
                  </button>
                ) : null}
              </div>
            </motion.div>
          ) : null}

          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <DialogContent className="max-w-[420px]">
              <DialogHeader>
                <DialogTitle>Choose your AI</DialogTitle>
                <DialogDescription>
                  Select which model should run the intake conversation and build this project plan.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 px-6 py-2 max-h-[60vh] overflow-y-auto">
                {providers.map((provider) => (
                  <div key={provider.id} className="space-y-2">
                    <div className="text-xs font-semibold text-text-tertiary uppercase tracking-wider pl-1">
                      {provider.name}
                    </div>
                    {provider.models && provider.models.length > 0 ? (
                      provider.models.map((model) => {
                        const isSelected = selectedProviderId === provider.id && selectedModelName === model.name;
                        return (
                          <button
                            key={model.id}
                            onClick={() => {
                              setSelectedProviderId(provider.id);
                              setSelectedModelName(model.name);
                              setIsModalOpen(false);
                            }}
                            className={cn(
                              'group flex w-full items-center justify-between rounded-xl border p-3 text-left transition-all duration-200',
                              isSelected
                                ? 'border-accent-border bg-accent-primary-muted'
                                : 'border-border-default bg-bg-elevated/40 hover:border-border-strong hover:bg-bg-elevated/60',
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={cn(
                                  'flex h-8 w-8 items-center justify-center rounded-lg border transition-colors',
                                  isSelected
                                    ? 'border-accent-border bg-bg-surface text-accent-primary'
                                    : 'border-border-default bg-bg-surface text-text-tertiary group-hover:text-text-secondary',
                                )}
                              >
                                <Sparkles className="h-4 w-4" />
                              </div>
                              <div>
                                <div className="text-[14px] font-medium text-text-primary">
                                  {model.name}
                                </div>
                                {(modelRoles?.fast_model_provider_id === provider.id && modelRoles?.fast_model_name === model.name) && (
                                  <span className="text-[10px] font-mono text-accent-primary uppercase tracking-wider bg-accent-primary-muted px-1.5 py-0.5 rounded ml-1">Fast</span>
                                )}
                                {(modelRoles?.deep_model_provider_id === provider.id && modelRoles?.deep_model_name === model.name) && (
                                  <span className="text-[10px] font-mono text-status-secure-dim uppercase tracking-wider bg-status-secure/10 px-1.5 py-0.5 rounded ml-1">Deep</span>
                                )}
                              </div>
                            </div>
                            {isSelected ? (
                              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-primary text-white">
                                <ChevronRight className="h-3 w-3" />
                              </div>
                            ) : null}
                          </button>
                        );
                      })
                    ) : (
                      <button
                        onClick={() => {
                          setSelectedProviderId(provider.id);
                          setSelectedModelName(null);
                          setIsModalOpen(false);
                        }}
                        className={cn(
                          'group flex w-full items-center justify-between rounded-xl border p-3 text-left transition-all duration-200',
                          selectedProviderId === provider.id && !selectedModelName
                            ? 'border-accent-border bg-accent-primary-muted'
                            : 'border-border-default bg-bg-elevated/40 hover:border-border-strong hover:bg-bg-elevated/60',
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              'flex h-8 w-8 items-center justify-center rounded-lg border transition-colors',
                              selectedProviderId === provider.id && !selectedModelName
                                ? 'border-accent-border bg-bg-surface text-accent-primary'
                                : 'border-border-default bg-bg-surface text-text-tertiary group-hover:text-text-secondary',
                            )}
                          >
                            <Sparkles className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-[14px] font-medium text-text-primary">
                              {provider.model || 'Default Model'}
                            </div>
                            {(modelRoles?.fast_model_provider_id === provider.id && !modelRoles?.fast_model_name) && (
                              <span className="text-[10px] font-mono text-accent-primary uppercase tracking-wider bg-accent-primary-muted px-1.5 py-0.5 rounded ml-1">Fast</span>
                            )}
                            {(modelRoles?.deep_model_provider_id === provider.id && !modelRoles?.deep_model_name) && (
                              <span className="text-[10px] font-mono text-status-secure-dim uppercase tracking-wider bg-status-secure/10 px-1.5 py-0.5 rounded ml-1">Deep</span>
                            )}
                          </div>
                        </div>
                        {selectedProviderId === provider.id && !selectedModelName ? (
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-primary text-white">
                            <ChevronRight className="h-3 w-3" />
                          </div>
                        ) : null}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <DialogFooter className="border-t border-border-default bg-bg-elevated/30 p-4">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="btn-ghost py-2 text-sm"
                >
                  Close
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </motion.div>
      </AnimatePresence>
    </main>
  );
}
