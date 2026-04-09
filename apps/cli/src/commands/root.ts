import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';
import { aiProviderSchema, type AIProvider, type InteractionMode } from '@scrimble/shared';
import { buildDefaultAIConfig, getDefaultApiKeyPlaceholder } from '../lib/ai/provider.js';
import { loadScrimbleConfig } from '../lib/config/load-config.js';
import { ConversationalOrchestrator } from '../lib/agent/orchestrator.js';
import type {
  AgentSetupInput,
  OperatorBoundary,
  OperatorBoundaryResolution,
  OperatorEvent,
  OperatorRunResult,
} from '../lib/agent/types.js';

interface RunOptions {
  autoConfirm: boolean;
  interactive: boolean;
  verbose: boolean;
  interactionMode: InteractionMode;
  setupSeed: AgentSetupInput;
  rl?: ReadlineInterface;
}

const MODE_LABELS: Record<InteractionMode, string> = {
  guide: 'guide (plan-first with frequent confirmation)',
  balanced: 'balanced (plan automatically, confirm before execution)',
  operator: 'operator (handle routine steps automatically, pause for higher-risk work)',
};

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function yesNoFromAnswer(answer: string): boolean {
  return /^y(es)?$/i.test(answer.trim());
}

async function loadInteractionMode(cwd: string): Promise<{ mode: InteractionMode; hasConfig: boolean }> {
  try {
    const config = await loadScrimbleConfig(cwd);
    return { mode: config.interactionMode ?? 'guide', hasConfig: true };
  } catch {
    return { mode: 'guide', hasConfig: false };
  }
}

async function askInteractionMode(
  rl: ReadlineInterface,
  log: (message?: string) => void,
  current: InteractionMode,
): Promise<InteractionMode> {
  const options: InteractionMode[] = ['guide', 'balanced', 'operator'];
  const defaultIndex = Math.max(0, options.indexOf(current));
  log(chalk.bold('How hands-on should I be by default?'));
  log(chalk.dim('  1. guide - plan-first, confirmation-heavy'));
  log(chalk.dim('  2. balanced - plan automatically, confirm before execution'));
  log(chalk.dim('  3. operator - handle routine setup/planning, pause for higher-risk work'));

  for (;;) {
    const answer = (await rl.question(`Mode [${defaultIndex + 1}]: `)).trim();
    if (!answer) {
      const fallback = options[defaultIndex];
      if (fallback) {
        return fallback;
      }
      return 'guide';
    }

    const asNumber = Number.parseInt(answer, 10);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= options.length) {
      const selected = options[asNumber - 1];
      if (selected) {
        return selected;
      }
      continue;
    }

    const normalized = answer.toLowerCase() as InteractionMode;
    if (options.includes(normalized)) {
      return normalized;
    }
    log(chalk.yellow(`Invalid mode: ${answer}`));
  }
}

async function askProvider(rl: ReadlineInterface, current?: AIProvider): Promise<AIProvider> {
  const providers = [...aiProviderSchema.options] as AIProvider[];
  const fallback = current ?? 'openai';
  for (;;) {
    const answer = (await rl.question(`Provider [${fallback}]: `)).trim();
    const candidate = (answer || fallback).toLowerCase();
    const parsed = aiProviderSchema.safeParse(candidate);
    if (parsed.success) {
      return parsed.data;
    }
    console.log(chalk.yellow(`Unsupported provider: ${answer}`));
    console.log(chalk.dim(`Available: ${providers.join(', ')}`));
  }
}

async function askWithDefault(rl: ReadlineInterface, label: string, fallback: string): Promise<string> {
  const answer = (await rl.question(`${label} [${fallback}]: `)).trim();
  return answer || fallback;
}

