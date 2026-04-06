import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as path from 'node:path';
import {
  SCRIMBLE_DIR,
  CONFIG_FILE,
  PROJECT_FILE,
  aiProviderSchema,
  scrimbleConfigSchema,
  DEFAULT_CLOUD_ENDPOINT,
} from '@scrimble/shared';
import { buildDefaultAIConfig, getDefaultApiKeyPlaceholder } from '../lib/ai/provider.js';
import { recordTelemetry } from '../lib/telemetry.js';
import { runPreflight } from '../lib/gemini/index.js';
import { loadConductorWorkspace, getActiveTrack } from '../lib/conductor/index.js';
import { pathExists } from '../lib/fs/index.js';
import { detectStack } from '../lib/init/stack-detection.js';
import { setupLocalScaffold } from '../lib/init/local-scaffold.js';
import { maybeBootstrapFromCloud } from '../lib/init/cloud-bootstrap.js';

function normalizeProjectId(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized.length > 0 ? normalized : 'project';
}

interface ExistingStateAssessment {
  hasExistingDir: boolean;
  isFullyInitialized: boolean;
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

async function runPreflightChecks(
  cwd: string,
  skipPreflight: boolean,
  log: (message?: string) => void,
): Promise<Awaited<ReturnType<typeof runPreflight>> | null> {
  if (skipPreflight) {
    return null;
  }

  log('');
  log(chalk.bold('Gemini Preflight:'));
  const preflight = await runPreflight(cwd);

  if (preflight.gemini.available) {
    log(chalk.green(`  ✓ Gemini CLI: v${preflight.gemini.version ?? 'unknown'}`));
  } else {
    log(chalk.yellow('  ⚠ Gemini CLI: not found'));
  }

  if (preflight.headlessAuth.available) {
    log(chalk.green('  ✓ Headless auth: available'));
  } else {
    log(chalk.yellow('  ⚠ Headless auth: not configured'));
  }

  if (preflight.conductor.installed && preflight.conductor.enabled) {
    log(chalk.green('  ✓ Conductor extension: installed'));
  } else if (preflight.conductor.installed) {
    log(chalk.yellow('  ⚠ Conductor extension: installed but disabled'));
  } else {
    log(chalk.yellow('  ⚠ Conductor extension: not installed'));
  }

  if (preflight.folderTrust.enabled && !preflight.folderTrust.workspaceTrusted) {
    log(chalk.yellow('  ⚠ Workspace is not in Gemini trusted folders'));
  }

  for (const warning of preflight.warnings) {
    log(chalk.yellow(`  ⚠ ${warning}`));
  }

  return preflight;
}

export default class Init extends Command {
  static override description = 'Initialize Scrimble in the current repository with Gemini-Conductor integration';

