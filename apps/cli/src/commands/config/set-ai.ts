import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as path from 'node:path';
import {
  type AIProvider,
  CONFIG_FILE,
  SCRIMBLE_DIR,
  aiModelStrategySchema,
  aiProfileAuthStrategySchema,
  aiProviderSchema,
} from '@scrimble/shared';
import { loadScrimbleConfig } from '../../lib/config/load-config.js';
import {
  buildProviderProfile,
  getActiveProfile,
  upsertProfile,
} from '../../lib/ai/profiles.js';
import { describeProfileModel } from '../../lib/ai/provider.js';
import { getDefaultAuthStrategy, providerSupportsAutoModel } from '../../lib/ai/provider-catalog.js';
import { runProviderSetupStudio } from '../../lib/ai/setup-studio.js';
import { migrateLegacyLedgerIfPresent } from '../../lib/ledger/legacy-migration.js';
import { writeSecureJson } from '../../lib/security.js';

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function toEnvReference(envName: string): string {
  const trimmed = envName.trim();
  if (!/^[A-Z0-9_]+$/.test(trimmed)) {
    throw new Error('Environment variable names must be uppercase letters, numbers, or underscores.');
  }
  return `\${${trimmed}}`;
}

function promptable(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export default class ConfigSetAi extends Command {
  static override description = 'Configure provider profiles, auth strategy, and model strategy for this project';

  static override examples = [
    '<%= config.bin %> config set-ai',
    '<%= config.bin %> config set-ai --provider openai --model gpt-4o --api-key-env OPENAI_API_KEY --non-interactive',
    '<%= config.bin %> config set-ai --provider github-copilot --auth-strategy env_token --model-strategy auto --non-interactive',
  ];

  static override flags = {
    provider: Flags.string({
      description: 'AI provider',
      options: [...aiProviderSchema.options],
    }),
    'profile-name': Flags.string({
      description: 'Profile display name',
    }),
    'model-strategy': Flags.string({
      description: 'Model strategy',
      options: [...aiModelStrategySchema.options],
    }),
    model: Flags.string({
      description: 'Explicit model identifier (required when model-strategy=explicit in non-interactive mode)',
    }),
    'auth-strategy': Flags.string({
      description: 'Auth strategy',
      options: [...aiProfileAuthStrategySchema.options],
    }),
    'base-url': Flags.string({
      description: 'Optional provider base URL override',
    }),
    'api-key': Flags.string({
      description: 'API key value (BYOK providers)',
    }),
    'api-key-env': Flags.string({
      description: 'Environment variable name for API key reference (stored as ${ENV_NAME})',
    }),
    token: Flags.string({
      description: 'Explicit GitHub token (Copilot advanced path)',
    }),
    'token-env': Flags.string({
      description: 'Environment variable name for explicit GitHub token reference',
    }),
    'non-interactive': Flags.boolean({
      description: 'Apply flags directly instead of launching setup studio',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigSetAi);
    if (flags['api-key'] && flags['api-key-env']) {
      throw new Error('Use either --api-key or --api-key-env, not both.');
    }
    if (flags.token && flags['token-env']) {
      throw new Error('Use either --token or --token-env, not both.');
    }

    const cwd = process.cwd();
    await migrateLegacyLedgerIfPresent(cwd);
    const configPath = path.join(cwd, SCRIMBLE_DIR, CONFIG_FILE);

    let existingConfig: Awaited<ReturnType<typeof loadScrimbleConfig>>;
    try {
      existingConfig = await loadScrimbleConfig(cwd);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        this.log(chalk.red('\nMissing .scrimble/config.json. Run `scrimble init` first.\n'));
        this.exit(1);
        return;
      }
      throw error;
    }

    if (promptable() && !flags['non-interactive']) {
      const studioResult = await runProviderSetupStudio({
        config: existingConfig,
        reason: 'Configure provider, authentication method, and model strategy.',
        seed: {
          ...(flags.provider ? { provider: aiProviderSchema.parse(flags.provider) } : {}),
          ...(flags.model ? { model: flags.model.trim() } : {}),
          ...(flags['profile-name'] ? { profileName: flags['profile-name'].trim() } : {}),
        },
      });
      if (!studioResult) {
        this.log(chalk.yellow('\nProvider setup cancelled.\n'));
        return;
      }

      await writeSecureJson(configPath, studioResult.config);
      const active = getActiveProfile(studioResult.config);
      this.log('');
      this.log(chalk.green('✓ Provider profile updated.'));
      if (active) {
        this.log(chalk.dim(`  Active profile: ${active.name} (${active.id})`));
        this.log(chalk.dim(`  Provider: ${active.provider}`));
        this.log(chalk.dim(`  Model: ${describeProfileModel(active)}`));
        this.log(chalk.dim(`  Auth: ${active.auth.strategy}`));
      }
      this.log('');
      return;
    }

    const activeProfile = getActiveProfile(existingConfig);
    const selectedProvider = flags.provider
      ? aiProviderSchema.parse(flags.provider)
      : activeProfile?.provider
        ?? 'openai';
    const selectedModelStrategy = flags['model-strategy']
      ? aiModelStrategySchema.parse(flags['model-strategy'])
      : flags.model
        ? 'explicit'
        : activeProfile?.provider === selectedProvider
          ? activeProfile.modelStrategy
          : providerSupportsAutoModel(selectedProvider) ? 'auto' : 'explicit';
    const selectedAuthStrategy = flags['auth-strategy']
      ? aiProfileAuthStrategySchema.parse(flags['auth-strategy'])
      : activeProfile?.provider === selectedProvider
        ? activeProfile.auth.strategy
        : getDefaultAuthStrategy(selectedProvider, false);
    const selectedModel = flags.model?.trim() || (selectedModelStrategy === 'explicit'
      ? activeProfile?.provider === selectedProvider ? activeProfile.model : undefined
      : undefined);
    if (selectedModelStrategy === 'explicit' && !selectedModel) {
      throw new Error('Explicit model strategy requires --model in non-interactive mode.');
    }

    const apiKeyInput = flags['api-key']?.trim() || (flags['api-key-env'] ? toEnvReference(flags['api-key-env']) : undefined);
    const tokenInput = flags.token?.trim() || (flags['token-env'] ? toEnvReference(flags['token-env']) : undefined);
    const profile = buildProviderProfile({
      id: activeProfile?.provider === selectedProvider ? activeProfile.id : undefined,
      name: flags['profile-name']?.trim() || (activeProfile?.provider === selectedProvider ? activeProfile.name : undefined),
      provider: selectedProvider,
      modelStrategy: selectedModelStrategy,
      ...(selectedModel ? { model: selectedModel } : {}),
      authStrategy: selectedAuthStrategy,
      ...(apiKeyInput ? { apiKey: apiKeyInput } : activeProfile?.auth.apiKey ? { apiKey: activeProfile.auth.apiKey } : {}),
      ...(tokenInput ? { token: tokenInput } : activeProfile?.auth.token ? { token: activeProfile.auth.token } : {}),
      ...(flags['base-url']?.trim() ? { baseUrl: flags['base-url'].trim() } : activeProfile?.baseUrl ? { baseUrl: activeProfile.baseUrl } : {}),
      options: activeProfile?.provider === selectedProvider ? activeProfile.options : undefined,
      interactive: false,
    });

    const merged = upsertProfile(existingConfig, profile, true);
    await writeSecureJson(configPath, merged);

    this.log('');
    this.log(chalk.green('✓ Provider profile updated.'));
    this.log(chalk.dim(`  Active profile: ${profile.name} (${profile.id})`));
    this.log(chalk.dim(`  Provider: ${profile.provider}`));
    this.log(chalk.dim(`  Model: ${describeProfileModel(profile)}`));
    this.log(chalk.dim(`  Auth strategy: ${profile.auth.strategy}`));
    this.log('');
  }
}
