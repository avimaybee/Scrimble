import { createHash } from 'node:crypto';
import type {
  LedgerTask,
  PlanningWarning,
  TaskGenerationInput,
  TaskGenerationOutput,
  TaskGraph,
  TaskGraphMetadata,
  TaskPhase,
  WorkerKind,
} from '@scrimble/shared';

interface Workstream {
  key: string;
  label: string;
  ownedFiles: string[];
  allowedFiles: string[];
  ownershipConfidence: 'high' | 'medium' | 'low';
  preferredWorker: WorkerKind;
  rationale: string;
}

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

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

function scoreMatch(query: Set<string>, candidate: string): number {
  if (query.size === 0) {
    return 0;
  }
  const candidateTokens = tokenize(candidate);
  let matches = 0;
  for (const token of candidateTokens) {
    if (query.has(token)) {
      matches += 1;
    }
  }
  return matches / Math.max(query.size, 1);
}

function inferPreferredWorker(text: string, fallback?: WorkerKind): WorkerKind {
  const lower = text.toLowerCase();
  if (lower.includes('architecture') || lower.includes('critical') || lower.includes('runtime')) {
    return 'gemini';
  }
  if (lower.includes('docs') || lower.includes('readme') || lower.includes('ux') || lower.includes('ui')) {
    return 'copilot';
  }
  return fallback ?? 'gemini';
}

function inferScopeFromFile(filePath: string): string {
  const normalized = normalizePath(filePath);
  const segments = normalized.split('/');
  if (segments.length <= 1) {
    return '';
  }
  if (segments.length >= 2 && ['apps', 'packages', 'services'].includes(segments[0] ?? '')) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0] ?? normalized;
}

function inferScopeFromDirectory(directory: string): string {
  const normalized = normalizePath(directory);
  const parts = normalized.split('/');
  if (parts.length >= 2 && ['apps', 'packages', 'services'].includes(parts[0] ?? '')) {
    return `${parts[0]}/${parts[1]}`;
  }
  return normalized;
}

