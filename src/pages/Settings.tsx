import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  BookText,
  Cpu,
  ExternalLink,
  Github,
  KeyRound,
  LayoutDashboard,
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
import {
  AIProvider,
  AIProviderType,
  deleteAIProvider,
  getAIProviders,
  saveAIProvider,
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
import { useCountUp } from '../hooks/useCountUp';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';

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

type SectionId = 'overview' | 'account' | 'profile' | 'ai' | 'research';

const settingsSections: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'account', label: 'Account', icon: UserIcon },
  { id: 'profile', label: 'Builder Profile', icon: Cpu },
  { id: 'ai', label: 'AI Keys', icon: KeyRound },
  { id: 'research', label: 'Research Tools', icon: Search },
];

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
    value: 'groq',
    label: 'Groq',
    helper: 'Use Groq for ultra-fast plan generation with open-source models.',
    placeholder: 'gsk_...',
  },
  {
    value: 'openrouter',
    label: 'OpenRouter',
    helper: 'Use OpenRouter to access a broad model catalog behind one key.',
    placeholder: 'sk-or-v1-...',
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
  groq: 'Groq',
  openrouter: 'OpenRouter',
  custom: 'Custom',
};

const inputClassName = 'field-input';

type ProviderFormState = {
  provider: AIProviderType;
  apiKey: string;
  model: string;
  baseUrl: string;
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
  recommended?: boolean;
  getLinkHref?: string;
  getLinkLabel?: string;
  note?: string;
  fields: MCPFieldDefinition[];
};

