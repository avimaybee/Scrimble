import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { type LanguageModelV1 } from 'ai';
import {
  PROVIDER_VALIDATION_CACHE_FILE,
  SCRIMBLE_DIR,
  aiConfigSchema,
  type AIConfig,
  type AIProfileAuthStrategy,
  type AIProvider,
  type AIProviderProfile,
  type ModelAvailabilityStatus,
  type ProfileAuthStatus,
  type ProfileValidationCacheEntry,
  type ProviderCapabilitySource,
  type ProviderValidationCache,
  type ScrimbleConfig,
} from '@scrimble/shared';
import { getActiveProfile } from './profiles.js';
import {
  getDefaultApiKeyEnvName,
  getDefaultApiKeyPlaceholder as getCatalogDefaultApiKeyPlaceholder,
  getDefaultAuthStrategy,
  getDefaultBaseUrl as getCatalogDefaultBaseUrl,
  getDefaultModel as getCatalogDefaultModel,
  getProviderCatalog,
  providerSupportsAutoModel,
} from './provider-catalog.js';

export interface ProfileHealthCheck {
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export interface ProfileHealth {
  status: ProfileAuthStatus;
  authStrategy: AIProfileAuthStrategy;
  resolvedAuthStrategy: AIProfileAuthStrategy;
  authSource?: string;
  capabilitySource: ProviderCapabilitySource;
  validatedAt: string;
  validationFreshness: 'fresh' | 'stale';
  modelLabel: string;
  modelAvailability: ModelAvailabilityStatus;
  availableModels: string[];
  usableNow: boolean;
  checks: ProfileHealthCheck[];
  issues: string[];
  usabilityIssues: string[];
}

interface AuthResolution {
  status: ProfileAuthStatus;
  strategy: AIProfileAuthStrategy;
  apiKey?: string;
  source?: string;
  reason?: string;
}

interface CapabilityResolution {
  source: ProviderCapabilitySource;
  availableModels: string[];
  validatedAt: string;
  stale: boolean;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const COPILOT_ENV_TOKEN_NAMES = ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'] as const;
const PROVIDER_VALIDATION_CACHE_VERSION = 1 as const;
const PROVIDER_VALIDATION_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const COPILOT_MODEL_FETCH_TIMEOUT_MS = 2_000;

function envValueFromTemplate(value?: string): { value?: string; source?: string } {
  if (!value) {
    return {};
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }
  const match = trimmed.match(/^\$\{([A-Z0-9_]+)\}$/);
  if (!match) {
    return { value: trimmed, source: 'profile' };
  }
  const envName = match[1];
  if (!envName) {
    return {};
  }
  const envValue = process.env[envName]?.trim();
  if (!envValue) {
    return { source: `env:${envName}` };
  }
  return { value: envValue, source: `env:${envName}` };
}

function resolveWindowsCopilotShim(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32' || command !== 'copilot') {
    return { command, args };
  }
  const appData = process.env['APPDATA'];
  if (!appData) {
    return { command, args };
  }
  const loader = path.join(appData, 'npm', 'node_modules', '@github', 'copilot', 'npm-loader.js');
  if (!fs.existsSync(loader)) {
    return { command, args };
  }
  return {
    command: process.execPath,
    args: [loader, ...args],
  };
}

function execCapture(command: string, args: string[], cwd = process.cwd(), timeout = 2000): CommandResult {
  const resolved = resolveWindowsCopilotShim(command, args);
  const result = spawnSync(resolved.command, resolved.args, {
    cwd,
    timeout,
    windowsHide: true,
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? (result.error ? 1 : 0),
  };
}

function parseTokenOutput(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim();
  if (!firstLine || firstLine.length < 10) {
    return undefined;
  }
  if (firstLine.toLowerCase().includes('login') || firstLine.toLowerCase().includes('auth')) {
    return undefined;
  }
  return firstLine;
}

function providerValidationCachePath(cwd: string): string {
  return path.join(cwd, SCRIMBLE_DIR, PROVIDER_VALIDATION_CACHE_FILE);
}

function emptyProviderValidationCache(): ProviderValidationCache {
  return {
    version: PROVIDER_VALIDATION_CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    profiles: {},
  };
}

function readProviderValidationCache(cwd: string): ProviderValidationCache {
  const cachePath = providerValidationCachePath(cwd);
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as ProviderValidationCache;
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.version === PROVIDER_VALIDATION_CACHE_VERSION &&
      parsed.profiles &&
      typeof parsed.profiles === 'object'
    ) {
      return parsed;
    }
  } catch {
    // no-op
  }
  return emptyProviderValidationCache();
}

