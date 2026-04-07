import * as path from 'node:path';
import type {
  ConductorImportOptions,
  ConductorImportResult,
  Intent,
  LedgerTask,
  TaskGraph,
  TaskPhase,
} from '@scrimble/shared';
import { readTextIfExists } from '../fs/index.js';
import { getActiveTrack, loadConductorWorkspace, parsePlan } from '../conductor/index.js';

function buildIntentFromConductor(options: {
  goal: string;
  product?: string;
  techStack?: string;
  guidelines?: string;
  workflow?: string;
}): Intent {
  const now = new Date().toISOString();
  const assumptions = [
    options.product ? `Product context: ${options.product.slice(0, 180)}` : undefined,
    options.techStack ? `Tech stack: ${options.techStack.slice(0, 180)}` : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  const constraints = [
    options.guidelines ? `Guideline: ${options.guidelines.slice(0, 180)}` : undefined,
    options.workflow ? `Workflow: ${options.workflow.slice(0, 180)}` : undefined,
  ].filter((entry): entry is string => Boolean(entry));

  return {
    id: `conductor-import-${Date.now()}`,
    goal: options.goal,
    productAssumptions: assumptions,
    constraints,
    successCriteria: ['Imported Conductor planning converted into native ledger tasks'],
    outOfScope: [],
    qualityPreference: 'production',
    createdAt: now,
    updatedAt: now,
  };
}

function convertPlanToGraph(
  intentId: string,
  trackId: string,
  plan: Awaited<ReturnType<typeof parsePlan>>,
): TaskGraph {
  const now = new Date().toISOString();
  const tasks: LedgerTask[] = [];
  const phases: TaskPhase[] = [];

  let previousTaskId: string | undefined;
  for (const phase of plan.phases) {
    const taskIds: string[] = [];
    for (const task of phase.tasks) {
      const ledgerTask: LedgerTask = {
        id: task.id,
        title: task.title,
        objective: task.rawMarkdown || task.title,
        doneCriteria: task.isManualVerification
          ? `Manual verification completed for ${task.title}`
          : `Task ${task.title} completed successfully`,
        ownedFiles: [],
        allowedFiles: [],
        verificationCommands: task.isManualVerification ? [] : [],
        dependencies: previousTaskId ? [previousTaskId] : [],
        preferredWorker: task.isManualVerification ? 'copilot' : 'gemini',
        fallbackWorker: task.isManualVerification ? 'gemini' : 'copilot',
        riskScore: task.isManualVerification ? 8 : 5,
        status: task.status === 'completed' ? 'completed' : 'pending',
        createdAt: now,
        updatedAt: now,
        attemptCount: 0,
        maxRetries: task.isManualVerification ? 0 : 1,
      };
      tasks.push(ledgerTask);
      taskIds.push(ledgerTask.id);
      previousTaskId = ledgerTask.id;
    }
    phases.push({
      id: phase.id,
      title: phase.title,
      taskIds,
    });
  }

  const edges = tasks.flatMap((task) => task.dependencies.map((dependency) => ({ from: task.id, to: dependency })));
  return {
    intentId,
    tasks,
    edges,
    phases,
    generatedAt: now,
    metadata: {
      totalComplexity: tasks.reduce((sum, task) => sum + task.riskScore, 0),
      parallelGroups: tasks.filter((task) => task.dependencies.length === 0).length || 1,
      criticalPathLength: tasks.length,
      contextSourcesUsed: [`conductor/tracks/${trackId}/plan.md`],
    },
  };
}

export async function importConductorToLedger(
  options: ConductorImportOptions & { cwd?: string } = {
    contextOnly: false,
    overwriteIntent: false,
  },
): Promise<ConductorImportResult> {
  const cwd = options.cwd ?? process.cwd();
  const workspace = await loadConductorWorkspace(cwd);
  if (!workspace.exists) {
    return {
      success: false,
      warnings: [],
      errors: ['Conductor workspace not found'],
      artifactsFound: [],
    };
  }

  const track =
    (options.trackId
      ? workspace.tracks.find((candidate) => candidate.id === options.trackId || candidate.title === options.trackId)
      : getActiveTrack(workspace)) ?? workspace.tracks[0];

  if (!track || !track.planPath) {
    return {
      success: false,
      warnings: [],
      errors: ['No Conductor track with plan.md found'],
      artifactsFound: workspace.tracks.map((candidate) => candidate.id),
    };
  }

  const [product, techStack, guidelines, workflow] = await Promise.all([
    readTextIfExists(workspace.productPath),
    readTextIfExists(workspace.techStackPath),
    readTextIfExists(workspace.guidelinesPath),
    readTextIfExists(workspace.workflowPath),
  ]);
  const plan = await parsePlan(track.planPath, track.id);
  const intent = buildIntentFromConductor({
    goal: track.title,
    ...(product ? { product } : {}),
    ...(techStack ? { techStack } : {}),
    ...(guidelines ? { guidelines } : {}),
    ...(workflow ? { workflow } : {}),
  });

  const artifactsFound = [
    workspace.tracksPath,
    workspace.productPath,
    workspace.techStackPath,
    workspace.guidelinesPath,
    workspace.workflowPath,
    track.planPath,
  ]
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => path.relative(cwd, entry).replaceAll('\\', '/'));

  if (options.contextOnly) {
    return {
      success: true,
      intent,
      warnings: ['Context-only import requested; task graph generation skipped.'],
      errors: [],
      artifactsFound,
    };
  }

  const graph = convertPlanToGraph(intent.id, track.id, plan);
  return {
    success: true,
    intent,
    graph,
    warnings: [],
    errors: [],
    artifactsFound,
  };
}

