import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { type LanguageModelV1 } from 'ai';
import { aiConfigSchema, type AIConfig, type AIProvider } from '@scrimble/shared';

const DEFAULT_MODEL_BY_PROVIDER: Record<AIProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-latest',
  google: 'gemini-2.5-pro',
  openrouter: 'openai/gpt-4o',
  'github-copilot': 'gpt-4.1',
  azure: 'gpt-4o',
  groq: 'llama-3.3-70b-versatile',
  together: 'meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo',
};

const DEFAULT_API_KEY_ENV_BY_PROVIDER: Record<AIProvider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  'github-copilot': 'GITHUB_COPILOT_TOKEN',
  azure: 'AZURE_OPENAI_API_KEY',
  groq: 'GROQ_API_KEY',
  together: 'TOGETHER_API_KEY',
};

const DEFAULT_BASE_URL_BY_PROVIDER: Partial<Record<AIProvider, string>> = {
  openrouter: 'https://openrouter.ai/api/v1',
  'github-copilot': 'https://api.githubcopilot.com',
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
};

function envValueFromTemplate(value?: string): string | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^\$\{([A-Z0-9_]+)\}$/);
  if (!match) return value;
  const envName = match[1];
  return envName ? process.env[envName] : undefined;
}

function resolveApiKey(provider: AIProvider, apiKey?: string): string {
  const resolved = envValueFromTemplate(apiKey);
  if (resolved) return resolved;

  const envName = DEFAULT_API_KEY_ENV_BY_PROVIDER[provider];
  const fallback = process.env[envName];
  if (fallback) return fallback;

  throw new Error(`Missing API key for provider "${provider}". Set ${envName} or configure ai.apiKey.`);
}

function resolveBaseUrl(provider: AIProvider, baseUrl?: string): string | undefined {
  if (baseUrl) return baseUrl;
  return DEFAULT_BASE_URL_BY_PROVIDER[provider];
}

export function getDefaultModel(provider: AIProvider): string {
  return DEFAULT_MODEL_BY_PROVIDER[provider];
}

export function getDefaultApiKeyPlaceholder(provider: AIProvider): string {
  return `\${${DEFAULT_API_KEY_ENV_BY_PROVIDER[provider]}}`;
}

export function getDefaultBaseUrl(provider: AIProvider): string | undefined {
  return DEFAULT_BASE_URL_BY_PROVIDER[provider];
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
  const apiKey = resolveApiKey(validatedConfig.provider, validatedConfig.apiKey);
  const baseURL = resolveBaseUrl(validatedConfig.provider, validatedConfig.baseUrl);

  switch (validatedConfig.provider) {
    case 'openai': {
      return createOpenAI(withOptionalBaseUrl(apiKey, baseURL))(validatedConfig.model);
    }
    case 'openrouter':
    case 'github-copilot':
    case 'groq':
    case 'together': {
      return createOpenAI(withOptionalBaseUrl(apiKey, baseURL))(validatedConfig.model);
    }
    case 'azure': {
      if (!baseURL) {
        throw new Error('Azure provider requires ai.baseUrl (Azure OpenAI endpoint).');
      }
      return createOpenAI({ apiKey, baseURL })(validatedConfig.model);
    }
    case 'anthropic': {
      return createAnthropic(withOptionalBaseUrl(apiKey, baseURL))(validatedConfig.model);
    }
    case 'google': {
      return createGoogleGenerativeAI(withOptionalBaseUrl(apiKey, baseURL))(validatedConfig.model);
    }
    default: {
      const exhaustiveProvider: never = validatedConfig.provider;
      throw new Error(`Unsupported provider: ${exhaustiveProvider}`);
    }
  }
}
