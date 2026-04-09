import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import {
  aiProviderSchema,
  CONFIG_FILE,
  SCRIMBLE_DIR,
  type InteractionMode,
  type LedgerDocument,
  type LedgerTask,
} from '@scrimble/shared';
import { createLanguageModel } from '../ai/provider.js';
import { loadScrimbleConfig } from '../config/load-config.js';
import { runAgentTool, toToolArgs } from './tools.js';
import {
  actionSummary,
  isMutatingAction,
  toOperatorStep,
  withBoundedExecuteDefaults,
} from './orchestrator-policy.js';
import type {
  AgentExecutionResult,
  AgentPlan,
  AgentPlanStep,
  AgentToolAction,
  AgentToolCall,
  AgentToolResult,
  ExecutePlanOptions,
  OperatorStep,
} from './types.js';

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

export function normalizeGoal(request: string): string {
  return request.replace(/\s+/g, ' ').trim();
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

  const reorderedCalls: AgentToolCall[] =
    existingIndex === 0 ? calls : [setupCall, ...calls.slice(0, existingIndex), ...calls.slice(existingIndex + 1)];
  const hasSetupPreview = previewResults.some((result) => result.callId === setupCall.id);

  return {
    calls: reorderedCalls,
    previewResults: hasSetupPreview ? previewResults : [{ ...setupResult, callId: setupCall.id }, ...previewResults],
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

function buildToolset(
  cwd: string,
  request: string,
  goal: string,
  mode: 'plan' | 'execute',
  options: ExecutePlanOptions = {},
) {
  const context = {
    cwd,
    request,
    goal,
    ...(options.setup ? { setup: options.setup } : {}),
  };

  const callTool = async (action: AgentToolAction, args: Record<string, unknown> = {}): Promise<AgentToolResult> => {
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
      parameters: z
        .object({
          provider: aiProviderSchema.optional(),
          model: z.string().optional(),
          apiKey: z.string().optional(),
        })
        .strict(),
      execute: async (args) => callTool('configure_ai', toToolArgs(args)),
    }),
    generate_or_update_tasks: tool({
      description: 'Generate or replan the local ledger task graph for a goal.',
      parameters: z
        .object({
          goal: z.string().optional(),
          replan: z.boolean().optional(),
        })
        .strict(),
      execute: async (args) => callTool('generate_or_update_tasks', toToolArgs(args)),
    }),
    show_plan: tool({
      description: 'Show ready tasks and next execution items.',
      parameters: z.object({}).strict(),
      execute: async () => callTool('show_plan'),
    }),
    execute_tasks: tool({
      description: 'Run tasks through LedgerSupervisor.',
      parameters: z
        .object({
          worker: z.enum(['auto', 'gemini', 'copilot']).optional(),
          parallel: z.number().int().min(1).max(8).optional(),
          timeoutSeconds: z.number().int().min(10).max(7200).optional(),
          maxTasks: z.number().int().min(0).optional(),
        })
        .strict(),
      execute: async (args) => callTool('execute_tasks', toToolArgs(args)),
    }),
    check_status: tool({
      description: 'Read local orchestration status from the ledger.',
      parameters: z.object({}).strict(),
      execute: async () => callTool('check_status'),
    }),
    show_logs: tool({
      description: 'Read recent local runtime events.',
      parameters: z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
        })
        .strict(),
      execute: async (args) => callTool('show_logs', toToolArgs(args)),
    }),
    doctor: tool({
      description: 'Run local health diagnostics.',
      parameters: z.object({}).strict(),
      execute: async () => callTool('doctor'),
    }),
  };
}

export interface ProposePlanOptions extends ExecutePlanOptions {
  setupResult?: AgentToolResult;
}