function writeProviderValidationCache(cwd: string, cache: ProviderValidationCache): void {
  const cachePath = providerValidationCachePath(cwd);
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  } catch {
    // cache writes are best-effort
  }
}

function getCachedProfileValidation(
  cwd: string,
  profileId: string,
): ProfileValidationCacheEntry | undefined {
  const cache = readProviderValidationCache(cwd);
  return cache.profiles[profileId];
}

function persistProfileValidation(cwd: string, entry: ProfileValidationCacheEntry): void {
  const cache = readProviderValidationCache(cwd);
  cache.profiles[entry.profileId] = entry;
  cache.updatedAt = new Date().toISOString();
  writeProviderValidationCache(cwd, cache);
}

function isStaleTimestamp(timestamp: string, maxAgeMs: number): boolean {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return true;
  }
  return Date.now() - parsed > maxAgeMs;
}

function fallbackModels(provider: AIProvider): string[] {
  return [...new Set(getProviderCatalog(provider).recommendedModels)];
}

function parseModelList(payload: unknown): string[] {
  const fromArray = (input: unknown[]): string[] => input
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry.trim();
      }
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        for (const key of ['id', 'model', 'name']) {
          const value = record[key];
          if (typeof value === 'string' && value.trim()) {
            return value.trim();
          }
        }
      }
      return '';
    })
    .filter((entry) => entry.length > 0);

  if (Array.isArray(payload)) {
    return [...new Set(fromArray(payload))];
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['data', 'models', 'items']) {
      const value = record[key];
      if (Array.isArray(value)) {
        return [...new Set(fromArray(value))];
      }
    }
  }
  return [];
}

async function fetchCopilotModelsLive(authToken: string): Promise<string[] | undefined> {
  const endpoints = [
    'https://api.githubcopilot.com/models',
    'https://api.githubcopilot.com/v1/models',
  ];

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, COPILOT_MODEL_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${authToken}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        continue;
      }
      const payload = await response.json();
      const models = parseModelList(payload);
      if (models.length > 0) {
        return models;
      }
    } catch {
      // try next endpoint
    } finally {
      clearTimeout(timer);
    }
  }
  return undefined;
}

function resolveCopilotCredential(profile: AIProviderProfile): AuthResolution {
  if (profile.auth.strategy === 'personal_access_token') {
    const explicit = envValueFromTemplate(profile.auth.token);
    if (explicit.value) {
      return {
        status: 'ready',
        strategy: 'personal_access_token',
        apiKey: explicit.value,
        source: explicit.source ?? 'explicit_token',
      };
    }
  }

  for (const envName of COPILOT_ENV_TOKEN_NAMES) {
    const value = process.env[envName]?.trim();
    if (value) {
      return {
        status: 'ready',
        strategy: 'env_token',
        apiKey: value,
        source: `env:${envName}`,
      };
    }
  }

  const copilotTokenCommands: Array<string[]> = [
    ['auth', 'token'],
    ['token'],
  ];
  for (const args of copilotTokenCommands) {
    const result = execCapture('copilot', args);
    if (result.exitCode === 0) {
      const token = parseTokenOutput(result.stdout);
      if (token) {
        return {
          status: 'ready',
          strategy: 'copilot_login',
          apiKey: token,
          source: 'copilot_login',
        };
      }
    }
  }

  const ghAuthToken = execCapture('gh', ['auth', 'token']);
  if (ghAuthToken.exitCode === 0) {
    const token = parseTokenOutput(ghAuthToken.stdout);
    if (token) {
      return {
        status: 'ready',
        strategy: 'gh_cli',
        apiKey: token,
        source: 'gh_cli',
      };
    }
  }

  return {
    status: 'missing',
    strategy: profile.auth.strategy,
    reason:
      profile.auth.strategy === 'copilot_login'
        ? 'Run `copilot login` or configure env token fallback.'
        : profile.auth.strategy === 'env_token'
          ? 'Set COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN.'
          : profile.auth.strategy === 'gh_cli'
            ? 'Authenticate GitHub CLI (`gh auth login`) or provide higher-priority Copilot credentials.'
            : 'Provide an explicit token or configure Copilot credentials.',
  };
}

