import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import type {
  ContextArtifact,
  FoundationContextArtifact,
  RepoContextSummary,
  ScriptCatalogEntry,
  WorkerKind,
} from '@scrimble/shared';
import { SCRIMBLE_DIR } from '@scrimble/shared';
import { appendActivity } from '../local/index.js';
import { loadScrimbleConfig } from '../config/load-config.js';
import { generateTaskGraph } from './generator.js';
import { scanRepositoryContext } from '../discovery/foundation.js';
import {
  isFoundationReady,
  loadIntentState,
  normalizeIntent,
  saveCurrentIntent,
} from './intent.js';
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
  qualityWarnings: string[];
  suggestions: string[];
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listTopLevelDirectories(cwd: string): Promise<string[]> {
  const entries = await fs.readdir(cwd, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 16);
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

function normalizeWorkspacePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
}

async function collectExistingFiles(cwd: string, maxFiles: number = 800): Promise<string[]> {
  const ignoredDirectories = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    '.turbo',
    '.next',
    '.cache',
    '.scrimble/runtime',
  ]);
  const results: string[] = [];

  async function walk(relativeDir: string, depth: number): Promise<void> {
    if (results.length >= maxFiles || depth > 5) {
      return;
    }
    const absoluteDir = relativeDir ? path.join(cwd, relativeDir) : cwd;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) {
        return;
      }
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const normalized = normalizeWorkspacePath(relativePath);
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(normalized) || ignoredDirectories.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        await walk(normalized, depth + 1);
      } else if (entry.isFile()) {
        results.push(normalized);
      }
    }
  }

  await walk('', 0);
  return results.sort((left, right) => left.localeCompare(right));
}

async function loadFoundationContext(cwd: string): Promise<FoundationContextArtifact[]> {
  const contextDir = path.join(cwd, SCRIMBLE_DIR, 'context');
  if (!(await pathExists(contextDir))) {
    return [];
  }
  const files = ['product.md', 'product-guidelines.md', 'tech-stack.md'];
  const artifacts: FoundationContextArtifact[] = [];
  for (const fileName of files) {
    const absolutePath = path.join(contextDir, fileName);
    try {
      const content = await fs.readFile(absolutePath, 'utf8');
      artifacts.push({
        path: normalizeWorkspacePath(path.join(SCRIMBLE_DIR, 'context', fileName)),
        content,
      });
    } catch {
      // ignore missing foundation artifact
    }
  }
  return artifacts;
}

interface PackageJsonShape {
  name?: string;
  scripts?: Record<string, string>;
}

async function readPackageScripts(cwd: string, packageJsonPath: string): Promise<ScriptCatalogEntry | null> {
  try {
    const absolute = path.join(cwd, packageJsonPath);
    const content = await fs.readFile(absolute, 'utf8');
    const parsed = JSON.parse(content) as PackageJsonShape;
    const scripts = Object.keys(parsed.scripts ?? {});
    return {
      path: normalizeWorkspacePath(path.dirname(packageJsonPath)),
      ...(parsed.name ? { name: parsed.name } : {}),
      scripts,
    };
  } catch {
    return null;
  }
}

async function buildScriptCatalog(
  cwd: string,
  existingFiles: string[],
  packageManager: string | undefined,
): Promise<{
  packageManager?: string;
  rootScripts: string[];
  workspaceScripts: ScriptCatalogEntry[];
}> {
  const packageJsonFiles = existingFiles.filter((filePath) => filePath.endsWith('/package.json') || filePath === 'package.json');
  const entries = await Promise.all(packageJsonFiles.map((packageJsonPath) => readPackageScripts(cwd, packageJsonPath)));
  const validEntries = entries.filter((entry): entry is ScriptCatalogEntry => entry !== null);
  const rootEntry = validEntries.find((entry) => entry.path === '.');
  const workspaceEntries = validEntries.filter((entry) => entry.path !== '.');
  return {
    ...(packageManager ? { packageManager } : {}),
    rootScripts: rootEntry?.scripts ?? [],
    workspaceScripts: workspaceEntries,
  };
}

function buildRepoContext(repoName: string, scan: Awaited<ReturnType<typeof scanRepositoryContext>>, keyDirectories: string[]): RepoContextSummary {
  return {
    name: repoName,
    path: scan.repoPath,
    ...(scan.branch ? { branch: scan.branch } : {}),
    projectType: scan.projectType,
    ...(scan.languages[0] ? { primaryLanguage: scan.languages[0] } : {}),
    frameworks: scan.frameworks,
    ...(scan.packageManager ? { packageManager: scan.packageManager } : {}),
    ...(scan.readmeSummary ? { readmeSummary: scan.readmeSummary } : {}),
    keyDirectories,
  };
}

export async function generateLedgerTasks(input: GenerateLedgerTasksInput): Promise<GenerateLedgerTasksResult> {
  const cwd = input.cwd ?? process.cwd();
  const goal = input.goal.trim();
  if (!goal) {
    throw new Error('Generation goal is required.');
  }

  const scan = await scanRepositoryContext(cwd);
  const repoName = scan.repoName;
  const [keyDirectories, existingFiles, artifacts, workerPreferences, foundationContext] = await Promise.all([
    listTopLevelDirectories(cwd),
    collectExistingFiles(cwd),
    discoverArtifacts(cwd),
    loadWorkerPreferences(cwd),
    loadFoundationContext(cwd),
  ]);
  const scriptCatalog = await buildScriptCatalog(cwd, existingFiles, scan.packageManager);
  const repoContext = buildRepoContext(repoName, scan, keyDirectories);

  const intentState = await loadIntentState(cwd);
  if (!isFoundationReady(intentState)) {
    throw new Error('Project foundation is not approved yet. Complete discovery before generating tasks.');
  }

  const planningIntent = normalizeIntent({
    initialGoal: goal,
    repoContext,
    ...(intentState.intent ? { previousIntent: intentState.intent } : {}),
  });
  if (!intentState.intent || intentState.intent.goal !== planningIntent.goal) {
    await saveCurrentIntent(planningIntent, {
      cwd,
      reason: intentState.intent ? 'intent_refined' : 'intent_created',
    });
  }

  const generated = generateTaskGraph({
    intent: planningIntent,
    repoContext,
    repoScan: scan,
    existingFiles,
    foundationContext,
    scriptCatalog,
    contextArtifacts: [
      ...artifacts.map((artifact) => ({
        path: artifact.path,
        kind: artifact.kind,
      })),
      ...foundationContext.map((artifact) => ({
        path: artifact.path,
        kind: 'scrimble_context',
      })),
    ],
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
      runtime: {
        version: currentLedger.runtime.version,
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
      planningWarnings: generated.qualityWarnings.map((warning) => warning.code),
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
      planningWarnings: generated.qualityWarnings.length,
      contextArtifactCount: artifacts.length + foundationContext.length,
    },
    cwd,
  );
  await recordTelemetry({
    event: input.replan ? 'ledger_replanned' : 'ledger_generated',
    payload: {
      generatedTasks: freshTasks.length,
      preservedCompletedTasks: completedTasks.length,
      planningWarnings: generated.qualityWarnings.length,
      contextArtifactCount: artifacts.length + foundationContext.length,
      approvalReset: true,
    },
  });

  return {
    goal,
    totalTasks: nextTasks.length,
    generatedTasks: freshTasks.length,
    preservedCompletedTasks: completedTasks.length,
    warnings: generated.warnings,
    qualityWarnings: generated.qualityWarnings.map((warning) => warning.message),
    suggestions: generated.suggestions,
  };
}
