import { randomUUID } from 'node:crypto';
import type { InteractionMode } from '@scrimble/shared';
import { toToolArgs } from './tools.js';
import type { AgentToolAction, AgentToolCall, OperatorBoundary, OperatorStep } from './types.js';

const MUTATING_ACTIONS = new Set<AgentToolAction>([
  'configure_ai',
  'generate_or_update_tasks',
  'execute_tasks',
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
  return {
    id: randomUUID(),
    action: call.action,
    actionSummary: actionSummary(call.action),
    reason: decision.reason,
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