function resolveByokCredential(profile: AIProviderProfile): AuthResolution {
  if (profile.auth.strategy !== 'api_key') {
    return {
      status: 'invalid',
      strategy: profile.auth.strategy,
      reason: `${profile.provider} profiles must use api_key auth strategy.`,
    };
  }

  const configured = envValueFromTemplate(profile.auth.apiKey);
  if (configured.value) {
    return {
      status: 'ready',
      strategy: 'api_key',
      apiKey: configured.value,
      source: configured.source ?? 'profile',
    };
  }

  const envName = getDefaultApiKeyEnvName(profile.provider);
  const fallback = process.env[envName]?.trim();
  if (fallback) {
    return {
      status: 'ready',
      strategy: 'api_key',
      apiKey: fallback,
      source: `env:${envName}`,
    };
  }

  return {
    status: 'missing',
    strategy: 'api_key',
    reason: `Missing API key for ${profile.provider}. Set ${envName} or update profile auth.`,
  };
}

function resolveProfileAuth(profile: AIProviderProfile): AuthResolution {
  if (profile.provider === 'github-copilot') {
    return resolveCopilotCredential(profile);
  }
  return resolveByokCredential(profile);
}

function resolveModel(profile: AIProviderProfile): string {
  if (profile.modelStrategy === 'explicit') {
    return profile.model?.trim() || getCatalogDefaultModel(profile.provider);
  }
  if (providerSupportsAutoModel(profile.provider)) {
    return 'auto';
  }
  return getCatalogDefaultModel(profile.provider);
}

function resolveBaseUrl(provider: AIProvider, baseUrl?: string): string | undefined {
  const trimmed = baseUrl?.trim();
  if (trimmed) {
    return trimmed;
  }
  return getCatalogDefaultBaseUrl(provider);
}

function resolveCapabilityFromCacheOrFallback(
  profile: AIProviderProfile,
  cwd: string,
): CapabilityResolution {
  const cached = getCachedProfileValidation(cwd, profile.id);
  if (cached?.capability?.availableModels && cached.capability.availableModels.length > 0) {
    return {
      source: 'cached',
      availableModels: cached.capability.availableModels,
      validatedAt: cached.capability.validatedAt,
      stale: isStaleTimestamp(cached.capability.validatedAt, PROVIDER_VALIDATION_CACHE_MAX_AGE_MS),
    };
  }

  return {
    source: 'fallback',
    availableModels: fallbackModels(profile.provider),
    validatedAt: new Date().toISOString(),
    stale: false,
  };
}

async function resolveCapabilityWithLiveFallback(
  profile: AIProviderProfile,
  auth: AuthResolution,
  cwd: string,
): Promise<CapabilityResolution> {
  if (profile.provider === 'github-copilot' && auth.status === 'ready' && auth.apiKey) {
    const liveModels = await fetchCopilotModelsLive(auth.apiKey);
    if (liveModels && liveModels.length > 0) {
      return {
        source: 'live',
        availableModels: liveModels,
        validatedAt: new Date().toISOString(),
        stale: false,
      };
    }
  }

  const cachedOrFallback = resolveCapabilityFromCacheOrFallback(profile, cwd);
  if (cachedOrFallback.source === 'cached' && cachedOrFallback.stale) {
    return {
      source: 'fallback',
      availableModels: cachedOrFallback.availableModels.length > 0
        ? cachedOrFallback.availableModels
        : fallbackModels(profile.provider),
      validatedAt: new Date().toISOString(),
      stale: false,
    };
  }
  return cachedOrFallback;
}