function rootLevelScopeForFallback(input: TaskGenerationInput): string {
  const keys = input.repoContext.keyDirectories.map(inferScopeFromDirectory).filter(Boolean);
  if (keys.length > 0) {
    return keys[0] as string;
  }
  const fromFiles = input.existingFiles.map(inferScopeFromFile).filter(Boolean);
  if (fromFiles.length > 0) {
    return fromFiles[0] as string;
  }
  return '**/*';
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function deriveWorkstreams(input: TaskGenerationInput): Workstream[] {
  const queryTokens = tokenize([
    input.intent.goal,
    input.intent.productVision,
    input.intent.targetUsers,
    ...input.intent.successCriteria,
  ].join(' '));

  const fromFiles = input.existingFiles.map((filePath) => inferScopeFromFile(filePath));
  const fromDirectories = input.repoContext.keyDirectories.map((directory) => inferScopeFromDirectory(directory));
  const candidates = dedupe([...fromFiles, ...fromDirectories].filter((entry) => entry.length > 0));

  const ranked = candidates
    .map((candidate) => {
      const sourceConfidence: 'high' | 'medium' = fromFiles.includes(candidate) ? 'high' : 'medium';
      const score = scoreMatch(queryTokens, candidate) + (sourceConfidence === 'high' ? 0.2 : 0.1);
      return { candidate, score, sourceConfidence };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  if (ranked.length === 0) {
    const fallbackScope = rootLevelScopeForFallback(input);
    return [
      {
        key: slugify(fallbackScope) || 'workspace',
        label: fallbackScope,
        ownedFiles: [fallbackScope === '**/*' ? fallbackScope : `${fallbackScope}/**/*`],
        allowedFiles: ['.scrimble/context/**/*'],
        ownershipConfidence: fallbackScope === '**/*' ? 'low' : 'medium',
        preferredWorker: inferPreferredWorker(input.intent.goal, input.workerPreferences?.defaultWorker),
        rationale: fallbackScope === '**/*'
          ? 'No reliable module boundaries were detected, so planner fell back to repository-wide ownership.'
          : `Planner inferred primary workstream from repository structure: ${fallbackScope}.`,
      },
    ];
  }

  return ranked.map((entry) => ({
    key: slugify(entry.candidate) || 'workspace',
    label: entry.candidate,
    ownedFiles: [`${entry.candidate}/**/*`],
    allowedFiles: ['.scrimble/context/**/*'],
    ownershipConfidence: entry.sourceConfidence,
    preferredWorker: inferPreferredWorker(
      `${entry.candidate} ${input.intent.goal}`,
      input.workerPreferences?.defaultWorker,
    ),
    rationale: `Planner mapped repository boundary "${entry.candidate}" to current intent and success criteria.`,
  }));
}

function commandPrefix(packageManager?: string): string {
  switch ((packageManager ?? '').toLowerCase()) {
    case 'pnpm':
      return 'pnpm';
    case 'yarn':
      return 'yarn';
    case 'bun':
      return 'bun';
    default:
      return 'npm';
  }
}

function findWorkspaceScriptEntry(
  scope: Workstream,
  input: TaskGenerationInput,
): { path: string; name?: string; scripts: string[] } | undefined {
  const catalog = input.scriptCatalog;
  if (!catalog) {
    return undefined;
  }
  const normalizedScope = normalizePath(scope.label);
  return catalog.workspaceScripts.find((entry) => normalizedScope.startsWith(normalizePath(entry.path)));
}

function inferVerificationCommands(scope: Workstream, input: TaskGenerationInput): string[] {
  const catalog = input.scriptCatalog;
  if (!catalog) {
    return [];
  }

  const packageManager = commandPrefix(catalog.packageManager ?? input.repoScan?.packageManager);
  const quality = input.intent.qualityPreference;
  const priorities = quality === 'prototype'
    ? ['build', 'test']
    : quality === 'enterprise'
      ? ['lint', 'test', 'build']
      : ['lint', 'test'];

  const workspace = findWorkspaceScriptEntry(scope, input);
  if (workspace) {
    const matches = priorities.filter((script) => workspace.scripts.includes(script)).slice(0, 2);
    if (matches.length > 0) {
      if (packageManager === 'pnpm' && workspace.name) {
        return matches.map((script) => `pnpm --filter ${workspace.name as string} run ${script}`);
      }
      return matches.map((script) => `${packageManager} run ${script}`);
    }
  }

  const rootMatches = priorities.filter((script) => catalog.rootScripts.includes(script)).slice(0, 2);
  return rootMatches.map((script) => `${packageManager} run ${script}`);
}

function makeTaskTitle(scope: Workstream, criterion: string): string {
  const trimmedCriterion = criterion.replace(/\s+/g, ' ').trim();
  const short = trimmedCriterion.length > 64 ? `${trimmedCriterion.slice(0, 61)}...` : trimmedCriterion;
  return `[${scope.label}] ${short}`;
}

function buildObjectives(input: TaskGenerationInput): string[] {
  const criteria = input.intent.successCriteria.filter((entry) => entry.trim().length > 0);
  if (criteria.length > 0) {
    return criteria;
  }
  return [input.intent.goal];
}

function buildTaskWarnings(task: LedgerTask): PlanningWarning[] {
  const warnings: PlanningWarning[] = [];
  if (task.ownedFiles.length === 0 || task.ownershipConfidence === 'low') {
    warnings.push({
      code: 'ownership_weak',
      message: `Task "${task.id}" has weak ownership inference; review scope before execution.`,
      taskId: task.id,
    });
  }
  if (task.verificationCommands.length === 0) {
    warnings.push({
      code: 'verification_missing',
      message: `Task "${task.id}" has no inferred verification commands.`,
      taskId: task.id,
    });
  }
  return warnings;
}

function detectGraphWarnings(input: TaskGenerationInput, tasks: LedgerTask[]): PlanningWarning[] {
  const warnings: PlanningWarning[] = [];

  if (!input.foundationContext || input.foundationContext.length === 0) {
    warnings.push({
      code: 'foundation_context_missing',
      message: 'No .scrimble/context artifacts were available; planning is grounded only in structured intent.',
    });
  }

  const intentText = `${input.intent.goal} ${input.intent.productVision}`.trim();
  if (intentText.split(/\s+/).length < 4 || input.intent.successCriteria.length === 0) {
    warnings.push({
      code: 'requirements_ambiguous',
      message: 'Goal/success criteria are sparse; plan may need refinement before execution.',
    });
  }

  if (input.repoScan?.frameworks && input.repoScan.frameworks.length >= 5) {
    warnings.push({
      code: 'conflicting_repo_signals',
      message: `Detected many frameworks (${input.repoScan.frameworks.join(', ')}); review scope assumptions.`,
    });
  }

  for (const task of tasks) {
    warnings.push(...buildTaskWarnings(task));
  }

  return warnings;
}

function estimateMetadata(
  tasks: LedgerTask[],
  warnings: PlanningWarning[],
  workstreams: Workstream[],
  input: TaskGenerationInput,
): TaskGraphMetadata {
  const totalComplexity = tasks.reduce((sum, task) => sum + task.riskScore, 0);
  const criticalPathLength = tasks.length;
  const ownershipCoverage = tasks.length === 0 ? 0 : tasks.filter((task) => task.ownedFiles.length > 0).length / tasks.length;
  const verificationCoverage = tasks.length === 0
    ? 0
    : tasks.filter((task) => task.verificationCommands.length > 0).length / tasks.length;
  const groundingScore = Math.min(
    1,
    (input.foundationContext && input.foundationContext.length > 0 ? 0.35 : 0) +
      (input.existingFiles.length > 0 ? 0.35 : 0) +
      (input.intent.successCriteria.length > 0 ? 0.2 : 0.1) +
      (input.repoScan ? 0.1 : 0),
  );

  return {
    totalComplexity,
    criticalPathLength,
    ownershipCoverage,
    verificationCoverage,
    groundingScore,
    warningCount: warnings.length,
    workstreams: workstreams.map((workstream) => workstream.label),
    contextSourcesUsed: [
      ...input.contextArtifacts.map((artifact) => artifact.path),
      ...(input.foundationContext?.map((artifact) => artifact.path) ?? []),
    ],
  };
}

function toTaskPhase(workstream: Workstream, taskIds: string[]): TaskPhase {
  return {
    id: slugify(workstream.label) || workstream.key,
    title: workstream.label,
    taskIds,
    description: 'Repository workstream inferred from structure and intent.',
  };
}

export function generateTaskGraph(input: TaskGenerationInput): TaskGenerationOutput {
  const tasks: LedgerTask[] = [];
  const suggestions: string[] = [];
  const now = new Date().toISOString();
  const objectives = buildObjectives(input);
  const workstreams = deriveWorkstreams(input);
  const taskIdsByWorkstream = new Map<string, string[]>();
  let previousTaskId: string | undefined;

  for (const [index, objective] of objectives.entries()) {
    const workstream = workstreams[index % workstreams.length] ?? workstreams[0];
    if (!workstream) {
      continue;
    }
    const verificationCommands = inferVerificationCommands(workstream, input);
    const taskId = createTaskId(workstream.key || 'task', objective);
    const taskWarnings: string[] = [];
    if (workstream.ownershipConfidence === 'low') {
      taskWarnings.push('ownership_inference_low');
    }
    if (verificationCommands.length === 0) {
      taskWarnings.push('verification_inference_missing');
    }

    const qualityRisk = input.intent.qualityPreference === 'enterprise'
      ? 7
      : input.intent.qualityPreference === 'production'
        ? 5
        : 3;
    const confidencePenalty = workstream.ownershipConfidence === 'high' ? 0 : workstream.ownershipConfidence === 'medium' ? 1 : 2;

    const task: LedgerTask = {
      id: taskId,
      title: makeTaskTitle(workstream, objective),
      objective: `Deliver success criterion: ${objective}`,
      rationale: `${workstream.rationale} Derived from intent success criterion "${objective}".`,
      doneCriteria: [
        `Outcome achieved: ${objective}`,
        `Respects non-goals: ${input.intent.nonGoals.join('; ') || 'none specified'}`,
        `Meets quality bar: ${input.intent.qualityPreference}`,
      ].join(' | '),
      ownedFiles: [...workstream.ownedFiles],
      allowedFiles: [...workstream.allowedFiles, 'README.md', '.scrimble/context/**/*'],
      ownershipConfidence: workstream.ownershipConfidence,
      ...(taskWarnings.length > 0 ? { planningWarnings: taskWarnings } : {}),
      verificationCommands,
      dependencies: previousTaskId ? [previousTaskId] : [],
      preferredWorker: workstream.preferredWorker,
      fallbackWorker: workstream.preferredWorker === 'gemini' ? 'copilot' : 'gemini',
      riskScore: Math.min(10, qualityRisk + confidencePenalty),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      attemptCount: 0,
      maxRetries: 1,
    };
    tasks.push(task);
    previousTaskId = task.id;
    const currentTaskIds = taskIdsByWorkstream.get(workstream.key) ?? [];
    currentTaskIds.push(task.id);
    taskIdsByWorkstream.set(workstream.key, currentTaskIds);
  }

  if (tasks.length === 0) {
    const fallbackScope = rootLevelScopeForFallback(input);
    tasks.push({
      id: createTaskId('fallback', input.intent.goal),
      title: `Scope and implement: ${input.intent.goal}`,
      objective: input.intent.goal,
      rationale: 'Fallback task generated because no success criteria or repo workstreams were available.',
      doneCriteria: `Implement "${input.intent.goal}" while respecting non-goals and quality preference.`,
      ownedFiles: [fallbackScope === '**/*' ? fallbackScope : `${fallbackScope}/**/*`],
      allowedFiles: ['.scrimble/context/**/*'],
      ownershipConfidence: fallbackScope === '**/*' ? 'low' : 'medium',
      planningWarnings: ['ownership_inference_low', 'verification_inference_missing'],
      verificationCommands: [],
      dependencies: [],
      preferredWorker: input.workerPreferences?.defaultWorker ?? 'gemini',
      fallbackWorker: input.workerPreferences?.defaultWorker === 'gemini' ? 'copilot' : 'gemini',
      riskScore: 7,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      attemptCount: 0,
      maxRetries: 1,
    });
  }

  const qualityWarnings = detectGraphWarnings(input, tasks);
  const warnings = qualityWarnings.map((warning) => warning.message);
  if (qualityWarnings.some((warning) => warning.code === 'ownership_weak')) {
    suggestions.push('Refine plan scope by naming specific modules/directories for affected tasks.');
  }
  if (qualityWarnings.some((warning) => warning.code === 'verification_missing')) {
    suggestions.push('Add or configure project scripts so planner can infer scoped verification commands.');
  }

  const edges = tasks.flatMap((task) => task.dependencies.map((dependency) => ({ from: task.id, to: dependency })));
  const phases: TaskPhase[] = workstreams
    .map((workstream) => toTaskPhase(workstream, taskIdsByWorkstream.get(workstream.key) ?? []))
    .filter((phase) => phase.taskIds.length > 0);
  const metadata = estimateMetadata(tasks, qualityWarnings, workstreams, input);

  const graph: TaskGraph = {
    intentId: input.intent.id,
    tasks,
    edges,
    phases,
    generatedAt: new Date().toISOString(),
    metadata,
  };

  return {
    graph,
    warnings,
    qualityWarnings,
    suggestions,
  };
}
