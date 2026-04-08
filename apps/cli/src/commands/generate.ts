import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import type { ContextArtifact, WorkerKind } from '@scrimble/shared';
import { appendActivity } from '../lib/local/index.js';
import { loadScrimbleConfig } from '../lib/config/load-config.js';
import { captureIntent } from '../lib/planning/intent.js';
import { generateTaskGraph } from '../lib/planning/generator.js';
import { detectStack } from '../lib/init/stack-detection.js';
import { getWorkerDriver } from '../lib/workers/factory.js';
import {
  loadLedgerApprovalState,
  loadAssignmentsState,
  loadFileLeasesState,
  loadTasksState,
  saveLedgerApprovalState,
  saveAssignmentsState,
  saveFileLeasesState,
  saveTasksState,
} from '../lib/ledger/storage.js';
import { appendLedgerEvent } from '../lib/ledger/records.js';
import { recordTelemetry } from '../lib/telemetry.js';

async function promptForGoal(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Generation goal is required. Provide --goal when running non-interactively.');
  }

  const rl = createInterface({ input, output });
  try {
    const goal = (await rl.question('What should Scrimble generate a plan for? ')).trim();
    if (!goal) {
      throw new Error('Generation goal is required.');
    }
    return goal;
  } finally {
    rl.close();
  }
}

async function listTopLevelDirectories(cwd: string): Promise<string[]> {
  const entries = await fs.readdir(cwd, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 12);
}

async function discoverArtifacts(cwd: string): Promise<ContextArtifact[]> {
  const workers: WorkerKind[] = ['gemini', 'copilot'];
  const artifacts: ContextArtifact[] = [];

  for (const worker of workers) {
    const driver = getWorkerDriver(worker, { cwd });
    const preflight = await driver.preflight();
    if (!preflight.available) {
      continue;
    }
    const discovered = await driver.discoverContextArtifacts();
    artifacts.push(...discovered);
  }

  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    if (seen.has(artifact.path)) {
      return false;
    }
    seen.add(artifact.path);
    return true;
  });
}

export default class Generate extends Command {
  static override description = 'Generate or replan a local ledger task graph';

  static override examples = [
    '<%= config.bin %> generate "Add user authentication"',
    '<%= config.bin %> generate --goal "Ship stable runtime"',
    '<%= config.bin %> generate --goal "Tighten retries and leases" --replan',
  ];

  static override flags = {
    goal: Flags.string({
      description: 'Goal describing the task graph to produce',
    }),
    replan: Flags.boolean({
      description: 'Replace remaining non-completed tasks with a freshly generated graph',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(Generate);
    let goal = (flags.goal ?? argv.join(' ')).trim();
    if (!goal) {
      goal = await promptForGoal();
    }

    const cwd = process.cwd();
    const repoName = path.basename(cwd);
    const stack = await detectStack(cwd);
    const keyDirectories = await listTopLevelDirectories(cwd);
    const artifacts = await discoverArtifacts(cwd);

    const intent = await captureIntent(
      {
        initialGoal: goal,
        repoContext: {
          name: repoName,
          frameworks: stack.frameworks,
          keyDirectories,
          ...(stack.languages[0] ? { primaryLanguage: stack.languages[0] } : {}),
        },
      },
      cwd,
    );

    let workerPreferences: { defaultWorker?: WorkerKind; allowParallel: boolean; maxParallelWorkers: number } = {
      allowParallel: false,
      maxParallelWorkers: 1,
    };
    try {
      const config = await loadScrimbleConfig(cwd);
      const defaultWorker =
        config.workerPreferences?.defaultWorker === 'gemini' || config.workerPreferences?.defaultWorker === 'copilot'
          ? config.workerPreferences.defaultWorker
          : undefined;
      workerPreferences = {
        allowParallel: config.workerPreferences?.allowParallel ?? false,
        maxParallelWorkers: config.workerPreferences?.maxParallelWorkers ?? 1,
        ...(defaultWorker ? { defaultWorker } : {}),
      };
    } catch {
      // keep defaults when config is not yet present
    }

    const generated = generateTaskGraph({
      intent,
      repoContext: {
        name: repoName,
        frameworks: stack.frameworks,
        keyDirectories,
        ...(stack.languages[0] ? { primaryLanguage: stack.languages[0] } : {}),
      },
      existingFiles: [],
      contextArtifacts: artifacts.map((artifact) => ({
        path: artifact.path,
        kind: artifact.kind,
      })),
      workerPreferences,
    });

    const currentTasks = await loadTasksState(cwd);
    const currentAssignments = await loadAssignmentsState(cwd);
    const currentLeases = await loadFileLeasesState(cwd);
    const currentApproval = await loadLedgerApprovalState(cwd);
    const completedTasks = flags.replan ? currentTasks.tasks.filter((task) => task.status === 'completed') : [];
    const completedTaskIds = new Set(completedTasks.map((task) => task.id));
    const freshTasks = generated.graph.tasks.filter((task) => !completedTaskIds.has(task.id));
    const nextTasks = [...completedTasks, ...freshTasks];

    await saveTasksState(
      {
        version: currentTasks.version,
        tasks: nextTasks,
        updatedAt: new Date().toISOString(),
      },
      cwd,
    );
    await saveAssignmentsState(
      {
        version: currentAssignments.version,
        assignments: [],
        updatedAt: new Date().toISOString(),
      },
      cwd,
    );
    await saveFileLeasesState(
      {
        version: currentLeases.version,
        leases: [],
        updatedAt: new Date().toISOString(),
      },
      cwd,
    );
    await saveLedgerApprovalState(
      {
        ...currentApproval,
        approved: false,
        updatedAt: new Date().toISOString(),
      },
      cwd,
    );

    await appendLedgerEvent(
      flags.replan ? 'task_retried' : 'task_created',
      {
        goal,
        generatedTasks: freshTasks.length,
        preservedCompletedTasks: completedTasks.length,
        approvalReset: true,
      },
      cwd,
    );
    await appendActivity(
      flags.replan ? 'ledger_replanned' : 'ledger_generated',
      {
        goal,
        generatedTasks: freshTasks.length,
        preservedCompletedTasks: completedTasks.length,
        contextArtifactCount: artifacts.length,
      },
      cwd,
    );
    await recordTelemetry({
      event: flags.replan ? 'ledger_replanned' : 'ledger_generated',
      payload: {
        generatedTasks: freshTasks.length,
        preservedCompletedTasks: completedTasks.length,
        contextArtifactCount: artifacts.length,
        approvalReset: true,
      },
    });

    this.log('');
    this.log(chalk.green(flags.replan ? '✓ Local task graph replanned.' : '✓ Local task graph generated.'));
    this.log(chalk.dim(`Goal: ${goal}`));
    this.log(chalk.dim(`Tasks ready: ${nextTasks.length}`));
    if (generated.warnings.length > 0) {
      for (const warning of generated.warnings) {
        this.log(chalk.yellow(`⚠ ${warning}`));
      }
    }
    this.log(chalk.dim('Run `scrimble approve` then `scrimble run --worker auto` to execute tasks.'));
    this.log('');
  }
}