function isPlausibleByokModel(provider: AIProvider, model: string): boolean {
  const normalized = model.toLowerCase();
  switch (provider) {
    case 'openai':
    case 'azure':
      return /gpt|o1|o3|o4|text-embedding|omni/.test(normalized);
    case 'anthropic':
      return /claude/.test(normalized);
    case 'google':
      return /gemini|models\//.test(normalized);
    case 'openrouter':
    case 'together':
      return normalized.includes('/');
    case 'groq':
      return /llama|mixtral|qwen|gemma|deepseek|whisper/.test(normalized);
    case 'github-copilot':
      return true;
    default:
      return true;
  }
}

function resolveModelAvailability(
  profile: AIProviderProfile,
  capability: CapabilityResolution,
): { status: ModelAvailabilityStatus; reason?: string } {
  if (profile.modelStrategy === 'auto') {
    return { status: 'available' };
  }

  const selectedModel = resolveModel(profile);
  const available = capability.availableModels.map((entry) => entry.toLowerCase());
  if (available.includes(selectedModel.toLowerCase())) {
    return { status: 'available' };
  }

  if (profile.provider === 'github-copilot') {
    if (capability.source === 'live' || capability.source === 'cached') {
      return {
        status: 'unavailable',
        reason: `Model "${selectedModel}" is not in currently available Copilot models.`,
      };
    }
    return {
      status: 'unverified',
      reason: `Model "${selectedModel}" could not be verified live; use auto for safest routing.`,
    };
  }

  if (isPlausibleByokModel(profile.provider, selectedModel)) {
    return {
      status: 'unverified',
      reason: `Model "${selectedModel}" is not in curated defaults, but appears plausible for ${profile.provider}.`,
    };
  }
  return {
    status: 'unverified',
    reason: `Model "${selectedModel}" could not be verified for ${profile.provider}; verify provider support manually.`,
  };
}

function buildProfileHealth(
  profile: AIProviderProfile,
  auth: AuthResolution,
  capability: CapabilityResolution,
): ProfileHealth {
  const checks: ProfileHealthCheck[] = [];
  const issues: string[] = [];
  const usabilityIssues: string[] = [];
  const modelLabel = describeProfileModel(profile);
  const modelAvailability = resolveModelAvailability(profile, capability);

  if (profile.modelStrategy === 'explicit' && !profile.model?.trim()) {
    issues.push('Explicit model strategy requires a model.');
  } else {
    checks.push({ status: 'pass', message: `Model strategy: ${profile.modelStrategy} (${modelLabel})` });
  }

  const providerCatalog = getProviderCatalog(profile.provider);
  if (providerCatalog.requiresBaseUrl && !resolveBaseUrl(profile.provider, profile.baseUrl)) {
    issues.push('Provider requires base URL, but none is configured.');
  } else if (resolveBaseUrl(profile.provider, profile.baseUrl)) {
    checks.push({
      status: 'pass',
      message: `Base URL: ${resolveBaseUrl(profile.provider, profile.baseUrl)}`,
    });
  }

  if (profile.provider === 'github-copilot') {
    checks.push({
      status: 'warn',
      message: providerCatalog.planDependentModels
        ? 'Copilot model availability is plan/client dependent.'
        : 'Copilot profile detected.',
    });
  }

  if (auth.status === 'ready') {
    checks.push({
      status: 'pass',
      message: `Auth source: ${auth.source ?? 'configured'}`,
    });
  } else if (auth.status === 'missing') {
    usabilityIssues.push(auth.reason ?? 'Authentication is missing.');
    checks.push({
      status: 'warn',
      message: auth.reason ?? 'Authentication is missing.',
    });
  } else {
    issues.push(auth.reason ?? 'Authentication strategy is invalid.');
  }

  if (modelAvailability.status === 'available') {
    checks.push({
      status: 'pass',
      message: `Model availability: available (${modelLabel})`,
    });
  } else if (modelAvailability.status === 'unverified') {
    checks.push({
      status: 'warn',
      message: modelAvailability.reason ?? 'Model availability is unverified.',
    });
  } else {
    usabilityIssues.push(modelAvailability.reason ?? 'Selected model is unavailable for this profile.');
    checks.push({
      status: 'fail',
      message: modelAvailability.reason ?? 'Selected model is unavailable for this profile.',
    });
  }

  if (capability.source === 'live') {
    checks.push({
      status: 'pass',
      message: `Capabilities: live (${capability.availableModels.length} model(s))`,
    });
  } else if (capability.source === 'cached') {
    checks.push({
      status: capability.stale ? 'warn' : 'pass',
      message: capability.stale
        ? `Capabilities: cached and stale (validated ${capability.validatedAt}).`
        : `Capabilities: cached (validated ${capability.validatedAt}).`,
    });
  } else {
    checks.push({
      status: 'warn',
      message: 'Capabilities: fallback catalog (live lookup unavailable).',
    });
  }

  const usableNow = issues.length === 0 && usabilityIssues.length === 0;
  const health: ProfileHealth = {
    status: auth.status,
    authStrategy: profile.auth.strategy,
    resolvedAuthStrategy: auth.strategy,
    ...(auth.source ? { authSource: auth.source } : {}),
    capabilitySource: capability.source,
    validatedAt: capability.validatedAt,
    validationFreshness: capability.stale ? 'stale' : 'fresh',
    modelLabel,
    modelAvailability: modelAvailability.status,
    availableModels: capability.availableModels,
    usableNow,
    checks: [
      ...checks,
      ...issues.map((issue) => ({ status: 'fail' as const, message: issue })),
    ],
    issues,
    usabilityIssues,
  };
  return health;
}

