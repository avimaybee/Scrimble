import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import {
  SCRIMBLE_DIR,
  CONFIG_FILE,
  PROJECT_FILE,
  SESSION_FILE,
  aiProviderSchema,
  scrimbleConfigSchema,
  type InteractionMode,
} from '@scrimble/shared';
import { buildDefaultAIConfig, getDefaultApiKeyPlaceholder } from '../lib/ai/provider.js';
import { recordTelemetry } from '../lib/telemetry.js';
import { pathExists } from '../lib/fs/index.js';
import { detectStack } from '../lib/init/stack-detection.js';
import { setupLocalScaffold } from '../lib/init/local-scaffold.js';

interface ExistingStateAssessment {
  hasExistingDir: boolean;
  isFullyInitialized: boolean;
}

const INTERACTION_MODES: InteractionMode[] = ['guide', 'balanced', 'operator'];

function parseInteractionMode(value: string): InteractionMode {
  if (INTERACTION_MODES.includes(value as InteractionMode)) {
    return value as InteractionMode;
  }
  throw new Error(`Unsupported interaction mode: ${value}`);
}

function promptable(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function promptInteractionMode(
  log: (message?: string) => void,
  current: InteractionMode = 'guide',
): Promise<InteractionMode> {
  const modes = [...INTERACTION_MODES];
  const defaultIndex = Math.max(0, modes.indexOf(current));

  log('');
  log(chalk.bold('How should Scrimble collaborate by default?'));
  log(chalk.dim('  1. guide - plan-first, confirmation-heavy'));
  log(chalk.dim('  2. balanced - confirm before execution'));
  log(chalk.dim('  3. operator - automate routine setup/planning'));

  const rl = createInterface({ input, output });
  try {
    for (;;) {
      const answer = (await rl.question(`Mode [${defaultIndex + 1}]: `)).trim();
      if (!answer) {
        const fallback = modes[defaultIndex];
        return fallback ?? 'guide';
      }
      const numeric = Number.parseInt(answer, 10);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= modes.length) {
        const selected = modes[numeric - 1];
        if (selected) {
          return selected;
        }
      }
      const normalized = answer.toLowerCase();
      if (INTERACTION_MODES.includes(normalized as InteractionMode)) {
        return normalized as InteractionMode;
      }
      log(chalk.yellow(`Invalid mode: ${answer}`));
    }
  } finally {
    rl.close();
  }
}

async function assessExistingScrimbleState(cwd: string): Promise<ExistingStateAssessment> {
  const scrimbleDir = path.join(cwd, SCRIMBLE_DIR);
  const hasExistingDir = await pathExists(scrimbleDir);
  if (!hasExistingDir) {
    return { hasExistingDir: false, isFullyInitialized: false };
  }

  const [hasProjectFile, hasConfigFile] = await Promise.all([
    pathExists(path.join(scrimbleDir, PROJECT_FILE)),
    pathExists(path.join(scrimbleDir, CONFIG_FILE)),
  ]);
  return {
    hasExistingDir: true,
    isFullyInitialized: hasProjectFile && hasConfigFile,
  };
}

export default class Init extends Command {
  static override description = 'Initialize local Scrimble scaffold for conversational orchestration';

  static override examples = [
    '<%= config.bin %> init',
    '<%= config.bin %> init --goal "Ship a stable local orchestrator"',
    '<%= config.bin %> init --ai-provider github-copilot --ai-model gpt-4.1',
    '<%= config.bin %> init --interaction-mode balanced',
  ];

