import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as path from 'node:path';
import {
  CONFIG_FILE,
  SCRIMBLE_DIR,
  aiProviderSchema,
  type AIModelStrategy,
  type AIProfileAuthStrategy,
  type AIProvider,
  type InteractionMode,
} from '@scrimble/shared';
import { getDefaultApiKeyPlaceholder, getDefaultModel, hasValidActiveProfile } from '../lib/ai/provider.js';
import { buildDefaultScrimbleConfig, getActiveProfile } from '../lib/ai/profiles.js';
import { runProviderSetupStudio } from '../lib/ai/setup-studio.js';
import { getDefaultAuthStrategy, providerSupportsAutoModel } from '../lib/ai/provider-catalog.js';
import { ConversationalOrchestrator } from '../lib/agent/orchestrator.js';
import type {
  AgentSetupInput,
  OperatorBoundary,
  OperatorBoundaryResolution,
  OperatorEvent,
  OperatorRunResult,
} from '../lib/agent/types.js';
import { loadScrimbleConfig } from '../lib/config/load-config.js';
import { ensureDiscoveryFoundation } from '../lib/discovery/plaintext.js';
import { migrateLegacyLedgerIfPresent } from '../lib/ledger/legacy-migration.js';
import { runOperatorShell } from '../lib/shell/run-operator-shell.js';
import { writeSecureJson } from '../lib/security.js';

interface RunOptions {
  autoConfirm: boolean;
  interactive: boolean;
  verbose: boolean;
  interactionMode: InteractionMode;
  setupSeed: AgentSetupInput;
}

interface InteractionSettings {
  mode: InteractionMode;
  hasConfig: boolean;
  config?: Awaited<ReturnType<typeof loadScrimbleConfig>> | undefined;
  profileId?: string | undefined;
  profileName?: string | undefined;
  provider?: AIProvider | undefined;
  modelStrategy?: AIModelStrategy | undefined;
  model?: string | undefined;
  authStrategy?: AIProfileAuthStrategy | undefined;
  apiKey?: string | undefined;
  token?: string | undefined;
  baseUrl?: string | undefined;
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function loadInteractionSettings(cwd: string): Promise<InteractionSettings> {
  try {
    const config = await loadScrimbleConfig(cwd);
    const profile = getActiveProfile(config);
    return {
      mode: config.interactionMode ?? 'guide',
      hasConfig: true,
      config,
      ...(profile
        ? {
            profileId: profile.id,
            profileName: profile.name,
            provider: profile.provider,
            modelStrategy: profile.modelStrategy,
            ...(profile.model ? { model: profile.model } : {}),
            authStrategy: profile.auth.strategy,
            ...(profile.auth.apiKey ? { apiKey: profile.auth.apiKey } : {}),
            ...(profile.auth.token ? { token: profile.auth.token } : {}),
            ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
          }
        : {}),
    };
  } catch {
    return { mode: 'guide', hasConfig: false };
  }
}

function printOperatorEvent(log: (message?: string) => void, event: OperatorEvent, verbose: boolean): void {
  switch (event.type) {
    case 'planning':
      log(chalk.dim('Inspecting context and choosing the next step...'));
      break;
    case 'resumed':
      log(chalk.dim(event.message));
      break;
    case 'step_started':
      log(chalk.dim(`Starting: ${event.message}`));
      break;
    case 'step_completed':
      log(chalk.cyan(`Done: ${event.message}`));
      if (verbose && event.result) {
        for (const detail of event.result.details) {
          log(chalk.dim(`  ${detail}`));
        }
      }
      break;
    case 'boundary_requested':
      if (event.boundary) {
        log('');
        log(chalk.bold('Approval needed'));
        log(chalk.dim(`  Action: ${event.boundary.actionSummary}`));
        if (event.boundary.category) {
          log(chalk.dim(`  Category: ${event.boundary.category}`));
        }
        if (event.boundary.riskLevel) {
          log(chalk.dim(`  Risk: ${event.boundary.riskLevel}`));
        }
        log(chalk.dim(`  Scope: parallel=${event.boundary.scope.parallel}, maxTasks=${event.boundary.scope.maxTasks}`));
        log(chalk.yellow(`  ${event.boundary.reason}`));
        if (event.boundary.nextStepHint) {
          log(chalk.dim(`  If approved: ${event.boundary.nextStepHint}`));
        }
      }
      break;
    case 'redirected':
      log(chalk.dim(event.message));
      break;
    default:
      break;
  }
}

function printOperatorOutcome(
  log: (message?: string) => void,
  result: OperatorRunResult,
  verbose: boolean,
): void {
  log('');
  log(chalk.bold('Report'));
  if (result.status === 'completed') {
    log(chalk.cyan(`  ${result.summary}`));
  } else if (result.status === 'paused') {
    if (result.boundary) {
      log(chalk.yellow(`  Waiting on approval: ${result.boundary.actionSummary}`));
      log(chalk.dim(`  Why: ${result.boundary.reason}`));
      log(chalk.dim(`  Scope: parallel=${result.boundary.scope.parallel}, maxTasks=${result.boundary.scope.maxTasks}`));
    } else {
      log(chalk.yellow(`  ${result.summary}`));
    }
  } else if (result.status === 'blocked' || result.status === 'failed') {
    log(chalk.red(`  ${result.summary}`));
  } else {
    log(chalk.cyan(`  ${result.summary}`));
  }

  if (result.reason) {
    log(chalk.dim(`  Reason: ${result.reason}`));
  }
  if (result.lastFailure) {
    log(chalk.dim(`  Failure source: ${result.lastFailure.source}`));
    if (result.lastFailure.taskId) {
      log(chalk.dim(`  Task: ${result.lastFailure.taskId}`));
    }
    if (result.lastFailure.detail) {
      log(chalk.dim(`  Detail: ${result.lastFailure.detail}`));
    }
  }
  if (result.nextSuggestedAction) {
    log(chalk.dim(`  Next: ${result.nextSuggestedAction}`));
  }
  if (result.recoveryActions && result.recoveryActions.length > 0) {
    log(chalk.bold('  Recovery options:'));
    for (const action of result.recoveryActions) {
      log(chalk.dim(`    - ${action.label}: ${action.description}`));
    }
  }

  if (verbose && result.results.length > 0) {
    log('');
    log(chalk.bold('Technical output'));
    for (const entry of result.results) {
      log(chalk.cyan(`  ${entry.action}: ${entry.summary}`));
      for (const detail of entry.details) {
        log(chalk.dim(`    ${detail}`));
      }
    }
  }
  log('');
}

export default class Root extends Command {
  static override description = 'Continuous conversational repo operator for local planning and execution';
  static override strict = false;

