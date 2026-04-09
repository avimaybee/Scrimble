import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { InteractionMode, OrchestrationState } from '@scrimble/shared';
import { SCRIMBLE_DIR } from '@scrimble/shared';
import { mutateLedger, readLedger } from '../ledger/storage.js';
import { runAgentTool } from './tools.js';
import {
  buildProgressPrompt,
  buildSingleCallPlan,
  executePlan as executePlannedCalls,
  isReadOnlyRequest,
  nextStepFromPlan,
  normalizeGoal,
  proposePlan as proposePlanForRequest,
  selectDeterministicStep,
  type ProposePlanOptions,
} from './orchestrator-planning.js';
import {
  isMutatingAction,
  permissionPolicyForCall,
  toBoundary,
} from './orchestrator-policy.js';
import {
  clearActiveRun,
  writeBoundaryState,
  writePlanningState,
  writeRunOutcome,
  writeStepCompletionState,
} from './orchestrator-state.js';
import type {
  AgentExecutionResult,
  AgentPlan,
  AgentToolAction,
  AgentToolCall,
  AgentToolResult,
  ExecutePlanOptions,
  OperatorBoundary,
  OperatorFailureContext,
  OperatorRecoveryAction,
  OperatorRecoveryKind,
  OperatorBoundaryResolution,
  OperatorEvent,
  OperatorRunOptions,
  OperatorRunResult,
  OperatorStep,
} from './types.js';

const DEFAULT_OPERATOR_MAX_STEPS = 12;

function callSignature(call: AgentToolCall): string {
  return `${call.action}:${JSON.stringify(call.args)}`;
}

function toToolCall(step: OperatorStep): AgentToolCall {
  return {
    id: randomUUID(),
    action: step.action,
    args: step.args,
    mutating: isMutatingAction(step.action),
  };
}

function toBoundaryFromState(
  state: NonNullable<NonNullable<OrchestrationState['activeRun']>['pendingBoundary']>,
): OperatorBoundary {
  return {
    id: state.id,
    action: state.action as AgentToolCall['action'],
    actionSummary: state.actionSummary,
    reason: state.reason,
    ...(state.category ? { category: state.category } : {}),
    ...(state.riskLevel ? { riskLevel: state.riskLevel } : {}),
    ...(state.nextStepHint ? { nextStepHint: state.nextStepHint } : {}),
    scope: state.scope,
    choices: [...state.choices],
  };
}

function completedStepFallback(step: OperatorStep, execution: AgentExecutionResult): AgentToolResult {
  return {
    action: step.action,
    summary: execution.summary || `Completed ${step.action}.`,
    details: execution.summary ? [execution.summary] : [],
  };
}

function executionBlockerReason(result: AgentToolResult): string | undefined {
  const failedDetail = result.details.find((detail) => detail.startsWith('Failed tasks:'));
  const conflictedDetail = result.details.find((detail) => detail.startsWith('Conflicted tasks:'));
  const hasFailures = Boolean(failedDetail && !failedDetail.endsWith('none'));
  const hasConflicts = Boolean(conflictedDetail && !conflictedDetail.endsWith('none'));
  if (!hasFailures && !hasConflicts) {
    return undefined;
  }
  return (hasFailures ? failedDetail : conflictedDetail) ?? 'Execution reported unresolved blockers.';
}

