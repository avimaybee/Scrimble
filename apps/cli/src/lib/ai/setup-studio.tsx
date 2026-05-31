import React, { useEffect, useMemo, useState } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import {
  type AIProfileAuthStrategy,
  type AIProvider,
  aiProviderSchema,
  type ScrimbleConfig,
} from '@scrimble/shared';
import {
  buildProviderProfile,
  describeProfileModel,
  getActiveProfile,
  upsertProfile,
} from './profiles.js';
import {
  evaluateProfileHealth,
  refreshProfileHealth,
  getDefaultApiKeyPlaceholder,
  type ProfileHealth,
} from './provider.js';
import {
  getDefaultAuthStrategy,
  getDefaultBaseUrl,
  getDefaultModel,
  getProviderCatalog,
  listProviderCatalog,
  providerSupportsAutoModel,
} from './provider-catalog.js';

type SetupStep =
  | 'provider'
  | 'auth'
  | 'model'
  | 'custom_model'
  | 'profile_name'
  | 'token'
  | 'base_url'
  | 'review';

const STEPS: SetupStep[] = [
  'provider',
  'auth',
  'model',
  'custom_model',
  'profile_name',
  'token',
  'base_url',
  'review',
];

export interface ProviderSetupStudioResult {
  config: ScrimbleConfig;
  profileId: string;
}

export interface ProviderSetupStudioOptions {
  config: ScrimbleConfig;
  reason?: string;
  seed?: {
    provider?: AIProvider;
    model?: string;
    profileName?: string;
  };
}

interface ProviderSetupStudioAppProps extends ProviderSetupStudioOptions {
  onComplete: (result: ProviderSetupStudioResult) => void;
  onCancel: () => void;
}

function parseSelection(input: string, options: string[]): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }
  const asNumber = Number.parseInt(trimmed, 10);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= options.length) {
    return options[asNumber - 1];
  }
  return options.find((entry) => entry === trimmed.toLowerCase() || entry === trimmed);
}

function stageLabel(step: SetupStep): string {
  switch (step) {
    case 'provider':
      return 'Provider selection';
    case 'auth':
      return 'Auth method';
    case 'model':
    case 'custom_model':
      return 'Model strategy';
    case 'profile_name':
      return 'Profile details';
    case 'token':
      return 'Credential input';
    case 'base_url':
      return 'Endpoint';
    case 'review':
      return 'Review + save';
    default:
      return 'Setup';
  }
}

function authLabel(strategy: AIProfileAuthStrategy): string {
  switch (strategy) {
    case 'api_key':
      return 'API key / env reference';
    case 'copilot_login':
      return 'Copilot login (device flow)';
    case 'env_token':
      return 'Env token (COPILOT_GITHUB_TOKEN, GH_TOKEN, GITHUB_TOKEN)';
    case 'gh_cli':
      return 'GitHub CLI auth token';
    case 'personal_access_token':
      return 'Explicit GitHub token';
    default:
      return strategy;
  }
}

function needsTokenStep(provider: AIProvider, authStrategy: AIProfileAuthStrategy): boolean {
  if (provider === 'github-copilot') {
    return authStrategy === 'personal_access_token';
  }
  return authStrategy === 'api_key';
}

function needsBaseUrlStep(provider: AIProvider): boolean {
  const catalog = getProviderCatalog(provider);
  return Boolean(catalog.requiresBaseUrl || catalog.defaultBaseUrl);
}

function setupStepsFor(provider: AIProvider, authStrategy: AIProfileAuthStrategy, modelStrategy: 'auto' | 'explicit'): SetupStep[] {
  const steps: SetupStep[] = ['provider', 'auth', 'model'];
  steps.push('profile_name');
  if (needsTokenStep(provider, authStrategy)) {
    steps.push('token');
  }
  if (needsBaseUrlStep(provider)) {
    steps.push('base_url');
  }
  steps.push('review');
  return steps;
}

