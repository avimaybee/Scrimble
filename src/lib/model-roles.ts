import type { AIModelRoles, AIProvider } from './ai';

const DEFAULT_MODEL_LABEL = 'default model';

function resolveDefaultProviderModel(provider: AIProvider | undefined) {
  if (!provider) {
    return '';
  }

  const deprecatedModel = (provider.model || '').trim();
  if (deprecatedModel) {
    return deprecatedModel;
  }

  const firstNamedModel = provider.models.find((model) => model.name.trim());
  return firstNamedModel?.name.trim() || '';
}

function resolveProviderDisplayName(provider: AIProvider) {
  const explicitName = provider.name.trim();
  if (explicitName) {
    return explicitName;
  }

  switch (provider.provider) {
    case 'openai':
      return 'OpenAI';
    case 'anthropic':
      return 'Anthropic';
    case 'gemini':
      return 'Google Gemini';
    case 'openrouter':
      return 'OpenRouter';
    case 'groq':
      return 'Groq';
    case 'custom':
    default:
      return 'Custom provider';
  }
}

export function hasConfiguredRole(providerId: string | null, modelName: string | null) {
  return Boolean(providerId?.trim() && modelName?.trim());
}

export function resolveModelRoleDisplay(providers: AIProvider[], modelRoles: AIModelRoles) {
  const defaultProvider = providers.find((provider) => provider.is_default) || providers[0];
  if (!defaultProvider) {
    return {
      fast: DEFAULT_MODEL_LABEL,
      deep: DEFAULT_MODEL_LABEL,
    };
  }

  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const fastSlot = hasConfiguredRole(modelRoles.fast_model_provider_id, modelRoles.fast_model_name)
    ? {
        provider: providerById.get(modelRoles.fast_model_provider_id || '') || defaultProvider,
        model: (modelRoles.fast_model_name || '').trim(),
      }
    : null;
  const deepSlot = hasConfiguredRole(modelRoles.deep_model_provider_id, modelRoles.deep_model_name)
    ? {
        provider: providerById.get(modelRoles.deep_model_provider_id || '') || defaultProvider,
        model: (modelRoles.deep_model_name || '').trim(),
      }
    : null;
  const defaultSlot = {
    provider: defaultProvider,
    model: resolveDefaultProviderModel(defaultProvider),
  };

  const resolveRoleLabel = (role: 'fast' | 'deep') => {
    const resolvedSlot = role === 'fast'
      ? fastSlot || deepSlot || defaultSlot
      : deepSlot || fastSlot || defaultSlot;

    const modelName = resolvedSlot.model
      || resolveDefaultProviderModel(resolvedSlot.provider)
      || DEFAULT_MODEL_LABEL;

    return `${resolveProviderDisplayName(resolvedSlot.provider)} — ${modelName}`;
  };

  return {
    fast: resolveRoleLabel('fast'),
    deep: resolveRoleLabel('deep'),
  };
}
