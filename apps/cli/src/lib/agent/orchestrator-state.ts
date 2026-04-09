import { randomUUID } from 'node:crypto';
import type {
  LedgerDocument,
  OrchestrationActiveRunState,
  OrchestrationBoundaryState,
  OrchestrationState,
} from '@scrimble/shared';
import type { AgentToolResult, OperatorBoundary, OperatorRunResult, OperatorStep } from './types.js';

const MAX_COMPLETED_HISTORY = 8;

function nowIso(): string {
  return new Date().toISOString();
}

function toBoundaryState(boundary: OperatorBoundary): OrchestrationBoundaryState {
  return {
    id: boundary.id,
    action: boundary.action,
    actionSummary: boundary.actionSummary,
    reason: boundary.reason,
    scope: boundary.scope,
    choices: boundary.choices,
    requestedAt: nowIso(),
  };
}

function ensureOrchestrationState(ledger: LedgerDocument): OrchestrationState {
  const next: OrchestrationState = {
    ...ledger.orchestration,
    version: ledger.orchestration.version ?? 1,
    sessionId: ledger.orchestration.sessionId || randomUUID(),
    updatedAt: nowIso(),
  };
  ledger.orchestration = next;
  return next;
}

function ensureActiveRun(
  ledger: LedgerDocument,
  request: string,
): { orchestration: OrchestrationState; activeRun: OrchestrationActiveRunState } {
  const orchestration = ensureOrchestrationState(ledger);
  const activeRun: OrchestrationActiveRunState = orchestration.activeRun
    ? {
        ...orchestration.activeRun,
        request,
        updatedAt: nowIso(),
      }
    : {
        request,
        startedAt: nowIso(),
        updatedAt: nowIso(),
      };
  orchestration.activeRun = activeRun;
  return { orchestration, activeRun };
}

export function writePlanningState(
  ledger: LedgerDocument,
  input: { request: string; step: OperatorStep },
): void {
  const { orchestration, activeRun } = ensureActiveRun(ledger, input.request);
  activeRun.currentStep = {
    action: input.step.action,
    actionSummary: input.step.actionSummary,
    rationale: input.step.rationale,
    requiresConfirmation: input.step.requiresConfirmation,
    expectedOutcome: input.step.expectedOutcome,
    pauseCondition: input.step.pauseCondition,
    plannedAt: nowIso(),
  };
  delete activeRun.pendingBoundary;
  delete activeRun.lastPauseReason;
  activeRun.updatedAt = nowIso();
  orchestration.updatedAt = nowIso();
}

export function writeBoundaryState(
  ledger: LedgerDocument,
  input: { request: string; boundary?: OperatorBoundary; pauseReason?: string; clearPauseReason?: boolean },
): void {
  const { orchestration, activeRun } = ensureActiveRun(ledger, input.request);
  if (input.boundary) {
    activeRun.pendingBoundary = toBoundaryState(input.boundary);
  } else {
    delete activeRun.pendingBoundary;
  }

  if (input.clearPauseReason) {
    delete activeRun.lastPauseReason;
  } else if (input.pauseReason) {
    activeRun.lastPauseReason = input.pauseReason;
  } else if (input.boundary) {
    activeRun.lastPauseReason = input.boundary.reason;
  }

  activeRun.updatedAt = nowIso();
  orchestration.updatedAt = nowIso();
}

export function writeStepCompletionState(
  ledger: LedgerDocument,
  input: { request: string; result: AgentToolResult },
): void {
  const { orchestration, activeRun } = ensureActiveRun(ledger, input.request);
  const completion = {
    action: input.result.action,
    summary: input.result.summary,
    completedAt: nowIso(),
  };
  const history = [...(activeRun.completedSteps ?? []), completion].slice(-MAX_COMPLETED_HISTORY);
  activeRun.completedSteps = history;
  activeRun.lastCompletedStep = completion;
  delete activeRun.currentStep;
  delete activeRun.pendingBoundary;
  delete activeRun.lastPauseReason;
  activeRun.updatedAt = nowIso();
  orchestration.updatedAt = nowIso();
}

export function writeRunOutcome(ledger: LedgerDocument, result: OperatorRunResult): void {
  const orchestration = ensureOrchestrationState(ledger);
  orchestration.lastRunOutcome = {
    status: result.status,
    request: result.lastRequest,
    summary: result.summary,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.nextSuggestedAction ? { nextSuggestedAction: result.nextSuggestedAction } : {}),
    completedAt: nowIso(),
  };
  orchestration.updatedAt = nowIso();
}

export function clearActiveRun(ledger: LedgerDocument): void {
  const orchestration = ensureOrchestrationState(ledger);
  delete orchestration.activeRun;
  orchestration.updatedAt = nowIso();
}
