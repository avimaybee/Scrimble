import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ContextArtifact, WorkerKind } from '@scrimble/shared';
import { appendActivity } from '../local/index.js';
import { loadScrimbleConfig } from '../config/load-config.js';
import { captureIntent } from './intent.js';
import { generateTaskGraph } from './generator.js';
import { detectStack } from '../init/stack-detection.js';
import { getWorkerDriver } from '../workers/factory.js';
import {
  readLedger,
  writeLedger,
} from '../ledger/storage.js';
import { appendLedgerEvent } from '../ledger/records.js';
import { recordTelemetry } from '../telemetry.js';

export interface GenerateLedgerTasksInput {
  goal: string;
  replan?: boolean;
  cwd?: string;
}

export interface GenerateLedgerTasksResult {
  goal: string;
  totalTasks: number;
  generatedTasks: number;
  preservedCompletedTasks: number;
  warnings: string[];
  suggestions: string[];
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

async function loadWorkerPreferences(cwd: string): Promise<{
  defaultWorker?: WorkerKind;
  allowParallel: boolean;
  maxParallelWorkers: number;
}> {
  try {
    const config = await loadScrimbleConfig(cwd);
    const defaultWorker =
      config.workerPreferences?.defaultWorker === 'gemini' || config.workerPreferences?.defaultWorker === 'copilot'
        ? config.workerPreferences.defaultWorker
        : undefined;
    return {
      allowParallel: config.workerPreferences?.allowParallel ?? false,
      maxParallelWorkers: config.workerPreferences?.maxParallelWorkers ?? 1,
      ...(defaultWorker ? { defaultWorker } : {}),
    };
  } catch {
    return {
      allowParallel: false,
      maxParallelWorkers: 1,
    };
  }
}

export async function generateLedgerTasks(input: GenerateLedgerTasksInput): Promise<GenerateLedgerTasksResult> {
  const cwd = input.cwd ?? process.cwd();
  const goal = input.goal.trim();
  if (!goal) {
    throw new Error('Generation goal is required.');
  }

  const repoName = path.basename(cwd);
  const stack = await detectStack(cwd);
  const keyDirectories = await listTopLevelDirectories(cwd);
  const artifacts = await discoverArtifacts(cwd);
  const workerPreferences = await loadWorkerPreferences(cwd);

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

  const currentLedger = await readLedger(cwd);
  const currentTasks = currentLedger.tasks;
  const completedTasks = input.replan ? currentTasks.tasks.filter((task) => task.status === 'completed') : [];
  const completedTaskIds = new Set(completedTasks.map((task) => task.id));
  const freshTasks = generated.graph.tasks.filter((task) => !completedTaskIds.has(task.id));
  const nextTasks = [...completedTasks, ...freshTasks];

  await writeLedger(
    {
      ...currentLedger,
      tasks: {
        ...currentLedger.tasks,
        version: currentTasks.version,
        tasks: nextTasks,
        updatedAt: new Date().toISOString(),
      },
      assignments: {
        ...currentLedger.assignments,
        assignments: [],
        updatedAt: new Date().toISOString(),
      },
      approval: {
        ...currentLedger.approval,
        approved: false,
        updatedAt: new Date().toISOString(),
      },
    },
    cwd,
  );

  await appendLedgerEvent(
    input.replan ? 'task_retried' : 'task_created',
    {
      goal,
      generatedTasks: freshTasks.length,
      preservedCompletedTasks: completedTasks.length,
      approvalReset: true,
    },
    cwd,
  );
  await appendActivity(
    input.replan ? 'ledger_replanned' : 'ledger_generated',
    {
      goal,
      generatedTasks: freshTasks.length,
      preservedCompletedTasks: completedTasks.length,
      contextArtifactCount: artifacts.length,
    },
    cwd,
  );
  await recordTelemetry({
    event: input.replan ? 'ledger_replanned' : 'ledger_generated',
    payload: {
      generatedTasks: freshTasks.length,
      preservedCompletedTasks: completedTasks.length,
      contextArtifactCount: artifacts.length,
      approvalReset: true,
    },
  });

  return {
    goal,
    totalTasks: nextTasks.length,
    generatedTasks: freshTasks.length,
    preservedCompletedTasks: completedTasks.length,
    warnings: generated.warnings,
    suggestions: generated.suggestions,
  };
}