function recoveryActionsFor(kind: OperatorRecoveryKind): OperatorRecoveryAction[] {
  switch (kind) {
    case 'resume_active_run':
      return [
        { kind: 'resume_active_run', label: 'Resume', description: 'Resume the active run from the current step.' },
        { kind: 'show_plan', label: 'Show plan', description: 'Inspect the current plan before continuing.' },
        { kind: 'inspect_logs', label: 'Inspect logs', description: 'Inspect runtime logs for context before resuming.' },
      ];
    case 'pending_approval':
      return [
        { kind: 'pending_approval', label: 'Approve boundary', description: 'Approve and continue the requested action.' },
        { kind: 'show_plan', label: 'Inspect plan', description: 'Review rationale, scope, and warnings before approving.' },
        { kind: 'inspect_logs', label: 'Inspect logs', description: 'Inspect supporting runtime details before deciding.' },
      ];
    case 'retry_task':
      return [
        { kind: 'retry_task', label: 'Retry task', description: 'Retry the failed/bocked task in one bounded step.' },
        { kind: 'replan', label: 'Replan', description: 'Regenerate tasks from the latest intent and repo state.' },
        { kind: 'inspect_logs', label: 'Inspect logs', description: 'Inspect detailed failure and conflict events.' },
      ];
    case 'state_inconsistent':
      return [
        { kind: 'clear_stale_execution', label: 'Repair state', description: 'Clear stale runtime execution and repair mismatched in_progress tasks.' },
        { kind: 'mark_failed_and_continue', label: 'Mark failed and continue', description: 'Mark stale in_progress attempts as failed and continue from clean state.' },
        { kind: 'inspect_logs', label: 'Inspect logs', description: 'Inspect state mismatch context before applying repair.' },
      ];
    case 'dismiss_completed':
      return [
        { kind: 'show_plan', label: 'Review next plan', description: 'Inspect current plan and next ready tasks.' },
        { kind: 'dismiss_completed', label: 'Dismiss completed run', description: 'Clear completed-run context from startup and continue.' },
      ];
    case 'replan':
      return [
        { kind: 'replan', label: 'Replan', description: 'Regenerate the task graph from current goal and state.' },
        { kind: 'show_plan', label: 'Show plan', description: 'Inspect the generated plan before execution.' },
        { kind: 'revise_foundation', label: 'Revise foundation', description: 'Revise project foundation if direction changed.' },
      ];
    default:
      return [
        { kind: 'show_plan', label: 'Inspect plan', description: 'Review current plan and readiness state.' },
        { kind: 'inspect_logs', label: 'Inspect logs', description: 'Inspect runtime detail and decide next action.' },
      ];
  }
}

function parseFailureContextFromResult(result: AgentToolResult): OperatorFailureContext | undefined {
  if (result.action !== 'execute_tasks') {
    return undefined;
  }
  const failedLine = result.details.find((detail) => detail.startsWith('Failed tasks:'));
  const conflictedLine = result.details.find((detail) => detail.startsWith('Conflicted tasks:'));
  const verificationLine = result.details.find((detail) => detail.toLowerCase().includes('verification'));
  const warningLine = result.details.find((detail) => detail.toLowerCase().includes('planning warnings'));
  const hasFailure = Boolean(failedLine && !failedLine.endsWith('none'));
  const hasConflict = Boolean(conflictedLine && !conflictedLine.endsWith('none'));
  if (!hasFailure && !hasConflict && !verificationLine && !warningLine) {
    return undefined;
  }

  const taskIds = [failedLine, conflictedLine]
    .filter((line): line is string => Boolean(line))
    .flatMap((line) => line.split(':').slice(1).join(':').split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry !== 'none');
  return {
    source: hasConflict ? 'ownership' : verificationLine ? 'verification' : 'execution',
    ...(taskIds[0] ? { taskId: taskIds[0] } : {}),
    ...(verificationLine ? { detail: verificationLine } : warningLine ? { detail: warningLine } : {}),
  };
}

function detectConsistencyIssue(ledger: Awaited<ReturnType<typeof readLedger>>): string | undefined {
  const activeExecution = ledger.runtime.activeExecution;
  const activeRun = ledger.orchestration.activeRun;
  const inProgressTasks = ledger.tasks.tasks.filter((task) => task.status === 'in_progress');
  if (activeExecution) {
    const activeTask = ledger.tasks.tasks.find((task) => task.id === activeExecution.taskId);
    if (!activeTask) {
      return `Runtime active execution references missing task "${activeExecution.taskId}".`;
    }
    if (activeTask.status !== 'in_progress') {
      return `Runtime active execution task "${activeTask.id}" is ${activeTask.status}.`;
    }
    if (!activeRun) {
      return 'Runtime active execution exists with no active orchestration run.';
    }
    if (activeRun.pendingBoundary) {
      return 'Active execution is running while orchestration is paused for approval.';
    }
  }
  if (!activeExecution && inProgressTasks.length > 0) {
    return `Found ${inProgressTasks.length} in_progress task(s) with no active runtime execution.`;
  }
  return undefined;
}

