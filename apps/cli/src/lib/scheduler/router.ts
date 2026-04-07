import type { ContextArtifact, LedgerTask, RoutingDecision, WorkerHealth, WorkerKind } from '@scrimble/shared';

export interface WorkerHistory {
  successes: number;
  failures: number;
}

export interface RouteTaskInput {
  workers: WorkerHealth[];
  contextArtifacts?: ContextArtifact[];
  history?: Partial<Record<WorkerKind, WorkerHistory>>;
  manualWorker?: WorkerKind;
}

function priorityOrder(kind: WorkerKind): number {
  return kind === 'gemini' ? 0 : 1;
}

function findAvailableWorker(
  workers: WorkerHealth[],
  kind: WorkerKind,
): WorkerHealth | undefined {
  return workers.find((worker) => worker.available && worker.kind === kind);
}

function sortWorkers(workers: WorkerHealth[]): WorkerHealth[] {
  return [...workers].sort((left, right) => priorityOrder(left.kind) - priorityOrder(right.kind));
}

function chooseByAvailability(workers: WorkerHealth[]): WorkerHealth | undefined {
  const available = sortWorkers(workers.filter((worker) => worker.available));
  if (available.length === 0) {
    return undefined;
  }

  const idle = available.find((worker) => !worker.currentTaskId);
  if (idle) {
    return idle;
  }

  return available[0];
}

export function routeTask(task: LedgerTask, input: RouteTaskInput): RoutingDecision {
  const availableWorkers = input.workers.filter((worker) => worker.available);
  if (availableWorkers.length === 0) {
    throw new Error('No available workers for routing');
  }

  if (input.manualWorker) {
    const forced = findAvailableWorker(availableWorkers, input.manualWorker);
    if (!forced) {
      throw new Error(`Manual worker ${input.manualWorker} is unavailable`);
    }
    return {
      worker: forced.kind,
      reason: `Manual override selected ${forced.kind}`,
      confidence: 1,
      alternatives: sortWorkers(availableWorkers)
        .filter((worker) => worker.kind !== forced.kind)
        .map((worker) => worker.kind),
    };
  }

  if (task.preferredWorker) {
    const preferred = findAvailableWorker(availableWorkers, task.preferredWorker);
    if (preferred) {
      return {
        worker: preferred.kind,
        reason: `Task preferred worker ${preferred.kind} is available`,
        confidence: 0.95,
        alternatives: sortWorkers(availableWorkers)
          .filter((worker) => worker.kind !== preferred.kind)
          .map((worker) => worker.kind),
      };
    }
  }

  if (task.fallbackWorker) {
    const fallback = findAvailableWorker(availableWorkers, task.fallbackWorker);
    if (fallback) {
      return {
        worker: fallback.kind,
        reason: `Using task fallback worker ${fallback.kind}`,
        confidence: 0.85,
        alternatives: sortWorkers(availableWorkers)
          .filter((worker) => worker.kind !== fallback.kind)
          .map((worker) => worker.kind),
      };
    }
  }

  const selected = chooseByAvailability(availableWorkers);
  if (!selected) {
    throw new Error('No available worker could be selected');
  }

  return {
    worker: selected.kind,
    reason: selected.currentTaskId
      ? `Selected ${selected.kind} by deterministic worker priority`
      : `Selected idle worker ${selected.kind}`,
    confidence: selected.currentTaskId ? 0.7 : 0.8,
    alternatives: sortWorkers(availableWorkers)
      .filter((worker) => worker.kind !== selected.kind)
      .map((worker) => worker.kind),
  };
}

