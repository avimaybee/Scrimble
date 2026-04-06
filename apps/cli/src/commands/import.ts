import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RepoContext } from '@scrimble/shared';
import {
  appendActivity,
  ensureScrimbleDirectories,
  savePlanState,
  writeCurrentChunkFromPlan,
  type LocalChunk,
  type LocalPlanState,
} from '../lib/local/index.js';
import { buildArchitecturePrompt, buildChunkPlanningPrompt } from '../lib/ai/prompts/index.js';
import { recordTelemetry } from '../lib/telemetry.js';

interface StackSnapshot {
  languages: string[];
  frameworks: string[];
}

function detectStackFromFiles(fileNames: Set<string>, packageJsonDeps: Set<string>): StackSnapshot {
  const languages: string[] = [];
  const frameworks: string[] = [];

  if (fileNames.has('package.json')) languages.push('TypeScript/JavaScript');
  if (fileNames.has('pyproject.toml') || fileNames.has('requirements.txt')) languages.push('Python');
  if (fileNames.has('go.mod')) languages.push('Go');
  if (fileNames.has('Cargo.toml')) languages.push('Rust');

  if (packageJsonDeps.has('react')) frameworks.push('React');
  if (packageJsonDeps.has('next')) frameworks.push('Next.js');
  if (packageJsonDeps.has('hono')) frameworks.push('Hono');
  if (packageJsonDeps.has('express')) frameworks.push('Express');
  if (packageJsonDeps.has('@cloudflare/workers-types')) frameworks.push('Cloudflare Workers');

  return { languages, frameworks };
}

