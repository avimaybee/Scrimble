import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  BookText,
  Cpu,
  ExternalLink,
  Github,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  User as UserIcon,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuthStore } from '../store/authStore';
import { logout } from '../lib/firebase';
import { InlineError } from '../components/ui/InlineError';
import {
  AIModelRoles,
  AIProvider,
  AIProviderType,
  deleteAIProvider,
  getAIModelRoles,
  getAIProviders,
  saveAIModelRoles,
  saveAIProvider,
  testAIProvider,
} from '../lib/ai';
import {
  deleteMCPServer,
  getMCPServers,
  type MCPServer,
  type MCPServerType,
  type SaveMCPServerPayload,
  saveMCPServer,
  toggleMCPServer,
} from '../lib/mcp';
import { BuilderProfileSection } from '../components/settings/builder-profile-section';

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
    label: 'Gemini',
    helper: 'Use Gemini with your own key for fast plan drafting and step updates.',
    placeholder: 'AIza...',
  },
  {
    value: 'openrouter',
    label: 'OpenRouter',
    helper: 'Access multiple AI models through OpenRouter at competitive prices.',
    placeholder: 'sk-or-...',
  },
  {
    value: 'groq',
    label: 'Groq',
    helper: 'Ultra-fast inference with Groq. Great for quick iterations.',
    placeholder: 'gsk_...',
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
  gemini: 'Gemini',
  custom: 'Custom',
  openrouter: 'OpenRouter',
  groq: 'Groq',
};

const inputClassName = 'field-input';

type ProviderFormState = {
  provider: AIProviderType;
  apiKey: string;
  model: string;
  baseUrl: string;
};

type ModelRoleSlotFormState = {
  providerId: string;
  modelName: string;
};

type ModelRoleFormState = {
  fast: ModelRoleSlotFormState;
  deep: ModelRoleSlotFormState;
};

type MCPFormFieldName = 'apiKey' | 'token' | 'name' | 'baseUrl';

type MCPFormState = {
  apiKey: string;
  token: string;
  name: string;
  baseUrl: string;
};

type MCPFieldDefinition = {
  key: MCPFormFieldName;
  label: string;
  placeholder: string;
  type: 'password' | 'text' | 'url';
  autoComplete?: string;
  helper?: string;
};

type MCPCardDefinition = {
  type: MCPServerType;
  label: string;
  description: string;
  icon: LucideIcon;
  optional?: boolean;
  recommended?: boolean;
  getLinkHref?: string;
  getLinkLabel?: string;
  note?: string;
  fields: MCPFieldDefinition[];
};

type AlwaysOnResearchCard = {
  id: 'jina' | 'gitmcp' | 'cloudflare-scrape';
  label: string;
  description: string;
  icon: LucideIcon;
};

const defaultFormState: ProviderFormState = {
  provider: 'openai',
  apiKey: '',
  model: '',
  baseUrl: '',
};

const defaultModelRoleFormState: ModelRoleFormState = {
  fast: {
    providerId: '',
    modelName: '',
  },
  deep: {
    providerId: '',
    modelName: '',
  },
};

const defaultMCPFormState: MCPFormState = {
  apiKey: '',
  token: '',
  name: '',
  baseUrl: '',
};

const defaultMCPForms: Record<MCPServerType, MCPFormState> = {
  'brave-search': { ...defaultMCPFormState },
  github: { ...defaultMCPFormState },
  context7: { ...defaultMCPFormState },
  custom: { ...defaultMCPFormState },
};

const alwaysOnResearchCards: AlwaysOnResearchCard[] = [
  {
    id: 'jina',
    label: 'Jina Reader + Search',
    description: 'Always on — no setup needed.',
    icon: Search,
  },
  {
    id: 'gitmcp',
    label: 'GitMCP',
    description: 'Always on for public repos — no setup needed.',
    icon: Github,
  },
  {
    id: 'cloudflare-scrape',
    label: 'Cloudflare Scrape',
    description: 'Always on — powered by Cloudflare.',
    icon: Cpu,
  },
];

