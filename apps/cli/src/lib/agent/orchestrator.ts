import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import {
  aiProviderSchema,
  type InteractionMode,
  type OrchestrationActiveRunState,
  type OrchestrationBoundaryState,
  type OrchestrationExecutionSummaryState,
  type OrchestrationPlanState,
  type OrchestrationState,
  CONFIG_FILE,
  SCRIMBLE_DIR,
} from '@scrimble/shared';
import { createLanguageModel } from '../ai/provider.js';
import { loadScrimbleConfig } from '../config/load-config.js';
import { mutateLedger, readLedger } from '../ledger/storage.js';
import { runAgentTool, toToolArgs } from './tools.js';
import type {
  AgentExecutionResult,
  AgentPlan,
  AgentPlanStep,
  AgentToolAction,
  AgentToolCall,
  AgentToolResult,
  ExecutePlanOptions,
  OperatorBoundary,
  OperatorBoundaryResolution,
  OperatorEvent,
  OperatorRunOptions,
  OperatorRunResult,
  OperatorStep,
} from './types.js';

const MUTATING_ACTIONS = new Set<AgentToolAction>([
  'configure_ai',
  'generate_or_update_tasks',
  'execute_tasks',
]);
const DEFAULT_OPERATOR_MAX_STEPS = 12;

const ROOT_SYSTEM_PROMPT = [
  'You are the Scrimble local orchestrator.',
  'Satisfy the user request by calling tools.',
  'Prefer the smallest tool sequence that fully solves the request.',
  'For execution requests, call show_plan before execute_tasks.',
  'For setup gaps, call check_setup and configure_ai.',
  'Avoid cloud/backend assumptions.',
].join(' ');

function toModelConfig(config: Awaited<ReturnType<typeof loadScrimbleConfig>>['ai']) {
  return {
    provider: config.provider,
    model: config.model,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
  };
}

function normalizeGoal(request: string): string {
  return request.replace(/\s+/g, ' ').trim();
}

function isMutatingAction(action: AgentToolAction): boolean {
  return MUTATING_ACTIONS.has(action);
}

function actionSummary(action: AgentToolAction): string {
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
      return 'Start working through the planned tasks.';
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

interface PermissionPolicyDecision {
  requiresConfirmation: boolean;
  reason: string;
  scope: {
    parallel: number;
    maxTasks: number;
    args: Record<string, unknown>;
  };
}

function callSignature(call: AgentToolCall): string {
  return `${call.action}:${JSON.stringify(call.args)}`;
}

function withBoundedExecuteDefaults(call: AgentToolCall): AgentToolCall {
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

function permissionPolicyForCall(call: AgentToolCall, interactionMode: InteractionMode): PermissionPolicyDecision {
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
      reason: 'Model configuration changes require explicit confirmation.',
      scope: { parallel: 1, maxTasks: 1, args: toToolArgs(call.args) },
    };
  }

  if (call.action === 'generate_or_update_tasks') {
    return {
      requiresConfirmation: interactionMode === 'guide',
      reason: interactionMode === 'guide'
        ? 'Guide mode confirms task-graph updates.'
        : 'Task-graph updates can run automatically in this mode.',
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
        reason: 'Operator mode can start the next task step automatically.',
        scope: { parallel, maxTasks, args },
      };
    }

    return {
      requiresConfirmation: true,
      reason: 'Starting the next task step needs confirmation in this mode.',
      scope: { parallel, maxTasks, args },
    };
  }

  return {
    requiresConfirmation: interactionMode === 'guide',
    reason: interactionMode === 'guide'
      ? 'Mutating actions require confirmation in guide mode.'
      : 'Mutating action can run automatically in this mode.',
    scope: { parallel: 1, maxTasks: 1, args: toToolArgs(call.args) },
  };
}