function makeImportChunks(goal: string, stack: StackSnapshot): LocalChunk[] {
  const stackSummary = [
    stack.languages.length > 0 ? `Languages: ${stack.languages.join(', ')}` : null,
    stack.frameworks.length > 0 ? `Frameworks: ${stack.frameworks.join(', ')}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' | ');

  const contextSuffix = stackSummary ? `\n\nRepo stack signals: ${stackSummary}.` : '';

  return [
    {
      id: 'chunk-001',
      sequence: 1,
      title: 'Audit current implementation baseline',
      status: 'active',
      prompt: `Map what is already built against the project goal: ${goal}.${contextSuffix}`,
      doneWhen: 'Baseline gaps and strengths are documented in code comments or notes.',
      verificationSignals: ['scrimble verify --command "npm run lint"', 'Updated architecture summary reflects current repo state.'],
    },
    {
      id: 'chunk-002',
      sequence: 2,
      title: 'Close highest-risk implementation gaps',
      status: 'pending',
      prompt: `Implement highest-impact missing pieces needed to achieve: ${goal}.`,
      doneWhen: 'Critical path functionality works end-to-end with clear verification evidence.',
      verificationSignals: ['scrimble verify --command "npm run build"', 'No high-priority blockers remain in activity log.'],
    },
    {
      id: 'chunk-003',
      sequence: 3,
      title: 'Stabilize and prepare for delivery',
      status: 'pending',
      prompt: `Harden reliability, documentation, and release readiness for: ${goal}.`,
      doneWhen: 'Release-readiness checks pass and remaining work is clearly scoped.',
      verificationSignals: ['scrimble status shows all chunks complete or intentionally skipped.'],
    },
  ];
}

export default class Import extends Command {
  static override description = 'Adopt an existing repository into Scrimble with a reality-based plan';

  static override examples = [
    '<%= config.bin %> import --goal "Ship MVP onboarding flow"',
    '<%= config.bin %> import --goal "Stabilize API runtime" --force',
  ];

  static override flags = {
    goal: Flags.string({
      description: 'High-level goal for imported project planning',
      required: true,
    }),
    force: Flags.boolean({
      description: 'Overwrite existing local plan artifacts',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Import);
    const paths = await ensureScrimbleDirectories();

    if (!flags.force) {
      try {
        await fs.access(paths.plan);
        this.log(chalk.yellow('\nA plan already exists. Use --force to replace it.\n'));
        return;
      } catch {
        // expected when no plan exists
      }
    }

    const cwd = process.cwd();
    const fileList = new Set(await fs.readdir(cwd));
    const packageJsonPath = path.join(cwd, 'package.json');
    let deps = new Set<string>();
    try {
      const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      deps = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ]);
    } catch {
      deps = new Set<string>();
    }

    const stack = detectStackFromFiles(fileList, deps);
    const repoContext: RepoContext = {
      name: path.basename(cwd),
      path: cwd,
      stack: {
        languages: stack.languages,
        frameworks: stack.frameworks,
      },
      structure: [],
      existingFiles: Array.from(fileList).sort().slice(0, 50),
    };
    const architectureSummary = [
      `Imported repo objective: ${flags.goal}.`,
      stack.languages.length > 0 ? `Detected languages: ${stack.languages.join(', ')}.` : 'No language signal detected.',
      stack.frameworks.length > 0 ? `Detected frameworks: ${stack.frameworks.join(', ')}.` : 'No framework signal detected.',
      'Approach: preserve existing working behavior, then close high-impact gaps in bounded chunks.',
    ].join('\n');
    const researchSummary = [
      '# Research Summary',
      '',
      `Goal analyzed: ${flags.goal}`,
      stack.languages.length > 0
        ? `Detected languages: ${stack.languages.join(', ')}`
        : 'Detected languages: none',
      stack.frameworks.length > 0
        ? `Detected frameworks: ${stack.frameworks.join(', ')}`
        : 'Detected frameworks: none',
      `Existing top-level files scanned: ${repoContext.existingFiles?.length ?? 0}`,
      '',
      'Initial planning posture: preserve known-good behavior, then close high-risk gaps in bounded chunks.',
    ].join('\n');
    const architecturePrompt = buildArchitecturePrompt({
      projectGoal: flags.goal,
      repoContext,
    });
    const chunkPlanningPrompt = buildChunkPlanningPrompt({
      projectGoal: flags.goal,
      architectureSummary,
      repoContext,
      completedWorkSummary: 'No completed work yet (import baseline).',
      chunkCountTarget: 3,
    });

    const plan: LocalPlanState = {
      version: 1,
      architecture: {
        summary: architectureSummary,
        approved: true,
        approvedAt: new Date().toISOString(),
        notes: 'Auto-approved via import flow from existing repo reality.',
      },
      chunks: makeImportChunks(flags.goal, stack),
      sync: {},
      metadata: {
        importedAt: new Date().toISOString(),
        importMode: 'existing-repo',
      },
    };

    await fs.writeFile(paths.architecture, `${architectureSummary}\n`, 'utf8');
    await fs.writeFile(paths.research, `${researchSummary}\n`, 'utf8');
    await fs.writeFile(path.join(paths.promptsDir, 'architecture-planning.md'), `${architecturePrompt}\n`, 'utf8');
    await fs.writeFile(path.join(paths.promptsDir, 'chunk-planning.md'), `${chunkPlanningPrompt}\n`, 'utf8');
    await savePlanState(plan);
    await writeCurrentChunkFromPlan(plan);
    await appendActivity('project_imported', {
      goal: flags.goal,
      chunkCount: plan.chunks.length,
    });
    await recordTelemetry({
      event: 'project_imported',
      payload: {
        chunkCount: plan.chunks.length,
        languages: stack.languages,
        frameworks: stack.frameworks,
      },
    });

    this.log('');
    this.log(chalk.green('✓ Existing repository imported into Scrimble.'));
    this.log(chalk.dim(`Architecture summary written to ${paths.architecture}`));
    this.log(chalk.dim(`Research summary written to ${paths.research}`));
    this.log(chalk.dim(`Planning prompts written to ${paths.promptsDir}`));
    this.log(chalk.dim('Run `scrimble` to view the active chunk and execution prompt.'));
    this.log('');
  }
}
