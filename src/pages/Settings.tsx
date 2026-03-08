import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  KeyRound,
  Loader2,
  LogOut,
  ShieldCheck,
  Sparkles,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuthStore } from '../store/authStore';
import { logout } from '../lib/firebase';
import {
  AIProvider,
  AIProviderType,
  deleteAIProvider,
  getAIProviders,
  saveAIProvider,
} from '../lib/ai';

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

const providerOptions: Array<{
  value: AIProviderType;
  label: string;
  helper: string;
  placeholder: string;
}> = [
  {
    value: 'openai',
    label: 'OpenAI',
    helper: 'Use your OpenAI key to power plan generation and updates.',
    placeholder: 'sk-...',
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    helper: 'Use your Anthropic key to run Claude on your projects.',
    placeholder: 'sk-ant-...',
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    helper: 'Fast, reliable, and free for many use cases through Google AI Studio.',
    placeholder: 'AIza...',
  },
  {
    value: 'custom',
    label: 'Custom',
    helper: 'Use any OpenAI-compatible service by adding its API URL.',
    placeholder: 'Paste your API key',
  },
];

const providerLabels: Record<AIProviderType, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  custom: 'Custom',
};

const inputClassName =
  'h-12 w-full rounded-[8px] border border-border-default bg-bg-elevated px-4 text-[15px] text-text-primary placeholder:text-text-tertiary shadow-[inset_0_1px_0_rgba(255,252,242,0.02)] outline-none transition-[border-color,box-shadow,background-color] duration-200 focus:border-accent-primary focus:bg-bg-overlay focus:ring-2 focus:ring-accent-primary-muted';

type ProviderFormState = {
  provider: AIProviderType;
  apiKey: string;
  model: string;
  baseUrl: string;
};

const defaultFormState: ProviderFormState = {
  provider: 'openai',
  apiKey: '',
  model: '',
  baseUrl: '',
};

function getProviderSummary(provider: AIProvider) {
  if (provider.provider === 'custom' && provider.base_url) {
    return provider.base_url;
  }

  if (provider.model) {
    return provider.model;
  }

  return provider.name;
}