function wantsRepairRequest(request: string): boolean {
  return /\b(repair state|repair|fix state|clear stale|consistency)\b/.test(request.toLowerCase());
}

function hasNoRemainingWork(tasks: ReadonlyArray<{ status: string }>): boolean {
  if (tasks.length === 0) {
    return false;
  }
  return tasks.every((task) => task.status === 'completed');
}

async function hasScrimbleDir(cwd: string): Promise<boolean> {
  try {
    await fs.access(path.join(cwd, SCRIMBLE_DIR));
    return true;
  } catch {
    return false;
  }
}

interface RunLoopConfig {
  resetActiveRun: boolean;
  approvedBoundaryAction?: AgentToolAction;
}

function buildProgressSignature(
  ledger: Awaited<ReturnType<typeof readLedger>>,
  setupRequired: boolean,
): string {
  const statusCounts = {
    pending: 0,
    ready: 0,
    inProgress: 0,
    completed: 0,
    blocked: 0,
    failed: 0,
  };
  for (const task of ledger.tasks.tasks) {
    switch (task.status) {
      case 'pending':
        statusCounts.pending += 1;
        break;
      case 'ready':
        statusCounts.ready += 1;
        break;
      case 'in_progress':
        statusCounts.inProgress += 1;
        break;
      case 'completed':
        statusCounts.completed += 1;
        break;
      case 'blocked':
        statusCounts.blocked += 1;
        break;
      case 'failed':
        statusCounts.failed += 1;
        break;
      default:
        break;
    }
  }

  return JSON.stringify({
    setupRequired,
    statusCounts,
    activeExecutionTaskId: ledger.runtime.activeExecution?.taskId ?? null,
    activeExecutionPhase: ledger.runtime.activeExecution?.phase ?? null,
    pendingBoundaryAction: ledger.orchestration.activeRun?.pendingBoundary?.action ?? null,
    lastCompletedAction: ledger.orchestration.activeRun?.lastCompletedStep?.action ?? null,
  });
}

export class ConversationalOrchestrator {
  constructor(private readonly cwd: string = process.cwd()) {}

  async loadSessionState(): Promise<OrchestrationState | null> {
    if (!(await hasScrimbleDir(this.cwd))) {
      return null;
    }
    return (await readLedger(this.cwd)).orchestration;
  }

  async proposePlan(request: string, options: ProposePlanOptions = {}): Promise<AgentPlan> {
    return proposePlanForRequest(this.cwd, request, options);
  }

  async executePlan(plan: AgentPlan, options: ExecutePlanOptions = {}): Promise<AgentExecutionResult> {
    return executePlannedCalls(this.cwd, plan, options);
  }

  async runRequest(request: string, options: OperatorRunOptions): Promise<OperatorRunResult> {
    return this.runLoop(request, options, { resetActiveRun: true });
  }