async function askBoundaryDecision(
  rl: ReadlineInterface,
  boundary: OperatorBoundary,
): Promise<OperatorBoundaryResolution> {
  const scope = `parallel=${boundary.scope.parallel}, maxTasks=${boundary.scope.maxTasks}`;
  const answer = (await rl.question(
    `${boundary.actionSummary} now? (${scope}) I will continue with the next safest step after this. [y/N] (or type a new direction): `,
  )).trim();
  if (yesNoFromAnswer(answer)) {
    return { kind: 'proceed' };
  }
  if (!answer || /^(n|no|pause|stop)$/i.test(answer)) {
    return { kind: 'pause' };
  }
  return { kind: 'redirect', request: answer };
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
        log(chalk.dim(`  Scope: parallel=${event.boundary.scope.parallel}, maxTasks=${event.boundary.scope.maxTasks}`));
        log(chalk.yellow(`  ${event.boundary.reason}`));
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
  if (result.nextSuggestedAction) {
    log(chalk.dim(`  Next: ${result.nextSuggestedAction}`));
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
    const orchestrator = new ConversationalOrchestrator(cwd);
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const prompt = trimOrUndefined(flags.prompt) ?? trimOrUndefined(argv.join(' '));
    const { mode: loadedMode, hasConfig } = await loadInteractionMode(cwd);
    let interactionMode: InteractionMode = loadedMode;
    const modelSeed = trimOrUndefined(flags.model);
    const apiKeySeed = trimOrUndefined(flags['api-key']);
    const setupSeed: AgentSetupInput = {
      ...(flags.provider ? { provider: aiProviderSchema.parse(flags.provider) } : {}),
      ...(modelSeed ? { model: modelSeed } : {}),
      ...(apiKeySeed ? { apiKey: apiKeySeed } : {}),
      interactionMode,
    };

    if (prompt) {
      await this.handlePrompt(orchestrator, prompt, {
        autoConfirm: flags.yes,
        interactive,
        verbose: flags.verbose,
        interactionMode,
        setupSeed,
      });
      return;
    }

    if (!interactive) {
      this.log(chalk.red('Provide a request with `scrimble --prompt "<request>"` in non-interactive mode.'));
      this.exit(1);
      return;
    }

    const session = await orchestrator.loadSessionState();
    this.log('');
    this.log(chalk.bold('Scrimble'));
    this.log(chalk.dim(`Mode: ${MODE_LABELS[interactionMode]}`));
    if (session?.activeRun) {
      this.log(chalk.dim(`In-progress request: ${session.activeRun.request}`));
      if (session.activeRun.pendingBoundary) {
        this.log(chalk.dim(`Waiting on approval: ${session.activeRun.pendingBoundary.actionSummary}`));
        this.log(chalk.dim(`Reason: ${session.activeRun.pendingBoundary.reason}`));
      } else if (session.activeRun.lastPauseReason) {
        this.log(chalk.dim(`Last pause: ${session.activeRun.lastPauseReason}`));
      }
    } else if (session?.lastRunOutcome) {
      this.log(chalk.dim(`Last outcome: ${session.lastRunOutcome.summary}`));
    } else if (session?.lastExecutionSummary) {
      this.log(chalk.dim(`Last execution: ${session.lastExecutionSummary.summary}`));
    }
    this.log(chalk.dim('Tell me what you want to get done. Type "exit" to quit.'));
    this.log('');

    const rl = createInterface({ input, output });
    try {
      let firstTurn = true;
      let needsModeOnboarding = !hasConfig;
      if (session?.activeRun) {
        if (firstTurn && needsModeOnboarding) {
          this.log('');
          interactionMode = await askInteractionMode(rl, this.log.bind(this), interactionMode);
          setupSeed.interactionMode = interactionMode;
          this.log(chalk.dim(`Got it. I'll default to ${MODE_LABELS[interactionMode]}.`));
          this.log('');
          needsModeOnboarding = false;
        }

        const resumePrompt = session.activeRun.pendingBoundary
          ? 'Resume the pending approval now? [Y/n] '
          : 'Resume the in-progress request now? [Y/n] ';
        const resumeAnswer = (await rl.question(chalk.cyan(resumePrompt))).trim();
        if (!resumeAnswer || yesNoFromAnswer(resumeAnswer)) {
          await this.resumeRun(orchestrator, {
            autoConfirm: flags.yes,
            interactive: true,
            verbose: flags.verbose,
            interactionMode,
            setupSeed,
            rl,
          });
          firstTurn = false;
        } else if (!/^(n|no)$/i.test(resumeAnswer)) {
          await this.handlePrompt(orchestrator, resumeAnswer, {
            autoConfirm: flags.yes,
            interactive: true,
            verbose: flags.verbose,
            interactionMode,
            setupSeed,
            rl,
          });
          firstTurn = false;
        }
      }

      for (;;) {
        const promptLabel = firstTurn
          ? 'What are you trying to get done? '
          : 'What should we tackle next? ';
        const userInput = (await rl.question(chalk.cyan(promptLabel))).trim();
        if (!userInput) {
          continue;
        }
        if (/^(exit|quit)$/i.test(userInput)) {
          this.log('');
          break;
        }

        if (firstTurn && needsModeOnboarding) {
          this.log('');
          interactionMode = await askInteractionMode(rl, this.log.bind(this), interactionMode);
          setupSeed.interactionMode = interactionMode;
          this.log(chalk.dim(`Got it. I'll default to ${MODE_LABELS[interactionMode]}.`));
          this.log('');
          needsModeOnboarding = false;
        }

        await this.handlePrompt(orchestrator, userInput, {
          autoConfirm: flags.yes,
          interactive: true,
          verbose: flags.verbose,
          interactionMode,
          setupSeed,
          rl,
        });
        firstTurn = false;
      }
    } finally {
      rl.close();
    }
  }

  private async ensureSetupForConfigure(options: RunOptions): Promise<void> {
    const providerFromSeed = options.setupSeed.provider;
    const modelFromSeed = trimOrUndefined(options.setupSeed.model);
    const apiKeyFromSeed = trimOrUndefined(options.setupSeed.apiKey);

    if (!options.interactive || !options.rl) {
      const provider = providerFromSeed ?? 'openai';
      const model = modelFromSeed ?? buildDefaultAIConfig(provider).model;
      const apiKey = apiKeyFromSeed ?? getDefaultApiKeyPlaceholder(provider);
      Object.assign(options.setupSeed, { provider, model, apiKey, interactionMode: options.interactionMode });
      return;
    }

    const provider = providerFromSeed ?? await askProvider(options.rl, 'openai');
    const model = modelFromSeed ?? await askWithDefault(options.rl, 'Model', buildDefaultAIConfig(provider).model);
    const apiKey =
      apiKeyFromSeed ??
      await askWithDefault(options.rl, 'API key or ${ENV_VAR}', getDefaultApiKeyPlaceholder(provider));
    Object.assign(options.setupSeed, { provider, model, apiKey, interactionMode: options.interactionMode });
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

  private async resumeRun(
    orchestrator: ConversationalOrchestrator,
    options: RunOptions,
  ): Promise<void> {
    const result = await this.runOperator(orchestrator, options);
    printOperatorOutcome(this.log.bind(this), result, options.verbose);
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
            await this.ensureSetupForConfigure(options);
          }
          return { kind: 'proceed' };
        }
        if (!options.interactive || !options.rl) {
          return { kind: 'pause' };
        }
        const decision = await askBoundaryDecision(options.rl, boundary);
        if (decision.kind === 'proceed' && boundary.action === 'configure_ai') {
          await this.ensureSetupForConfigure(options);
        }
        return decision;
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
