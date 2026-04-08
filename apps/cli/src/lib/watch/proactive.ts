import type {
  AssignmentsState,
  LedgerTask,
  TasksState,
  VerificationResult,
  WorkersState,
} from '@scrimble/shared';
import type { LocalPlanState } from '../local/index.js';
import type { RepoWatchEvent } from './watcher.js';

export interface ProactiveSignal {
  type:
    | 'completion-ready'
    | 'verification-drift'
    | 'dependency-drift'
    | 'plan-divergence'
    | 'no-active-chunk'
    | 'execution-signal';
  severity: 'info' | 'warn';
  message: string;
  suggestedCommand: string;
  confidence: number;
}

function containsDependencySignal(events: RepoWatchEvent[]): boolean {
  const dependencyFiles = new Set([
    'package.json',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'go.mod',
    'Cargo.toml',
    'requirements.txt',
    'pyproject.toml',
  ]);
  return events.some((event) => dependencyFiles.has(event.relativePath.split('/').at(-1) ?? ''));
}

/**
 * Passive system event detection: test runner exits, build completions, etc.
 * Instead of heuristic filename matching, we watch for actual execution artifacts.
 */
function containsExecutionSignal(events: RepoWatchEvent[]): boolean {
  const executionOutputPatterns = [
    'test-results',
    'coverage',
    'junit.xml',
    '.nyc_output',
    '__snapshots__',
    'dist/',
    '.tsbuildinfo',
    '.next/',
    'build/',
  ];
  return events.some((event) => {
    const pathLower = event.relativePath.toLowerCase();
    return executionOutputPatterns.some((pattern) => pathLower.includes(pattern));
  });
}

function areLedgerDependenciesMet(task: LedgerTask, tasksById: Map<string, LedgerTask>): boolean {
  return task.dependencies.every((dependencyId) => tasksById.get(dependencyId)?.status === 'completed');
}

export function evaluateProactiveSignals(input: {
  events: RepoWatchEvent[];
  plan: LocalPlanState;
  verificationResult?: VerificationResult | null;
}): ProactiveSignal[] {
  const { events, plan, verificationResult } = input;
  const activeChunk = plan.chunks.find((chunk) => chunk.status === 'active');
  const signals: ProactiveSignal[] = [];

  if (!activeChunk) {
    signals.push({
      type: 'no-active-chunk',
      severity: 'info',
      message: 'No active chunk is selected. Activate the next chunk to keep momentum.',
      suggestedCommand: 'scrimble next --activate',
      confidence: 0.95,
    });
    return signals;
  }

  const executionSignalDetected = containsExecutionSignal(events);
  if (executionSignalDetected) {
    signals.push({
      type: 'execution-signal',
      severity: 'info',
      message: 'Execution artifacts detected (tests/build). Consider re-verifying this active chunk.',
      suggestedCommand: 'scrimble verify',
      confidence: 0.82,
    });
  }

  if (verificationResult?.status === 'pass' && (executionSignalDetected || events.length >= 3)) {
    signals.push({
      type: 'completion-ready',
      severity: 'info',
      message: 'Verification is passing after recent changes; this chunk may be ready to complete.',
      suggestedCommand: 'scrimble done',
      confidence: 0.88,
    });
  }

  if (verificationResult && verificationResult.status !== 'pass' && events.length > 0) {
    signals.push({
      type: 'verification-drift',
      severity: 'warn',
      message: `Verification status is ${verificationResult.status}; review drift before marking chunk done.`,
      suggestedCommand: 'scrimble verify',
      confidence: 0.83,
    });
  }

  if (containsDependencySignal(events)) {
    signals.push({
      type: 'dependency-drift',
      severity: 'warn',
      message: 'Dependency-related files changed; future chunks may need updates.',
      suggestedCommand: 'scrimble update --request "Dependencies changed"',
      confidence: 0.78,
    });
  }

  if (events.length >= 25) {
    signals.push({
      type: 'plan-divergence',
      severity: 'warn',
      message: 'Large change burst detected; plan may have diverged from code reality.',
      suggestedCommand: 'scrimble replan --request "Major code divergence detected"',
      confidence: 0.72,
    });
  }

  return signals;
}

