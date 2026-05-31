import { randomUUID } from 'node:crypto';
import type { InteractionMode } from '@scrimble/shared';
import { toToolArgs } from './tools.js';
import type { AgentToolAction, AgentToolCall, OperatorBoundary, OperatorStep } from './types.js';

const MUTATING_ACTIONS = new Set<AgentToolAction>([
  'configure_ai',
  'generate_or_update_tasks',
  'execute_tasks',
  'repair_state',
  'recover_failed_tasks',
]);

export interface PermissionPolicyDecision {
  requiresConfirmation: boolean;
  reason: string;
  scope: {
    parallel: number;
    maxTasks: number;
    args: Record<string, unknown>;
  };
}

export function isMutatingAction(action: AgentToolAction): boolean {
  return MUTATING_ACTIONS.has(action);
}

export function actionSummary(action: AgentToolAction): string {
  switch (action) {
    case 'inspect_repo':
      return 'Look through the repository and current progress.';
    case 'check_setup':
      return 'Check whether local setup is ready.';
    case 'configure_ai':
      return 'Set up your model configuration.';
    case 'generate_or_update_tasks':
      return 'Break your goal into actionable work.';
    case 'show_plan':
      return 'Outline the next steps.';
    case 'execute_tasks':
      return 'Start the next task.';
    case 'repair_state':
      return 'Repair inconsistent runtime/operator state.';
    case 'recover_failed_tasks':
      return 'Recover failed/blocked tasks for retry.';
    case 'check_status':
      return 'Summarize current progress.';
    case 'show_logs':
      return 'Review recent runtime activity.';
    case 'doctor':
      return 'Run diagnostics and suggest fixes.';
    default: {
      const exhaustive: never = action;
      return `Unknown action: ${String(exhaustive)}`;
    }
  }
}

export function withBoundedExecuteDefaults(call: AgentToolCall): AgentToolCall {
  if (call.action !== 'execute_tasks') {
    return call;
  }

  const args = toToolArgs(call.args);
  return {
    ...call,
    args: {
      ...args,
      parallel: 1,
      maxTasks: 1,
    },
  };
}

export function permissionPolicyForCall(
  call: AgentToolCall,
  interactionMode: InteractionMode,
): PermissionPolicyDecision {
  if (!call.mutating) {
    return {
      requiresConfirmation: false,
      reason: 'Read-only actions run automatically.',
      scope: { parallel: 1, maxTasks: 1, args: toToolArgs(call.args) },
    };
  }

  if (call.action === 'configure_ai') {
    return {
      requiresConfirmation: true,
      reason: 'I need your approval to update setup/configuration.',
      scope: { parallel: 1, maxTasks: 1, args: toToolArgs(call.args) },
    };
  }

  if (call.action === 'generate_or_update_tasks') {
    return {
      requiresConfirmation: interactionMode === 'guide',
      reason:
        interactionMode === 'guide'
          ? 'I need your approval to update the task graph.'
          : 'Task-graph updates are allowed automatically in this mode.',
      scope: { parallel: 1, maxTasks: 1, args: toToolArgs(call.args) },
    };
  }

  if (call.action === 'execute_tasks') {
    const normalized = withBoundedExecuteDefaults(call);
    const args = toToolArgs(normalized.args);
    const parallel = typeof args['parallel'] === 'number' ? args['parallel'] : 1;
    const maxTasks = typeof args['maxTasks'] === 'number' ? args['maxTasks'] : 1;
    if (interactionMode === 'operator') {
      return {
        requiresConfirmation: false,
        reason: 'Operator mode can start the next bounded task automatically.',
        scope: { parallel, maxTasks, args },
      };
    }

    return {
      requiresConfirmation: true,
      reason: 'I need your approval to start the next bounded task.',
      scope: { parallel, maxTasks, args },
    };
  }

  if (call.action === 'repair_state') {
    return {
      requiresConfirmation: interactionMode !== 'operator',
      reason:
        interactionMode === 'operator'
          ? 'Operator mode can apply deterministic state repair automatically.'
          : 'I need your approval to repair runtime/orchestration state.',
      scope: { parallel: 1, maxTasks: 1, args: toToolArgs(call.args) },
    };
  }

  if (call.action === 'recover_failed_tasks') {
    return {
      requiresConfirmation: interactionMode === 'guide',
      reason:
        interactionMode === 'guide'
          ? 'I need your approval to recover failed/blocked tasks for retry.'
          : 'Recovery can move failed/blocked tasks back into an executable state in this mode.',
      scope: { parallel: 1, maxTasks: 1, args: toToolArgs(call.args) },
    };
  }

  return {
    requiresConfirmation: interactionMode === 'guide',
    reason:
      interactionMode === 'guide'
        ? 'I need your approval before running this change.'
        : 'This change can run automatically in this mode.',
    scope: { parallel: 1, maxTasks: 1, args: toToolArgs(call.args) },
  };
}