  async resumeActiveRun(options: OperatorRunOptions): Promise<OperatorRunResult> {
    const state = await this.loadSessionState();
    const active = state?.activeRun;
    if (!active) {
      const paused: OperatorRunResult = {
        status: 'paused',
        summary: 'No active run to resume.',
        lastRequest: '',
        nextSuggestedAction: 'Start a new request.',
        reason: 'no_active_run',
        recoveryKind: 'resume_active_run',
        recoveryActions: recoveryActionsFor('dismiss_completed'),
        results: [],
      };
      if (state) {
        await mutateLedger(this.cwd, (ledger) => {
          writeRunOutcome(ledger, paused);
        });
      }
      return paused;
    }

    let resumedRequest = active.request;
    let approvedBoundaryAction: AgentToolAction | undefined;
    options.onEvent?.({
      type: 'resumed',
      message: `Resuming active run for "${resumedRequest}".`,
      request: resumedRequest,
    });

    const resumeLedger = await readLedger(this.cwd);
    const resumeIssue = detectConsistencyIssue(resumeLedger);
    if (resumeIssue && !wantsRepairRequest(resumedRequest)) {
      const paused: OperatorRunResult = {
        status: 'paused',
        summary: 'Resume paused due to runtime/orchestration consistency mismatch.',
        lastRequest: resumedRequest,
        nextSuggestedAction: 'Apply state repair before resuming normal execution.',
        reason: resumeIssue,
        recoveryKind: 'state_inconsistent',
        recoveryActions: recoveryActionsFor('state_inconsistent'),
        lastFailure: {
          source: 'consistency',
          detail: resumeIssue,
        },
        results: [],
      };
      await mutateLedger(this.cwd, (ledger) => {
        writeBoundaryState(ledger, {
          request: resumedRequest,
          pauseReason: paused.summary,
        });
        writeRunOutcome(ledger, paused);
      });
      return paused;
    }

    if (active.pendingBoundary && !options.autoConfirm) {
      const boundary = toBoundaryFromState(active.pendingBoundary);
      options.onEvent?.({
        type: 'boundary_requested',
        message: boundary.reason,
        request: resumedRequest,
        action: boundary.action,
        boundary,
      });

      const resolution: OperatorBoundaryResolution = options.resolveBoundary
        ? await options.resolveBoundary(boundary)
        : { kind: 'pause' };

      if (resolution.kind === 'redirect') {
        resumedRequest = resolution.request.trim() || resumedRequest;
        options.onEvent?.({
          type: 'redirected',
          message: `Redirected to: ${resumedRequest}`,
          request: resumedRequest,
          reason: boundary.reason,
        });
        await mutateLedger(this.cwd, (ledger) => {
          writeBoundaryState(ledger, {
            request: resumedRequest,
            pauseReason: 'Run redirected by user input.',
          });
          writeRunOutcome(ledger, {
            status: 'redirected',
            summary: `Redirected to: ${resumedRequest}`,
            lastRequest: resumedRequest,
            nextSuggestedAction: 'Continuing with redirected request.',
            reason: boundary.reason,
            results: [],
          });
        });
      } else if (resolution.kind !== 'proceed') {
        const paused: OperatorRunResult = {
          status: 'paused',
          summary: `Paused: ${boundary.reason}`,
          lastRequest: resumedRequest,
          boundary,
          nextSuggestedAction: 'Confirm this boundary or redirect me.',
          reason: boundary.reason,
          recoveryKind: 'pending_approval',
          recoveryActions: recoveryActionsFor('pending_approval'),
          results: [],
        };
        await mutateLedger(this.cwd, (ledger) => {
          writeBoundaryState(ledger, {
            request: resumedRequest,
            boundary,
            pauseReason: paused.summary,
          });
          writeRunOutcome(ledger, paused);
        });
        return paused;
      } else {
        approvedBoundaryAction = boundary.action;
        await mutateLedger(this.cwd, (ledger) => {
          writeBoundaryState(ledger, {
            request: resumedRequest,
            clearPauseReason: true,
          });
        });
      }
    } else if (active.pendingBoundary && options.autoConfirm) {
      approvedBoundaryAction = active.pendingBoundary.action as AgentToolAction;
      await mutateLedger(this.cwd, (ledger) => {
        writeBoundaryState(ledger, {
          request: resumedRequest,
          clearPauseReason: true,
        });
      });
    }

    return this.runLoop(resumedRequest, options, {
      resetActiveRun: false,
      ...(approvedBoundaryAction ? { approvedBoundaryAction } : {}),
    });
  }