function toCacheEntry(
  profile: AIProviderProfile,
  health: ProfileHealth,
): ProfileValidationCacheEntry {
  return {
    profileId: profile.id,
    provider: profile.provider,
    authStrategy: health.authStrategy,
    authStatus: health.status,
    ...(health.authSource ? { authSource: health.authSource } : {}),
    modelStrategy: profile.modelStrategy,
    ...(profile.model ? { model: profile.model } : {}),
    modelAvailability: health.modelAvailability,
    capability: {
      source: health.capabilitySource,
      availableModels: health.availableModels,
      validatedAt: health.validatedAt,
      ...(health.validationFreshness === 'stale' ? { stale: true } : {}),
    },
    issues: health.issues,
    usabilityIssues: health.usabilityIssues,
    validatedAt: health.validatedAt,
  };
}

export function getDefaultModel(provider: AIProvider): string {
  return getCatalogDefaultModel(provider);
}

export function getDefaultApiKeyPlaceholder(provider: AIProvider): string {
  return getCatalogDefaultApiKeyPlaceholder(provider);
}

export function getDefaultBaseUrl(provider: AIProvider): string | undefined {
  return getCatalogDefaultBaseUrl(provider);
}

export function buildDefaultAIConfig(provider: AIProvider, modelOverride?: string): AIConfig {
  const baseUrl = getDefaultBaseUrl(provider);
  return {
    provider,
    model: modelOverride ?? getDefaultModel(provider),
    apiKey: getDefaultApiKeyPlaceholder(provider),
    ...(baseUrl ? { baseUrl } : {}),
  };
}

function withOptionalBaseUrl<T extends { apiKey: string; baseURL?: string }>(
  apiKey: string,
  baseURL?: string,
): T {
  return (baseURL ? { apiKey, baseURL } : { apiKey }) as T;
}

export function createLanguageModel(config: AIConfig): LanguageModelV1 {
  const validatedConfig = aiConfigSchema.parse(config);
  const apiKey = envValueFromTemplate(validatedConfig.apiKey).value;
  let resolvedApiKey: string | undefined;
  if (!apiKey) {
    const envName = getDefaultApiKeyEnvName(validatedConfig.provider);
    const fallback = process.env[envName]?.trim();
    if (!fallback) {
      throw new Error(`Missing API key for provider "${validatedConfig.provider}". Set ${envName} or configure profile auth.`);
    }
    resolvedApiKey = fallback;
  } else {
    resolvedApiKey = apiKey;
  }
  if (!resolvedApiKey) {
    throw new Error(`Unable to resolve API key for provider "${validatedConfig.provider}".`);
  }

  const baseURL = resolveBaseUrl(validatedConfig.provider, validatedConfig.baseUrl);

  switch (validatedConfig.provider) {
    case 'openai':
    case 'openrouter':
    case 'github-copilot':
    case 'groq':
    case 'together': {
      return createOpenAI(withOptionalBaseUrl(resolvedApiKey, baseURL))(validatedConfig.model);
    }
    case 'azure': {
      if (!baseURL) {
        throw new Error('Azure provider requires ai.baseUrl (Azure OpenAI endpoint).');
      }
      return createOpenAI({ apiKey: resolvedApiKey, baseURL })(validatedConfig.model);
    }
    case 'anthropic': {
      return createAnthropic(withOptionalBaseUrl(resolvedApiKey, baseURL))(validatedConfig.model);
    }
    case 'google': {
      return createGoogleGenerativeAI(withOptionalBaseUrl(resolvedApiKey, baseURL))(validatedConfig.model);
    }
    default: {
      const exhaustiveProvider: never = validatedConfig.provider;
      throw new Error(`Unsupported provider: ${exhaustiveProvider}`);
    }
  }
}

