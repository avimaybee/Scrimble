import type { LedgerDocument } from '@scrimble/shared';

const EXPLICIT_REPAIR_REQUESTS = new Set([
  'repair',
  'repair state',
  'fix state',
  'clear stale execution',
  'repair runtime and orchestration state consistency',
]);

function normalizeRequest(request: string): string {
  return request.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isRepairStateRequest(request: string): boolean {
  const normalized = normalizeRequest(request);
  return EXPLICIT_REPAIR_REQUESTS.has(normalized);
}

export function detectConsistencyIssue(
  ledger: Pick<LedgerDocument, 'tasks' | 'runtime' | 'orchestration'>,
): string | undefined {
  const activeExecution = ledger.runtime.activeExecution;
  const inProgressTasks = ledger.tasks.tasks.filter((task) => task.status === 'in_progress');

  if (activeExecution) {
    const activeTask = ledger.tasks.tasks.find((task) => task.id === activeExecution.taskId);
    if (!activeTask) {
      return `Runtime active execution references missing task "${activeExecution.taskId}".`;
    }
    if (activeTask.status !== 'in_progress') {
      return `Runtime active execution task "${activeTask.id}" is ${activeTask.status}.`;
    }
    if (ledger.orchestration.activeRun?.pendingBoundary) {
      return 'Active execution exists while orchestration is paused for approval.';
    }
  }

  if (!activeExecution && inProgressTasks.length > 0) {
    return `Found ${inProgressTasks.length} in_progress task(s) with no active runtime execution.`;
  }

  return undefined;
}