export async function proposePlan(
  cwd: string,
  request: string,
  options: ProposePlanOptions = {},
): Promise<AgentPlan> {
  const normalizedRequest = request.trim();
  const goal = normalizeGoal(request);
  if (!normalizedRequest) {
    const fallback = fallbackPlan('check local status');
    const preview = await runAgentTool('check_status', { cwd, request: 'check local status', goal }, {});
    const firstCall = fallback.calls[0];
    return {
      ...fallback,
      previewResults: [{ ...preview, ...(firstCall ? { callId: firstCall.id } : {}) }],
    };
  }

  const context = {
    cwd,
    request: normalizedRequest,
    goal,
    ...(options.setup ? { setup: options.setup } : {}),
  };

  const setupResult = options.setupResult ?? await runAgentTool('check_setup', context, {});
  if (setupNeedsAttention(setupResult)) {
    return buildSetupRequiredPlan(normalizedRequest, goal, setupResult);
  }

  if (!(await canLoadLLM(cwd))) {
    const plan = fallbackPlan(normalizedRequest);
    const firstCall = plan.calls[0];
    return {
      ...plan,
      previewResults: [{ ...setupResult, ...(firstCall ? { callId: firstCall.id } : {}) }],
    };
  }

  const config = await loadScrimbleConfig(cwd);
  const model = createLanguageModel(toModelConfig(config.ai));
  const tools = buildToolset(cwd, normalizedRequest, goal, 'plan', options);
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
    const fallbackPreview = await runAgentTool('check_status', context, {});
    const { calls: callsWithSetup, previewResults: previewsWithSetup } = ensureSetupCallFirst(
      [fallbackCall],
      [{ ...fallbackPreview, callId: fallbackCall.id }],
      setupResult,
    );

    return {
      id: randomUUID(),
      request: normalizedRequest,
      goal,
      calls: callsWithSetup,
      steps: buildSteps(callsWithSetup),
      previewResults: previewsWithSetup,
      requiresConfirmation: false,
      createdAt: new Date().toISOString(),
    };
  }

  const previewResultsFromModel: AgentToolResult[] = result.toolResults.map((toolResult) => {
    const action = toolResult.toolName as AgentToolAction;
    return normalizeToolResult(action, toolResult.result, toolResult.toolCallId);
  });

  const { calls: callsWithSetup, previewResults } = ensureSetupCallFirst(calls, previewResultsFromModel, setupResult);

  return {
    id: randomUUID(),
    request: normalizedRequest,
    goal,
    calls: callsWithSetup,
    steps: buildSteps(callsWithSetup),
    previewResults,
    requiresConfirmation: callsWithSetup.some((call) => call.mutating),
    createdAt: new Date().toISOString(),
  };
}

