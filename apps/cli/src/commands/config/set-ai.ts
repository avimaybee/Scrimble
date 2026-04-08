import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import {
  type AIProvider,
  CONFIG_FILE,
  SCRIMBLE_DIR,
  aiProviderSchema,
  scrimbleConfigSchema,
} from '@scrimble/shared';
import { buildDefaultAIConfig, getDefaultApiKeyPlaceholder } from '../../lib/ai/provider.js';
import { loadScrimbleConfig } from '../../lib/config/load-config.js';
import { writeSecureJson } from '../../lib/security.js';

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function toEnvReference(envName: string): string {
  const trimmed = envName.trim();
  if (!/^[A-Z0-9_]+$/.test(trimmed)) {
    throw new Error('api-key-env must be uppercase letters, numbers, or underscores (e.g. OPENAI_API_KEY).');
  }
  return `\${${trimmed}}`;
}

function promptable(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function promptProvider(
  rl: ReturnType<typeof createInterface>,
  log: (message?: string) => void,
  currentProvider: AIProvider,
): Promise<AIProvider> {
  const providers = [...aiProviderSchema.options] as AIProvider[];
  const defaultIndex = Math.max(0, providers.indexOf(currentProvider));

  log(chalk.bold('Select an AI provider:'));
  for (const [index, provider] of providers.entries()) {
    const currentMarker = provider === currentProvider ? ' (current)' : '';
    log(chalk.dim(`  ${index + 1}. ${provider}${currentMarker}`));
  }

  for (;;) {
    const answer = (await rl.question(`Provider [${defaultIndex + 1}]: `)).trim();
    if (!answer) {
      const provider = providers[defaultIndex];
      if (!provider) {
        throw new Error('Unable to resolve default provider.');
      }
      return provider;
    }

    const asNumber = Number.parseInt(answer, 10);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= providers.length) {
      const selected = providers[asNumber - 1];
      if (!selected) {
        throw new Error('Selected provider index is out of range.');
      }
      return selected;
    }

    const normalized = answer.toLowerCase();
    if (providers.includes(normalized as AIProvider)) {
      return aiProviderSchema.parse(normalized);
    }

    log(chalk.yellow(`Invalid provider selection: ${answer}`));
  }
}

async function promptWithDefault(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue: string,
): Promise<string> {
  const answer = (await rl.question(`${label} [${defaultValue}]: `)).trim();
  return answer || defaultValue;
}

export default class ConfigSetAi extends Command {
  static override description = 'Configure AI provider/model/api key for this Scrimble project';

  static override examples = [
    '<%= config.bin %> config set-ai',
    '<%= config.bin %> config set-ai --provider openai --model gpt-4o --api-key-env OPENAI_API_KEY',
  ];

  static override flags = {
    provider: Flags.string({
      description: 'AI provider',
      options: [...aiProviderSchema.options],
    }),
    model: Flags.string({
      description: 'AI model identifier',
    }),
    'api-key': Flags.string({
      description: 'Raw API key value to store in config',
    }),
    'api-key-env': Flags.string({
      description: 'Environment variable name to reference (stored as ${ENV_NAME})',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigSetAi);
    if (flags['api-key'] && flags['api-key-env']) {
      throw new Error('Use either --api-key or --api-key-env, not both.');
    }

    const cwd = process.cwd();
    const configPath = path.join(cwd, SCRIMBLE_DIR, CONFIG_FILE);

    let existingConfig: ReturnType<typeof scrimbleConfigSchema.parse>;
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

    let provider: AIProvider =
      flags.provider ? aiProviderSchema.parse(flags.provider) : existingConfig.ai.provider;

    let model =
      flags.model?.trim() ??
      (provider === existingConfig.ai.provider
        ? existingConfig.ai.model
        : buildDefaultAIConfig(provider).model);

    let apiKey =
      flags['api-key']?.trim() ??
      (flags['api-key-env'] ? toEnvReference(flags['api-key-env']) : undefined) ??
      (provider === existingConfig.ai.provider ? existingConfig.ai.apiKey?.trim() : undefined) ??
      '';

    if ((!flags.provider || !flags.model || !apiKey) && promptable()) {
      this.log('');
      this.log(chalk.bold('🤖 AI setup wizard'));
      this.log('');

      const rl = createInterface({ input, output });
      try {
        if (!flags.provider) {
          provider = await promptProvider(rl, this.log.bind(this), provider);
        }

        if (!flags.model) {
          const defaultModel = provider === existingConfig.ai.provider
            ? existingConfig.ai.model
            : buildDefaultAIConfig(provider).model;
          model = await promptWithDefault(rl, 'Model', defaultModel);
        }

        if (!flags['api-key'] && !flags['api-key-env']) {
          const defaultApiKey =
            provider === existingConfig.ai.provider
              ? existingConfig.ai.apiKey?.trim() || getDefaultApiKeyPlaceholder(provider)
              : getDefaultApiKeyPlaceholder(provider);
          apiKey = await promptWithDefault(
            rl,
            'API key or ${ENV_VAR} reference',
            defaultApiKey,
          );
        }
      } finally {
        rl.close();
      }
    }

    if (!model.trim()) {
      throw new Error('AI model is required. Provide --model or run interactively.');
    }
    if (!apiKey.trim()) {
      throw new Error('AI API key is required. Provide --api-key, --api-key-env, or run interactively.');
    }

    const providerDefaults = buildDefaultAIConfig(provider, model.trim());
    const baseUrl =
      provider === existingConfig.ai.provider
        ? existingConfig.ai.baseUrl ?? providerDefaults.baseUrl
        : providerDefaults.baseUrl;

    const updatedConfig = scrimbleConfigSchema.parse({
      ...existingConfig,
      ai: {
        provider,
        model: model.trim(),
        apiKey: apiKey.trim(),
        ...(baseUrl ? { baseUrl } : {}),
        ...(existingConfig.ai.options ? { options: existingConfig.ai.options } : {}),
      },
    });

    await writeSecureJson(configPath, updatedConfig);

    const apiKeyValue = updatedConfig.ai.apiKey ?? '';
    const envReferenced = /^\$\{[A-Z0-9_]+\}$/.test(apiKeyValue);

    this.log('');
    this.log(chalk.green('✓ AI configuration updated.'));
    this.log(chalk.dim(`  Provider: ${updatedConfig.ai.provider}`));
    this.log(chalk.dim(`  Model: ${updatedConfig.ai.model}`));
    this.log(
      chalk.dim(
        `  API key: ${envReferenced ? apiKeyValue : '[stored value]'}`,
      ),
    );
    this.log('');
  }
}