export function toBoundary(call: AgentToolCall, decision: PermissionPolicyDecision): OperatorBoundary {
  const category: OperatorBoundary['category'] =
    call.action === 'configure_ai'
      ? 'setup'
      : call.action === 'generate_or_update_tasks'
        ? 'planning'
        : call.action === 'execute_tasks' || call.action === 'repair_state' || call.action === 'recover_failed_tasks'
          ? 'execution'
          : 'inspection';
  const riskLevel: OperatorBoundary['riskLevel'] =
    call.action === 'execute_tasks' || call.action === 'repair_state' || call.action === 'recover_failed_tasks'
      ? 'high'
      : call.action === 'generate_or_update_tasks' || call.action === 'configure_ai'
        ? 'medium'
        : 'low';
  return {
    id: randomUUID(),
    action: call.action,
    actionSummary: actionSummary(call.action),
    reason: decision.reason,
    category,
    riskLevel,
    nextStepHint: expectedOutcomeForAction(call.action),
    scope: {
      parallel: decision.scope.parallel,
      maxTasks: decision.scope.maxTasks,
      args: decision.scope.args,
    },
    choices: ['proceed', 'pause', 'redirect'],
  };
}

export function expectedOutcomeForAction(action: AgentToolAction): string {
  switch (action) {
    case 'configure_ai':
      return 'Required model configuration is updated so planning/execution can continue.';
    case 'generate_or_update_tasks':
      return 'Task graph is refreshed to reflect the current goal.';
    case 'execute_tasks':
      return 'The next bounded task step is executed and progress advances.';
    case 'repair_state':
      return 'Runtime/orchestration state is repaired and resume can continue safely.';
    case 'recover_failed_tasks':
      return 'Failed/blocked tasks are recovered into an executable state for the next bounded step.';
    case 'check_status':
      return 'Latest progress and blockers are summarized.';
    case 'show_logs':
      return 'Recent runtime activity is surfaced.';
    default:
      return 'Context is updated for the next operator decision.';
  }
}

export function pauseConditionForAction(action: AgentToolAction): string {
  switch (action) {
    case 'configure_ai':
      return 'pause if credentials or setup details are missing';
    case 'generate_or_update_tasks':
      return 'pause if no safe next task can be derived';
    case 'execute_tasks':
      return 'pause if execution fails, conflicts, or needs approval';
    case 'repair_state':
      return 'pause if deterministic repair cannot be applied safely';
    case 'recover_failed_tasks':
      return 'pause if failed/blocked tasks cannot be recovered safely';
    default:
      return 'pause if no safe next action is available';
  }
}

export function toOperatorStep(
  call: AgentToolCall,
  interactionMode: InteractionMode,
  rationale: string,
): OperatorStep {
  const normalized = withBoundedExecuteDefaults(call);
  const policy = permissionPolicyForCall(normalized, interactionMode);
  return {
    action: normalized.action,
    args: toToolArgs(normalized.args),
    actionSummary: actionSummary(normalized.action),
    rationale,
    requiresConfirmation: policy.requiresConfirmation,
    expectedOutcome: expectedOutcomeForAction(normalized.action),
    pauseCondition: pauseConditionForAction(normalized.action),
  };
}