const mcpCardDefinitions: MCPCardDefinition[] = [
  {
    type: 'brave-search',
    label: 'Brave Search',
    description: 'Additional web search layer.',
    icon: Search,
    optional: true,
    getLinkHref: 'https://brave.com/search/api',
    getLinkLabel: 'brave.com/search/api',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        placeholder: 'Paste your Brave Search API key',
        type: 'password',
        autoComplete: 'off',
      },
    ],
  },
  {
    type: 'github',
    label: 'GitHub Personal Access Token',
    description: 'For private repos and higher rate limits.',
    icon: Github,
    optional: true,
    getLinkHref: 'https://github.com/settings/tokens',
    getLinkLabel: 'github.com/settings/tokens',
    note: 'Recommended scopes: public_repo for public repos, plus private repo scopes only if needed.',
    fields: [
      {
        key: 'token',
        label: 'Personal Access Token (read-only)',
        placeholder: 'ghp_...',
        type: 'password',
        autoComplete: 'off',
        helper: 'Use a token with public_repo so Scrimble can inspect public repos and issues.',
      },
    ],
  },
  {
    type: 'context7',
    label: 'Context7',
    description: 'For indexed library documentation.',
    icon: BookText,
    optional: true,
    recommended: true,
    getLinkHref: 'https://context7.com',
    getLinkLabel: 'Get a free key at context7.com',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        placeholder: 'Paste your Context7 key',
        type: 'password',
        autoComplete: 'off',
      },
    ],
  },
  {
    type: 'custom',
    label: 'Custom MCP',
    description: 'Any MCP-compatible server you run yourself.',
    icon: Server,
    optional: true,
    note: 'Use this for a private MCP endpoint that should only run inside your own stack.',
    fields: [
      {
        key: 'name',
        label: 'Server name',
        placeholder: 'My research server',
        type: 'text',
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        placeholder: 'https://your-mcp.example.com',
        type: 'url',
        autoComplete: 'url',
      },
    ],
  },
];

function getProviderSummary(provider: AIProvider) {
  if (provider.provider === 'custom' && provider.base_url) {
    return provider.base_url;
  }

  if (provider.model) {
    return provider.model;
  }

  return provider.name;
}

function getProviderDropdownLabel(provider: AIProvider) {
  const accountLabel = provider.provider === 'custom' && provider.base_url 
    ? provider.base_url 
    : provider.masked_key 
      ? `Ends in ${provider.masked_key.slice(-4)}`
      : provider.name;

  return `${providerLabels[provider.provider]} (${accountLabel})`;
}

function mapRolesToFormState(roles: AIModelRoles): ModelRoleFormState {
  return {
    fast: {
      providerId: roles.fast_model_provider_id || '',
      modelName: roles.fast_model_name || '',
    },
    deep: {
      providerId: roles.deep_model_provider_id || '',
      modelName: roles.deep_model_name || '',
    },
  };
}

function buildRolePayload(state: ModelRoleFormState): AIModelRoles {
  const fastProviderId = state.fast.providerId.trim();
  const fastModelName = state.fast.modelName.trim();
  const deepProviderId = state.deep.providerId.trim();
  const deepModelName = state.deep.modelName.trim();

  return {
    fast_model_provider_id: fastProviderId || null,
    fast_model_name: fastModelName || null,
    deep_model_provider_id: deepProviderId || null,
    deep_model_name: deepModelName || null,
  };
}

function getToolStatusText(server: MCPServer) {
  return server.is_active ? 'Connected' : 'Paused';
}

function getToolStatusClasses(server: MCPServer) {
  return server.is_active
    ? 'border-[rgba(52,211,153,0.22)] bg-[rgba(52,211,153,0.08)] text-status-secure'
    : 'border-[rgba(244,187,102,0.24)] bg-[rgba(244,187,102,0.08)] text-status-warning';
}

