import { randomUUID } from 'node:crypto';
import {
  legacyScrimbleConfigSchema,
  scrimbleConfigSchema,
  type AIModelStrategy,
  type AIProfileAuthStrategy,
  type AIProvider,
  type AIProviderProfile,
  type InteractionMode,
  type ScrimbleConfig,
} from '@scrimble/shared';
import {
  getDefaultApiKeyPlaceholder,
  getDefaultAuthStrategy,
  getDefaultBaseUrl,
  getDefaultModel,
  getProviderCatalog,
  providerSupportsAutoModel,
} from './provider-catalog.js';

type LegacyScrimbleConfig = ReturnType<typeof legacyScrimbleConfigSchema.parse>;

function normalizeProfileName(provider: AIProvider, name?: string): string {
  const trimmed = name?.trim();
  if (trimmed) {
    return trimmed;
  }
  return `${getProviderCatalog(provider).label} profile`;
}

function createProfileId(provider: AIProvider): string {
  return `${provider}-${randomUUID().slice(0, 8)}`;
}

function normalizeModelStrategy(provider: AIProvider, modelStrategy?: AIModelStrategy): AIModelStrategy {
  if (modelStrategy === 'auto' || modelStrategy === 'explicit') {
    if (modelStrategy === 'auto' && !providerSupportsAutoModel(provider)) {
      return 'explicit';
    }
    return modelStrategy;
  }
  return providerSupportsAutoModel(provider) ? 'auto' : 'explicit';
}

function normalizeAuthStrategy(
  provider: AIProvider,
  authStrategy: AIProfileAuthStrategy | undefined,
  interactive: boolean,
): AIProfileAuthStrategy {
  const fallback = getDefaultAuthStrategy(provider, interactive);
  if (!authStrategy) {
    return fallback;
  }
  if (provider === 'github-copilot') {
    if (['copilot_login', 'env_token', 'gh_cli', 'personal_access_token'].includes(authStrategy)) {
      return authStrategy;
    }
    return fallback;
  }
  return authStrategy === 'api_key' ? authStrategy : 'api_key';
}

export interface BuildProfileInput {
  id?: string | undefined;
  name?: string | undefined;
  provider: AIProvider;
  modelStrategy?: AIModelStrategy | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  authStrategy?: AIProfileAuthStrategy | undefined;
  apiKey?: string | undefined;
  token?: string | undefined;
  options?: AIProviderProfile['options'] | undefined;
  interactive?: boolean | undefined;
}

export function buildProviderProfile(input: BuildProfileInput): AIProviderProfile {
  const interactive = input.interactive ?? true;
  const modelStrategy = normalizeModelStrategy(input.provider, input.modelStrategy);
  const authStrategy = normalizeAuthStrategy(input.provider, input.authStrategy, interactive);
  const defaultModel = getDefaultModel(input.provider);
  const selectedModel = modelStrategy === 'explicit'
    ? (input.model?.trim() || defaultModel)
    : undefined;

  const auth: AIProviderProfile['auth'] = input.provider === 'github-copilot'
    ? authStrategy === 'personal_access_token'
      ? {
          strategy: 'personal_access_token',
          ...(input.token?.trim() ? { token: input.token.trim() } : {}),
        }
      : { strategy: authStrategy }
    : {
        strategy: 'api_key',
        apiKey: input.apiKey?.trim() || getDefaultApiKeyPlaceholder(input.provider),
      };

  const defaultBaseUrl = getDefaultBaseUrl(input.provider);
  return {
    id: input.id?.trim() || createProfileId(input.provider),
    name: normalizeProfileName(input.provider, input.name),
    provider: input.provider,
    modelStrategy,
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(input.baseUrl?.trim() ? { baseUrl: input.baseUrl.trim() } : defaultBaseUrl ? { baseUrl: defaultBaseUrl } : {}),
    auth,
    ...(input.options ? { options: input.options } : {}),
  };
}

export function buildDefaultScrimbleConfig(
  interactionMode: InteractionMode = 'guide',
  provider: AIProvider = 'openai',
): ScrimbleConfig {
  const profile = buildProviderProfile({
    provider,
    interactive: false,
  });
  return scrimbleConfigSchema.parse({
    schemaVersion: 2,
    activeProfileId: profile.id,
    profiles: [profile],
    interactionMode,
    plannerWorker: 'auto',
    workerPreferences: {
      defaultWorker: 'auto',
      allowParallel: false,
      maxParallelWorkers: 1,
    },
    executionDefaults: {
      worker: 'auto',
      timeoutSeconds: 300,
      maxParallelTasks: 1,
      maxRetriesPerTask: 1,
    },
    verificationDefaults: {
      enabled: true,
    },
  });
}