  static override examples = [
    '<%= config.bin %>',
    '<%= config.bin %> --prompt "summarize current progress"',
    '<%= config.bin %> "ship the next milestone"',
    '<%= config.bin %> --prompt "implement auth flow" --yes',
  ];

  static override flags = {
    prompt: Flags.string({
      description: 'One-shot conversational request',
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Auto-confirm policy boundaries',
      default: false,
    }),
    provider: Flags.string({
      description: 'Preferred provider for conversational setup',
      options: [...aiProviderSchema.options],
    }),
    model: Flags.string({
      description: 'Preferred model for conversational setup',
    }),
    'api-key': Flags.string({
      description: 'API key or ${ENV_VAR} reference for conversational setup',
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed tool output',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(Root);
    const cwd = process.cwd();
    await migrateLegacyLedgerIfPresent(cwd);
    const orchestrator = new ConversationalOrchestrator(cwd);
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const prompt = trimOrUndefined(flags.prompt) ?? trimOrUndefined(argv.join(' '));
    let settings = await loadInteractionSettings(cwd);

    if (prompt) {
      if (!interactive && (!settings.config || !hasValidActiveProfile(settings.config, { cwd }))) {
        this.log(chalk.red('No valid active provider profile found. Run `scrimble config set-ai` first.'));
        this.exit(1);
        return;
      }
      if (interactive && (!settings.config || !hasValidActiveProfile(settings.config, { cwd }))) {
        const baseline = settings.config ?? buildDefaultScrimbleConfig(settings.mode, settings.provider ?? 'openai');
        const setupResult = await runProviderSetupStudio({
          config: baseline,
          reason: 'Configure provider setup before running this one-shot request.',
          seed: {
            ...(settings.provider ? { provider: settings.provider } : {}),
            ...(settings.model ? { model: settings.model } : {}),
            ...(settings.profileName ? { profileName: settings.profileName } : {}),
          },
        });
        if (!setupResult) {
          this.log(chalk.yellow('Provider setup cancelled.'));
          this.exit(1);
          return;
        }
        await writeSecureJson(path.join(cwd, SCRIMBLE_DIR, CONFIG_FILE), setupResult.config);
        settings = await loadInteractionSettings(cwd);
      }
    }

    const providerSeed = flags.provider
      ? aiProviderSchema.parse(flags.provider)
      : settings.provider;
    const modelSeed = trimOrUndefined(flags.model) ?? trimOrUndefined(settings.model);
    const apiKeySeed = trimOrUndefined(flags['api-key']) ?? trimOrUndefined(settings.apiKey);
    const setupSeed: AgentSetupInput = {
      ...(settings.profileId ? { profileId: settings.profileId } : {}),
      ...(settings.profileName ? { profileName: settings.profileName } : {}),
      ...(providerSeed ? { provider: providerSeed } : {}),
      ...(settings.modelStrategy ? { modelStrategy: settings.modelStrategy } : {}),
      ...(modelSeed ? { model: modelSeed } : {}),
      ...(settings.authStrategy ? { authStrategy: settings.authStrategy } : {}),
      ...(apiKeySeed ? { apiKey: apiKeySeed } : {}),
      ...(settings.token ? { token: settings.token } : {}),
      ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
      interactionMode: settings.mode,
    };

    if (prompt) {
      const foundationReady = await ensureDiscoveryFoundation({
        cwd,
        prompt,
        interactive,
        autoApprove: flags.yes,
        log: this.log.bind(this),
      });
      if (!foundationReady) {
        this.exit(1);
        return;
      }
      await this.handlePrompt(orchestrator, prompt, {
        autoConfirm: flags.yes,
        interactive,
        verbose: flags.verbose,
        interactionMode: settings.mode,
        setupSeed,
      });
      return;
    }

    if (!interactive) {
      this.log(chalk.red('Provide a request with `scrimble --prompt "<request>"` in non-interactive mode.'));
      this.exit(1);
      return;
    }

    await runOperatorShell({
      cwd,
      orchestrator,
      interactionMode: settings.mode,
      setupSeed,
      autoConfirm: flags.yes,
      verbose: flags.verbose,
      config: settings.config ?? null,
    });
  }

  private ensureSetupForConfigure(options: RunOptions): void {
    const provider = options.setupSeed.provider ?? 'openai';
    const modelStrategy = options.setupSeed.modelStrategy
      ?? (providerSupportsAutoModel(provider) ? 'auto' : 'explicit');
    const authStrategy = options.setupSeed.authStrategy ?? getDefaultAuthStrategy(provider, options.interactive);
    const model = modelStrategy === 'explicit'
      ? (trimOrUndefined(options.setupSeed.model) ?? getDefaultModel(provider))
      : undefined;
    const apiKey = authStrategy === 'api_key'
      ? trimOrUndefined(options.setupSeed.apiKey) ?? getDefaultApiKeyPlaceholder(provider)
      : options.setupSeed.apiKey;
    const token = authStrategy === 'personal_access_token'
      ? trimOrUndefined(options.setupSeed.token) ?? trimOrUndefined(options.setupSeed.apiKey)
      : options.setupSeed.token;
    Object.assign(options.setupSeed, {
      provider,
      modelStrategy,
      ...(model ? { model } : {}),
      authStrategy,
      ...(apiKey ? { apiKey } : {}),
      ...(token ? { token } : {}),
      interactionMode: options.interactionMode,
    });
  }

  private async handlePrompt(
    orchestrator: ConversationalOrchestrator,
    prompt: string,
    options: RunOptions,
  ): Promise<void> {
    const result = await this.runOperator(orchestrator, options, prompt);
    printOperatorOutcome(this.log.bind(this), result, options.verbose);
    if (result.status === 'failed' && !options.interactive) {
      this.exit(1);
    }
  }

  private async runOperator(
    orchestrator: ConversationalOrchestrator,
    options: RunOptions,
    prompt?: string,
  ): Promise<OperatorRunResult> {
    options.setupSeed.interactionMode = options.interactionMode;
    const runOptions = {
      setup: options.setupSeed,
      interactionMode: options.interactionMode,
      autoConfirm: options.autoConfirm,
      resolveBoundary: async (boundary: OperatorBoundary): Promise<OperatorBoundaryResolution> => {
        if (options.autoConfirm) {
          if (boundary.action === 'configure_ai') {
            this.ensureSetupForConfigure(options);
          }
          return { kind: 'proceed' };
        }
        return { kind: 'pause' };
      },
      onEvent: (event: OperatorEvent) => {
        printOperatorEvent(this.log.bind(this), event, options.verbose);
      },
    };
    if (prompt) {
      return orchestrator.runRequest(prompt, runOptions);
    }
    return orchestrator.resumeActiveRun(runOptions);
  }
}