export default function Settings() {
  const { user } = useAuthStore();
  const mcpSectionRef = useRef<HTMLElement | null>(null);

  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [mcpServers, setMCPServers] = useState<MCPServer[]>([]);
  const [form, setForm] = useState<ProviderFormState>(defaultFormState);
  const [modelRoleForm, setModelRoleForm] = useState<ModelRoleFormState>(defaultModelRoleFormState);
  const [mcpForms, setMCPForms] = useState<Record<MCPServerType, MCPFormState>>(defaultMCPForms);
  const [expandedMCPType, setExpandedMCPType] = useState<MCPServerType | null>(null);
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);
  const [isLoadingModelRoles, setIsLoadingModelRoles] = useState(true);
  const [isLoadingMCPServers, setIsLoadingMCPServers] = useState(true);
  const [providerLoadError, setProviderLoadError] = useState<string | null>(null);
  const [modelRoleLoadError, setModelRoleLoadError] = useState<string | null>(null);
  const [mcpLoadError, setMCPLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingModelRoles, setIsSavingModelRoles] = useState(false);
  const [savingMCPType, setSavingMCPType] = useState<MCPServerType | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [providerErrors, setProviderErrors] = useState<Record<string, string>>({});
  const [removingMCPId, setRemovingMCPId] = useState<string | null>(null);
  const [togglingMCPId, setTogglingMCPId] = useState<string | null>(null);

  const selectedProvider =
    providerOptions.find((option) => option.value === form.provider) ?? providerOptions[0];

  const mcpServersByType = mcpServers.reduce<Partial<Record<MCPServerType, MCPServer>>>(
    (lookup, server) => {
      lookup[server.server_type] = server;
      return lookup;
    },
    {},
  );

  const optionalResearchToolCount = mcpServers.filter((server) => server.is_active).length;
  const activeResearchToolCount = alwaysOnResearchCards.length + optionalResearchToolCount;
  const aiProviderCount = providers.length;
  const isWorkspaceReady = aiProviderCount > 0;

  const loadProviders = async (silent = false) => {
    setIsLoadingProviders(true);
    setProviderLoadError(null);

    try {
      const result = await getAIProviders();
      setProviders(result);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Could not load your AI keys right now.';
      setProviderLoadError(message);
      if (!silent) {
        toast.error(message);
      }
    } finally {
      setIsLoadingProviders(false);
    }
  };

  const loadModelRoles = async (silent = false) => {
    setIsLoadingModelRoles(true);
    setModelRoleLoadError(null);

    try {
      const result = await getAIModelRoles();
      setModelRoleForm(mapRolesToFormState(result));
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Could not load your model role preferences right now.';
      setModelRoleLoadError(message);
      if (!silent) {
        toast.error(message);
      }
    } finally {
      setIsLoadingModelRoles(false);
    }
  };

  const loadMCPServers = async (silent = false) => {
    setIsLoadingMCPServers(true);
    setMCPLoadError(null);

    try {
      const result = await getMCPServers();
      setMCPServers(result);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not load your research tools right now.';
      setMCPLoadError(message);
      if (!silent) {
        toast.error(message);
      }
    } finally {
      setIsLoadingMCPServers(false);
    }
  };

  useEffect(() => {
    void Promise.all([loadProviders(), loadModelRoles(), loadMCPServers()]);
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
      await Promise.all([loadProviders(true), loadModelRoles(true)]);
      toast.success('Provider removed.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Could not remove that AI key.');
    } finally {
      setRemovingId(null);
    }
  };

  const handleTestProvider = async (providerId: string) => {
    setTestingId(providerId);
    setProviderErrors((prev) => ({ ...prev, [providerId]: '' }));
    try {
      const success = await testAIProvider(providerId);
      if (success) {
        toast.success('Connection successful! The AI key is working.');
        setProviderErrors((prev) => ({ ...prev, [providerId]: '' }));
      } else {
        const errorMsg = 'Connection failed. Please check your API key.';
        setProviderErrors((prev) => ({ ...prev, [providerId]: errorMsg }));
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Could not test the connection.';
      setProviderErrors((prev) => ({ ...prev, [providerId]: errorMsg }));
    } finally {
      setTestingId(null);
    }
  };

  const handleModelRoleFieldChange = (
    role: 'fast' | 'deep',
    field: keyof ModelRoleSlotFormState,
    value: string,
  ) => {
    setModelRoleForm((current) => {
      const next = {
        ...current,
        [role]: {
          ...current[role],
          [field]: value,
        },
      };

      // Auto-fill model name if a provider is selected and model name is currently empty
      if (field === 'providerId' && value) {
        const selected = providers.find(p => p.id === value);
        if (selected?.model && !next[role].modelName) {
          next[role].modelName = selected.model;
        }
      }

      return next;
    });
  };

  const handleSaveModelRoles = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload = buildRolePayload(modelRoleForm);
    const hasFastMismatch = Boolean(payload.fast_model_provider_id) !== Boolean(payload.fast_model_name);
    const hasDeepMismatch = Boolean(payload.deep_model_provider_id) !== Boolean(payload.deep_model_name);

    if (hasFastMismatch) {
      toast.error('Fast model needs both a provider and a model name.');
      return;
    }

    if (hasDeepMismatch) {
      toast.error('Deep model needs both a provider and a model name.');
      return;
    }

    setIsSavingModelRoles(true);

    try {
      const saved = await saveAIModelRoles(payload);
      setModelRoleForm(mapRolesToFormState(saved));
      toast.success('Model roles saved.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Could not save model roles.');
    } finally {
      setIsSavingModelRoles(false);
    }
  };

  const handleMCPFieldChange = (
    serverType: MCPServerType,
    field: MCPFormFieldName,
    value: string,
  ) => {
    setMCPForms((current) => ({
      ...current,
      [serverType]: {
        ...current[serverType],
        [field]: value,
      },
    }));
  };

  const resetMCPForm = (serverType: MCPServerType) => {
    setMCPForms((current) => ({
      ...current,
      [serverType]: { ...defaultMCPFormState },
    }));
  };

  const handleSaveMCPServer = async (
    event: FormEvent<HTMLFormElement>,
    serverType: MCPServerType,
  ) => {
    event.preventDefault();

    const currentForm = mcpForms[serverType];
    let payload: SaveMCPServerPayload | null = null;

    if (serverType === 'brave-search') {
      const apiKey = currentForm.apiKey.trim();
      if (!apiKey) {
        toast.error('Add your Brave Search API key first.');
        return;
      }
      payload = {
        serverType,
        config: { apiKey },
      };
    }

    if (serverType === 'github') {
      const token = currentForm.token.trim();
      if (!token) {
        toast.error('Add your GitHub Personal Access Token first.');
        return;
      }
      payload = {
        serverType,
        config: { token },
      };
    }

    if (serverType === 'context7') {
      const apiKey = currentForm.apiKey.trim();
      if (!apiKey) {
        toast.error('Add your Context7 API key first.');
        return;
      }
      payload = {
        serverType,
        config: { apiKey },
      };
    }

    if (serverType === 'custom') {
      const name = currentForm.name.trim();
      const baseUrl = currentForm.baseUrl.trim();

      if (!name) {
        toast.error('Give your custom MCP server a name.');
        return;
      }

      if (!baseUrl) {
        toast.error('Add the base URL for your custom MCP server.');
        return;
      }

      payload = {
        serverType,
        name,
        config: { baseUrl },
      };
    }

    if (!payload) {
      toast.error('Could not prepare that research tool connection.');
      return;
    }

    setSavingMCPType(serverType);

    try {
      await saveMCPServer(payload);
      await loadMCPServers(true);
      resetMCPForm(serverType);
      setExpandedMCPType(null);
      toast.success('Research tool connected.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Could not connect that research tool.');
    } finally {
      setSavingMCPType(null);
    }
  };

  const handleToggleMCPServer = async (server: MCPServer) => {
    setTogglingMCPId(server.id);

    try {
      const result = await toggleMCPServer(server.id);
      await loadMCPServers(true);
      toast.success(result.is_active ? `${server.name} turned on.` : `${server.name} paused.`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Could not update that research tool.');
    } finally {
      setTogglingMCPId(null);
    }
  };

  const handleRemoveMCPServer = async (server: MCPServer) => {
    setRemovingMCPId(server.id);

    try {
      await deleteMCPServer(server.id);
      await loadMCPServers(true);
      if (expandedMCPType === server.server_type) {
        setExpandedMCPType(null);
      }
      toast.success('Research tool disconnected.');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Could not disconnect that research tool.');
    } finally {
      setRemovingMCPId(null);
    }
  };

  const scrollToResearchTools = () => {
    mcpSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <motion.main
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="mx-auto w-full max-w-[920px] px-6 pb-24 pt-20 font-sans"
    >
      <motion.div variants={itemVariants} className="mb-10 max-w-[620px]">
        <h1 className="text-heading mb-3">Settings</h1>
        <p className="text-body">
          Keep your account close at hand, manage your AI providers, and tune optional
          research connectors when you want private or indexed sources.
        </p>
      </motion.div>

      <motion.section
        variants={itemVariants}
        className="mb-8 grid gap-4 md:grid-cols-3"
      >
        <div className="rounded-[16px] border border-border-default bg-bg-surface p-5 shadow-panel">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-text-secondary">
            <Cpu className="h-4 w-4 text-accent-primary" />
            AI coverage
          </div>
          <div className="text-3xl font-serif tracking-[-0.04em] text-text-primary">
            {aiProviderCount}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            {aiProviderCount > 0
              ? 'Your generation keys are connected and ready to use.'
              : 'Add at least one AI key so Scrimble can start building.'}
          </p>
        </div>

        <div className="rounded-[16px] border border-border-default bg-bg-surface p-5 shadow-panel">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-text-secondary">
            <Search className="h-4 w-4 text-accent-primary" />
            Research depth
          </div>
          <div className="text-3xl font-serif tracking-[-0.04em] text-text-primary">
            {activeResearchToolCount}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            {`Core stack active (${alwaysOnResearchCards.length}) with ${optionalResearchToolCount} optional connector${optionalResearchToolCount === 1 ? '' : 's'}.`}
          </p>
        </div>

        <div className="rounded-[16px] border border-border-default bg-bg-surface p-5 shadow-panel">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-text-secondary">
            <ShieldCheck className="h-4 w-4 text-accent-primary" />
            Workspace readiness
          </div>
          <div className="text-lg font-medium tracking-[-0.03em] text-text-primary">
            {isWorkspaceReady ? 'Ready to build' : 'Needs one quick setup'}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            {isWorkspaceReady
              ? 'You can start a new project now and Scrimble will have what it needs.'
              : 'Once you save an AI key, new projects can run without extra setup.'}
          </p>
        </div>
      </motion.section>

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
              <h2 className="text-xl font-medium tracking-[-0.03em] text-text-primary">
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

      <motion.div variants={itemVariants} className="mb-8">
        <BuilderProfileSection />
      </motion.div>

      <motion.section
        variants={itemVariants}
        className="mb-8 rounded-[16px] border border-border-default bg-bg-surface p-6 shadow-panel"
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

        {providerLoadError ? (
          <div className="mb-5 flex flex-col gap-3 rounded-[14px] border border-status-error/25 bg-status-error/8 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-text-primary">I couldn&apos;t refresh your AI keys.</p>
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">{providerLoadError}</p>
            </div>
            <button
              type="button"
              onClick={() => void loadProviders()}
              className="inline-flex items-center gap-2 rounded-[8px] border border-status-error/25 px-3 py-2 text-sm font-medium text-status-error transition-colors hover:bg-status-error/10"
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>
          </div>
        ) : null}

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
                      <h3 className="text-[17px] font-medium tracking-[-0.03em] text-text-primary">
                        {providerLabels[provider.provider]}
                      </h3>
                      {provider.is_default ? (
                        <span className="rounded-[6px] border border-accent-border bg-accent-primary-muted px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em] text-accent-primary">
                          Default
                        </span>
                      ) : null}
                    </div>
                    <p className="mb-3 text-sm text-text-secondary">{getProviderSummary(provider)}</p>

                    {providerErrors[provider.id] ? (
                      <InlineError 
                        message={providerErrors[provider.id]} 
                        onRetry={() => handleTestProvider(provider.id)}
                        className="mb-3"
                      />
                    ) : null}

                    <div className="space-y-2">
                      <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-text-tertiary">
                        Saved key
                      </label>
                      <input
                        readOnly
                        value={provider.masked_key || '••••••••••••••••'}
                        className={cn(inputClassName, 'cursor-default bg-bg-base/60 opacity-85', provider.masked_key && 'font-mono text-xs')}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleTestProvider(provider.id)}
                      disabled={testingId === provider.id}
                      className="btn-secondary"
                    >
                      {testingId === provider.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-4 w-4" />
                      )}
                      Test
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveProvider(provider.id)}
                      disabled={removingId === provider.id}
                      className="btn-danger"
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
            <Cpu className="h-4 w-4 text-accent-primary" />
            Model roles.
          </div>

          {modelRoleLoadError ? (
            <div className="mb-4 flex flex-col gap-3 rounded-[12px] border border-status-error/25 bg-status-error/8 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-text-secondary">{modelRoleLoadError}</p>
              <button
                type="button"
                onClick={() => void loadModelRoles()}
                className="inline-flex items-center gap-2 rounded-[8px] border border-status-error/25 px-3 py-2 text-sm font-medium text-status-error transition-colors hover:bg-status-error/10"
              >
                <RefreshCw className="h-4 w-4" />
                Try again
              </button>
            </div>
          ) : null}

          {isLoadingModelRoles ? (
            <div className="rounded-[12px] border border-border-default bg-bg-elevated/60 p-4 text-sm text-text-secondary">
              Loading your model role preferences...
            </div>
          ) : (
            <form onSubmit={handleSaveModelRoles} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[12px] border border-border-default bg-bg-surface/70 p-4">
                  <h3 className="mb-1 text-[15px] font-medium text-text-primary">Fast model</h3>
                  <p className="mb-4 text-sm text-text-secondary">
                    For quick tasks (structuring, routing, research summaries).
                  </p>

                  <div className="space-y-3">
                    <div>
                      <label className="mb-2 block text-[13px] font-medium text-text-secondary">
                        Connected provider
                      </label>
                      <select
                        value={modelRoleForm.fast.providerId}
                        onChange={(event) => handleModelRoleFieldChange('fast', 'providerId', event.target.value)}
                        className={inputClassName}
                        disabled={isSavingModelRoles}
                      >
                        <option value="">Use default AI</option>
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {getProviderDropdownLabel(provider)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-[13px] font-medium text-text-secondary">
                        Model name
                      </label>
                      <input
                        type="text"
                        value={modelRoleForm.fast.modelName}
                        onChange={(event) => handleModelRoleFieldChange('fast', 'modelName', event.target.value)}
                        placeholder="e.g. gemini-2.0-flash, gpt-4o-mini, llama-3.3-70b"
                        className={inputClassName}
                        disabled={isSavingModelRoles}
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-[12px] border border-border-default bg-bg-surface/70 p-4">
                  <h3 className="mb-1 text-[15px] font-medium text-text-primary">Deep model</h3>
                  <p className="mb-4 text-sm text-text-secondary">
                    For complex tasks (plan generation, architecture, step writing).
                  </p>

                  <div className="space-y-3">
                    <div>
                      <label className="mb-2 block text-[13px] font-medium text-text-secondary">
                        Connected provider
                      </label>
                      <select
                        value={modelRoleForm.deep.providerId}
                        onChange={(event) => handleModelRoleFieldChange('deep', 'providerId', event.target.value)}
                        className={inputClassName}
                        disabled={isSavingModelRoles}
                      >
                        <option value="">Use default AI</option>
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {getProviderDropdownLabel(provider)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-[13px] font-medium text-text-secondary">
                        Model name
                      </label>
                      <input
                        type="text"
                        value={modelRoleForm.deep.modelName}
                        onChange={(event) => handleModelRoleFieldChange('deep', 'modelName', event.target.value)}
                        placeholder="e.g. gemini-2.5-pro, gpt-4o, claude-3-5-sonnet"
                        className={inputClassName}
                        disabled={isSavingModelRoles}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <p className="font-mono text-[11px] leading-relaxed text-text-tertiary">
                  Not sure? Leave these blank and Scrimble will use your default AI for everything.
                </p>
                <p className="font-mono text-[11px] leading-relaxed text-text-tertiary">
                  For the best plans, use a fast model (e.g. Flash, mini variants) for the quick slot and your smartest model for the deep slot.
                </p>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingModelRoles}
                  className="btn-secondary flex items-center gap-2 rounded-[8px] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingModelRoles ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {isSavingModelRoles ? 'Saving...' : 'Save model roles'}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="mt-6 rounded-[14px] border border-border-default bg-bg-elevated/40 p-5">
          <div className="mb-4 flex items-center gap-2 text-[15px] font-medium text-text-primary">
            <Cpu className="h-4 w-4 text-accent-primary" />
            Add another AI
          </div>

          <form onSubmit={handleSaveProvider} className="space-y-5">
            <input
              type="text"
              name="username"
              autoComplete="username"
              style={{ display: 'none' }}
              readOnly
              value={user?.email || 'user'}
            />
            <div>
              <div className="grid gap-1 rounded-[10px] border border-border-default bg-bg-elevated p-1 sm:grid-cols-4">
                {providerOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        provider: option.value,
                        apiKey: '',
                        model: '',
                        baseUrl: '',
                      }))
                    }
                    className={cn(
                      'h-9 rounded-[6px] px-3 text-sm font-medium transition-all duration-200',
                      form.provider === option.value
                        ? 'bg-bg-surface text-accent-primary shadow-[0_0_0_1px_var(--color-accent-border)]'
                        : 'text-text-secondary hover:bg-bg-surface/50 hover:text-text-primary',
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
                <label className="mb-2 block text-[13px] font-medium text-text-secondary">
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
                <label className="mb-2 block text-[13px] font-medium text-text-secondary">
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
                  <label className="mb-2 block text-[13px] font-medium text-text-secondary">
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

        <div className="mt-6 rounded-[14px] border border-accent-border bg-accent-primary-muted p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent-primary" />
            <p className="text-sm leading-relaxed text-text-primary">
              Your keys are encrypted before they are stored in Cloudflare D1. Scrimble never
              keeps them in plain text and only uses them to run work on your projects.
            </p>
          </div>
        </div>
      </motion.section>

      {optionalResearchToolCount === 0 ? (
        <motion.div
          variants={itemVariants}
          className="mb-8 rounded-[14px] border border-accent-border bg-accent-primary-muted px-4 py-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-relaxed text-text-secondary">
              You are already covered by the default research stack. Add optional connectors if
              you want private repositories, indexed docs, or extra web coverage.
            </p>
            <button
              type="button"
              onClick={scrollToResearchTools}
              className="inline-flex items-center gap-1 text-sm font-medium text-accent-primary transition-colors hover:text-accent-primary-hover"
            >
              Set up now
            </button>
          </div>
        </motion.div>
      ) : null}

      <motion.section
        ref={mcpSectionRef}
        id="research-tools"
        variants={itemVariants}
        className="rounded-[16px] border border-border-default bg-bg-surface p-6 shadow-panel"
      >
        <div className="mb-6 max-w-[720px]">
          <div className="section-label mb-4">Research tools</div>
          <h2 className="mb-2 text-2xl font-serif tracking-[-0.03em] text-text-primary">
            Research is ready by default.
          </h2>
          <p className="text-body">
            Scrimble always uses Jina Reader + Search, GitMCP, and Cloudflare Scrape. Optional
            connectors below expand private and indexed coverage when you need it.
          </p>
        </div>

        {mcpLoadError ? (
          <div className="mb-5 flex flex-col gap-3 rounded-[14px] border border-status-error/25 bg-status-error/8 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-text-primary">I couldn&apos;t refresh your research tools.</p>
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">{mcpLoadError}</p>
            </div>
            <button
              type="button"
              onClick={() => void loadMCPServers()}
              className="inline-flex items-center gap-2 rounded-[8px] border border-status-error/25 px-3 py-2 text-sm font-medium text-status-error transition-colors hover:bg-status-error/10"
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>
          </div>
        ) : null}

        <div className="space-y-4">
          {alwaysOnResearchCards.map((card) => (
            <div
              key={card.id}
              className="rounded-[14px] border border-border-default bg-bg-elevated/70 p-4"
            >
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] border border-border-default bg-bg-base/55">
                    <card.icon className="h-5 w-5 text-accent-primary" />
                  </div>

                  <div className="max-w-[620px]">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h3 className="text-[17px] font-medium tracking-[-0.03em] text-text-primary">
                        {card.label}
                      </h3>
                    </div>

                    <p className="text-sm leading-relaxed text-text-secondary">
                      {card.description}
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center gap-2 rounded-[8px] border border-[rgba(52,211,153,0.22)] bg-[rgba(52,211,153,0.08)] px-3 py-1 text-[12px] font-medium text-status-secure">
                        <span className="h-2 w-2 rounded-full bg-status-secure" />
                        Connected
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {isLoadingMCPServers ? (
            <div className="rounded-[14px] border border-border-default bg-bg-elevated/50 p-4 text-sm text-text-secondary">
              Loading your optional research connectors...
            </div>
          ) : (
            mcpCardDefinitions.map((card) => {
              const connectedServer = mcpServersByType[card.type];
              const isConnected = Boolean(connectedServer);
              const isExpanded = expandedMCPType === card.type;
              const isSavingCard = savingMCPType === card.type;

              return (
                <div
                  key={card.type}
                  className="rounded-[14px] border border-border-default bg-bg-elevated/70 p-4"
                >
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] border border-border-default bg-bg-base/55">
                        <card.icon className="h-5 w-5 text-accent-primary" />
                      </div>

                      <div className="max-w-[620px]">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <h3 className="text-[17px] font-medium tracking-[-0.03em] text-text-primary">
                            {card.label}
                          </h3>
                          {card.optional ? (
                            <span className="rounded-[6px] border border-border-default bg-bg-base/60 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em] text-text-tertiary">
                              Optional
                            </span>
                          ) : null}
                          {card.recommended ? (
                            <span className="rounded-[6px] border border-[rgba(244,187,102,0.24)] bg-[rgba(244,187,102,0.08)] px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em] text-status-warning">
                              Recommended
                            </span>
                          ) : null}
                        </div>

                        <p className="text-sm leading-relaxed text-text-secondary">
                          {card.description}
                        </p>

                        {isConnected && connectedServer ? (
                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <span
                              className={cn(
                                'inline-flex items-center gap-2 rounded-[8px] border px-3 py-1 text-[12px] font-medium',
                                getToolStatusClasses(connectedServer),
                              )}
                            >
                              <span
                                className={cn(
                                  'h-2 w-2 rounded-full',
                                  connectedServer.is_active ? 'bg-status-secure' : 'bg-status-warning',
                                )}
                              />
                              {getToolStatusText(connectedServer)}
                            </span>
                            <p className="text-sm text-text-secondary">
                              {connectedServer.masked_config}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {isConnected && connectedServer ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleToggleMCPServer(connectedServer)}
                            disabled={togglingMCPId === connectedServer.id}
                            className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {togglingMCPId === connectedServer.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : null}
                            {connectedServer.is_active ? 'Pause' : 'Turn on'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRemoveMCPServer(connectedServer)}
                            disabled={removingMCPId === connectedServer.id}
                            className="inline-flex items-center gap-2 text-sm font-medium text-status-error transition-colors hover:text-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {removingMCPId === connectedServer.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : null}
                            Disconnect
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedMCPType((current) => (current === card.type ? null : card.type))
                          }
                          className="inline-flex h-11 items-center justify-center rounded-[8px] border border-accent-border px-4 text-sm font-medium text-accent-primary transition-colors hover:bg-accent-primary-muted"
                        >
                          {isExpanded ? 'Close' : 'Connect'}
                        </button>
                      )}
                    </div>
                  </div>

                  {!isConnected && isExpanded ? (
                    <div className="mt-5 rounded-[12px] border border-border-default bg-bg-base/45 p-4">
                      <form
                        onSubmit={(event) => void handleSaveMCPServer(event, card.type)}
                        className="space-y-4"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-[15px] font-medium text-text-primary">
                              Connect {card.label}
                            </p>
                            {card.note ? (
                              <p className="mt-1 text-sm text-text-secondary">{card.note}</p>
                            ) : null}
                          </div>

                          {card.getLinkHref && card.getLinkLabel ? (
                            <a
                              href={card.getLinkHref}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-sm font-medium text-accent-soft transition-colors hover:text-accent-primary"
                            >
                              {card.getLinkLabel}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                        </div>

                        <div
                          className={cn(
                            'grid gap-4',
                            card.fields.length > 1 ? 'sm:grid-cols-2' : 'sm:grid-cols-1',
                          )}
                        >
                          {card.fields.map((field) => (
                            <div key={`${card.type}-${field.key}`}>
                              <label className="mb-2 block text-[13px] font-medium text-text-secondary">
                                {field.label}
                              </label>
                              <input
                                type={field.type}
                                autoComplete={field.autoComplete}
                                value={mcpForms[card.type][field.key]}
                                onChange={(event) =>
                                  handleMCPFieldChange(card.type, field.key, event.target.value)
                                }
                                placeholder={field.placeholder}
                                className={inputClassName}
                              />
                              {field.helper ? (
                                <p className="mt-2 text-xs leading-relaxed text-text-tertiary">
                                  {field.helper}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>

                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => setExpandedMCPType(null)}
                            className="inline-flex h-11 items-center justify-center rounded-[8px] border border-border-default px-4 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={isSavingCard}
                            className="btn-primary flex items-center gap-2 rounded-[8px] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isSavingCard ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            {isSavingCard ? 'Connecting...' : 'Save connection'}
                          </button>
                        </div>
                      </form>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div className="mt-5 px-1 text-[13px] leading-relaxed text-text-muted">
          Scrimble only uses these tools while building your plan. Your tokens are encrypted and
          never shared.
        </div>
      </motion.section>
    </motion.main>
  );
}