const defaultFormState: ProviderFormState = {
  provider: 'openai',
  apiKey: '',
  model: '',
  baseUrl: '',
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

const mcpCardDefinitions: MCPCardDefinition[] = [
  {
    type: 'brave-search',
    label: 'Brave Search',
    description:
      'Searches the web for the latest library news, community discussions, and real-world feedback.',
    icon: Search,
    recommended: true,
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
    label: 'GitHub',
    description: 'Checks library health, reads real bug reports, and compares alternatives.',
    icon: Github,
    getLinkHref: 'https://github.com/settings/tokens',
    getLinkLabel: 'github.com/settings/tokens',
    note: 'Scopes needed: public_repo.',
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
    description:
      'Pulls live, structured documentation for any library — always current, never stale.',
    icon: BookText,
    recommended: true,
    getLinkHref: 'https://context7.com',
    getLinkLabel: 'context7.com',
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
  const connectIntentTimeoutRef = useRef<number | null>(null);
  const disconnectIntentTimeoutRef = useRef<number | null>(null);

  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [mcpServers, setMCPServers] = useState<MCPServer[]>([]);
  const [form, setForm] = useState<ProviderFormState>(defaultFormState);
  const [mcpForms, setMCPForms] = useState<Record<MCPServerType, MCPFormState>>(defaultMCPForms);
  const [expandedMCPType, setExpandedMCPType] = useState<MCPServerType | null>(null);
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);
  const [isLoadingMCPServers, setIsLoadingMCPServers] = useState(true);
  const [providerLoadError, setProviderLoadError] = useState<string | null>(null);
  const [mcpLoadError, setMCPLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savingMCPType, setSavingMCPType] = useState<MCPServerType | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removingMCPId, setRemovingMCPId] = useState<string | null>(null);
  const [togglingMCPId, setTogglingMCPId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const [visibleSection, setVisibleSection] = useState<SectionId>('overview');
  const [isSectionSwitching, setIsSectionSwitching] = useState(false);
  const [openingMCPType, setOpeningMCPType] = useState<MCPServerType | null>(null);
  const [pendingMCPDisconnectId, setPendingMCPDisconnectId] = useState<string | null>(null);
  const [providerToRemove, setProviderToRemove] = useState<AIProvider | null>(null);
  const [isSignOutDialogOpen, setIsSignOutDialogOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const selectedProvider =
    providerOptions.find((option) => option.value === form.provider) ?? providerOptions[0];
  const accountInitial = (user?.displayName || user?.email || 'U').trim().charAt(0).toUpperCase();

  const mcpServersByType = mcpServers.reduce<Partial<Record<MCPServerType, MCPServer>>>(
    (lookup, server) => {
      lookup[server.server_type] = server;
      return lookup;
    },
    {},
  );

  const activeResearchToolCount = mcpServers.filter((server) => server.is_active).length;
  const aiProviderCount = providers.length;
  const isWorkspaceReady = aiProviderCount > 0;
  const animatedAIProviderCount = useCountUp({
    target: aiProviderCount,
    durationMs: 1200,
    enabled: !isLoadingProviders && aiProviderCount > 0,
  });
  const animatedResearchToolCount = useCountUp({
    target: activeResearchToolCount,
    durationMs: 1200,
    enabled: !isLoadingMCPServers && activeResearchToolCount > 0,
  });

  useEffect(() => {
    const titleBySection: Record<SectionId, string> = {
      overview: 'Settings — Scrimble',
      account: 'Account — Scrimble',
      profile: 'Builder Profile — Scrimble',
      ai: 'AI Keys — Scrimble',
      research: 'Research Tools — Scrimble',
    };

    document.title = titleBySection[activeSection];
  }, [activeSection]);

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
    void Promise.all([loadProviders(), loadMCPServers()]);
  }, []);

  useEffect(() => {
    if (activeSection === visibleSection) {
      return;
    }

    setIsSectionSwitching(true);
    const timeoutId = window.setTimeout(() => {
      setVisibleSection(activeSection);
      setIsSectionSwitching(false);
    }, 100);

    return () => window.clearTimeout(timeoutId);
  }, [activeSection, visibleSection]);

  useEffect(() => {
    return () => {
      if (connectIntentTimeoutRef.current !== null) {
        window.clearTimeout(connectIntentTimeoutRef.current);
      }
      if (disconnectIntentTimeoutRef.current !== null) {
        window.clearTimeout(disconnectIntentTimeoutRef.current);
      }
    };
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

  const requestProviderRemoval = (provider: AIProvider) => {
    setProviderToRemove(provider);
  };

  const handleConfirmProviderRemoval = async () => {
    if (!providerToRemove) {
      return;
    }

    await handleRemoveProvider(providerToRemove.id);
    setProviderToRemove(null);
  };

  const handleConfirmSignOut = async () => {
    setIsSigningOut(true);
    try {
      await logout();
      setIsSignOutDialogOpen(false);
    } finally {
      setIsSigningOut(false);
    }
  };

  const clearPendingMCPDisconnect = () => {
    if (disconnectIntentTimeoutRef.current !== null) {
      window.clearTimeout(disconnectIntentTimeoutRef.current);
      disconnectIntentTimeoutRef.current = null;
    }

    setPendingMCPDisconnectId(null);
  };

  const requestMCPDisconnect = (server: MCPServer) => {
    if (pendingMCPDisconnectId === server.id) {
      clearPendingMCPDisconnect();
      void handleRemoveMCPServer(server);
      return;
    }

    if (disconnectIntentTimeoutRef.current !== null) {
      window.clearTimeout(disconnectIntentTimeoutRef.current);
    }

    setPendingMCPDisconnectId(server.id);
    disconnectIntentTimeoutRef.current = window.setTimeout(() => {
      setPendingMCPDisconnectId(null);
      disconnectIntentTimeoutRef.current = null;
    }, 4000);
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

    if (connectIntentTimeoutRef.current !== null) {
      window.clearTimeout(connectIntentTimeoutRef.current);
      connectIntentTimeoutRef.current = null;
    }
    setOpeningMCPType(null);
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
    if (pendingMCPDisconnectId === server.id) {
      clearPendingMCPDisconnect();
    }
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

  const handleSectionChange = (section: SectionId) => {
    if (section === activeSection) {
      return;
    }

    setActiveSection(section);
  };

  const handleConnectIntent = (serverType: MCPServerType) => {
    if (expandedMCPType === serverType) {
      if (connectIntentTimeoutRef.current !== null) {
        window.clearTimeout(connectIntentTimeoutRef.current);
        connectIntentTimeoutRef.current = null;
      }
      setOpeningMCPType(null);
      setExpandedMCPType(null);
      return;
    }

    if (connectIntentTimeoutRef.current !== null) {
      window.clearTimeout(connectIntentTimeoutRef.current);
    }

    setOpeningMCPType(serverType);
    connectIntentTimeoutRef.current = window.setTimeout(() => {
      setExpandedMCPType(serverType);
      setOpeningMCPType(null);
      connectIntentTimeoutRef.current = null;
    }, 220);
  };

  const scrollToResearchTools = () => {
    setActiveSection('research');
    window.setTimeout(() => {
      mcpSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 140);
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
          Keep your account close at hand, connect the AI tools you already use, and
          give Scrimble better sources before every plan begins.
        </p>
      </motion.div>

      <motion.div variants={itemVariants} className="mb-8">
        <div className="-mx-1 overflow-x-auto pb-1">
          <div className="flex min-w-max gap-2 px-1">
            {settingsSections.map((section) => {
              const isActive = activeSection === section.id;

              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => handleSectionChange(section.id)}
                  className={cn(
                    'inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[12px] font-medium transition-colors',
                    isActive
                      ? 'border-accent-border bg-accent-primary-muted text-accent-primary'
                      : 'border-border-default bg-bg-surface text-text-secondary hover:border-border-strong hover:text-text-primary',
                  )}
                >
                  <section.icon className="h-3.5 w-3.5" />
                  {section.label}
                </button>
              );
            })}
          </div>
        </div>
      </motion.div>

      <div
        className={cn(
          'transition-opacity ease-out',
          isSectionSwitching ? 'opacity-0 duration-100' : 'opacity-100 duration-150',
        )}
      >

      {visibleSection === 'overview' ? (
      <motion.section
        variants={itemVariants}
        className="mb-8 grid gap-4 md:grid-cols-3"
      >
        <div className="rounded-[16px] border border-border-default bg-bg-surface p-5 shadow-panel">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-text-secondary">
            <Cpu className="h-4 w-4 text-accent-primary" />
            AI coverage
          </div>
          <div className={cn(
            "text-3xl font-serif tracking-[-0.04em] text-text-primary",
            isLoadingProviders && "skeleton-shimmer rounded-md"
          )}>
            {isLoadingProviders ? '──' : animatedAIProviderCount}
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
          <div className={cn(
            "text-3xl font-serif tracking-[-0.04em] text-text-primary",
            isLoadingMCPServers && "skeleton-shimmer rounded-md"
          )}>
            {isLoadingMCPServers ? '──' : animatedResearchToolCount}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            {activeResearchToolCount > 0
              ? 'Live research is on, so plans can use fresh documentation and comparisons.'
              : 'Optional, but helpful when you want deeper tradeoffs and fresher references.'}
          </p>
        </div>

        <div className="rounded-[16px] border border-border-default bg-bg-surface p-5 shadow-panel">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-text-secondary">
            <ShieldCheck className="h-4 w-4 text-accent-primary" />
            Workspace readiness
          </div>
          <div className={cn(
            "text-lg font-medium tracking-[-0.03em] text-text-primary",
            isLoadingProviders && "skeleton-shimmer rounded-md w-40"
          )}>
            {isLoadingProviders ? '──' : isWorkspaceReady ? 'Ready to build' : 'Needs one quick setup'}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            {isWorkspaceReady
              ? 'You can start a new project now and Scrimble will have what it needs.'
              : 'Once you save an AI key, new projects can run without extra setup.'}
          </p>
        </div>
      </motion.section>
      ) : null}

      {visibleSection === 'account' ? (
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
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(135deg,#E8581A_0%,#c44a14_100%)] text-[13px] font-semibold tracking-[0.02em] text-white">
                  {accountInitial}
                </span>
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
            onClick={() => setIsSignOutDialogOpen(true)}
            className="btn-danger"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </motion.section>
      ) : null}

      {visibleSection === 'profile' ? (
      <motion.div variants={itemVariants} className="mb-8">
        <BuilderProfileSection />
      </motion.div>
      ) : null}

      {visibleSection === 'ai' ? (
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
                className="rounded-[14px] border border-border-default bg-bg-elevated/70 p-4 transition-[border-color,background-color] duration-150 hover:border-white/[0.12] hover:bg-white/[0.02]"
              >
                <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/5 border border-white/10">
                          <Cpu className="h-4 w-4 text-text-secondary" />
                        </div>
                        <h3 className="text-[17px] font-medium tracking-[-0.03em] text-text-primary">
                          {providerLabels[provider.provider]}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${provider.is_default ? 'bg-status-secure' : 'bg-text-muted'}`} />
                        <span className="text-xs text-text-muted">{provider.is_default ? 'Default' : 'Connected'}</span>
                      </div>
                      {provider.is_default ? (
                        <span className="badge-accent">
                          Default
                        </span>
                      ) : null}
                    </div>
                    <p className="mb-3 text-sm text-text-secondary">{getProviderSummary(provider)}</p>

                    <div className="space-y-2">
                      <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-text-tertiary">
                        Saved key
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          value={provider.masked_key || '••••••••••••••••'}
                          className={cn(inputClassName, 'bg-bg-base/60 opacity-85 flex-1')}
                        />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              disabled
                              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-text-muted transition-colors hover:border-white/20 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Copy is disabled for security.</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => requestProviderRemoval(provider)}
                              disabled={removingId === provider.id}
                              className="flex h-10 w-10 items-center justify-center rounded-lg border border-status-error/20 bg-status-error/5 text-status-error transition-colors hover:bg-status-error/10 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {removingId === provider.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Remove key</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => requestProviderRemoval(provider)}
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
            ))
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {providerOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setForm((current) => ({
                      ...current,
                      provider: option.value,
                      apiKey: '',
                      model: '',
                      baseUrl: '',
                    }));
                    document.getElementById('ai-keys-form')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="flex flex-col items-start rounded-xl border border-white/10 bg-white/[0.02] p-5 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.04] text-left"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 border border-white/10">
                      <Cpu className="h-5 w-5 text-text-secondary" />
                    </div>
                    <div>
                      <span className="text-[15px] font-medium text-text-primary">{option.label}</span>
                      <span className="block text-[11px] text-text-muted">
                        {option.value === 'openai' && 'GPT-4o'}
                        {option.value === 'anthropic' && 'Claude 3.5'}
                        {option.value === 'gemini' && '2.0 Flash'}
                        {option.value === 'custom' && 'Custom API'}
                      </span>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-accent-primary">+ Add key</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div id="ai-keys-form" className="mt-6 rounded-[14px] border border-border-default bg-bg-elevated/40 p-5">
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

        <div className="mt-6 card-level-2">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-status-secure" />
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-medium text-text-primary">Your keys are encrypted</p>
                <span className="text-[10px] font-mono text-status-secure bg-status-secure/10 px-1.5 py-0.5 rounded">AES-256-GCM</span>
              </div>
              <p className="text-sm leading-relaxed text-text-secondary">
                Keys are encrypted before storage in Cloudflare D1. Scrimble never keeps them in plain text and only uses them to run work on your projects.
              </p>
            </div>
          </div>
        </div>
      </motion.section>
      ) : null}

      {visibleSection === 'research' && activeResearchToolCount === 0 ? (
        <motion.div
          variants={itemVariants}
          className="mb-8 rounded-[14px] border border-accent-border bg-accent-primary-muted px-4 py-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-relaxed text-text-secondary">
              Connect research tools if you want deeper comparisons and better tradeoffs.
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

      {visibleSection === 'research' ? (
      <motion.section
        ref={mcpSectionRef}
        id="research-tools"
        variants={itemVariants}
        className="rounded-[16px] border border-border-default bg-bg-surface p-6 shadow-panel"
      >
        <div className="mb-6 max-w-[720px]">
          <div className="section-label mb-4">Research tools</div>
          <h2 className="mb-2 text-2xl font-serif tracking-[-0.03em] text-text-primary">
            Give your plan live research context.
          </h2>
          <p className="text-body">
            Connect tools that let Scrimble do deeper research when building your plan. The more
            you connect, the better your plan will be.
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
          {isLoadingMCPServers ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-24 w-full skeleton-shimmer rounded-xl"
                  style={{ animationDelay: `${i * 100}ms` }}
                />
              ))}
            </div>
          ) : (
            mcpCardDefinitions.map((card, index) => {
              const connectedServer = mcpServersByType[card.type];
              const isConnected = Boolean(connectedServer);
              const isExpanded = expandedMCPType === card.type;
              const isSavingCard = savingMCPType === card.type;
              const isOpeningCard = openingMCPType === card.type;

              return (
                <div
                  key={card.type}
                  className={cn(
                    "rounded-[14px] border border-border-default p-4 transition-[border-color,background-color] duration-150 hover:border-white/[0.12] hover:bg-white/[0.02]",
                    isConnected ? "bg-status-secure/[0.03] border-status-secure/20" : "bg-bg-elevated/70"
                  )}
                  style={card.recommended && !isConnected ? { borderLeft: '3px solid rgba(235, 94, 40, 0.5)' } : undefined}
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
                          {card.recommended ? (
                            <span className="badge-warning">
                              Recommended
                            </span>
                          ) : null}
                        </div>

                        <p className="text-sm leading-relaxed text-text-secondary">
                          {card.description}
                        </p>

                        {isConnected && connectedServer ? (
                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <span className="badge-success">
                              Connected
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
                          {pendingMCPDisconnectId === connectedServer.id ? (
                            <>
                              <button
                                type="button"
                                onClick={clearPendingMCPDisconnect}
                                disabled={removingMCPId === connectedServer.id}
                                className="inline-flex h-9 items-center justify-center rounded-[8px] border border-border-default px-3 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleRemoveMCPServer(connectedServer)}
                                disabled={removingMCPId === connectedServer.id}
                                className="inline-flex h-9 items-center justify-center gap-2 rounded-[8px] border border-status-error/35 px-3 text-sm font-semibold text-status-error transition-colors hover:bg-status-error/10 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {removingMCPId === connectedServer.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : null}
                                Are you sure?
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => requestMCPDisconnect(connectedServer)}
                              disabled={removingMCPId === connectedServer.id}
                              className="inline-flex items-center gap-2 text-sm font-medium text-status-error transition-colors hover:text-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Disconnect
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleConnectIntent(card.type)}
                          disabled={isOpeningCard}
                          className={cn(
                            index === 0 
                              ? "btn-primary"
                              : "btn-secondary",
                            isOpeningCard && 'opacity-50',
                          )}
                        >
                          {isOpeningCard ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          {isOpeningCard ? 'Connecting...' : isExpanded ? 'Close' : card.type === 'custom' ? 'Configure' : 'Connect'}
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
                            className="btn-primary flex items-center gap-2 rounded-[8px] disabled:cursor-not-allowed disabled:opacity-50"
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
      ) : null}
      </div>

      <Dialog open={isSignOutDialogOpen} onOpenChange={(open) => !isSigningOut && setIsSignOutDialogOpen(open)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Sign out of Scrimble?</DialogTitle>
            <DialogDescription>
              You&apos;ll need to sign back in to access your projects and plans.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsSignOutDialogOpen(false)}
              disabled={isSigningOut}
              className="btn-secondary px-6"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmSignOut()}
              disabled={isSigningOut}
              className="btn-danger px-6"
            >
              {isSigningOut ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing out...
                </>
              ) : (
                'Sign out'
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={providerToRemove !== null}
        onOpenChange={(open) => {
          if (!open && !removingId) {
            setProviderToRemove(null);
          }
        }}
      >
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Remove AI key?</DialogTitle>
            <DialogDescription>
              This removes {providerToRemove ? providerLabels[providerToRemove.provider] : 'this provider'} from your
              workspace. You can add it again any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setProviderToRemove(null)}
              disabled={Boolean(removingId)}
              className="btn-secondary px-6"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmProviderRemoval()}
              disabled={Boolean(removingId)}
              className="btn-danger px-6"
            >
              {removingId ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Removing...
                </>
              ) : (
                'Remove key'
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.main>
  );
}