export function evaluateLedgerProactiveSignals(input: {
  events: RepoWatchEvent[];
  tasks: TasksState;
  assignments: AssignmentsState;
  workers: WorkersState;
  verificationResult?: VerificationResult | null;
}): ProactiveSignal[] {
  const { events, tasks, assignments, workers, verificationResult } = input;
  const signals: ProactiveSignal[] = [];
  const taskIndex = new Map(tasks.tasks.map((task) => [task.id, task]));
  const activeTaskId = assignments.assignments.find((assignment) => assignment.status === 'in_progress')?.taskId;
  const activeTask = activeTaskId
    ? taskIndex.get(activeTaskId)
    : tasks.tasks.find((task) => task.status === 'running' || task.status === 'leased' || task.status === 'verify_pending');
  const readyTasks = tasks.tasks.filter((task) => task.status === 'pending' && areLedgerDependenciesMet(task, taskIndex));
  const blockedCount = tasks.tasks.filter((task) => task.status === 'blocked').length;
  const failedCount = tasks.tasks.filter((task) => task.status === 'failed').length;
  const unavailableWorkers = workers.workers.filter((worker) => !worker.available).length;

  if (!activeTask) {
    signals.push({
      type: 'no-active-chunk',
      severity: 'info',
      message:
        readyTasks.length > 0
          ? 'Ready tasks exist but no task is actively running.'
          : tasks.tasks.length === 0
            ? 'No ledger tasks are available yet.'
            : 'No active or ready ledger task is available.',
      suggestedCommand: readyTasks.length > 0 ? 'scrimble run --worker auto' : tasks.tasks.length === 0 ? 'scrimble generate' : 'scrimble status',
      confidence: readyTasks.length > 0 ? 0.9 : 0.92,
    });
  }

  const executionSignalDetected = containsExecutionSignal(events);
  if (executionSignalDetected) {
    signals.push({
      type: 'execution-signal',
      severity: 'info',
      message: 'Execution artifacts detected (tests/build). Consider re-verifying the current task.',
      suggestedCommand: 'scrimble verify',
      confidence: 0.82,
    });
  }

  if (verificationResult?.status === 'pass' && (executionSignalDetected || events.length >= 3)) {
    signals.push({
      type: 'completion-ready',
      severity: 'info',
      message: 'Verification is passing after recent changes; the current task may be ready to complete.',
      suggestedCommand: 'scrimble done',
      confidence: 0.88,
    });
  }

  if (verificationResult && verificationResult.status !== 'pass' && events.length > 0) {
    signals.push({
      type: 'verification-drift',
      severity: 'warn',
      message: `Verification status is ${verificationResult.status}; review drift before marking done.`,
      suggestedCommand: 'scrimble verify',
      confidence: 0.83,
    });
  }

  if (containsDependencySignal(events)) {
    signals.push({
      type: 'dependency-drift',
      severity: 'warn',
      message: 'Dependency-related files changed; downstream tasks may need updates.',
      suggestedCommand: 'scrimble update --request "Dependencies changed"',
      confidence: 0.78,
    });
  }

  if (blockedCount > 0 || failedCount > 0) {
    signals.push({
      type: 'plan-divergence',
      severity: 'warn',
      message: `${blockedCount + failedCount} task(s) are blocked or failed and need intervention.`,
      suggestedCommand: 'scrimble conflicts',
      confidence: 0.9,
    });
  }

  if (unavailableWorkers > 0) {
    signals.push({
      type: 'plan-divergence',
      severity: 'warn',
      message: `${unavailableWorkers} worker(s) unavailable; routing capacity is reduced.`,
      suggestedCommand: 'scrimble workers',
      confidence: 0.81,
    });
  }

  if (events.length >= 25) {
    signals.push({
      type: 'plan-divergence',
      severity: 'warn',
      message: 'Large change burst detected; task graph may have diverged from code reality.',
      suggestedCommand: 'scrimble replan --request "Major code divergence detected"',
      confidence: 0.72,
    });
  }

  return signals;
}