  static override flags = {
    goal: Flags.string({
      char: 'g',
      description: 'Project goal description',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing .scrimble directory',
      default: false,
    }),
    'ai-provider': Flags.string({
      description: 'AI provider to configure',
      options: [...aiProviderSchema.options],
      default: 'openai',
    }),
    'ai-model': Flags.string({
      description: 'AI model (defaults to provider-specific recommended model)',
    }),
    'interaction-mode': Flags.string({
      description: 'Default interaction style for conversation flow',
      options: [...INTERACTION_MODES],
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);

    this.log(chalk.bold('\n🚀 Initializing Scrimble\n'));

    const cwd = process.cwd();
    const scrimbleDir = path.join(cwd, SCRIMBLE_DIR);
    const existingState = await assessExistingScrimbleState(cwd);

    if (existingState.hasExistingDir) {
      if (existingState.isFullyInitialized && !flags.force) {
        this.log(chalk.yellow('  ⚠ .scrimble directory already exists.'));
        this.log(chalk.dim('    Use --force to reinitialize.\n'));
        return;
      }
      if (existingState.isFullyInitialized) {
        this.log(chalk.dim('  Reinitializing existing .scrimble directory...'));
      } else {
        this.log(chalk.dim('  Detected incomplete .scrimble state. Repairing initialization...'));
      }
    }

    const repoName = path.basename(cwd);
    this.log(chalk.dim(`  Repository: ${repoName}`));

    const stack = await detectStack(cwd);
    if (stack.languages.length > 0) {
      this.log(chalk.dim(`  Detected: ${stack.languages.join(', ')}`));
    }
    if (stack.frameworks.length > 0) {
      this.log(chalk.dim(`  Frameworks: ${stack.frameworks.join(', ')}`));
    }

    const selectedProvider = aiProviderSchema.parse(flags['ai-provider']);
    let interactionMode: InteractionMode = flags['interaction-mode']
      ? parseInteractionMode(flags['interaction-mode'])
      : 'guide';
    if (!flags['interaction-mode'] && promptable()) {
      interactionMode = await promptInteractionMode(this.log.bind(this), interactionMode);
    }
    const defaultAIConfig = buildDefaultAIConfig(selectedProvider, flags['ai-model']);
    this.log(chalk.dim(`  AI provider: ${selectedProvider}`));
    this.log(chalk.dim(`  AI model: ${defaultAIConfig.model}`));
    this.log(chalk.dim(`  Interaction mode: ${interactionMode}`));

    let config = scrimbleConfigSchema.parse({
      schemaVersion: 1,
      ai: defaultAIConfig,
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

    let projectData: Record<string, unknown> = {
      name: repoName,
      path: cwd,
      stack,
      initialized: new Date().toISOString(),
      goal: flags.goal ?? null,
      localFirst: true,
    };

    await setupLocalScaffold({
      cwd,
      scrimbleDir,
      repoName,
      stack,
      config,
      projectData,
      ...(flags.goal ? { goal: flags.goal } : {}),
    });

    const sessionPath = path.join(scrimbleDir, SESSION_FILE);
    try {
      await fs.unlink(sessionPath);
      this.log(chalk.dim('  Removed legacy session.json'));
    } catch {
      // no-op when legacy session does not exist
    }

    this.log('');
    this.log(chalk.green('  ✓ .scrimble directory created'));
    this.log(chalk.green('  ✓ config.json created'));
    this.log(chalk.green('  ✓ project.json created'));
    this.log(chalk.green('  ✓ research-summary.md created'));
    this.log(chalk.green('  ✓ runtime/ directory created'));
    this.log('');

    const keyPlaceholder = getDefaultApiKeyPlaceholder(selectedProvider);
    this.log(chalk.bold('Next steps:'));
    this.log(chalk.dim('  1. Run `scrimble` and describe your goal in plain language'));
    this.log(chalk.dim(`  2. If needed, set your API key env var: ${keyPlaceholder.slice(2, -1)}="your-key"`));
    if (selectedProvider === 'github-copilot') {
      this.log(chalk.dim('     GitHub Copilot users: set GITHUB_COPILOT_TOKEN from your Copilot auth/session token.'));
    }
    this.log(chalk.dim('  3. Use `scrimble doctor` for worker readiness diagnostics'));
    this.log('');

    await recordTelemetry({
      event: 'project_initialized',
      payload: {
        provider: selectedProvider,
        model: defaultAIConfig.model,
        localFirst: true,
      },
    });
  }
}
