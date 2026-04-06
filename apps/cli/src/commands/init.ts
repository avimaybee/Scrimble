import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  SCRIMBLE_DIR,
  CONFIG_FILE,
  PROJECT_FILE,
  RESEARCH_FILE,
  aiProviderSchema,
  scrimbleConfigSchema,
} from '@scrimble/shared';
import {
  CloudApiError,
  formatCloudError,
  getPlanRegistryState,
  getProject,
  listProjects,
  resolveCloudClientConfig,
} from '../lib/api/index.js';
import { buildDefaultAIConfig, getDefaultApiKeyPlaceholder } from '../lib/ai/provider.js';
import { savePlanState, type LocalPlanState, writeCurrentChunkFromPlan } from '../lib/local/index.js';
import { writeSecureJson } from '../lib/security.js';
import { recordTelemetry } from '../lib/telemetry.js';

function normalizeProjectId(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized.length > 0 ? normalized : 'project';
}

function isLocalPlanState(value: unknown): value is LocalPlanState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { version?: unknown; chunks?: unknown };
  return typeof candidate.version === 'number' && Array.isArray(candidate.chunks);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export default class Init extends Command {
  static override description = 'Initialize Scrimble in the current repository';

  static override examples = [
    '<%= config.bin %> init',
    '<%= config.bin %> init --goal "Build a REST API for user management"',
    '<%= config.bin %> init --project-id my-project --from-cloud',
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
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);

    this.log(chalk.bold('\n🚀 Initializing Scrimble\n'));

    const cwd = process.cwd();
    const scrimbleDir = path.join(cwd, SCRIMBLE_DIR);

    const scrimbleDirExists = await pathExists(scrimbleDir);
    if (scrimbleDirExists) {
      const hasProjectFile = await pathExists(path.join(scrimbleDir, PROJECT_FILE));
      const hasConfigFile = await pathExists(path.join(scrimbleDir, CONFIG_FILE));
      const fullyInitialized = hasProjectFile && hasConfigFile;

      if (fullyInitialized && !flags.force) {
        this.log(chalk.yellow('  ⚠ .scrimble directory already exists.'));
        this.log(chalk.dim('    Use --force to reinitialize.\n'));
        return;
      }

      if (fullyInitialized) {
        this.log(chalk.dim('  Reinitializing existing .scrimble directory...'));
      } else {
        this.log(chalk.dim('  Detected incomplete .scrimble state. Repairing initialization...'));
      }
    }

    // Detect repository info
    const repoName = path.basename(cwd);
    this.log(chalk.dim(`  Repository: ${repoName}`));

    // Detect stack
    const stack = await this.detectStack(cwd);
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

    // Create .scrimble directory structure
    await fs.mkdir(scrimbleDir, { recursive: true });
    await fs.mkdir(path.join(scrimbleDir, 'verification'), { recursive: true });
    await fs.mkdir(path.join(scrimbleDir, 'prompts'), { recursive: true });
    await fs.mkdir(path.join(scrimbleDir, 'rules'), { recursive: true });

    // Create default config
    const defaultCloudEndpoint = 'https://api.scrimble.dev';
    const defaultConfig = {
      ai: defaultAIConfig,
      auth: {
        provider: 'custom',
        clientId: 'scrimble-cli',
        deviceCodeEndpoint: `${defaultCloudEndpoint}/oauth/device/code`,
        tokenEndpoint: `${defaultCloudEndpoint}/oauth/token`,
        scope: 'scrimble:cli',
      },
      cloudEndpoint: defaultCloudEndpoint,
      ...(explicitProjectId ? { projectId: explicitProjectId } : {}),
    };

    // Validate config structure
    let validatedConfig = scrimbleConfigSchema.parse(defaultConfig);
    
    // Create project.json placeholder
    let projectData: Record<string, unknown> = {
      name: repoName,
      path: cwd,
      stack,
      initialized: new Date().toISOString(),
      goal: flags.goal ?? null,
    };

    await writeSecureJson(path.join(scrimbleDir, CONFIG_FILE), validatedConfig);
    await writeSecureJson(path.join(scrimbleDir, PROJECT_FILE), projectData);

    // Create .gitignore for sensitive files
    const gitignoreContent = `# Scrimble sensitive files
session.json
*.log
`;
    await fs.writeFile(path.join(scrimbleDir, '.gitignore'), gitignoreContent);

    // Create agent context file
    const agentContext = `# Scrimble Agent Context

This file provides context for AI coding agents working on this project.

## Project
- Name: ${repoName}
- Goal: ${flags.goal ?? 'Not specified yet'}

## Stack
- Languages: ${stack.languages.join(', ') || 'Unknown'}
- Frameworks: ${stack.frameworks.join(', ') || 'None detected'}

## Current Status
Run \`scrimble\` to see the current execution chunk and what to work on next.

## Rules
- Follow the current chunk prompt exactly
- Do not modify files listed in "Do Not Touch"
- Complete the "Done When" conditions before marking complete
`;
    await fs.writeFile(path.join(scrimbleDir, 'rules', 'agent-context.md'), agentContext);
    const researchSummary = `# Research Summary

No dedicated research findings captured yet.

## Initial Context
- Goal: ${flags.goal ?? 'Not specified yet'}
- Repository: ${repoName}
- Captured At: ${new Date().toISOString()}
`;
    await fs.writeFile(path.join(scrimbleDir, RESEARCH_FILE), researchSummary);

    let bootstrapWarning: string | undefined;
    let bootstrapSummary:
      | {
        projectId: string;
        importedPlan: boolean;
      }
      | undefined;
    if (flags['from-cloud']) {
      try {
        const cloud = await resolveCloudClientConfig(cwd);
        if (!cloud.accessToken) {
          bootstrapWarning = 'Cloud bootstrap skipped (no active session). Run `scrimble login` first.';
        } else {
          let targetProjectId = explicitProjectId ?? cloud.projectId;
          let cloudProject: Awaited<ReturnType<typeof getProject>> | undefined;

          try {
            cloudProject = await getProject(cloud, targetProjectId);
          } catch (error) {
            const notFound = error instanceof CloudApiError && error.status === 404;
            if (!notFound || explicitProjectId) {
              throw error;
            }

            const cloudProjects = await listProjects(cloud);
            if (cloudProjects.length === 1) {
              const onlyProject = cloudProjects[0];
              if (!onlyProject) {
                throw new Error('Cloud project lookup returned an empty result.');
              }
              targetProjectId = onlyProject.id;
              cloudProject = onlyProject;
            } else if (cloudProjects.length > 1) {
              const projectIds = cloudProjects.map((project) => project.id).join(', ');
              bootstrapWarning = `Cloud bootstrap skipped (multiple projects found: ${projectIds}). Re-run with --project-id <id>.`;
            } else {
              bootstrapWarning = 'Cloud bootstrap skipped (no cloud projects found for this account).';
            }
          }

          if (cloudProject) {
            validatedConfig = scrimbleConfigSchema.parse({
              ...validatedConfig,
              projectId: targetProjectId,
            });
            await writeSecureJson(path.join(scrimbleDir, CONFIG_FILE), validatedConfig);

            projectData = {
              ...projectData,
              id: cloudProject.id,
              name: cloudProject.name,
              goal: cloudProject.goal ?? projectData['goal'] ?? null,
              status: cloudProject.status,
              bootstrappedFromCloudAt: new Date().toISOString(),
            };
            await writeSecureJson(path.join(scrimbleDir, PROJECT_FILE), projectData);

            const registry = await getPlanRegistryState({
              ...cloud,
              projectId: targetProjectId,
            });

            let importedPlan = false;
            if (registry.latest && isLocalPlanState(registry.latest.plan)) {
              await savePlanState(registry.latest.plan, cwd);
              await writeCurrentChunkFromPlan(registry.latest.plan, cwd);
              importedPlan = true;
            }

            bootstrapSummary = {
              projectId: targetProjectId,
              importedPlan,
            };
          }
        }
      } catch (error) {
        bootstrapWarning = `Cloud bootstrap skipped: ${formatCloudError(error)}`;
      }
    }

    this.log('');
    this.log(chalk.green('  ✓ .scrimble directory created'));
    this.log(chalk.green('  ✓ config.json created'));
    this.log(chalk.green('  ✓ project.json created'));
    this.log(chalk.green('  ✓ research-summary.md created'));
    if (bootstrapSummary) {
      this.log(chalk.green(`  ✓ Cloud project linked: ${bootstrapSummary.projectId}`));
      if (bootstrapSummary.importedPlan) {
        this.log(chalk.green('  ✓ Pulled canonical plan from cloud'));
      } else {
        this.log(chalk.dim('  Cloud project found but no canonical plan revision exists yet.'));
      }
    } else if (bootstrapWarning) {
      this.log(chalk.yellow(`  ⚠ ${bootstrapWarning}`));
    }
    this.log('');

    // Next steps
    const keyPlaceholder = getDefaultApiKeyPlaceholder(selectedProvider);
    this.log(chalk.bold('Next steps:'));
    this.log(chalk.dim('  1. Edit .scrimble/config.json to configure your AI provider'));
    this.log(chalk.dim(`  2. Set your API key: export ${keyPlaceholder.slice(2, -1)}="your-key"`));
    if (selectedProvider === 'github-copilot') {
      this.log(chalk.dim('     GitHub Copilot users: set GITHUB_COPILOT_TOKEN from your Copilot auth/session token.'));
    }
    this.log(chalk.dim('  3. Authenticate: `scrimble login`'));
    if (!flags.goal) {
      this.log(chalk.dim('  4. Run `scrimble` to start planning your project'));
    } else {
      this.log(chalk.dim('  4. Run `scrimble` to generate your execution plan'));
    }
    this.log('');

    await recordTelemetry({
      event: 'project_initialized',
      payload: {
        provider: selectedProvider,
        model: defaultAIConfig.model,
      },
    });
  }

  private async detectStack(cwd: string): Promise<{ languages: string[]; frameworks: string[]; packageManager?: string }> {
    const languages: string[] = [];
    const frameworks: string[] = [];
    let packageManager: string | undefined = undefined;

    const fileList = await fs.readdir(cwd).catch(() => [] as string[]);
    const files = new Set(fileList);

    // Detect package managers and languages
    if (files.has('package.json')) {
      languages.push('TypeScript/JavaScript');
      
      try {
        const pkgContent = await fs.readFile(path.join(cwd, 'package.json'), 'utf-8');
        const pkg = JSON.parse(pkgContent) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        
        // Detect package manager
        if (files.has('pnpm-lock.yaml')) packageManager = 'pnpm';
        else if (files.has('yarn.lock')) packageManager = 'yarn';
        else if (files.has('package-lock.json')) packageManager = 'npm';
        else if (files.has('bun.lockb')) packageManager = 'bun';

        // Detect frameworks from dependencies
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps['next']) frameworks.push('Next.js');
        if (allDeps['react']) frameworks.push('React');
        if (allDeps['vue']) frameworks.push('Vue');
        if (allDeps['svelte']) frameworks.push('Svelte');
        if (allDeps['express']) frameworks.push('Express');
        if (allDeps['hono']) frameworks.push('Hono');
        if (allDeps['fastify']) frameworks.push('Fastify');
        if (allDeps['@cloudflare/workers-types']) frameworks.push('Cloudflare Workers');
      } catch {
        // Ignore JSON parse errors
      }
    }

    if (files.has('requirements.txt') || files.has('pyproject.toml') || files.has('setup.py')) {
      languages.push('Python');
    }

    if (files.has('go.mod')) {
      languages.push('Go');
    }

    if (files.has('Cargo.toml')) {
      languages.push('Rust');
    }

    if (files.has('Gemfile')) {
      languages.push('Ruby');
    }

    const result: { languages: string[]; frameworks: string[]; packageManager?: string } = { languages, frameworks };
    if (packageManager !== undefined) {
      result.packageManager = packageManager;
    }
    return result;
  }
}