export default function Settings() {
  const { user } = useAuthStore();
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [form, setForm] = useState<ProviderFormState>(defaultFormState);
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const selectedProvider =
    providerOptions.find((option) => option.value === form.provider) ?? providerOptions[0];

  const loadProviders = async (silent = false) => {
    setIsLoadingProviders(true);

    try {
      const result = await getAIProviders();
      setProviders(result);
    } catch (error: unknown) {
      if (!silent) {
        toast.error(
          error instanceof Error ? error.message : 'Could not load your AI keys right now.',
        );
      }
    } finally {
      setIsLoadingProviders(false);
    }
  };

  useEffect(() => {
    void loadProviders();
  }, []);

  const handleSaveProvider = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const apiKey = form.apiKey.trim();
    const model = form.model.trim();
    const baseUrl = form.baseUrl.trim();

    if (!apiKey) {
      toast.error('Add an AI key before saving.');
      return;
    }

    if (form.provider === 'custom' && !baseUrl) {
      toast.error('Add the API URL for your custom AI.');
      return;
    }

    setIsSaving(true);

    try {
      await saveAIProvider({
        name: `${selectedProvider.label} key`,
        provider: form.provider,
        apiKey,
        model: model || undefined,
        baseUrl: form.provider === 'custom' ? baseUrl : undefined,
        isDefault: providers.length === 0,
      });

      await loadProviders(true);
      setForm((current) => ({
        ...defaultFormState,
        provider: current.provider,
      }));
      toast.success('Keys saved.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Could not save your AI key.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveProvider = async (providerId: string) => {
    setRemovingId(providerId);

    try {
      await deleteAIProvider(providerId);
      await loadProviders(true);
      toast.success('Provider removed.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Could not remove that AI key.');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <motion.main
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="mx-auto w-full max-w-[920px] px-6 pb-24 pt-20 font-sans"
    >
      <motion.div variants={itemVariants} className="mb-10 max-w-[560px]">
        <h1 className="text-heading mb-3">Settings</h1>
        <p className="text-body">
          Keep your account close at hand and connect the AI tools you already use.
        </p>
      </motion.div>

      <motion.section
        variants={itemVariants}
        className="mb-8 rounded-[16px] border border-border-default bg-bg-surface p-6 shadow-panel"
      >
        <div className="mb-4 flex items-center gap-2 text-[13px] font-medium text-text-secondary">
          <UserIcon className="h-4 w-4 text-accent-primary" />
          Account
        </div>

        <div className="flex flex-col gap-4 rounded-[14px] border border-border-default bg-bg-elevated/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[14px] border border-border-default bg-bg-surface">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt="Avatar"
                  className="h-full w-full object-cover"
                />
              ) : (
                <UserIcon className="h-8 w-8 text-text-secondary" />
              )}
            </div>

            <div>
              <h2 className="text-xl font-medium tracking-[-0.02em] text-text-primary">
                {user?.displayName || 'User'}
              </h2>
              <p className="text-text-secondary">{user?.email}</p>
            </div>
          </div>

          <button
            onClick={() => logout()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-border-default bg-bg-surface px-4 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </motion.section>

      <motion.section
        variants={itemVariants}
        className="rounded-[16px] border border-border-default bg-bg-surface p-6 shadow-panel"
      >
        <div className="mb-6 max-w-[640px]">
          <div className="mb-4 flex items-center gap-2 text-[13px] font-medium text-text-secondary">
            <KeyRound className="h-4 w-4 text-accent-primary" />
            Your AI keys
          </div>
          <h2 className="mb-2 text-2xl font-serif tracking-[-0.03em] text-text-primary">
            Use the AI tools you already trust.
          </h2>
          <p className="text-body">
            Connect OpenAI, Anthropic, Gemini, or a custom OpenAI-compatible service. Scrimble
            uses them to do the work on your projects.
          </p>
        </div>

        <div className="space-y-4">
          {isLoadingProviders ? (
            <div className="rounded-[14px] border border-border-default bg-bg-elevated/50 p-4 text-sm text-text-secondary">
              Loading your saved AI keys...
            </div>
          ) : providers.length > 0 ? (
            providers.map((provider) => (
              <div
                key={provider.id}
                className="rounded-[14px] border border-border-default bg-bg-elevated/70 p-4"
              >
                <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h3 className="text-[17px] font-medium tracking-[-0.02em] text-text-primary">
                        {providerLabels[provider.provider]}
                      </h3>
                      {provider.is_default ? (
                        <span className="rounded-[6px] border border-accent-border bg-accent-primary-muted px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em] text-accent-primary">
                          Default
                        </span>
                      ) : null}
                    </div>
                    <p className="mb-3 text-sm text-text-secondary">{getProviderSummary(provider)}</p>

                    <div className="space-y-2">
                      <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-text-tertiary">
                        Saved key
                      </label>
                      <input
                        readOnly
                        value="••••••••••••••••"
                        className={cn(inputClassName, 'cursor-default bg-bg-base/60 opacity-85')}
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemoveProvider(provider.id)}
                    disabled={removingId === provider.id}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-[rgba(248,113,113,0.22)] px-4 text-sm font-medium text-[#f0c4b8] transition-colors hover:border-[rgba(248,113,113,0.36)] hover:bg-status-skipped disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {removingId === provider.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Remove
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-[14px] border border-dashed border-border-strong bg-bg-elevated/40 p-4 text-sm text-text-secondary">
              No AI keys saved yet. Add one below so Scrimble can work on your projects.
            </div>
          )}
        </div>

        <div className="mt-6 rounded-[14px] border border-border-default bg-bg-elevated/40 p-5">
          <div className="mb-4 flex items-center gap-2 text-[15px] font-medium text-text-primary">
            <Sparkles className="h-4 w-4 text-accent-primary" />
            Add another AI
          </div>

          <form onSubmit={handleSaveProvider} className="space-y-5">
            <div>
              <div className="grid gap-2 sm:grid-cols-4">
                {providerOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, provider: option.value }))}
                    className={cn(
                      'h-11 rounded-[8px] border px-3 text-sm font-medium transition-colors',
                      form.provider === option.value
                        ? 'border-accent-border bg-accent-primary-muted text-accent-primary'
                        : 'border-border-default bg-bg-surface text-text-secondary hover:border-border-strong hover:text-text-primary',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-sm text-text-secondary">{selectedProvider.helper}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className={cn(form.provider === 'custom' && 'sm:col-span-2')}>
                <label className="mb-2 block text-[13px] font-medium text-[#c5bcad]">
                  Your API key
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={form.apiKey}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, apiKey: event.target.value }))
                  }
                  placeholder={selectedProvider.placeholder}
                  className={inputClassName}
                />
              </div>

              <div>
                <label className="mb-2 block text-[13px] font-medium text-[#c5bcad]">
                  Model to use (optional)
                </label>
                <input
                  type="text"
                  value={form.model}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, model: event.target.value }))
                  }
                  placeholder="Leave blank to use the provider default"
                  className={inputClassName}
                />
              </div>

              {form.provider === 'custom' ? (
                <div className="sm:col-span-2">
                  <label className="mb-2 block text-[13px] font-medium text-[#c5bcad]">
                    API URL
                  </label>
                  <input
                    type="url"
                    value={form.baseUrl}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, baseUrl: event.target.value }))
                    }
                    placeholder="https://..."
                    className={inputClassName}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="btn-primary flex items-center gap-2 rounded-[8px] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isSaving ? 'Saving...' : 'Save key'}
              </button>
            </div>
          </form>
        </div>

        <div className="mt-6 rounded-[14px] border border-accent-border bg-accent-primary-muted/35 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent-primary" />
            <p className="text-sm leading-relaxed text-[#f0e7db]">
              Your privacy is priority. API keys are encrypted with <strong>AES-256</strong> before being stored in our isolated Cloudflare D1 database. Scrimble never stores them in plain text and only uses them to securely proxy your requests.
            </p>
          </div>
        </div>
      </motion.section>
    </motion.main>
  );
}
