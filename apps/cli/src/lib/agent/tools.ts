import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  CONFIG_FILE,
  SCRIMBLE_DIR,
  aiProviderSchema,
  scrimbleConfigSchema,
  type AIProvider,
  type InteractionMode,
} from '@scrimble/shared';
import { buildDefaultAIConfig, getDefaultApiKeyPlaceholder } from '../ai/provider.js';
import { detectStack } from '../init/stack-detection.js';
import { setupLocalScaffold } from '../init/local-scaffold.js';
import { readLedgerEvents } from '../ledger/records.js';
import { getReadyTasks } from '../ledger/operations.js';
import {
  mutateLedger,
  readLedger,
} from '../ledger/storage.js';
import { generateLedgerTasks } from '../planning/generate-ledger.js';
import { LedgerSupervisor } from '../scheduler/supervisor.js';
import { writeSecureJson } from '../security.js';
import { getWorkerDriver } from '../workers/factory.js';
import type { AgentSetupInput, AgentToolAction, AgentToolResult, ExecutePlanOptions } from './types.js';

type ParsedScrimbleConfig = ReturnType<typeof scrimbleConfigSchema.parse>;

interface ToolContext {
  cwd: string;
  goal: string;
  request: string;
  setup?: AgentSetupInput;
}

export function toToolArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listTopLevelDirectories(cwd: string): Promise<string[]> {
  const entries = await fs.readdir(cwd, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 12);
}

function defaultConfig(
  provider: AIProvider,
  model?: string,
  apiKey?: string,
  interactionMode: InteractionMode = 'guide',
): ParsedScrimbleConfig {
  const ai = buildDefaultAIConfig(provider, model);
  return scrimbleConfigSchema.parse({
    schemaVersion: 1,
    ai: {
      ...ai,
      apiKey: apiKey?.trim() || ai.apiKey || getDefaultApiKeyPlaceholder(provider),
    },
    interactionMode,
    plannerWorker: 'auto',
    workerPreferences: {
      defaultWorker: 'auto',
      allowParallel: false,
      maxParallelWorkers: 1,
    },
    executionDefaults: {
      worker: 'auto',
      timeoutSeconds: 300,
      maxParallelTasks: 1,
      maxRetriesPerTask: 1,
    },
    verificationDefaults: {
      enabled: true,
    },
  });
}

async function readRawConfig(cwd: string): Promise<ParsedScrimbleConfig | null> {
  const configPath = path.join(cwd, SCRIMBLE_DIR, CONFIG_FILE);
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return scrimbleConfigSchema.parse(JSON.parse(raw) as unknown);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    return null;
  }
}

async function ensureScaffoldIfMissing(
  cwd: string,
  goal: string,
  provider: AIProvider,
  model?: string,
  apiKey?: string,
  interactionMode: InteractionMode = 'guide',
): Promise<boolean> {
  const scrimbleDir = path.join(cwd, SCRIMBLE_DIR);
  if (await pathExists(scrimbleDir)) {
    return false;
  }

  const stack = await detectStack(cwd);
  const repoName = path.basename(cwd);
  const config = defaultConfig(provider, model, apiKey, interactionMode);
  const projectData: Record<string, unknown> = {
    name: repoName,
    path: cwd,
    stack,
    initialized: new Date().toISOString(),
    goal,
    localFirst: true,
  };
  await setupLocalScaffold({
    cwd,
    scrimbleDir,
    repoName,
    goal,
    stack,
    config,
    projectData,
  });
  return true;
}

export async function inspectRepo(context: ToolContext): Promise<AgentToolResult> {
  const stack = await detectStack(context.cwd);
  const directories = await listTopLevelDirectories(context.cwd);
  const ledger = await readLedger(context.cwd);
  return {
    action: 'inspect_repo',
    summary: 'Inspected repository structure and current local ledger state.',
    details: [
      `Languages: ${stack.languages.join(', ') || 'unknown'}`,
      `Frameworks: ${stack.frameworks.join(', ') || 'none detected'}`,
      `Top directories: ${directories.join(', ') || 'none'}`,
      `Ledger tasks: ${ledger.tasks.tasks.length}`,
    ],
  };
}

export async function checkSetup(context: ToolContext): Promise<AgentToolResult> {
  const details: string[] = [];
  const issues: string[] = [];
  const scrimbleDir = path.join(context.cwd, SCRIMBLE_DIR);
  if (await pathExists(scrimbleDir)) {
    details.push('.scrimble directory is present.');
  } else {
    issues.push('.scrimble directory is missing.');
  }

  const config = await readRawConfig(context.cwd);
  if (config) {
    details.push(`AI config: provider=${config.ai.provider}, model=${config.ai.model}`);
  } else {
    issues.push('AI config is missing or invalid.');
  }
  details.push('Worker readiness checks are available via `doctor`.');

  return {
    action: 'check_setup',
    summary:
      issues.length === 0
        ? 'You are ready to plan and run work in this repository.'
        : `Before I can continue, I need to fix: ${issues.join(' | ')}`,
    details,
    ...(issues.length > 0 ? { setupRequired: true } : {}),
  };
}