  static override examples = [
    '<%= config.bin %> init',
    '<%= config.bin %> init --goal "Build a REST API for user management"',
    '<%= config.bin %> init --project-id my-project --from-cloud',
    '<%= config.bin %> init --skip-preflight',
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
    'from-cloud': Flags.boolean({
      description: 'Bootstrap from authenticated cloud project and canonical plan registry',
      default: true,
      allowNo: true,
    }),
    'project-id': Flags.string({
      description: 'Cloud project id to bootstrap (defaults to repo slug)',
    }),
    'skip-preflight': Flags.boolean({
      description: 'Skip Gemini/Conductor preflight checks',
      default: false,
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
    const defaultAIConfig = buildDefaultAIConfig(selectedProvider, flags['ai-model']);
    const explicitProjectId = flags['project-id'] ? normalizeProjectId(flags['project-id']) : undefined;
    this.log(chalk.dim(`  AI provider: ${selectedProvider}`));
    this.log(chalk.dim(`  AI model: ${defaultAIConfig.model}`));

    const conductorWorkspace = await loadConductorWorkspace(cwd);
    if (conductorWorkspace.exists) {
      this.log(chalk.green('  ✓ Conductor workspace detected'));
      const activeTrack = getActiveTrack(conductorWorkspace);
      if (activeTrack) {
        this.log(chalk.dim(`    Active track: ${activeTrack.title}`));
      }
      this.log(chalk.dim(`    Tracks: ${conductorWorkspace.tracks.length}`));
    } else {
      this.log(chalk.dim('  No conductor/ workspace found'));
    }

    const preflight = await runPreflightChecks(cwd, flags['skip-preflight'], this.log.bind(this));
    if (preflight && !preflight.canProceed && !conductorWorkspace.exists) {
      this.log('');
      this.log(chalk.red('  ✗ Preflight failed and no Conductor workspace is available.'));
      this.log(chalk.dim('    Resolve the errors above, or run with --skip-preflight to initialize local scaffolding only.'));
      this.log('');
      return;
    }

    let config = scrimbleConfigSchema.parse({
      ai: defaultAIConfig,
      auth: {
        provider: 'custom',
        clientId: 'scrimble-cli',
        deviceCodeEndpoint: `${DEFAULT_CLOUD_ENDPOINT}/oauth/device/code`,
        tokenEndpoint: `${DEFAULT_CLOUD_ENDPOINT}/oauth/token`,
        scope: 'scrimble:cli',
      },
      cloudEndpoint: DEFAULT_CLOUD_ENDPOINT,
      ...(explicitProjectId ? { projectId: explicitProjectId } : {}),
    });

    let projectData: Record<string, unknown> = {
      name: repoName,
      path: cwd,
      stack,
      initialized: new Date().toISOString(),
      goal: flags.goal ?? null,
      conductor: {
        exists: conductorWorkspace.exists,
        trackCount: conductorWorkspace.tracks.length,
        ...(conductorWorkspace.exists ? { detectedAt: new Date().toISOString() } : {}),
      },
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

    const bootstrap = await maybeBootstrapFromCloud({
      cwd,
      scrimbleDir,
      enabled: flags['from-cloud'],
      config,
      projectData,
      ...(explicitProjectId ? { explicitProjectId } : {}),
    });
    config = bootstrap.config;
    projectData = bootstrap.projectData;

    this.log('');
    this.log(chalk.green('  ✓ .scrimble directory created'));
    this.log(chalk.green('  ✓ config.json created'));
    this.log(chalk.green('  ✓ project.json created'));
    this.log(chalk.green('  ✓ research-summary.md created'));
    this.log(chalk.green('  ✓ runtime/ directory created'));
    if (conductorWorkspace.exists) {
      this.log(chalk.green(`  ✓ Conductor workspace adopted (${conductorWorkspace.tracks.length} tracks)`));
    }
    if (bootstrap.summary) {
      this.log(chalk.green(`  ✓ Cloud project linked: ${bootstrap.summary.projectId}`));
      if (bootstrap.summary.importedPlan) {
        this.log(chalk.green('  ✓ Pulled canonical plan from cloud'));
      } else {
        this.log(chalk.dim('  Cloud project found but no canonical plan revision exists yet.'));
      }
    } else if (bootstrap.warning) {
      this.log(chalk.yellow(`  ⚠ ${bootstrap.warning}`));
    }
    this.log('');

    const keyPlaceholder = getDefaultApiKeyPlaceholder(selectedProvider);
    this.log(chalk.bold('Next steps:'));
    if (conductorWorkspace.exists) {
      this.log(chalk.dim('  1. Run `scrimble status` to see Conductor track state'));
      this.log(chalk.dim('  2. Run `scrimble approve <track>` to approve a track for execution'));
      this.log(chalk.dim('  3. Run `scrimble run` to start autonomous execution'));
    } else {
      this.log(chalk.dim('  1. Edit .scrimble/config.json to configure your AI provider'));
      this.log(chalk.dim(`  2. Set your API key: export ${keyPlaceholder.slice(2, -1)}="your-key"`));
      if (selectedProvider === 'github-copilot') {
        this.log(chalk.dim('     GitHub Copilot users: set GITHUB_COPILOT_TOKEN from your Copilot auth/session token.'));
      }
      this.log(chalk.dim('  3. Authenticate: `scrimble login`'));
      this.log(chalk.dim('  4. Run `scrimble generate` to create a Conductor track'));
    }
    this.log('');

    await recordTelemetry({
      event: 'project_initialized',
      payload: {
        provider: selectedProvider,
        model: defaultAIConfig.model,
        conductorExists: conductorWorkspace.exists,
        conductorTracks: conductorWorkspace.tracks.length,
        projectId:
          (typeof projectData['id'] === 'string' ? projectData['id'] : config.projectId) ?? null,
      },
    });
  }
}