  private async runLoop(
    request: string,
    options: OperatorRunOptions,
    config: RunLoopConfig,
  ): Promise<OperatorRunResult> {
    const emit = (event: OperatorEvent): void => {
      options.onEvent?.(event);
    };

    let activeRequest = request.trim() || 'check local status';
    const setupRef = options.setup ?? {};
    const maxSteps = Math.max(1, options.maxSteps ?? DEFAULT_OPERATOR_MAX_STEPS);
    const results: AgentToolResult[] = [];
    let stepCount = 0;
    let lastSignature = '';
    let lastProgressSignature = '';
    let repeatedSignatureCount = 0;
    let approvedBoundaryAction = config.approvedBoundaryAction;

    if (config.resetActiveRun) {
      const ledger = await readLedger(this.cwd);
      if (ledger.orchestration.activeRun) {
        await mutateLedger(this.cwd, (document) => {
          clearActiveRun(document);
        });
      }
    }

    const initialLedger = await readLedger(this.cwd);
    const stateIssue = detectConsistencyIssue(initialLedger);
    if (stateIssue && !wantsRepairRequest(activeRequest)) {
      const paused: OperatorRunResult = {
        status: 'paused',
        summary: 'State mismatch detected between runtime/orchestration/task graph.',
        lastRequest: activeRequest,
        nextSuggestedAction: 'Run a repair action before continuing execution.',
        reason: stateIssue,
        recoveryKind: 'state_inconsistent',
        recoveryActions: recoveryActionsFor('state_inconsistent'),
        lastFailure: {
          source: 'consistency',
          detail: stateIssue,
        },
        results,
      };
      emit({
        type: 'paused',
        message: paused.summary,
        request: activeRequest,
        reason: stateIssue,
        ...(paused.recoveryActions ? { recoveryActions: paused.recoveryActions } : {}),
        ...(paused.lastFailure ? { lastFailure: paused.lastFailure } : {}),
      });
      await mutateLedger(this.cwd, (document) => {
        writeBoundaryState(document, {
          request: activeRequest,
          pauseReason: paused.summary,
        });
        writeRunOutcome(document, paused);
      });
      return paused;
    }

    while (stepCount < maxSteps) {
      emit({
        type: 'planning',
        message: 'Inspecting context and choosing the next action.',
        request: activeRequest,
      });

      const ledger = await readLedger(this.cwd);
      const completedSteps = ledger.orchestration.activeRun?.completedSteps ?? [];
      const planningPrompt = buildProgressPrompt(
        activeRequest,
        completedSteps.map((step) => ({ action: step.action, summary: step.summary })),
      );
      const setupResult = await runAgentTool(
        'check_setup',
        {
          cwd: this.cwd,
          request: activeRequest,
          goal: normalizeGoal(activeRequest),
          ...(setupRef ? { setup: setupRef } : {}),
        },
        {},
      );
      const lastCompletedAction = ledger.orchestration.activeRun?.lastCompletedStep?.action;
      if (setupResult.setupRequired === true && lastCompletedAction === 'configure_ai') {
        const paused: OperatorRunResult = {
          status: 'paused',
          summary: 'Provider setup is still incomplete and execution is waiting for setup/auth updates.',
          lastRequest: activeRequest,
          nextSuggestedAction: 'Complete provider setup/authentication, then resume.',
          reason: 'setup_required',
          recoveryKind: 'resume_active_run',
          recoveryActions: [
            {
              kind: 'resume_active_run',
              label: 'Resume after setup',
              description: 'Finish provider setup/authentication first, then resume this run.',
            },
          ],
          results,
        };
        emit({
          type: 'paused',
          message: paused.summary,
          request: activeRequest,
          ...(paused.reason ? { reason: paused.reason } : {}),
          ...(paused.recoveryActions ? { recoveryActions: paused.recoveryActions } : {}),
        });
        await mutateLedger(this.cwd, (document) => {
          writeBoundaryState(document, {
            request: activeRequest,
            pauseReason: paused.summary,
          });
          writeRunOutcome(document, paused);
        });
        return paused;
      }

      let plan: AgentPlan | undefined;
      let step = selectDeterministicStep({
        request: activeRequest,
        interactionMode: options.interactionMode,
        ledger,
        setupResult,
      });
      if (!step) {
        plan = await this.proposePlan(planningPrompt, { setup: setupRef, setupResult });
        step = nextStepFromPlan(plan, options.interactionMode);
      }

      if (!step) {
        if (hasNoRemainingWork(ledger.tasks.tasks)) {
          const completed: OperatorRunResult = {
            status: 'completed',
            summary: 'Nothing more to do in the current task graph.',
            lastRequest: activeRequest,
            nextSuggestedAction: 'Ask for a new goal when ready.',
            recoveryKind: 'dismiss_completed',
            recoveryActions: recoveryActionsFor('dismiss_completed'),
            results,
          };
          emit({
            type: 'completed',
            message: completed.summary,
            request: activeRequest,
            summary: completed.summary,
          });
          await mutateLedger(this.cwd, (document) => {
            writeRunOutcome(document, completed);
            clearActiveRun(document);
          });
          return completed;
        }

        const paused: OperatorRunResult = {
          status: 'paused',
          summary: 'I do not know the next safe action from the current state.',
          lastRequest: activeRequest,
          nextSuggestedAction: 'Provide a narrower instruction or redirect me to the next step.',
          reason: 'no_next_action',
          recoveryKind: 'replan',
          recoveryActions: recoveryActionsFor('retry_task'),
          results,
        };
        emit({
          type: 'paused',
          message: paused.summary,
          request: activeRequest,
          summary: paused.summary,
          ...(paused.reason ? { reason: paused.reason } : {}),
          ...(paused.recoveryActions ? { recoveryActions: paused.recoveryActions } : {}),
        });
        await mutateLedger(this.cwd, (document) => {
          writeBoundaryState(document, {
            request: activeRequest,
            pauseReason: paused.summary,
          });
          writeRunOutcome(document, paused);
        });
        return paused;
      }

      const call = toToolCall(step);
      const signature = callSignature(call);
      const progressSignature = buildProgressSignature(ledger, setupResult.setupRequired === true);
      const sameSignature = signature === lastSignature;
      const unchangedState = sameSignature && progressSignature === lastProgressSignature;
      if (sameSignature && unchangedState) {
        repeatedSignatureCount += 1;
      } else {
        repeatedSignatureCount = 1;
      }
      lastSignature = signature;
      lastProgressSignature = progressSignature;

      if (sameSignature && unchangedState && repeatedSignatureCount > 1) {
        const nextSuggestedAction = setupResult.setupRequired === true
          ? 'Complete provider setup/authentication, then resume.'
          : 'Change the state (or redirect the request) before retrying the same action.';
        const paused: OperatorRunResult = {
          status: 'paused',
          summary: 'I would repeat the same action without state change, so I am pausing to avoid a loop.',
          lastRequest: activeRequest,
          nextSuggestedAction,
          reason: 'no_progress_repeated_action',
          recoveryKind: 'resume_active_run',
          recoveryActions: [
            {
              kind: 'resume_active_run',
              label: 'Resume after changes',
              description: 'Apply the blocking change, then resume this run.',
            },
          ],
          results,
        };
        emit({
          type: 'paused',
          message: paused.summary,
          request: activeRequest,
          summary: paused.summary,
          ...(paused.reason ? { reason: paused.reason } : {}),
          ...(paused.recoveryActions ? { recoveryActions: paused.recoveryActions } : {}),
        });
        await mutateLedger(this.cwd, (document) => {
          writeBoundaryState(document, {
            request: activeRequest,
            pauseReason: paused.summary,
          });
          writeRunOutcome(document, paused);
        });
        return paused;
      }

      const policy = permissionPolicyForCall(call, options.interactionMode);
      const boundary = toBoundary(call, policy);
      const boundaryAlreadyApproved = approvedBoundaryAction === call.action;
      if (boundaryAlreadyApproved) {
        approvedBoundaryAction = undefined;
      } else if (policy.requiresConfirmation && !options.autoConfirm) {
        emit({
          type: 'boundary_requested',
          message: boundary.reason,
          request: activeRequest,
          action: call.action,
          boundary,
        });

        const resolution: OperatorBoundaryResolution = options.resolveBoundary
          ? await options.resolveBoundary(boundary)
          : { kind: 'pause' };

        if (resolution.kind === 'redirect') {
          const nextRequest = resolution.request.trim() || activeRequest;
          emit({
            type: 'redirected',
            message: `Redirected to: ${nextRequest}`,
            request: nextRequest,
            reason: boundary.reason,
          });
          activeRequest = nextRequest;
          lastSignature = '';
          lastProgressSignature = '';
          repeatedSignatureCount = 0;
          await mutateLedger(this.cwd, (document) => {
            writeBoundaryState(document, {
              request: activeRequest,
              pauseReason: 'Run redirected by user input.',
            });
            writeRunOutcome(document, {
              status: 'redirected',
              summary: `Redirected to: ${activeRequest}`,
              lastRequest: activeRequest,
              nextSuggestedAction: 'Continuing with redirected request.',
              reason: boundary.reason,
              results: [],
            });
          });
          continue;
        }

        if (resolution.kind !== 'proceed') {
          const paused: OperatorRunResult = {
            status: 'paused',
            summary: `Paused: ${boundary.reason}`,
            lastRequest: activeRequest,
            boundary,
            nextSuggestedAction: 'Confirm this boundary or redirect me.',
            reason: boundary.reason,
            recoveryKind: 'pending_approval',
            recoveryActions: recoveryActionsFor('pending_approval'),
            results,
          };
          emit({
            type: 'paused',
            message: paused.summary,
            request: activeRequest,
            boundary,
            reason: boundary.reason,
            ...(paused.recoveryActions ? { recoveryActions: paused.recoveryActions } : {}),
          });
          await mutateLedger(this.cwd, (document) => {
            writeBoundaryState(document, {
              request: activeRequest,
              boundary,
              pauseReason: paused.summary,
            });
            writeRunOutcome(document, paused);
          });
          return paused;
        }
      }

      await mutateLedger(this.cwd, (document) => {
        writePlanningState(document, { request: activeRequest, step });
      });

      emit({
        type: 'step_started',
        message: `${step.actionSummary} (${step.rationale})`,
        request: activeRequest,
        action: call.action,
      });

      try {
        const singleStepPlan = plan
          ? {
              ...buildSingleCallPlan(plan, call),
              request: activeRequest,
              goal: normalizeGoal(activeRequest),
            }
          : {
              id: randomUUID(),
              request: activeRequest,
              goal: normalizeGoal(activeRequest),
              calls: [call],
              steps: [{ action: call.action, summary: step.rationale, mutating: call.mutating }],
              previewResults: [],
              requiresConfirmation: call.mutating,
              createdAt: new Date().toISOString(),
            };

        const execution = await this.executePlan(singleStepPlan, {
          setup: setupRef,
          planId: singleStepPlan.id,
          ...(call.action === 'execute_tasks'
            ? {
                parallel: typeof call.args['parallel'] === 'number' ? call.args['parallel'] : 1,
                maxTasks: typeof call.args['maxTasks'] === 'number' ? call.args['maxTasks'] : 1,
              }
            : {}),
        });

        const latestResult =
          [...execution.results]
            .reverse()
            .find((entry) => entry.action === call.action && entry.dryRun !== true) ??
          completedStepFallback(step, execution);

        results.push(latestResult);

        emit({
          type: 'step_completed',
          message: latestResult.summary,
          request: activeRequest,
          action: call.action,
          result: latestResult,
        });

        if (call.action === 'execute_tasks') {
          const blockerReason = executionBlockerReason(latestResult);
          if (blockerReason) {
            const failureContext = parseFailureContextFromResult(latestResult);
            const blocked: OperatorRunResult = {
              status: 'blocked',
              summary: 'Execution finished with failures or conflicts and needs attention.',
              lastRequest: activeRequest,
              nextSuggestedAction: 'Inspect status/logs and resolve blockers before continuing.',
              reason: blockerReason,
              recoveryKind: 'retry_task',
              recoveryActions: recoveryActionsFor('retry_task'),
              ...(failureContext ? { lastFailure: failureContext } : {}),
              results,
            };
            emit({
              type: 'blocked',
              message: blocked.summary,
              request: activeRequest,
              reason: blockerReason,
              ...(blocked.recoveryActions ? { recoveryActions: blocked.recoveryActions } : {}),
              ...(blocked.lastFailure ? { lastFailure: blocked.lastFailure } : {}),
            });
            await mutateLedger(this.cwd, (document) => {
              writeStepCompletionState(document, { request: activeRequest, result: latestResult });
              writeBoundaryState(document, {
                request: activeRequest,
                pauseReason: blocked.summary,
              });
              writeRunOutcome(document, blocked);
            });
            return blocked;
          }
        }

        const readOnlyTurn = isReadOnlyRequest(activeRequest) && !call.mutating;
        if (readOnlyTurn) {
          const completed: OperatorRunResult = {
            status: 'completed',
            summary: latestResult.summary,
            lastRequest: activeRequest,
            nextSuggestedAction: 'Ask for the next goal when ready.',
            recoveryKind: 'dismiss_completed',
            recoveryActions: recoveryActionsFor('dismiss_completed'),
            results,
          };
          emit({
            type: 'completed',
            message: completed.summary,
            request: activeRequest,
            summary: completed.summary,
          });
          await mutateLedger(this.cwd, (document) => {
            writeStepCompletionState(document, { request: activeRequest, result: latestResult });
            writeRunOutcome(document, completed);
            clearActiveRun(document);
          });
          return completed;
        }

        await mutateLedger(this.cwd, (document) => {
          writeStepCompletionState(document, { request: activeRequest, result: latestResult });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failed: OperatorRunResult = {
          status: 'failed',
          summary: `Execution failed: ${message}`,
          lastRequest: activeRequest,
          nextSuggestedAction: 'Investigate the failure and retry with a narrower step.',
          reason: message,
          recoveryKind: 'retry_task',
          recoveryActions: recoveryActionsFor('retry_task'),
          lastFailure: {
            source: 'runtime',
            detail: message,
          },
          results,
        };
        emit({
          type: 'blocked',
          message: failed.summary,
          request: activeRequest,
          reason: message,
          ...(failed.recoveryActions ? { recoveryActions: failed.recoveryActions } : {}),
          ...(failed.lastFailure ? { lastFailure: failed.lastFailure } : {}),
        });
        await mutateLedger(this.cwd, (document) => {
          writeBoundaryState(document, {
            request: activeRequest,
            pauseReason: failed.summary,
          });
          writeRunOutcome(document, failed);
        });
        return failed;
      }

      stepCount += 1;
    }

    const paused: OperatorRunResult = {
      status: 'paused',
      summary: 'I reached the operator step limit and paused to stay safe.',
      lastRequest: activeRequest,
      nextSuggestedAction: 'Confirm continuation or provide a narrower instruction.',
      reason: 'loop_guard_max_steps',
      recoveryKind: 'resume_active_run',
      recoveryActions: recoveryActionsFor('resume_active_run'),
      results,
    };
    emit({
      type: 'paused',
      message: paused.summary,
      request: activeRequest,
      ...(paused.reason ? { reason: paused.reason } : {}),
      ...(paused.recoveryActions ? { recoveryActions: paused.recoveryActions } : {}),
    });
    await mutateLedger(this.cwd, (document) => {
      writeBoundaryState(document, {
        request: activeRequest,
        pauseReason: paused.summary,
      });
      writeRunOutcome(document, paused);
    });
    return paused;
  }
}

export function isMutatingPlan(plan: AgentPlan): boolean {
  return plan.requiresConfirmation;
}