export async function configureAi(
  context: ToolContext,
  args: Record<string, unknown> = {},
): Promise<AgentToolResult> {
  const setup = context.setup;
  const providerArg = typeof args['provider'] === 'string' ? args['provider'] : undefined;
  const modelArg = typeof args['model'] === 'string' ? args['model'] : undefined;
  const apiKeyArg = typeof args['apiKey'] === 'string' ? args['apiKey'] : undefined;
  const provider = aiProviderSchema.parse(setup?.provider ?? 'openai');
  const selectedProvider = aiProviderSchema.parse(providerArg ?? provider);
  const model = modelArg?.trim() || setup?.model?.trim() || buildDefaultAIConfig(selectedProvider).model;
  const apiKey = apiKeyArg?.trim() || setup?.apiKey?.trim() || getDefaultApiKeyPlaceholder(selectedProvider);
  const interactionMode: InteractionMode = setup?.interactionMode ?? 'guide';

  const scaffoldCreated = await ensureScaffoldIfMissing(
    context.cwd,
    context.goal,
    selectedProvider,
    model,
    apiKey,
    interactionMode,
  );
  const configPath = path.join(context.cwd, SCRIMBLE_DIR, CONFIG_FILE);
  const existing = await readRawConfig(context.cwd);
  const merged = scrimbleConfigSchema.parse({
    ...(existing ?? defaultConfig(selectedProvider, model, apiKey, interactionMode)),
    interactionMode: setup?.interactionMode ?? existing?.interactionMode ?? 'guide',
    ai: {
      ...buildDefaultAIConfig(selectedProvider, model),
      ...(existing?.ai ?? {}),
      provider: selectedProvider,
      model,
      apiKey,
    },
  });
  await writeSecureJson(configPath, merged);

  return {
    action: 'configure_ai',
    summary: scaffoldCreated ? 'Created local scaffold and saved AI configuration.' : 'Updated AI configuration.',
    details: [`Provider: ${merged.ai.provider}`, `Model: ${merged.ai.model}`],
  };
}

export async function generateOrUpdateTasks(context: ToolContext, replan: boolean): Promise<AgentToolResult> {
  const goal = context.goal;
  const result = await generateLedgerTasks({
    goal,
    replan,
    cwd: context.cwd,
  });
  return {
    action: 'generate_or_update_tasks',
    summary: replan ? 'Regenerated the local task graph.' : 'Generated a fresh local task graph.',
    details: [`Goal: ${result.goal}`, `Tasks in graph: ${result.totalTasks}`, `New tasks: ${result.generatedTasks}`],
  };
}

export async function showPlan(context: ToolContext): Promise<AgentToolResult> {
  const ledger = await readLedger(context.cwd);
  const tasksState = ledger.tasks;
  const readyTasks = await getReadyTasks(context.cwd);
  const next = tasksState.tasks
    .filter((task) => task.status === 'pending' || task.status === 'running' || task.status === 'leased')
    .slice(0, 5)
    .map((task) => `${task.id}: ${task.title}`);
  return {
    action: 'show_plan',
    summary: 'I outlined the next work steps from your current plan.',
    details: [`Ready tasks: ${readyTasks.length}`, ...(next.length > 0 ? next : ['No pending tasks'])],
  };
}

export async function executeTasks(
  context: ToolContext,
  args: Record<string, unknown> = {},
  options: ExecutePlanOptions = {},
): Promise<AgentToolResult> {
  const workerArg = typeof args['worker'] === 'string' && ['auto', 'gemini', 'copilot'].includes(args['worker'])
    ? (args['worker'] as 'auto' | 'gemini' | 'copilot')
    : undefined;
  const parallelArg = typeof args['parallel'] === 'number' ? args['parallel'] : undefined;
  const timeoutSecondsArg = typeof args['timeoutSeconds'] === 'number' ? args['timeoutSeconds'] : undefined;
  const maxTasksArg = typeof args['maxTasks'] === 'number' ? args['maxTasks'] : undefined;

  const approvalNote = options.planId
    ? `approved via conversational confirmation (plan ${options.planId})`
    : 'approved via conversational orchestration';
  await mutateLedger(context.cwd, (ledger) => {
    ledger.approval = {
      ...ledger.approval,
      approved: true,
      approvedAt: new Date().toISOString(),
      notes: approvalNote,
      updatedAt: new Date().toISOString(),
    };
  });

  const config = await readRawConfig(context.cwd);
  const supervisor = new LedgerSupervisor();
  const requestedParallel = parallelArg ?? options.parallel ?? 1;
  const effectiveParallel = 1;
  const effectiveMaxTasks = maxTasksArg ?? options.maxTasks ?? 1;
  const runResult = await supervisor.run({
    cwd: context.cwd,
    worker: workerArg ?? options.worker ?? config?.executionDefaults?.worker ?? 'auto',
    parallel: effectiveParallel,
    timeoutMs: options.timeoutMs ?? ((timeoutSecondsArg ?? config?.executionDefaults?.timeoutSeconds ?? 300) * 1000),
    maxTasks: effectiveMaxTasks,
  });

  return {
    action: 'execute_tasks',
    summary: `Worked through the plan: ${runResult.completedTaskIds.length} completed, ${runResult.failedTaskIds.length} failed, ${runResult.conflictedTaskIds.length} conflicted.`,
    details: [
      runResult.completedTaskIds.length > 0
        ? `Completed tasks: ${runResult.completedTaskIds.join(', ')}`
        : 'Completed tasks: none',
      runResult.failedTaskIds.length > 0 ? `Failed tasks: ${runResult.failedTaskIds.join(', ')}` : 'Failed tasks: none',
      runResult.conflictedTaskIds.length > 0
        ? `Conflicted tasks: ${runResult.conflictedTaskIds.join(', ')}`
        : 'Conflicted tasks: none',
      ...(requestedParallel > 1 ? ['Execution scope normalized to one active task at a time.'] : []),
    ],
  };
}