export function createLanguageModelFromProfile(profile: AIProviderProfile): LanguageModelV1 {
  const health = evaluateProfileHealth(profile);
  if (!health.usableNow) {
    throw new Error(health.usabilityIssues[0] ?? health.issues[0] ?? 'Profile is not currently usable.');
  }
  const auth = resolveProfileAuth(profile);
  if (auth.status !== 'ready' || !auth.apiKey) {
    throw new Error(auth.reason ?? 'Profile authentication is not configured.');
  }
  const model = resolveModel(profile);
  const baseUrl = resolveBaseUrl(profile.provider, profile.baseUrl);
  return createLanguageModel({
    provider: profile.provider,
    model,
    apiKey: auth.apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(profile.options ? { options: profile.options } : {}),
  });
}

export function createLanguageModelFromScrimbleConfig(config: ScrimbleConfig): LanguageModelV1 {
  const profile = getActiveProfile(config);
  if (!profile) {
    throw new Error('No active AI profile configured.');
  }
  return createLanguageModelFromProfile(profile);
}

export function describeProfileModel(profile: AIProviderProfile): string {
  return profile.modelStrategy === 'auto'
    ? 'auto'
    : profile.model?.trim() || getCatalogDefaultModel(profile.provider);
}

export function evaluateProfileHealth(
  profile: AIProviderProfile,
  options: { cwd?: string } = {},
): ProfileHealth {
  const cwd = options.cwd ?? process.cwd();
  const auth = resolveProfileAuth(profile);
  const capability = resolveCapabilityFromCacheOrFallback(profile, cwd);
  const health = buildProfileHealth(profile, auth, capability);
  persistProfileValidation(cwd, toCacheEntry(profile, health));
  return health;
}

export async function refreshProfileHealth(
  profile: AIProviderProfile,
  options: { cwd?: string } = {},
): Promise<ProfileHealth> {
  const cwd = options.cwd ?? process.cwd();
  const auth = resolveProfileAuth(profile);
  const capability = await resolveCapabilityWithLiveFallback(profile, auth, cwd);
  const health = buildProfileHealth(profile, auth, capability);
  persistProfileValidation(cwd, toCacheEntry(profile, health));
  return health;
}

export function hasValidActiveProfile(
  config: ScrimbleConfig,
  options: { cwd?: string } = {},
): boolean {
  const profile = getActiveProfile(config);
  if (!profile) {
    return false;
  }
  const health = evaluateProfileHealth(profile, options);
  return health.usableNow;
}

export function buildDefaultProfileFromProvider(provider: AIProvider, interactive: boolean): AIProviderProfile {
  const modelStrategy = providerSupportsAutoModel(provider) ? 'auto' : 'explicit';
  const authStrategy = getDefaultAuthStrategy(provider, interactive);
  return {
    id: `${provider}-default`,
    name: `${getProviderCatalog(provider).label} profile`,
    provider,
    modelStrategy,
    ...(modelStrategy === 'explicit' ? { model: getCatalogDefaultModel(provider) } : {}),
    ...(getCatalogDefaultBaseUrl(provider) ? { baseUrl: getCatalogDefaultBaseUrl(provider) } : {}),
    auth: provider === 'github-copilot'
      ? authStrategy === 'personal_access_token'
        ? { strategy: 'personal_access_token' }
        : { strategy: authStrategy }
      : { strategy: 'api_key', apiKey: getCatalogDefaultApiKeyPlaceholder(provider) },
  };
}
