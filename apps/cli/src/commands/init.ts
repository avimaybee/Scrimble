import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  SCRIMBLE_DIR,
  CONFIG_FILE,
  PROJECT_FILE,
  aiProviderSchema,
  scrimbleConfigSchema,
} from '@scrimble/shared';
import { buildDefaultAIConfig, getDefaultApiKeyPlaceholder } from '../lib/ai/provider.js';

export default class Init extends Command {
  static override description = 'Initialize Scrimble in the current repository';

  static override examples = [
    '<%= config.bin %> init',
    '<%= config.bin %> init --goal "Build a REST API for user management"',
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
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);

    this.log(chalk.bold('\n🚀 Initializing Scrimble\n'));

    const cwd = process.cwd();
    const scrimbleDir = path.join(cwd, SCRIMBLE_DIR);

    // Check if already initialized
    try {
      await fs.access(scrimbleDir);
      if (!flags.force) {
        this.log(chalk.yellow('  ⚠ .scrimble directory already exists.'));
        this.log(chalk.dim('    Use --force to reinitialize.\n'));
        return;
      }
      this.log(chalk.dim('  Reinitializing existing .scrimble directory...'));
    } catch {
      // Directory doesn't exist, which is expected
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
    this.log(chalk.dim(`  AI provider: ${selectedProvider}`));
    this.log(chalk.dim(`  AI model: ${defaultAIConfig.model}`));

    // Create .scrimble directory structure
    await fs.mkdir(scrimbleDir, { recursive: true });
    await fs.mkdir(path.join(scrimbleDir, 'verification'), { recursive: true });
    await fs.mkdir(path.join(scrimbleDir, 'prompts'), { recursive: true });
    await fs.mkdir(path.join(scrimbleDir, 'rules'), { recursive: true });

    // Create default config
    const defaultConfig = { ai: defaultAIConfig };

    // Validate config structure
    const validatedConfig = scrimbleConfigSchema.parse(defaultConfig);
    
    await fs.writeFile(
      path.join(scrimbleDir, CONFIG_FILE),
      JSON.stringify(validatedConfig, null, 2)
    );

    // Create project.json placeholder
    const projectData = {
      name: repoName,
      path: cwd,
      stack,
      initialized: new Date().toISOString(),
      goal: flags.goal ?? null,
    };

    await fs.writeFile(
      path.join(scrimbleDir, PROJECT_FILE),
      JSON.stringify(projectData, null, 2)
    );

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

    this.log('');
    this.log(chalk.green('  ✓ .scrimble directory created'));
    this.log(chalk.green('  ✓ config.json created'));
    this.log(chalk.green('  ✓ project.json created'));
    this.log('');

    // Next steps
    const keyPlaceholder = getDefaultApiKeyPlaceholder(selectedProvider);
    this.log(chalk.bold('Next steps:'));
    this.log(chalk.dim('  1. Edit .scrimble/config.json to configure your AI provider'));
    this.log(chalk.dim(`  2. Set your API key: export ${keyPlaceholder.slice(2, -1)}="your-key"`));
    if (selectedProvider === 'github-copilot') {
      this.log(chalk.dim('     GitHub Copilot users: set GITHUB_COPILOT_TOKEN from your Copilot auth/session token.'));
    }
    if (!flags.goal) {
      this.log(chalk.dim('  3. Run `scrimble` to start planning your project'));
    } else {
      this.log(chalk.dim('  3. Run `scrimble` to generate your execution plan'));
    }
    this.log('');
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