export async function checkStatus(context: ToolContext): Promise<AgentToolResult> {
  const ledger = await readLedger(context.cwd);
  const tasks = ledger.tasks.tasks;
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const blocked = tasks.filter((task) => task.status === 'blocked').length;
  const pending = tasks.filter((task) => task.status === 'pending' || task.status === 'leased' || task.status === 'running')
    .length;
  const nextAction = blocked > 0
    ? 'Unblock blocked tasks or revise the plan.'
    : pending > 0
      ? 'Continue with the next ready task.'
      : 'Capture a new goal to generate more work.';
  return {
    action: 'check_status',
    summary: tasks.length === 0
      ? 'No active work plan yet.'
      : `Progress: ${completed}/${tasks.length} tasks complete${blocked > 0 ? `, ${blocked} blocked` : ''}.`,
    details: [
      `Current goal: ${ledger.intent.intent?.goal ?? 'not captured'}`,
      `Pending tasks: ${pending}`,
      `Approval ready: ${ledger.approval.approved ? 'yes' : 'no'}`,
      `Next recommended action: ${nextAction}`,
    ],
  };
}

export async function showLogs(context: ToolContext, args: Record<string, unknown> = {}): Promise<AgentToolResult> {
  const limit = typeof args['limit'] === 'number' ? Math.max(1, Math.min(100, Math.floor(args['limit']))) : 20;
  const events = await readLedgerEvents({ cwd: context.cwd, limit });
  const newestEvent = events[0];
  return {
    action: 'show_logs',
    summary: events.length === 0
      ? 'No recent runtime activity was found.'
      : `Recent activity loaded (${events.length} events${newestEvent ? `, latest: ${newestEvent.type}` : ''}).`,
    details: events.slice(0, 10).map((event) => `${event.timestamp} ${event.type}`),
  };
}

export async function doctor(context: ToolContext): Promise<AgentToolResult> {
  const setup = await checkSetup(context);
  const workerDetails: string[] = [];
  for (const workerKind of ['gemini', 'copilot'] as const) {
    const preflight = await getWorkerDriver(workerKind, { cwd: context.cwd }).preflight();
    if (preflight.available) {
      workerDetails.push(`${workerKind}: ready${preflight.version ? ` (${preflight.version})` : ''}`);
    } else {
      workerDetails.push(`${workerKind}: ${preflight.errors[0] ?? 'unavailable'}`);
    }
  }
  return {
    action: 'doctor',
    summary: setup.summary,
    details: [`Node.js: ${process.version}`, ...setup.details, ...workerDetails],
  };
}

export async function runAgentTool(
  action: AgentToolAction,
  context: ToolContext,
  args: Record<string, unknown> = {},
  options: {
    replan?: boolean;
    execute?: ExecutePlanOptions;
  } = {},
): Promise<AgentToolResult> {
  switch (action) {
    case 'inspect_repo':
      return inspectRepo(context);
    case 'check_setup':
      return checkSetup(context);
    case 'configure_ai':
      return configureAi(context, args);
    case 'generate_or_update_tasks':
      return generateOrUpdateTasks(
        {
          ...context,
          goal: typeof args['goal'] === 'string' && args['goal'].trim() ? String(args['goal']) : context.goal,
        },
        options.replan ?? (args['replan'] === true),
      );
    case 'show_plan':
      return showPlan(context);
    case 'execute_tasks':
      return executeTasks(context, args, options.execute);
    case 'check_status':
      return checkStatus(context);
    case 'show_logs':
      return showLogs(context, args);
    case 'doctor':
      return doctor(context);
    default: {
      const neverAction: never = action;
      throw new Error(`Unsupported agent action: ${String(neverAction)}`);
    }
  }
}