function toBoundary(call: AgentToolCall, decision: PermissionPolicyDecision): OperatorBoundary {
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

function toBoundaryState(boundary: OperatorBoundary): OrchestrationBoundaryState {
  return {
    id: boundary.id,
    action: boundary.action,
    actionSummary: boundary.actionSummary,
    reason: boundary.reason,
    scope: boundary.scope,
    choices: boundary.choices,
    requestedAt: new Date().toISOString(),
  };
}

function expectedOutcomeForAction(action: AgentToolAction): string {
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

function pauseConditionForAction(action: AgentToolAction): string {
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

function nextStepFromPlan(plan: AgentPlan, interactionMode: InteractionMode): OperatorStep | undefined {
  const nextCall = plan.calls.find((call) => call.mutating);
  if (!nextCall) {
    return undefined;
  }
  const normalizedCall = withBoundedExecuteDefaults(nextCall);
  const policy = permissionPolicyForCall(normalizedCall, interactionMode);
  const rationale =
    plan.steps.find((step) => step.action === normalizedCall.action)?.summary ??
    actionSummary(normalizedCall.action);
  return {
    action: normalizedCall.action,
    args: toToolArgs(normalizedCall.args),
    actionSummary: actionSummary(normalizedCall.action),
    rationale,
    requiresConfirmation: policy.requiresConfirmation,
    expectedOutcome: expectedOutcomeForAction(normalizedCall.action),
    pauseCondition: pauseConditionForAction(normalizedCall.action),
  };
}

function toActiveRunStepState(step: OperatorStep): NonNullable<OrchestrationActiveRunState['currentStep']> {
  return {
    action: step.action,
    actionSummary: step.actionSummary,
    rationale: step.rationale,
    requiresConfirmation: step.requiresConfirmation,
    expectedOutcome: step.expectedOutcome,
    pauseCondition: step.pauseCondition,
    plannedAt: new Date().toISOString(),
  };
}

function planOnlyToolResult(action: AgentToolAction, args: Record<string, unknown>): AgentToolResult {
  const argText = JSON.stringify(args);
  return {
    action,
    summary: `Planned ${action} (waiting for confirmation).`,
    details: argText === '{}' ? ['No arguments supplied.'] : [`Arguments: ${argText}`],
    dryRun: true,
  };
}

function normalizeToolResult(
  action: AgentToolAction,
  result: unknown,
  callId: string,
): AgentToolResult {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const record = result as Partial<AgentToolResult>;
    if (typeof record.summary === 'string' && Array.isArray(record.details)) {
      return {
        action,
        summary: record.summary,
        details: record.details.map((entry) => String(entry)),
        ...(record.dryRun === true ? { dryRun: true } : {}),
        ...(record.setupRequired === true ? { setupRequired: true } : {}),
        callId,
      };
    }
  }

  return {
    action,
    summary: `Tool ${action} completed.`,
    details: [typeof result === 'string' ? result : JSON.stringify(result)],
    callId,
  };
}

function buildSteps(calls: AgentToolCall[]): AgentPlanStep[] {
  return calls.map((call) => ({
    action: call.action,
    summary: actionSummary(call.action),
    mutating: call.mutating,
  }));
}

function buildSingleCallPlan(plan: AgentPlan, call: AgentToolCall): AgentPlan {
  const normalizedCall = withBoundedExecuteDefaults(call);
  const matchingStep =
    plan.steps.find((step) => step.action === normalizedCall.action) ??
    { action: normalizedCall.action, summary: actionSummary(normalizedCall.action), mutating: normalizedCall.mutating };
  const previewResults = plan.previewResults.filter((result) =>
    result.action === 'check_setup' && result.dryRun !== true
  );
  return {
    ...plan,
    calls: [normalizedCall],
    steps: [matchingStep],
    previewResults,
    requiresConfirmation: normalizedCall.mutating,
  };
}

function buildProgressPrompt(request: string, history: string[]): string {
  if (history.length === 0) {
    return request;
  }
  return [
    `Current request: ${request}`,
    'Completed steps:',
    ...history.map((entry) => `- ${entry}`),
    'Choose the next best action to continue.',
    'Do not repeat completed steps unless recovery is required.',
  ].join('\n');
}

function fallbackPlan(request: string): AgentPlan {
  const goal = normalizeGoal(request);
  const calls: AgentToolCall[] = [
    {
      id: randomUUID(),
      action: 'check_setup',
      args: {},
      mutating: false,
    },
    {
      id: randomUUID(),
      action: 'configure_ai',
      args: {},
      mutating: true,
    },
  ];
  return {
    id: randomUUID(),
    request: request.trim(),
    goal,
    calls,
    steps: buildSteps(calls),
    previewResults: [],
    requiresConfirmation: true,
    createdAt: new Date().toISOString(),
  };
}

function setupNeedsAttention(result: AgentToolResult): boolean {
  return result.setupRequired === true;
}

async function hasScrimbleDir(cwd: string): Promise<boolean> {
  try {
    await fs.access(path.join(cwd, SCRIMBLE_DIR));
    return true;
  } catch {
    return false;
  }
}

function toOrchestrationPlanState(plan: AgentPlan): OrchestrationPlanState {
  return {
    id: plan.id,
    request: plan.request,
    goal: plan.goal,
    requiresConfirmation: plan.requiresConfirmation,
    createdAt: plan.createdAt,
    steps: plan.steps.map((step) => ({
      action: step.action,
      summary: step.summary,
      mutating: step.mutating,
    })),
  };
}

function toOrchestrationExecutionSummary(
  plan: AgentPlan,
  execution: AgentExecutionResult,
): OrchestrationExecutionSummaryState {
  return {
    planId: plan.id,
    request: plan.request,
    summary: execution.summary,
    completedAt: new Date().toISOString(),
    results: execution.results.map((result) => ({
      action: result.action,
      summary: result.summary,
    })),
  };
}

function buildSetupRequiredPlan(request: string, goal: string, setupResult: AgentToolResult): AgentPlan {
  const setupCall: AgentToolCall = {
    id: randomUUID(),
    action: 'check_setup',
    args: {},
    mutating: false,
  };
  const configureCall: AgentToolCall = {
    id: randomUUID(),
    action: 'configure_ai',
    args: {},
    mutating: true,
  };

  return {
    id: randomUUID(),
    request,
    goal,
    calls: [setupCall, configureCall],
    steps: buildSteps([setupCall, configureCall]),
    previewResults: [
      { ...setupResult, callId: setupCall.id },
      { ...planOnlyToolResult('configure_ai', {}), callId: configureCall.id },
    ],
    requiresConfirmation: true,
    createdAt: new Date().toISOString(),
  };
}

function ensureSetupCallFirst(
  calls: AgentToolCall[],
  previewResults: AgentToolResult[],
  setupResult: AgentToolResult,
): { calls: AgentToolCall[]; previewResults: AgentToolResult[] } {
  const existingIndex = calls.findIndex((call) => call.action === 'check_setup');
  if (existingIndex === -1) {
    const setupCall: AgentToolCall = {
      id: randomUUID(),
      action: 'check_setup',
      args: {},
      mutating: false,
    };
    return {
      calls: [setupCall, ...calls],
      previewResults: [{ ...setupResult, callId: setupCall.id }, ...previewResults],
    };
  }

  const setupCall = calls[existingIndex];
  if (!setupCall) {
    return { calls, previewResults };
  }

  const reorderedCalls: AgentToolCall[] = existingIndex === 0
    ? calls
    : [setupCall, ...calls.slice(0, existingIndex), ...calls.slice(existingIndex + 1)];
  const hasSetupPreview = previewResults.some((result) => result.callId === setupCall.id);

  return {
    calls: reorderedCalls,
    previewResults: hasSetupPreview
      ? previewResults
      : [{ ...setupResult, callId: setupCall.id }, ...previewResults],
  };
}

async function canLoadLLM(cwd: string): Promise<boolean> {
  const scrimbleDir = path.join(cwd, SCRIMBLE_DIR);
  try {
    await fs.access(path.join(scrimbleDir, CONFIG_FILE));
    const config = await loadScrimbleConfig(cwd);
    createLanguageModel(toModelConfig(config.ai));
    return true;
  } catch {
    return false;
  }
}

export class ConversationalOrchestrator {
  private sessionState: OrchestrationState | undefined;

  constructor(private readonly cwd: string = process.cwd()) {}

  async loadSessionState(): Promise<OrchestrationState | null> {
    if (!(await hasScrimbleDir(this.cwd))) {
      return null;
    }
    return (await readLedger(this.cwd)).orchestration;
  }

  private cloneOrchestrationState(state: OrchestrationState): OrchestrationState {
    return {
      ...state,
      ...(state.lastProposedPlan
        ? {
            lastProposedPlan: {
              ...state.lastProposedPlan,
              steps: state.lastProposedPlan.steps.map((step) => ({ ...step })),
            },
          }
        : {}),
      ...(state.lastConfirmedPlan
        ? {
            lastConfirmedPlan: {
              ...state.lastConfirmedPlan,
              steps: state.lastConfirmedPlan.steps.map((step) => ({ ...step })),
            },
          }
        : {}),
      ...(state.lastExecutionSummary
        ? {
            lastExecutionSummary: {
              ...state.lastExecutionSummary,
              results: state.lastExecutionSummary.results.map((result) => ({ ...result })),
            },
          }
        : {}),
      ...(state.activeRun
        ? {
            activeRun: {
              ...state.activeRun,
              completedSteps: state.activeRun.completedSteps.map((step) => ({ ...step })),
              ...(state.activeRun.currentStep ? { currentStep: { ...state.activeRun.currentStep } } : {}),
              ...(state.activeRun.pendingBoundary ? { pendingBoundary: { ...state.activeRun.pendingBoundary } } : {}),
              ...(state.activeRun.pauseState ? { pauseState: { ...state.activeRun.pauseState } } : {}),
              ...(state.activeRun.resumableContext
                ? { resumableContext: { history: [...state.activeRun.resumableContext.history] } }
                : {}),
            },
          }
        : {}),
      ...(state.lastRunOutcome ? { lastRunOutcome: { ...state.lastRunOutcome } } : {}),
    };
  }

  private async withSessionState<T>(seed: OrchestrationState, work: () => Promise<T>): Promise<T> {
    const previous = this.sessionState;
    this.sessionState = this.cloneOrchestrationState(seed);
    try {
      return await work();
    } finally {
      this.sessionState = previous;
    }
  }

  private async updateOrchestrationState(
    update: (current: OrchestrationState) => OrchestrationState,
  ): Promise<void> {
    if (this.sessionState) {
      this.sessionState = update(this.sessionState);
      return;
    }
    if (!(await hasScrimbleDir(this.cwd))) {
      return;
    }
    await mutateLedger(this.cwd, (ledger) => {
      const current = ledger.orchestration;
      ledger.orchestration = {
        ...update(current),
        version: current.version,
        sessionId: current.sessionId || randomUUID(),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  private async flushSessionState(): Promise<void> {
    if (!this.sessionState) {
      return;
    }
    if (!(await hasScrimbleDir(this.cwd))) {
      return;
    }
    const snapshot = this.cloneOrchestrationState(this.sessionState);
    await mutateLedger(this.cwd, (ledger) => {
      ledger.orchestration = {
        ...snapshot,
        version: snapshot.version,
        sessionId: snapshot.sessionId || ledger.orchestration.sessionId || randomUUID(),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  private async recordProposedPlan(plan: AgentPlan): Promise<void> {
    await this.updateOrchestrationState((current) => ({
      ...current,
      lastProposedPlan: toOrchestrationPlanState(plan),
    }));
  }

  private async recordConfirmedPlan(plan: AgentPlan): Promise<void> {
    await this.updateOrchestrationState((current) => ({
      ...current,
      lastConfirmedPlan: toOrchestrationPlanState(plan),
    }));
  }

  private async recordExecutionSummary(plan: AgentPlan, execution: AgentExecutionResult): Promise<void> {
    await this.updateOrchestrationState((current) => ({
      ...current,
      lastExecutionSummary: toOrchestrationExecutionSummary(plan, execution),
    }));
  }

  private async recordActiveRun(state?: OrchestrationActiveRunState): Promise<void> {
    await this.updateOrchestrationState((current) => {
      if (state) {
        return {
          ...current,
          activeRun: state,
        };
      }
      const { activeRun: _activeRun, ...withoutActiveRun } = current;
      return withoutActiveRun;
    });
  }

  private async recordRunOutcome(result: OperatorRunResult): Promise<void> {
    await this.updateOrchestrationState((current) => {
      const withOutcome: OrchestrationState = {
        ...current,
        lastRunOutcome: {
          status: result.status,
          request: result.lastRequest,
          summary: result.summary,
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.nextSuggestedAction ? { nextSuggestedAction: result.nextSuggestedAction } : {}),
          completedAt: new Date().toISOString(),
        },
      };
      if (result.status === 'paused' || result.status === 'blocked') {
        return withOutcome;
      }
      const { activeRun: _activeRun, ...withoutActiveRun } = withOutcome;
      return withoutActiveRun;
    });
  }

  private buildToolset(
    request: string,
    goal: string,
    mode: 'plan' | 'execute',
    options: ExecutePlanOptions = {},
  ) {
    const context = {
      cwd: this.cwd,
      request,
      goal,
      ...(options.setup ? { setup: options.setup } : {}),
    };

    const callTool = async (
      action: AgentToolAction,
      args: Record<string, unknown> = {},
    ): Promise<AgentToolResult> => {
      if (mode === 'plan' && isMutatingAction(action)) {
        return planOnlyToolResult(action, args);
      }
      return runAgentTool(action, context, args, {
        ...(mode === 'execute' ? { execute: options } : {}),
      });
    };

    return {
      inspect_repo: tool({
        description: 'Inspect repository structure and local ledger state.',
        parameters: z.object({}).strict(),
        execute: async () => callTool('inspect_repo'),
      }),
      check_setup: tool({
        description: 'Check local setup, worker readiness, and config.',
        parameters: z.object({}).strict(),
        execute: async () => callTool('check_setup'),
      }),
      configure_ai: tool({
        description: 'Configure AI provider/model/key and scaffold .scrimble if missing.',
        parameters: z.object({
          provider: aiProviderSchema.optional(),
          model: z.string().optional(),
          apiKey: z.string().optional(),
        }).strict(),
        execute: async (args) => callTool('configure_ai', toToolArgs(args)),
      }),
      generate_or_update_tasks: tool({
        description: 'Generate or replan the local ledger task graph for a goal.',
        parameters: z.object({
          goal: z.string().optional(),
          replan: z.boolean().optional(),
        }).strict(),
        execute: async (args) => callTool('generate_or_update_tasks', toToolArgs(args)),
      }),
      show_plan: tool({
        description: 'Show ready tasks and next execution items.',
        parameters: z.object({}).strict(),
        execute: async () => callTool('show_plan'),
      }),
      execute_tasks: tool({
        description: 'Run tasks through LedgerSupervisor.',
        parameters: z.object({
          worker: z.enum(['auto', 'gemini', 'copilot']).optional(),
          parallel: z.number().int().min(1).max(8).optional(),
          timeoutSeconds: z.number().int().min(10).max(7200).optional(),
          maxTasks: z.number().int().min(0).optional(),
        }).strict(),
        execute: async (args) => callTool('execute_tasks', toToolArgs(args)),
      }),
      check_status: tool({
        description: 'Read local orchestration status from the ledger.',
        parameters: z.object({}).strict(),
        execute: async () => callTool('check_status'),
      }),
      show_logs: tool({
        description: 'Read recent local runtime events.',
        parameters: z.object({
          limit: z.number().int().min(1).max(100).optional(),
        }).strict(),
        execute: async (args) => callTool('show_logs', toToolArgs(args)),
      }),
      doctor: tool({
        description: 'Run local health diagnostics.',
        parameters: z.object({}).strict(),
        execute: async () => callTool('doctor'),
      }),
    };
  }

  async proposePlan(request: string, options: ExecutePlanOptions = {}): Promise<AgentPlan> {
    const normalizedRequest = request.trim();
    const goal = normalizeGoal(request);
    if (!normalizedRequest) {
      const fallback = fallbackPlan('check local status');
      const preview = await runAgentTool('check_status', { cwd: this.cwd, request: 'check local status', goal }, {});
      const firstCall = fallback.calls[0];
      const plan: AgentPlan = {
        ...fallback,
        previewResults: [{ ...preview, ...(firstCall ? { callId: firstCall.id } : {}) }],
      };
      await this.recordProposedPlan(plan);
      return plan;
    }

    const context = {
      cwd: this.cwd,
      request: normalizedRequest,
      goal,
      ...(options.setup ? { setup: options.setup } : {}),
    };
    const setupResult = await runAgentTool('check_setup', context, {});
    if (setupNeedsAttention(setupResult)) {
      const setupPlan = buildSetupRequiredPlan(normalizedRequest, goal, setupResult);
      await this.recordProposedPlan(setupPlan);
      return setupPlan;
    }

    if (!(await canLoadLLM(this.cwd))) {
      const plan = fallbackPlan(normalizedRequest);
      const firstCall = plan.calls[0];
      const fallbackPlanResult: AgentPlan = {
        ...plan,
        previewResults: [{ ...setupResult, ...(firstCall ? { callId: firstCall.id } : {}) }],
      };
      await this.recordProposedPlan(fallbackPlanResult);
      return fallbackPlanResult;
    }

    const config = await loadScrimbleConfig(this.cwd);
    const model = createLanguageModel(toModelConfig(config.ai));
    const tools = this.buildToolset(normalizedRequest, goal, 'plan', options);
    const result = await generateText({
      model,
      system: ROOT_SYSTEM_PROMPT,
      prompt: normalizedRequest,
      tools,
      maxSteps: 8,
    });

    const calls: AgentToolCall[] = [];
    for (const call of result.toolCalls) {
      const action = call.toolName as AgentToolAction;
      calls.push({
        id: call.toolCallId,
        action,
        args: toToolArgs(call.args),
        mutating: isMutatingAction(action),
      });
    }

    if (calls.length === 0) {
      const fallbackCall: AgentToolCall = {
        id: randomUUID(),
        action: 'check_status',
        args: {},
        mutating: false,
      };
      const fallbackPreview = await runAgentTool(
        'check_status',
        context,
        {},
      );
      const { calls: callsWithSetup, previewResults: previewsWithSetup } = ensureSetupCallFirst(
        [fallbackCall],
        [{ ...fallbackPreview, callId: fallbackCall.id }],
        setupResult,
      );
      const fallbackStatusPlan: AgentPlan = {
        id: randomUUID(),
        request: normalizedRequest,
        goal,
        calls: callsWithSetup,
        steps: buildSteps(callsWithSetup),
        previewResults: previewsWithSetup,
        requiresConfirmation: false,
        createdAt: new Date().toISOString(),
      };
      await this.recordProposedPlan(fallbackStatusPlan);
      return fallbackStatusPlan;
    }

    const previewResultsFromModel: AgentToolResult[] = result.toolResults
      .map((toolResult) => {
        const action = toolResult.toolName as AgentToolAction;
        return normalizeToolResult(action, toolResult.result, toolResult.toolCallId);
      });
    const { calls: callsWithSetup, previewResults } = ensureSetupCallFirst(calls, previewResultsFromModel, setupResult);

    const llmPlan: AgentPlan = {
      id: randomUUID(),
      request: normalizedRequest,
      goal,
      calls: callsWithSetup,
      steps: buildSteps(callsWithSetup),
      previewResults,
      requiresConfirmation: callsWithSetup.some((call) => call.mutating),
      createdAt: new Date().toISOString(),
    };
    await this.recordProposedPlan(llmPlan);
    return llmPlan;
  }

  async executePlan(plan: AgentPlan, options: ExecutePlanOptions = {}): Promise<AgentExecutionResult> {
    const context = {
      cwd: this.cwd,
      request: plan.request,
      goal: plan.goal,
      ...(options.setup ? { setup: options.setup } : {}),
    };

    const results: AgentToolResult[] = [...plan.previewResults];
    for (const call of plan.calls) {
      if (!call.mutating) {
        continue;
      }
      options.onProgress?.(`→ ${actionSummary(call.action)}`);
      const result = await runAgentTool(call.action, context, call.args, { execute: options });
      const withCallId: AgentToolResult = {
        ...result,
        callId: call.id,
      };
      results.push(withCallId);
      options.onProgress?.(`✓ ${withCallId.summary}`);
    }

    const execution: AgentExecutionResult = {
      summary: results.map((entry) => entry.summary).join(' '),
      results,
    };
    await this.recordConfirmedPlan(plan);
    await this.recordExecutionSummary(plan, execution);
    return execution;
  }

  async runRequest(request: string, options: OperatorRunOptions): Promise<OperatorRunResult> {
    const ledger = await readLedger(this.cwd);
    return this.withSessionState(ledger.orchestration, async () => this.runLoop(request, options));
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
        results: [],
      };
      if (state) {
        await this.withSessionState(state, async () => {
          await this.recordRunOutcome(paused);
          await this.flushSessionState();
        });
      }
      return paused;
    }

    return this.withSessionState(state, async () => {
      let resumedRequest = active.request;
      let seedState: OrchestrationActiveRunState = {
        ...active,
        completedSteps: [...active.completedSteps],
        ...(active.resumableContext ? { resumableContext: { history: [...active.resumableContext.history] } } : {}),
      };

      options.onEvent?.({
        type: 'resumed',
        message: `Resuming active run for "${resumedRequest}".`,
        request: resumedRequest,
      });

      if (active.pendingBoundary && !options.autoConfirm) {
        const boundary: OperatorBoundary = {
          id: active.pendingBoundary.id,
          action: active.pendingBoundary.action as AgentToolAction,
          actionSummary: active.pendingBoundary.actionSummary,
          reason: active.pendingBoundary.reason,
          scope: active.pendingBoundary.scope,
          choices: [...active.pendingBoundary.choices],
        };

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
          const { pendingBoundary: _pendingBoundary, ...withoutPending } = seedState;
          seedState = {
            ...withoutPending,
            request: resumedRequest,
            updatedAt: new Date().toISOString(),
            lastRedirect: resumedRequest,
            pauseState: {
              kind: 'manual',
              reason: 'Run was redirected by the user.',
            },
            resumableContext: { history: [] },
          };
        } else if (resolution.kind !== 'proceed') {
          const paused: OperatorRunResult = {
            status: 'paused',
            summary: `Paused: ${boundary.reason}`,
            lastRequest: resumedRequest,
            boundary,
            nextSuggestedAction: 'Confirm this boundary or redirect me.',
            reason: boundary.reason,
            results: [],
          };
          await this.recordActiveRun(seedState);
          await this.recordRunOutcome(paused);
          await this.flushSessionState();
          return paused;
        } else {
          const { pendingBoundary: _pendingBoundary, ...withoutPending } = seedState;
          seedState = {
            ...withoutPending,
            updatedAt: new Date().toISOString(),
          };
        }
      } else if (active.pendingBoundary && options.autoConfirm) {
        const { pendingBoundary: _pendingBoundary, ...withoutPending } = seedState;
        seedState = {
          ...withoutPending,
          updatedAt: new Date().toISOString(),
        };
      }

      return this.runLoop(resumedRequest, options, seedState);
    });
  }

  private async runLoop(
    request: string,
    options: OperatorRunOptions,
    resumeState?: OrchestrationActiveRunState,
  ): Promise<OperatorRunResult> {
    const emit = (event: OperatorEvent): void => {
      options.onEvent?.(event);
    };

    const setupRef = options.setup ?? {};
    const maxSteps = Math.max(1, options.maxSteps ?? DEFAULT_OPERATOR_MAX_STEPS);
    let activeRequest = request.trim() || 'check local status';
    let historyForRequest: string[] = resumeState?.resumableContext ? [...resumeState.resumableContext.history] : [];
    let planningPrompt = activeRequest;
    let stepCount = resumeState?.stepCount ?? 0;
    const results: AgentToolResult[] = [];
    const signatureCounts = new Map<string, number>();
    const fingerprintCounts = new Map<string, number>();
    const completedSteps: OrchestrationActiveRunState['completedSteps'] = resumeState
      ? [...resumeState.completedSteps]
      : [];
    const { pendingBoundary: _pendingBoundary, pauseState: _pauseState, ...resumeWithoutPending } = resumeState ?? {};
    let activeRunState: OrchestrationActiveRunState = {
      ...(resumeState ? resumeWithoutPending : {}),
      request: activeRequest,
      startedAt: resumeState?.startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stepCount,
      completedSteps: [...completedSteps],
      ...(historyForRequest.length > 0 ? { resumableContext: { history: [...historyForRequest] } } : {}),
    };
    await this.recordActiveRun(activeRunState);
    await this.flushSessionState();

    while (stepCount < maxSteps) {
      emit({
        type: 'planning',
        message: 'Inspecting context and choosing the next action.',
        request: activeRequest,
      });

      const plan = await this.proposePlan(planningPrompt, { setup: setupRef });
      const step = nextStepFromPlan(plan, options.interactionMode);

      if (!step) {
        if (completedSteps.length > 0) {
          const paused: OperatorRunResult = {
            status: 'paused',
            summary: 'I do not see a clear next action from the current state.',
            lastRequest: activeRequest,
            nextSuggestedAction: 'Provide a narrower instruction or redirect me to a specific next step.',
            reason: 'no_next_action',
            results,
          };
          emit({
            type: 'paused',
            message: paused.summary,
            request: activeRequest,
            summary: paused.summary,
            ...(paused.reason ? { reason: paused.reason } : {}),
          });
          activeRunState = {
            ...activeRunState,
            request: activeRequest,
            updatedAt: new Date().toISOString(),
            lastPauseReason: paused.summary,
            pauseState: {
              kind: 'manual',
              reason: paused.summary,
              ...(paused.nextSuggestedAction ? { nextSuggestedAction: paused.nextSuggestedAction } : {}),
            },
            ...(historyForRequest.length > 0 ? { resumableContext: { history: [...historyForRequest] } } : {}),
          };
          await this.recordActiveRun(activeRunState);
          await this.recordRunOutcome(paused);
          await this.flushSessionState();
          return paused;
        }

        const readOnlyExecution = await this.executePlan(plan, {
          setup: setupRef,
          planId: plan.id,
        });
        const nonDry = readOnlyExecution.results.filter((entry) => entry.dryRun !== true);
        results.push(...nonDry);
        const completed: OperatorRunResult = {
          status: 'completed',
          summary: readOnlyExecution.summary,
          lastRequest: activeRequest,
          nextSuggestedAction: 'Ask for the next goal when ready.',
          results,
        };
        emit({
          type: 'completed',
          message: completed.summary,
          request: activeRequest,
          summary: completed.summary,
        });
        await this.recordActiveRun(undefined);
        await this.recordRunOutcome(completed);
        await this.flushSessionState();
        return completed;
      }

      const normalizedCall: AgentToolCall = {
        id: randomUUID(),
        action: step.action,
        args: step.args,
        mutating: true,
      };
      activeRunState = {
        ...activeRunState,
        request: activeRequest,
        updatedAt: new Date().toISOString(),
        currentStep: toActiveRunStepState(step),
        ...(historyForRequest.length > 0 ? { resumableContext: { history: [...historyForRequest] } } : {}),
      };
      await this.recordActiveRun(activeRunState);
      await this.flushSessionState();

      const signature = callSignature(normalizedCall);
      const signatureCount = (signatureCounts.get(signature) ?? 0) + 1;
      signatureCounts.set(signature, signatureCount);
      if (signatureCount > 2) {
        const paused: OperatorRunResult = {
          status: 'paused',
          summary: "I'm repeating the same step and pausing to avoid spinning.",
          lastRequest: activeRequest,
          nextSuggestedAction: 'Give a narrower instruction or redirect me.',
          reason: 'repeated_action_signature',
          results,
        };
        emit({
          type: 'paused',
          message: paused.summary,
          request: activeRequest,
          summary: paused.summary,
          ...(paused.reason ? { reason: paused.reason } : {}),
        });
          activeRunState = {
            ...activeRunState,
            request: activeRequest,
            updatedAt: new Date().toISOString(),
            lastPauseReason: paused.summary,
            pauseState: {
              kind: 'guard',
              reason: paused.summary,
              ...(paused.nextSuggestedAction ? { nextSuggestedAction: paused.nextSuggestedAction } : {}),
            },
            ...(historyForRequest.length > 0 ? { resumableContext: { history: [...historyForRequest] } } : {}),
          };
        await this.recordActiveRun(activeRunState);
        await this.recordRunOutcome(paused);
        await this.flushSessionState();
        return paused;
      }

      const policy = permissionPolicyForCall(normalizedCall, options.interactionMode);
      const boundary = toBoundary(normalizedCall, policy);
      if (policy.requiresConfirmation && !options.autoConfirm) {
        emit({
          type: 'boundary_requested',
          message: boundary.reason,
          request: activeRequest,
          action: normalizedCall.action,
          boundary,
        });
        activeRunState = {
          ...activeRunState,
          request: activeRequest,
          updatedAt: new Date().toISOString(),
          pendingBoundary: toBoundaryState(boundary),
          lastPauseReason: boundary.reason,
          pauseState: {
            kind: 'boundary',
            reason: boundary.reason,
            nextSuggestedAction: 'Approve, pause, or redirect this boundary.',
          },
          ...(historyForRequest.length > 0 ? { resumableContext: { history: [...historyForRequest] } } : {}),
        };
        await this.recordActiveRun(activeRunState);
        await this.flushSessionState();

        const resolution: OperatorBoundaryResolution = options.resolveBoundary
          ? await options.resolveBoundary(boundary)
          : { kind: 'pause' };

        if (resolution.kind === 'redirect') {
          const redirectedRequest = resolution.request.trim();
          const nextRequest = redirectedRequest || activeRequest;
          emit({
            type: 'redirected',
            message: `Redirected to: ${nextRequest}`,
            request: nextRequest,
            reason: boundary.reason,
          });
          activeRequest = nextRequest;
          planningPrompt = activeRequest;
          historyForRequest = [];
          signatureCounts.clear();
          fingerprintCounts.clear();
          const { pendingBoundary: _pendingBoundary, lastPauseReason: _lastPauseReason, ...withoutBoundary } = activeRunState;
          activeRunState = {
            ...withoutBoundary,
            request: activeRequest,
            updatedAt: new Date().toISOString(),
            lastRedirect: activeRequest,
            pauseState: {
              kind: 'manual',
              reason: 'Run redirected by user input.',
            },
            resumableContext: { history: [] },
          };
          await this.recordActiveRun(activeRunState);
          await this.flushSessionState();
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
            results,
          };
          emit({
            type: 'paused',
            message: paused.summary,
            request: activeRequest,
            boundary,
            reason: boundary.reason,
          });
          activeRunState = {
            ...activeRunState,
            request: activeRequest,
            updatedAt: new Date().toISOString(),
            pendingBoundary: toBoundaryState(boundary),
            lastPauseReason: paused.summary,
            pauseState: {
              kind: 'boundary',
              reason: boundary.reason,
              ...(paused.nextSuggestedAction ? { nextSuggestedAction: paused.nextSuggestedAction } : {}),
            },
            ...(historyForRequest.length > 0 ? { resumableContext: { history: [...historyForRequest] } } : {}),
          };
          await this.recordActiveRun(activeRunState);
          await this.recordRunOutcome(paused);
          await this.flushSessionState();
          return paused;
        }
      }

      const {
        pendingBoundary: _pendingBoundary,
        lastPauseReason: _lastPauseReason,
        pauseState: _pauseState,
        ...withoutBoundary
      } = activeRunState;
      activeRunState = {
        ...withoutBoundary,
        request: activeRequest,
        updatedAt: new Date().toISOString(),
        ...(historyForRequest.length > 0 ? { resumableContext: { history: [...historyForRequest] } } : {}),
      };
      await this.recordActiveRun(activeRunState);
      await this.flushSessionState();

      emit({
        type: 'step_started',
        message: `${step.actionSummary} (${step.rationale})`,
        request: activeRequest,
        action: normalizedCall.action,
      });

      const singleStepPlan = buildSingleCallPlan(plan, normalizedCall);
      try {
        const execution = await this.executePlan(singleStepPlan, {
          setup: setupRef,
          planId: singleStepPlan.id,
          ...(normalizedCall.action === 'execute_tasks'
            ? {
                parallel:
                  typeof normalizedCall.args['parallel'] === 'number' ? normalizedCall.args['parallel'] : 1,
                maxTasks:
                  typeof normalizedCall.args['maxTasks'] === 'number' ? normalizedCall.args['maxTasks'] : 1,
              }
            : {}),
        });
        const latestResult = [...execution.results]
          .reverse()
          .find((entry) => entry.action === normalizedCall.action && entry.dryRun !== true);
        if (latestResult) {
          results.push(latestResult);
          completedSteps.push({
            action: latestResult.action,
            summary: latestResult.summary,
            completedAt: new Date().toISOString(),
          });
          historyForRequest.push(`${latestResult.action}: ${latestResult.summary}`);
          const fingerprint = `${signature}:${latestResult.summary}`;
          const fingerprintCount = (fingerprintCounts.get(fingerprint) ?? 0) + 1;
          fingerprintCounts.set(fingerprint, fingerprintCount);
          if (fingerprintCount > 2) {
            const paused: OperatorRunResult = {
              status: 'paused',
              summary: "I'm not seeing meaningful state change, so I paused.",
              lastRequest: activeRequest,
              nextSuggestedAction: 'Provide a narrower instruction or redirect me.',
              reason: 'repeated_no_state_change',
              results,
            };
            emit({
              type: 'paused',
              message: paused.summary,
              request: activeRequest,
              ...(paused.reason ? { reason: paused.reason } : {}),
            });
            activeRunState = {
              ...activeRunState,
              request: activeRequest,
              updatedAt: new Date().toISOString(),
              stepCount: stepCount + 1,
              completedSteps: [...completedSteps],
              lastPauseReason: paused.summary,
              pauseState: {
                kind: 'guard',
                reason: paused.summary,
                ...(paused.nextSuggestedAction ? { nextSuggestedAction: paused.nextSuggestedAction } : {}),
              },
              resumableContext: { history: [...historyForRequest] },
            };
            await this.recordActiveRun(activeRunState);
            await this.recordRunOutcome(paused);
            await this.flushSessionState();
            return paused;
          }
        }

        stepCount += 1;
        activeRunState = {
          ...activeRunState,
          request: activeRequest,
          updatedAt: new Date().toISOString(),
          stepCount,
          completedSteps: [...completedSteps],
          resumableContext: { history: [...historyForRequest] },
        };
        await this.recordActiveRun(activeRunState);
        await this.flushSessionState();

        emit({
          type: 'step_completed',
          message: latestResult?.summary ?? execution.summary,
          request: activeRequest,
          action: normalizedCall.action,
          ...(latestResult ? { result: latestResult } : {}),
        });

        if (normalizedCall.action === 'execute_tasks' && latestResult) {
          const failedDetail = latestResult.details.find((detail) => detail.startsWith('Failed tasks:'));
          const conflictedDetail = latestResult.details.find((detail) => detail.startsWith('Conflicted tasks:'));
          const hasFailures = Boolean(failedDetail && !failedDetail.endsWith('none'));
          const hasConflicts = Boolean(conflictedDetail && !conflictedDetail.endsWith('none'));
          if (hasFailures || hasConflicts) {
            const blockerReason = (hasFailures ? failedDetail : conflictedDetail) ?? 'Execution reported unresolved blockers.';
            const blocked: OperatorRunResult = {
              status: 'blocked',
              summary: 'Execution finished with failures or conflicts and needs attention.',
              lastRequest: activeRequest,
              nextSuggestedAction: 'Inspect logs/status and resolve blockers before continuing.',
              reason: blockerReason,
              results,
            };
            emit({
              type: 'blocked',
              message: blocked.summary,
              request: activeRequest,
              reason: blockerReason,
            });
            activeRunState = {
              ...activeRunState,
              request: activeRequest,
              updatedAt: new Date().toISOString(),
              lastPauseReason: blocked.summary,
              pauseState: {
                kind: 'blocked',
                reason: blocked.summary,
                ...(blocked.nextSuggestedAction ? { nextSuggestedAction: blocked.nextSuggestedAction } : {}),
              },
              resumableContext: { history: [...historyForRequest] },
            };
            await this.recordActiveRun(activeRunState);
            await this.recordRunOutcome(blocked);
            await this.flushSessionState();
            return blocked;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failed: OperatorRunResult = {
          status: 'failed',
          summary: `Execution failed: ${message}`,
          lastRequest: activeRequest,
          nextSuggestedAction: 'Investigate the failure and retry with a narrower step.',
          reason: message,
          results,
        };
        emit({
          type: 'blocked',
          message: failed.summary,
          request: activeRequest,
          reason: message,
        });
        activeRunState = {
          ...activeRunState,
          request: activeRequest,
          updatedAt: new Date().toISOString(),
          lastPauseReason: failed.summary,
          pauseState: {
            kind: 'blocked',
            reason: failed.summary,
            ...(failed.nextSuggestedAction ? { nextSuggestedAction: failed.nextSuggestedAction } : {}),
          },
          resumableContext: { history: [...historyForRequest] },
        };
        await this.recordActiveRun(activeRunState);
        await this.recordRunOutcome(failed);
        await this.flushSessionState();
        return failed;
      }

      planningPrompt = buildProgressPrompt(activeRequest, historyForRequest);
    }

    const paused: OperatorRunResult = {
      status: 'paused',
      summary: "I reached the operator step limit and paused to stay safe.",
      lastRequest: activeRequest,
      nextSuggestedAction: 'Confirm continuation or provide a narrower instruction.',
      reason: 'loop_guard_max_steps',
      results,
    };
    emit({
      type: 'paused',
      message: paused.summary,
      request: activeRequest,
      ...(paused.reason ? { reason: paused.reason } : {}),
    });
    activeRunState = {
      ...activeRunState,
      request: activeRequest,
      updatedAt: new Date().toISOString(),
      lastPauseReason: paused.summary,
      pauseState: {
        kind: 'guard',
        reason: paused.summary,
        ...(paused.nextSuggestedAction ? { nextSuggestedAction: paused.nextSuggestedAction } : {}),
      },
      ...(historyForRequest.length > 0 ? { resumableContext: { history: [...historyForRequest] } } : {}),
    };
    await this.recordActiveRun(activeRunState);
    await this.recordRunOutcome(paused);
    await this.flushSessionState();
    return paused;
  }
}

export function isMutatingPlan(plan: AgentPlan): boolean {
  return plan.requiresConfirmation;
}
