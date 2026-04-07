import { createHash } from 'node:crypto';
import type {
  LedgerTask,
  TaskGenerationInput,
  TaskGenerationOutput,
  TaskGraph,
  TaskGraphMetadata,
  TaskPhase,
  WorkerKind,
} from '@scrimble/shared';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function createTaskId(prefix: string, title: string): string {
  const hash = createHash('sha1').update(`${prefix}:${title}`).digest('hex').slice(0, 8);
  return `${prefix}-${hash}`;
}

function inferPreferredWorker(text: string, fallback?: WorkerKind): WorkerKind {
  const lower = text.toLowerCase();
  if (lower.includes('architecture') || lower.includes('refactor') || lower.includes('critical')) {
    return 'gemini';
  }
  if (lower.includes('docs') || lower.includes('readme') || lower.includes('test')) {
    return 'copilot';
  }
  return fallback ?? 'gemini';
}

function buildDefaultPhases(input: TaskGenerationInput): Array<{ title: string; objectives: string[] }> {
  const goal = input.intent.goal;
  const objectives = input.intent.successCriteria.length > 0
    ? input.intent.successCriteria
    : [`Deliver ${goal}`];

  return [
    {
      title: 'Discovery and design',
      objectives: [
        `Audit current repository state for goal: ${goal}`,
        ...input.intent.productAssumptions.map((assumption) => `Capture assumption: ${assumption}`),
      ],
    },
    {
      title: 'Implementation',
      objectives,
    },
    {
      title: 'Verification and hardening',
      objectives: [
        'Run verification commands and resolve failing checks',
        'Confirm drift/conflict constraints are satisfied',
      ],
    },
  ];
}

function estimateMetadata(tasks: LedgerTask[]): TaskGraphMetadata {
  const totalComplexity = tasks.reduce((sum, task) => sum + task.riskScore, 0);
  const criticalPathLength = tasks.length;
  const parallelGroups = tasks.filter((task) => task.dependencies.length === 0).length || 1;
  return {
    totalComplexity,
    criticalPathLength,
    parallelGroups,
    estimatedHours: Math.max(1, Math.round(totalComplexity * 0.75)),
    contextSourcesUsed: [],
  };
}

export function generateTaskGraph(input: TaskGenerationInput): TaskGenerationOutput {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  const tasks: LedgerTask[] = [];
  const phases: TaskPhase[] = [];
  const phaseTemplates = buildDefaultPhases(input);
  const now = new Date().toISOString();

  let previousTaskId: string | undefined;
  for (const phaseTemplate of phaseTemplates) {
    const phaseTaskIds: string[] = [];
    for (const objective of phaseTemplate.objectives) {
      const taskId = createTaskId(slugify(phaseTemplate.title) || 'task', objective);
      const preferredWorker = inferPreferredWorker(
        objective,
        input.workerPreferences?.defaultWorker,
      );
      const task: LedgerTask = {
        id: taskId,
        title: objective.length > 72 ? `${objective.slice(0, 69)}...` : objective,
        objective,
        doneCriteria: `Objective completed: ${objective}`,
        ownedFiles: [],
        allowedFiles: [],
        verificationCommands: [],
        dependencies: previousTaskId ? [previousTaskId] : [],
        preferredWorker,
        fallbackWorker: preferredWorker === 'gemini' ? 'copilot' : 'gemini',
        riskScore: phaseTemplate.title.toLowerCase().includes('verification') ? 6 : 4,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        attemptCount: 0,
        maxRetries: 1,
      };
      tasks.push(task);
      phaseTaskIds.push(task.id);
      previousTaskId = task.id;
    }

    phases.push({
      id: slugify(phaseTemplate.title),
      title: phaseTemplate.title,
      taskIds: phaseTaskIds,
    });
  }

  if (input.contextArtifacts.length === 0) {
    warnings.push('No provider context artifacts were supplied; generated graph is intent-only.');
  } else {
    suggestions.push('Review generated tasks against provider artifacts for better file ownership hints.');
  }

  const edges = tasks.flatMap((task) => task.dependencies.map((dependency) => ({ from: task.id, to: dependency })));
  const metadata = estimateMetadata(tasks);
  metadata.contextSourcesUsed = input.contextArtifacts.map((artifact) => artifact.path);

  const graph: TaskGraph = {
    intentId: input.intent.id,
    tasks,
    edges,
    phases,
    generatedAt: new Date().toISOString(),
    metadata,
  };

  return { graph, warnings, suggestions };
}