function migrateLegacyCopilotAuth(apiKey?: string): AIProviderProfile['auth'] {
  const trimmed = apiKey?.trim();
  if (!trimmed) {
    return { strategy: 'copilot_login' };
  }
  const envRefMatch = trimmed.match(/^\$\{([A-Z0-9_]+)\}$/);
  if (envRefMatch) {
    const envName = envRefMatch[1];
    if (envName === 'COPILOT_GITHUB_TOKEN' || envName === 'GH_TOKEN' || envName === 'GITHUB_TOKEN' || envName === 'GITHUB_COPILOT_TOKEN') {
      return { strategy: 'env_token' };
    }
  }
  return {
    strategy: 'personal_access_token',
    token: trimmed,
  };
}

export function migrateLegacyScrimbleConfig(legacy: LegacyScrimbleConfig): ScrimbleConfig {
  const provider = legacy.ai.provider;
  const profile = buildProviderProfile({
    provider,
    modelStrategy: 'explicit',
    model: legacy.ai.model,
    baseUrl: legacy.ai.baseUrl,
    options: legacy.ai.options,
    interactive: false,
    ...(provider === 'github-copilot'
      ? {
          authStrategy: migrateLegacyCopilotAuth(legacy.ai.apiKey).strategy,
          token: migrateLegacyCopilotAuth(legacy.ai.apiKey).strategy === 'personal_access_token'
            ? legacy.ai.apiKey
            : undefined,
        }
      : {
          authStrategy: 'api_key',
          apiKey: legacy.ai.apiKey,
        }),
  });

  if (provider === 'github-copilot') {
    profile.auth = migrateLegacyCopilotAuth(legacy.ai.apiKey);
  }

  return normalizeScrimbleConfig({
    schemaVersion: 2,
    activeProfileId: profile.id,
    profiles: [profile],
    interactionMode: legacy.interactionMode,
    ...(legacy.plannerWorker ? { plannerWorker: legacy.plannerWorker } : {}),
    ...(legacy.workerPreferences ? { workerPreferences: legacy.workerPreferences } : {}),
    ...(legacy.executionDefaults ? { executionDefaults: legacy.executionDefaults } : {}),
    ...(legacy.verificationDefaults ? { verificationDefaults: legacy.verificationDefaults } : {}),
  });
}

function normalizeProfile(profile: AIProviderProfile, interactive: boolean, fallbackIndex: number): AIProviderProfile {
  const normalized = buildProviderProfile({
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    modelStrategy: profile.modelStrategy,
    model: profile.model,
    baseUrl: profile.baseUrl,
    authStrategy: profile.auth.strategy,
    apiKey: profile.auth.strategy === 'api_key' ? profile.auth.apiKey : undefined,
    token: profile.auth.strategy === 'personal_access_token' ? profile.auth.token : undefined,
    options: profile.options,
    interactive,
  });
  if (!normalized.id.trim()) {
    return { ...normalized, id: `${profile.provider}-${fallbackIndex + 1}` };
  }
  return normalized;
}

export function normalizeScrimbleConfig(config: ScrimbleConfig): ScrimbleConfig {
  const profiles = (config.profiles ?? []).map((profile, index) => normalizeProfile(profile, false, index));
  const deduped: AIProviderProfile[] = [];
  const seen = new Set<string>();
  for (const profile of profiles) {
    const id = profile.id.trim() || createProfileId(profile.provider);
    const uniqueId = seen.has(id) ? createProfileId(profile.provider) : id;
    seen.add(uniqueId);
    deduped.push({ ...profile, id: uniqueId });
  }

  if (deduped.length === 0) {
    deduped.push(buildProviderProfile({ provider: 'openai', interactive: false }));
  }

  const activeProfileId = deduped.some((profile) => profile.id === config.activeProfileId)
    ? config.activeProfileId
    : deduped[0]?.id;

  return scrimbleConfigSchema.parse({
    ...config,
    schemaVersion: Math.max(2, config.schemaVersion || 2),
    activeProfileId,
    profiles: deduped,
  });
}

export function getActiveProfile(config: ScrimbleConfig): AIProviderProfile | undefined {
  if (config.profiles.length === 0) {
    return undefined;
  }
  if (config.activeProfileId) {
    return config.profiles.find((profile) => profile.id === config.activeProfileId);
  }
  return config.profiles[0];
}

export function upsertProfile(
  config: ScrimbleConfig,
  profile: AIProviderProfile,
  activate: boolean = true,
): ScrimbleConfig {
  const normalized = normalizeScrimbleConfig(config);
  const existingIndex = normalized.profiles.findIndex((entry) => entry.id === profile.id);
  const nextProfiles = [...normalized.profiles];
  if (existingIndex >= 0) {
    nextProfiles.splice(existingIndex, 1, profile);
  } else {
    nextProfiles.push(profile);
  }
  return normalizeScrimbleConfig({
    ...normalized,
    profiles: nextProfiles,
    activeProfileId: activate ? profile.id : normalized.activeProfileId,
  });
}

export function describeProfileModel(profile: AIProviderProfile): string {
  if (profile.modelStrategy === 'auto') {
    return 'auto';
  }
  return profile.model ?? getDefaultModel(profile.provider);
}