function nextStep(
  current: SetupStep,
  provider: AIProvider,
  authStrategy: AIProfileAuthStrategy,
  modelStrategy: 'auto' | 'explicit',
): SetupStep {
  if (current === 'custom_model') {
    return nextStep('model', provider, authStrategy, modelStrategy);
  }
  const flow = setupStepsFor(provider, authStrategy, modelStrategy);
  const index = flow.indexOf(current);
  if (index === -1 || index >= flow.length - 1) {
    return 'review';
  }
  return flow[index + 1] ?? 'review';
}

function previousStep(
  current: SetupStep,
  provider: AIProvider,
  authStrategy: AIProfileAuthStrategy,
  modelStrategy: 'auto' | 'explicit',
): SetupStep {
  if (current === 'custom_model') {
    return 'model';
  }
  const flow = setupStepsFor(provider, authStrategy, modelStrategy);
  const index = flow.indexOf(current);
  if (index <= 0) {
    return current;
  }
  return flow[index - 1] ?? 'provider';
}

function ProviderSetupStudioApp({
  config,
  reason,
  seed,
  onComplete,
  onCancel,
}: ProviderSetupStudioAppProps): JSX.Element {
  const { exit } = useApp();
  const providers = aiProviderSchema.options as AIProvider[];
  const activeProfile = getActiveProfile(config);
  const initialProvider = seed?.provider ?? activeProfile?.provider ?? 'openai';
  const [provider, setProvider] = useState<AIProvider>(initialProvider);
  const [authStrategy, setAuthStrategy] = useState<AIProfileAuthStrategy>(
    activeProfile?.provider === initialProvider
      ? activeProfile.auth.strategy
      : getDefaultAuthStrategy(initialProvider, true),
  );
  const [modelStrategy, setModelStrategy] = useState<'auto' | 'explicit'>(
    activeProfile?.provider === initialProvider
      ? activeProfile.modelStrategy
      : providerSupportsAutoModel(initialProvider) ? 'auto' : 'explicit',
  );
  const [model, setModel] = useState(
    seed?.model
      ?? (activeProfile?.provider === initialProvider ? activeProfile.model : undefined)
      ?? getDefaultModel(initialProvider),
  );
  const [profileName, setProfileName] = useState(
    seed?.profileName
      ?? (activeProfile?.provider === initialProvider ? activeProfile.name : `${getProviderCatalog(initialProvider).label} profile`),
  );
  const [apiKeyOrToken, setApiKeyOrToken] = useState(
    activeProfile?.provider === initialProvider
      ? activeProfile.auth.strategy === 'api_key'
        ? activeProfile.auth.apiKey ?? getDefaultApiKeyPlaceholder(initialProvider)
        : activeProfile.auth.strategy === 'personal_access_token'
          ? activeProfile.auth.token ?? ''
          : ''
      : provider === 'github-copilot'
        ? ''
        : getDefaultApiKeyPlaceholder(initialProvider),
  );
  const [baseUrl, setBaseUrl] = useState(
    activeProfile?.provider === initialProvider
      ? activeProfile.baseUrl ?? getDefaultBaseUrl(initialProvider) ?? ''
      : getDefaultBaseUrl(initialProvider) ?? '',
  );
  const [step, setStep] = useState<SetupStep>('provider');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [liveHealth, setLiveHealth] = useState<ProfileHealth | undefined>(undefined);
  const [liveLookupError, setLiveLookupError] = useState<string | undefined>(undefined);
  const [liveLookupLoading, setLiveLookupLoading] = useState(false);

  const providerCatalog = useMemo(() => getProviderCatalog(provider), [provider]);
  const authChoices = useMemo(
    () => providerCatalog.authStrategies,
    [providerCatalog],
  );

  const profilePreview = useMemo(() => {
    const profile = buildProviderProfile({
      id: activeProfile?.provider === provider ? activeProfile.id : undefined,
      name: profileName,
      provider,
      modelStrategy,
      model,
      authStrategy,
      apiKey: provider === 'github-copilot'
        ? undefined
        : (apiKeyOrToken || getDefaultApiKeyPlaceholder(provider)),
      token: provider === 'github-copilot' ? apiKeyOrToken : undefined,
      baseUrl: baseUrl || undefined,
      options: activeProfile?.provider === provider ? activeProfile.options : undefined,
      interactive: true,
    });
    const health = evaluateProfileHealth(profile, { cwd: process.cwd() });
    return { profile, health };
  }, [activeProfile, apiKeyOrToken, authStrategy, baseUrl, model, modelStrategy, profileName, provider]);

  useEffect(() => {
    let cancelled = false;
    setLiveLookupLoading(true);
    setLiveLookupError(undefined);
    refreshProfileHealth(profilePreview.profile, { cwd: process.cwd() })
      .then((health) => {
        if (!cancelled) {
          setLiveHealth(health);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLiveLookupError('Live capability lookup failed; showing cached/fallback capability data.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLiveLookupLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    profilePreview.profile.provider,
    profilePreview.profile.modelStrategy,
    profilePreview.profile.model,
    profilePreview.profile.baseUrl,
    profilePreview.profile.auth.strategy,
    profilePreview.profile.auth.apiKey,
    profilePreview.profile.auth.token,
    profilePreview.profile.id,
  ]);

  const validationHealth = liveHealth ?? profilePreview.health;
  const capabilityModels = validationHealth.availableModels.length > 0
    ? validationHealth.availableModels
    : providerCatalog.recommendedModels;

  const modelChoices = useMemo(() => {
    const choices: string[] = [];
    if (providerCatalog.supportsAuto) {
      choices.push('auto');
    }
    for (const modelEntry of capabilityModels) {
      choices.push(modelEntry);
    }
    return [...new Set(choices)];
  }, [capabilityModels, providerCatalog]);

  const submit = (): void => {
    const value = draft.trim();
    setError(undefined);

    if (value.toLowerCase() === 'back') {
      setStep(previousStep(step, provider, authStrategy, modelStrategy));
      setDraft('');
      return;
    }

    if (step === 'provider') {
      const selection = parseSelection(value, providers);
      const nextProvider = aiProviderSchema.parse(selection ?? provider);
      setProvider(nextProvider);
      setAuthStrategy(getDefaultAuthStrategy(nextProvider, true));
      const supportsAuto = providerSupportsAutoModel(nextProvider);
      setModelStrategy(supportsAuto ? 'auto' : 'explicit');
      setModel(getDefaultModel(nextProvider));
      setProfileName(`${getProviderCatalog(nextProvider).label} profile`);
      setApiKeyOrToken(nextProvider === 'github-copilot' ? '' : getDefaultApiKeyPlaceholder(nextProvider));
      setBaseUrl(getDefaultBaseUrl(nextProvider) ?? '');
      setStep('auth');
      setDraft('');
      return;
    }

    if (step === 'auth') {
      const selection = parseSelection(value, authChoices);
      if (!selection) {
        setError('Select an auth method by number or name.');
        return;
      }
      const nextAuth = selection as AIProfileAuthStrategy;
      setAuthStrategy(nextAuth);
      if (!needsTokenStep(provider, nextAuth)) {
        setApiKeyOrToken('');
      } else if (!apiKeyOrToken) {
        setApiKeyOrToken(provider === 'github-copilot' ? '' : getDefaultApiKeyPlaceholder(provider));
      }
      setStep('model');
      setDraft('');
      return;
    }

    if (step === 'model') {
      const normalized = value.toLowerCase();
      if (!normalized || normalized === 'auto') {
        const nextStrategy = providerCatalog.supportsAuto ? 'auto' : 'explicit';
        setModelStrategy(nextStrategy);
        if (nextStrategy === 'auto') {
          setStep(nextStep('model', provider, authStrategy, nextStrategy));
          setDraft('');
          return;
        }
      }
      if (normalized === 'custom' || normalized === 'c') {
        setModelStrategy('explicit');
        setStep('custom_model');
        setDraft('');
        return;
      }
      const selection = parseSelection(value, modelChoices);
      if (!selection) {
        setError('Select a model option by number, name, or `custom`.');
        return;
      }
      if (selection === 'auto') {
        setModelStrategy('auto');
        setStep(nextStep('model', provider, authStrategy, 'auto'));
      } else {
        setModelStrategy('explicit');
        setModel(selection);
        setStep(nextStep('model', provider, authStrategy, 'explicit'));
      }
      setDraft('');
      return;
    }

    if (step === 'custom_model') {
      if (!value) {
        setError('Custom model id is required.');
        return;
      }
      setModel(value);
      setModelStrategy('explicit');
      setStep(nextStep('custom_model', provider, authStrategy, 'explicit'));
      setDraft('');
      return;
    }

    if (step === 'profile_name') {
      setProfileName(value || `${getProviderCatalog(provider).label} profile`);
      setStep(nextStep('profile_name', provider, authStrategy, modelStrategy));
      setDraft('');
      return;
    }

    if (step === 'token') {
      if (!value && needsTokenStep(provider, authStrategy) && provider !== 'github-copilot') {
        setApiKeyOrToken(getDefaultApiKeyPlaceholder(provider));
      } else {
        setApiKeyOrToken(value);
      }
      setStep(nextStep('token', provider, authStrategy, modelStrategy));
      setDraft('');
      return;
    }

    if (step === 'base_url') {
      if (!value && providerCatalog.requiresBaseUrl) {
        setError('Base URL is required for this provider.');
        return;
      }
      setBaseUrl(value || getDefaultBaseUrl(provider) || '');
      setStep(nextStep('base_url', provider, authStrategy, modelStrategy));
      setDraft('');
      return;
    }

    if (step === 'review') {
      if (validationHealth.issues.length > 0) {
        setError('Resolve profile issues before saving. Type `back` to adjust.');
        return;
      }
      const nextConfig = upsertProfile(config, profilePreview.profile, true);
      onComplete({
        config: nextConfig,
        profileId: profilePreview.profile.id,
      });
      exit();
      return;
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      exit();
      return;
    }
    if (key.return) {
      submit();
      return;
    }
    if (key.backspace || key.delete) {
      setDraft((current) => current.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      return;
    }
    if (input.length > 0) {
      setDraft((current) => current + input);
    }
  });

  const stepIndex = Math.max(0, STEPS.indexOf(step));

  return (
    <Box flexDirection="column" height={process.stdout.rows ?? 40}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
        <Text bold color="cyan">Provider Setup Studio</Text>
        <Text color="gray">Step {stepIndex + 1}/{STEPS.length}: {stageLabel(step)}</Text>
        <Text color="gray">{reason ?? 'Configure provider, auth, and model strategy for Scrimble.'}</Text>
      </Box>
      <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
        <Text>
          <Text bold>Provider:</Text> {provider}
          <Text color="gray"> | </Text>
          <Text bold>Auth:</Text> {authLabel(authStrategy)}
          <Text color="gray"> | </Text>
          <Text bold>Model:</Text> {modelStrategy === 'auto' ? 'auto' : model}
        </Text>
        <Text color="gray">{providerCatalog.description}</Text>
        <Text color="gray">{providerCatalog.docsHint}</Text>
        <Text color={validationHealth.usableNow ? 'green' : 'yellow'}>
          Validation: {validationHealth.usableNow ? 'usable now' : 'configured but not currently usable'}
          {' '}• source={validationHealth.capabilitySource}/{validationHealth.validationFreshness}
          {' '}• model={validationHealth.modelAvailability}
          {validationHealth.authSource ? ` • auth=${validationHealth.authSource}` : ''}
        </Text>
        {liveLookupLoading ? <Text color="gray">Refreshing live capabilities...</Text> : null}
        {liveLookupError ? <Text color="yellow">{liveLookupError}</Text> : null}
      </Box>
      <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column" flexGrow={1}>
        {step === 'provider' ? (
          <>
            <Text bold color="magenta">Select provider</Text>
            {listProviderCatalog().map((entry, index) => (
              <Text key={entry.provider}>
                {index + 1}. {entry.provider} — {entry.label}
              </Text>
            ))}
            <Text color="gray">Type number/provider and press Enter.</Text>
          </>
        ) : null}
        {step === 'auth' ? (
          <>
            <Text bold color="magenta">Select auth method</Text>
            {authChoices.map((entry, index) => (
              <Text key={entry}>
                {index + 1}. {entry} — {authLabel(entry)}
              </Text>
            ))}
            <Text color="gray">Type number/method and press Enter.</Text>
          </>
        ) : null}
        {step === 'model' ? (
          <>
            <Text bold color="magenta">Select model strategy</Text>
            {modelChoices.map((entry, index) => (
              <Text key={entry}>
                {index + 1}. {entry === 'auto' ? 'auto (recommended)' : entry}
              </Text>
            ))}
            <Text>c. custom model</Text>
              <Text color="gray">
                {providerCatalog.planDependentModels
                  ? 'Copilot model availability is plan/client dependent.'
                  : 'Type number/model, `auto`, or `custom`.'}
              </Text>
              <Text color="gray">
                Capability source: {validationHealth.capabilitySource} ({validationHealth.validationFreshness})
              </Text>
            </>
          ) : null}
        {step === 'custom_model' ? (
          <>
            <Text bold color="magenta">Enter explicit model id</Text>
            <Text color="gray">Current: {model}</Text>
          </>
        ) : null}
        {step === 'profile_name' ? (
          <>
            <Text bold color="magenta">Profile name</Text>
            <Text color="gray">Current: {profileName}</Text>
            <Text color="gray">Press Enter to keep current value.</Text>
          </>
        ) : null}
        {step === 'token' ? (
          <>
            <Text bold color="magenta">
              {provider === 'github-copilot' ? 'GitHub token (advanced)' : 'API key or ${ENV_VAR} reference'}
            </Text>
            <Text color="gray">Current: {apiKeyOrToken || '(empty)'}</Text>
          </>
        ) : null}
        {step === 'base_url' ? (
          <>
            <Text bold color="magenta">Base URL</Text>
            <Text color="gray">Current: {baseUrl || '(default)'}</Text>
            {providerCatalog.requiresBaseUrl ? (
              <Text color="yellow">This provider requires a base URL.</Text>
            ) : (
              <Text color="gray">Press Enter to keep provider default.</Text>
            )}
          </>
        ) : null}
        {step === 'review' ? (
          <>
            <Text bold color="magenta">Review and save</Text>
            <Text>Profile: {profilePreview.profile.name} ({profilePreview.profile.id})</Text>
            <Text>Provider: {profilePreview.profile.provider}</Text>
            <Text>Model: {describeProfileModel(profilePreview.profile)}</Text>
            <Text>Auth: {profilePreview.profile.auth.strategy}</Text>
            <Text color={validationHealth.usableNow ? 'green' : 'yellow'}>
              Usable now: {validationHealth.usableNow ? 'yes' : 'no'}
            </Text>
            {validationHealth.checks.map((check, index) => (
              <Text key={`${check.message}-${index}`} color={check.status === 'pass' ? 'green' : check.status === 'warn' ? 'yellow' : 'red'}>
                {check.status.toUpperCase()}: {check.message}
              </Text>
            ))}
            {validationHealth.usabilityIssues.length > 0 ? (
              <Text color="yellow">
                Runtime usability warnings: {validationHealth.usabilityIssues.join(' | ')}
              </Text>
            ) : null}
            <Text color="gray">Press Enter to save, or type `back` to adjust.</Text>
          </>
        ) : null}
      </Box>
      {error ? (
        <Box borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}
      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text color="cyan">{'>'}</Text>
        <Text> </Text>
        {draft ? <Text>{draft}</Text> : <Text color="gray">Type value, Enter submit, Esc cancel, `back` to previous step.</Text>}
      </Box>
    </Box>
  );
}

export async function runProviderSetupStudio(options: ProviderSetupStudioOptions): Promise<ProviderSetupStudioResult | null> {
  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    return null;
  }

  let outcome: ProviderSetupStudioResult | null = null;
  const instance = render(
    <ProviderSetupStudioApp
      config={options.config}
      {...(options.reason ? { reason: options.reason } : {})}
      {...(options.seed ? { seed: options.seed } : {})}
      onComplete={(result) => {
        outcome = result;
      }}
      onCancel={() => {
        outcome = null;
      }}
    />,
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
  return outcome;
}
