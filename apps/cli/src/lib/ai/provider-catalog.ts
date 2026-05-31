import type { AIProfileAuthStrategy, AIProvider } from '@scrimble/shared';

export interface ProviderCatalogEntry {
  provider: AIProvider;
  label: string;
  description: string;
  recommendedModels: string[];
  supportsAuto: boolean;
  authStrategies: AIProfileAuthStrategy[];
  docsHint: string;
  planDependentModels?: boolean;
  defaultBaseUrl?: string;
  requiresBaseUrl?: boolean;
}

const PROVIDER_CATALOG: Record<AIProvider, ProviderCatalogEntry> = {
  openai: {
    provider: 'openai',
    label: 'OpenAI',
    description: 'Bring-your-own API key for OpenAI models.',
    recommendedModels: ['gpt-4o', 'gpt-4.1'],
    supportsAuto: false,
    authStrategies: ['api_key'],
    docsHint: 'Use OPENAI_API_KEY or a stored API key.',
  },
  anthropic: {
    provider: 'anthropic',
    label: 'Anthropic',
    description: 'Bring-your-own API key for Claude models.',
    recommendedModels: ['claude-3-5-sonnet-latest'],
    supportsAuto: false,
    authStrategies: ['api_key'],
    docsHint: 'Use ANTHROPIC_API_KEY or a stored API key.',
  },
  google: {
    provider: 'google',
    label: 'Google',
    description: 'Bring-your-own API key for Gemini models.',
    recommendedModels: ['gemini-2.5-pro'],
    supportsAuto: false,
    authStrategies: ['api_key'],
    docsHint: 'Use GOOGLE_GENERATIVE_AI_API_KEY or a stored API key.',
  },
  openrouter: {
    provider: 'openrouter',
    label: 'OpenRouter',
    description: 'OpenAI-compatible gateway with BYOK auth.',
    recommendedModels: ['openai/gpt-4o'],
    supportsAuto: false,
    authStrategies: ['api_key'],
    docsHint: 'Use OPENROUTER_API_KEY. Base URL is prefilled.',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
  },
  'github-copilot': {
    provider: 'github-copilot',
    label: 'GitHub Copilot',
    description: 'Subscription-backed auth with official Copilot credential precedence.',
    recommendedModels: ['gpt-4.1', 'gpt-4o', 'claude-3.7-sonnet', 'gemini-2.5-pro'],
    supportsAuto: true,
    authStrategies: ['copilot_login', 'env_token', 'gh_cli', 'personal_access_token'],
    docsHint: 'Model availability is plan/client dependent and can change.',
    planDependentModels: true,
    defaultBaseUrl: 'https://api.githubcopilot.com',
  },
  azure: {
    provider: 'azure',
    label: 'Azure OpenAI',
    description: 'OpenAI-compatible Azure endpoint with BYOK auth.',
    recommendedModels: ['gpt-4o'],
    supportsAuto: false,
    authStrategies: ['api_key'],
    docsHint: 'Set AZURE_OPENAI_API_KEY and provide an Azure base URL.',
    requiresBaseUrl: true,
  },
  groq: {
    provider: 'groq',
    label: 'Groq',
    description: 'OpenAI-compatible low-latency inference with BYOK auth.',
    recommendedModels: ['llama-3.3-70b-versatile'],
    supportsAuto: false,
    authStrategies: ['api_key'],
    docsHint: 'Use GROQ_API_KEY. Base URL is prefilled.',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
  },
  together: {
    provider: 'together',
    label: 'Together AI',
    description: 'OpenAI-compatible model hosting with BYOK auth.',
    recommendedModels: ['meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo'],
    supportsAuto: false,
    authStrategies: ['api_key'],
    docsHint: 'Use TOGETHER_API_KEY. Base URL is prefilled.',
    defaultBaseUrl: 'https://api.together.xyz/v1',
  },
};

const DEFAULT_API_KEY_ENV_BY_PROVIDER: Record<AIProvider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  'github-copilot': 'COPILOT_GITHUB_TOKEN',
  azure: 'AZURE_OPENAI_API_KEY',
  groq: 'GROQ_API_KEY',
  together: 'TOGETHER_API_KEY',
};

export function listProviderCatalog(): ProviderCatalogEntry[] {
  return Object.values(PROVIDER_CATALOG);
}

export function getProviderCatalog(provider: AIProvider): ProviderCatalogEntry {
  return PROVIDER_CATALOG[provider];
}

export function getDefaultModel(provider: AIProvider): string {
  const entry = getProviderCatalog(provider);
  return entry.recommendedModels[0] ?? 'gpt-4o';
}

export function getDefaultBaseUrl(provider: AIProvider): string | undefined {
  return getProviderCatalog(provider).defaultBaseUrl;
}

export function getDefaultApiKeyEnvName(provider: AIProvider): string {
  return DEFAULT_API_KEY_ENV_BY_PROVIDER[provider];
}

export function getDefaultApiKeyPlaceholder(provider: AIProvider): string {
  return `\${${getDefaultApiKeyEnvName(provider)}}`;
}

export function providerSupportsAutoModel(provider: AIProvider): boolean {
  return getProviderCatalog(provider).supportsAuto;
}

export function getDefaultAuthStrategy(provider: AIProvider, interactive: boolean): AIProfileAuthStrategy {
  if (provider === 'github-copilot') {
    return interactive ? 'copilot_login' : 'env_token';
  }
  return 'api_key';
}