export async function executePlan(
  cwd: string,
  plan: AgentPlan,
  options: ExecutePlanOptions = {},
): Promise<AgentExecutionResult> {
  const context = {
    cwd,
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

  return {
    summary: results.map((entry) => entry.summary).join(' '),
    results,
  };
}

export function buildSingleCallPlan(plan: AgentPlan, call: AgentToolCall): AgentPlan {
  const normalizedCall = withBoundedExecuteDefaults(call);
  const matchingStep =
    plan.steps.find((step) => step.action === normalizedCall.action) ??
    { action: normalizedCall.action, summary: actionSummary(normalizedCall.action), mutating: normalizedCall.mutating };
  const previewResults = plan.previewResults.filter(
    (result) => result.action === 'check_setup' && result.dryRun !== true,
  );
  return {
    ...plan,
    calls: [normalizedCall],
    steps: [matchingStep],
    previewResults,
    requiresConfirmation: normalizedCall.mutating,
  };
}

function hasDependencyReady(task: LedgerTask, index: Map<string, LedgerTask>): boolean {
  return task.dependencies.every((dependencyId) => index.get(dependencyId)?.status === 'completed');
}

function readyTaskCount(ledger: LedgerDocument): number {
  const tasks = ledger.tasks.tasks;
  const index = new Map(tasks.map((task) => [task.id, task] as const));
  return tasks.filter((task) => task.status === 'pending' && hasDependencyReady(task, index)).length;
}

export function isReadOnlyRequest(request: string): boolean {
  const normalized = request.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const mutatingSignals =
    /\b(implement|fix|build|create|add|update|change|refactor|ship|execute|run|complete|write|modify|start)\b/;
  const readOnlySignals =
    /\b(status|progress|log|logs|show|list|inspect|review|summarize|what|why|diagnose|doctor|health)\b/;

  if (mutatingSignals.test(normalized)) {
    return false;
  }

  return readOnlySignals.test(normalized);
}

function readOnlyActionForRequest(request: string): AgentToolAction {
  const normalized = request.toLowerCase();
  if (/\b(log|logs|history)\b/.test(normalized)) {
    return 'show_logs';
  }
  if (/\b(doctor|diagnose|health)\b/.test(normalized)) {
    return 'doctor';
  }
  if (/\b(plan|next|todo|tasks?)\b/.test(normalized)) {
    return 'show_plan';
  }
  if (/\b(inspect|explore|repo|repository|files?|structure)\b/.test(normalized)) {
    return 'inspect_repo';
  }
  return 'check_status';
}

export function selectDeterministicStep(input: {
  request: string;
  interactionMode: InteractionMode;
  ledger: LedgerDocument;
  setupResult: AgentToolResult;
}): OperatorStep | undefined {
  if (input.setupResult.setupRequired === true) {
    return toOperatorStep(
      { id: randomUUID(), action: 'configure_ai', args: {}, mutating: true },
      input.interactionMode,
      'Local prerequisites are missing, so setup must be completed before continuing.',
    );
  }

  if (isReadOnlyRequest(input.request)) {
    const action = readOnlyActionForRequest(input.request);
    return toOperatorStep(
      { id: randomUUID(), action, args: {}, mutating: false },
      input.interactionMode,
      'This request is read-only, so the next step is a non-mutating status/inspection action.',
    );
  }

  const hasTaskGraph = input.ledger.tasks.tasks.length > 0;
  if (!hasTaskGraph) {
    return toOperatorStep(
      {
        id: randomUUID(),
        action: 'generate_or_update_tasks',
        args: { goal: normalizeGoal(input.request), replan: false },
        mutating: true,
      },
      input.interactionMode,
      'No task graph exists yet, so the next step is to generate one.',
    );
  }

  if (readyTaskCount(input.ledger) > 0) {
    return toOperatorStep(
      {
        id: randomUUID(),
        action: 'execute_tasks',
        args: { parallel: 1, maxTasks: 1 },
        mutating: true,
      },
      input.interactionMode,
      'Ready tasks exist, so the next safe step is to execute one bounded task.',
    );
  }

  return undefined;
}

export function nextStepFromPlan(plan: AgentPlan, interactionMode: InteractionMode): OperatorStep | undefined {
  const preferredCall =
    plan.calls.find((call) => call.action !== 'check_setup' && call.mutating) ??
    plan.calls.find((call) => call.action !== 'check_setup') ??
    plan.calls[0];
  if (!preferredCall) {
    return undefined;
  }

  const normalizedCall = withBoundedExecuteDefaults(preferredCall);
  const rationale =
    plan.steps.find((step) => step.action === normalizedCall.action)?.summary ?? actionSummary(normalizedCall.action);
  return toOperatorStep(normalizedCall, interactionMode, rationale);
}

export function buildProgressPrompt(request: string, completedSteps: Array<{ action: string; summary: string }>): string {
  if (completedSteps.length === 0) {
    return request;
  }

  return [
    `Current request: ${request}`,
    'Completed steps:',
    ...completedSteps.map((entry) => `- ${entry.action}: ${entry.summary}`),
    'Choose the next best action to continue.',
    'Do not repeat completed steps unless recovery is required.',
  ].join('\n');
}
