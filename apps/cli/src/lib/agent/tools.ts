import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  CONFIG_FILE,
  SCRIMBLE_DIR,
  aiModelStrategySchema,
  aiProfileAuthStrategySchema,
  aiProviderSchema,
  scrimbleConfigSchema,
  type AIProfileAuthStrategy,
  type AIProvider,
  type InteractionMode,
} from '@scrimble/shared';
import {
  describeProfileModel,
  getActiveProfile,
  buildDefaultScrimbleConfig,
  buildProviderProfile,
  upsertProfile,
} from '../ai/profiles.js';
import {
  evaluateProfileHealth,
  getDefaultApiKeyPlaceholder,
} from '../ai/provider.js';
import { getDefaultAuthStrategy, providerSupportsAutoModel } from '../ai/provider-catalog.js';
import { detectStack } from '../init/stack-detection.js';
import { setupLocalScaffold } from '../init/local-scaffold.js';
import { readLedgerEvents } from '../ledger/records.js';
import { getReadyTasks, updateTaskStatus } from '../ledger/operations.js';
import {
  mutateLedger,
  readLedger,
} from '../ledger/storage.js';
import { generateLedgerTasks } from '../planning/generate-ledger.js';
import { LedgerSupervisor } from '../scheduler/supervisor.js';
import { writeSecureJson } from '../security.js';
import { getWorkerDriver } from '../workers/factory.js';
import { loadScrimbleConfig } from '../config/load-config.js';
import type { AgentSetupInput, AgentToolAction, AgentToolResult, ExecutePlanOptions } from './types.js';

type ParsedScrimbleConfig = ReturnType<typeof scrimbleConfigSchema.parse>;

interface ToolContext {
  cwd: string;
  goal: string;
  request: string;
  setup?: AgentSetupInput;
}

interface ProfileSetupOverrides {
  model?: string | undefined;
  modelStrategy?: 'auto' | 'explicit' | undefined;
  authStrategy?: AIProfileAuthStrategy | undefined;
  apiKey?: string | undefined;
  token?: string | undefined;
  baseUrl?: string | undefined;
  profileName?: string | undefined;
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
  interactionMode: InteractionMode = 'guide',
  options: ProfileSetupOverrides = {},
): ParsedScrimbleConfig {
  let config = buildDefaultScrimbleConfig(interactionMode, provider);
  const activeProfile = getActiveProfile(config);
  if (!activeProfile) {
    return config;
  }
  const nextProfile = buildProviderProfile({
    id: activeProfile.id,
    name: options.profileName ?? activeProfile.name,
    provider,
    modelStrategy: options.modelStrategy
      ?? (options.model ? 'explicit' : providerSupportsAutoModel(provider) ? 'auto' : 'explicit'),
    model: options.model ?? activeProfile.model,
    authStrategy: options.authStrategy ?? getDefaultAuthStrategy(provider, false),
    apiKey: options.apiKey ?? activeProfile.auth.apiKey ?? getDefaultApiKeyPlaceholder(provider),
    token: options.token ?? activeProfile.auth.token,
    baseUrl: options.baseUrl ?? activeProfile.baseUrl,
    options: activeProfile.options,
    interactive: false,
  });
  config = upsertProfile(config, nextProfile, true);
  return scrimbleConfigSchema.parse(config);
}

async function readRawConfig(cwd: string): Promise<ParsedScrimbleConfig | null> {
  try {
    return await loadScrimbleConfig(cwd);
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
  interactionMode: InteractionMode = 'guide',
  options: ProfileSetupOverrides = {},
): Promise<boolean> {
  const scrimbleDir = path.join(cwd, SCRIMBLE_DIR);
  if (await pathExists(scrimbleDir)) {
    return false;
  }

  const stack = await detectStack(cwd);
  const repoName = path.basename(cwd);
  const config = defaultConfig(provider, interactionMode, options);
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
    const activeProfile = getActiveProfile(config);
    if (!activeProfile) {
      issues.push('No active AI profile is configured.');
      details.push('Profile state: missing');
    } else {
      const health = evaluateProfileHealth(activeProfile, { cwd: context.cwd });
      details.push(`Active profile: ${activeProfile.name} (${activeProfile.id})`);
      details.push(`Provider/model: ${activeProfile.provider}/${describeProfileModel(activeProfile)}`);
      details.push(
        `Auth: ${health.status} (configured=${health.authStrategy}, using=${health.resolvedAuthStrategy}${health.authSource ? `, source=${health.authSource}` : ''})`,
      );
      details.push(
        `Capabilities: ${health.capabilitySource}/${health.validationFreshness} (validated ${health.validatedAt})`,
      );
      details.push(`Model availability: ${health.modelAvailability}`);
      for (const issue of health.issues) {
        issues.push(issue);
      }
      for (const issue of health.usabilityIssues) {
        issues.push(issue);
      }
    }
  } else {
    issues.push('AI provider profiles are missing or invalid.');
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
  const modelStrategyArg = typeof args['modelStrategy'] === 'string' ? args['modelStrategy'] : undefined;
  const authStrategyArg = typeof args['authStrategy'] === 'string' ? args['authStrategy'] : undefined;
  const apiKeyArg = typeof args['apiKey'] === 'string' ? args['apiKey'] : undefined;
  const tokenArg = typeof args['token'] === 'string' ? args['token'] : undefined;
  const baseUrlArg = typeof args['baseUrl'] === 'string' ? args['baseUrl'] : undefined;
  const profileNameArg = typeof args['profileName'] === 'string' ? args['profileName'] : undefined;
  const provider = aiProviderSchema.parse(setup?.provider ?? 'openai');
  const selectedProvider = aiProviderSchema.parse(providerArg ?? provider);
  const selectedModel = modelArg?.trim() || setup?.model?.trim();
  const selectedModelStrategy = modelStrategyArg
    ? aiModelStrategySchema.parse(modelStrategyArg)
    : setup?.modelStrategy
      ?? (selectedModel ? 'explicit' : providerSupportsAutoModel(selectedProvider) ? 'auto' : 'explicit');
  const selectedAuthStrategy = authStrategyArg
    ? aiProfileAuthStrategySchema.parse(authStrategyArg)
    : setup?.authStrategy
      ?? getDefaultAuthStrategy(selectedProvider, false);
  const selectedApiKey = apiKeyArg?.trim() || setup?.apiKey?.trim();
  const selectedToken = tokenArg?.trim() || setup?.token?.trim();
  const selectedBaseUrl = baseUrlArg?.trim() || setup?.baseUrl?.trim();
  const selectedProfileName = profileNameArg?.trim() || setup?.profileName?.trim();
  const interactionMode: InteractionMode = setup?.interactionMode ?? 'guide';

  const scaffoldCreated = await ensureScaffoldIfMissing(
    context.cwd,
    context.goal,
    selectedProvider,
    interactionMode,
    {
      model: selectedModel,
      modelStrategy: selectedModelStrategy,
      authStrategy: selectedAuthStrategy,
      apiKey: selectedApiKey,
      token: selectedToken,
      baseUrl: selectedBaseUrl,
      profileName: selectedProfileName,
    },
  );
  const configPath = path.join(context.cwd, SCRIMBLE_DIR, CONFIG_FILE);
  const existing = await readRawConfig(context.cwd);
  const baseline = existing ?? defaultConfig(selectedProvider, interactionMode, {
    model: selectedModel,
    modelStrategy: selectedModelStrategy,
    authStrategy: selectedAuthStrategy,
    apiKey: selectedApiKey,
    token: selectedToken,
    baseUrl: selectedBaseUrl,
    profileName: selectedProfileName,
  });
  const activeProfile = getActiveProfile(baseline);
  const profileId = setup?.profileId
    ?? (activeProfile && activeProfile.provider === selectedProvider ? activeProfile.id : undefined);
  const nextProfile = buildProviderProfile({
    id: profileId,
    name: selectedProfileName ?? activeProfile?.name,
    provider: selectedProvider,
    modelStrategy: selectedModelStrategy,
    model: selectedModel || activeProfile?.model,
    authStrategy: selectedAuthStrategy,
    apiKey: selectedApiKey
      ?? (selectedProvider === 'github-copilot' ? undefined : activeProfile?.auth.apiKey)
      ?? getDefaultApiKeyPlaceholder(selectedProvider),
    token: selectedToken ?? activeProfile?.auth.token,
    baseUrl: selectedBaseUrl ?? activeProfile?.baseUrl,
    options: activeProfile?.options,
    interactive: false,
  });
  const merged = upsertProfile({
    ...baseline,
    interactionMode: setup?.interactionMode ?? existing?.interactionMode ?? 'guide',
  }, nextProfile, true);
  await writeSecureJson(configPath, merged);

  const health = evaluateProfileHealth(nextProfile, { cwd: context.cwd });
  const remainingIssues = [...health.issues, ...health.usabilityIssues];
  const setupStillRequired = remainingIssues.length > 0;

  return {
    action: 'configure_ai',
    summary: setupStillRequired
      ? 'Updated AI provider profile, but setup/auth still needs attention.'
      : scaffoldCreated
        ? 'Created local scaffold and saved AI provider profile.'
        : 'Updated AI provider profile.',
    details: [
      `Active profile: ${nextProfile.name} (${nextProfile.id})`,
      `Provider: ${nextProfile.provider}`,
      `Model: ${describeProfileModel(nextProfile)}`,
      `Auth strategy: ${nextProfile.auth.strategy}`,
      ...(setupStillRequired
        ? remainingIssues.map((issue) => `Remaining setup issue: ${issue}`)
        : []),
    ],
    ...(setupStillRequired ? { setupRequired: true } : {}),
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
    summary: replan
      ? 'Regenerated a foundation-aware task graph.'
      : 'Generated a foundation-aware task graph.',
    details: [
      `Goal: ${result.goal}`,
      `Tasks in graph: ${result.totalTasks}`,
      `New tasks: ${result.generatedTasks}`,
      ...(result.warnings.length > 0
        ? result.warnings.slice(0, 4).map((warning, index) => `Warning ${index + 1}: ${warning}`)
        : ['Warnings: none']),
      ...(result.qualityWarnings.length > 0
        ? result.qualityWarnings.slice(0, 4).map((warning, index) => `Quality warning ${index + 1}: ${warning}`)
        : ['Quality warnings: none']),
      ...(result.suggestions.length > 0
        ? result.suggestions.slice(0, 3).map((suggestion, index) => `Suggestion ${index + 1}: ${suggestion}`)
        : []),
    ],
  };
}

export async function showPlan(context: ToolContext): Promise<AgentToolResult> {
  const ledger = await readLedger(context.cwd);
  const tasksState = ledger.tasks;
  const readyTasks = await getReadyTasks(context.cwd);
  const next = tasksState.tasks
    .filter((task) => task.status === 'pending' || task.status === 'ready' || task.status === 'in_progress')
    .slice(0, 5)
    .map((task) => {
      const lines = [
        `${task.id}: ${task.title}`,
        `  rationale: ${task.rationale ?? 'No rationale captured.'}`,
        `  scope: ${task.ownedFiles.join(', ') || 'none'}`,
        `  dependencies: ${task.dependencies.join(', ') || 'none'}`,
        `  verification: ${task.verificationCommands.join(' && ') || 'none inferred'}`,
      ];
      if (task.planningWarnings && task.planningWarnings.length > 0) {
        lines.push(`  warnings: ${task.planningWarnings.join(', ')}`);
      }
      return lines;
    })
    .flat();
  const planningWarnings = tasksState.tasks
    .flatMap((task) => (task.planningWarnings ?? []).map((warning) => `${task.id}: ${warning}`));
  const summary = planningWarnings.length > 0
    ? `Plan review: ${readyTasks.length} ready tasks with ${planningWarnings.length} planning warnings.`
    : `Plan review: ${readyTasks.length} ready tasks.`;
  return {
    action: 'show_plan',
    summary,
    details: [
      `Ready tasks: ${readyTasks.length}`,
      ...(next.length > 0 ? next : ['No pending tasks']),
      ...(planningWarnings.length > 0
        ? ['Planning warnings:', ...planningWarnings.slice(0, 8)]
        : ['Planning warnings: none']),
    ],
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
  const readyTasks = await getReadyTasks(context.cwd);
  const planningWarnings = readyTasks
    .flatMap((task) => (task.planningWarnings ?? []).map((warning) => `${task.id}: ${warning}`))
    .slice(0, 5);
  const requestedParallel = parallelArg ?? options.parallel ?? 1;
  const requestedMaxTasks = maxTasksArg ?? options.maxTasks ?? 1;
  const effectiveParallel = 1;
  const effectiveMaxTasks = 1;
  const runResult = await supervisor.run({
    cwd: context.cwd,
    worker: workerArg ?? options.worker ?? config?.executionDefaults?.worker ?? 'auto',
    parallel: effectiveParallel,
    timeoutMs: options.timeoutMs ?? ((timeoutSecondsArg ?? config?.executionDefaults?.timeoutSeconds ?? 300) * 1000),
    maxTasks: effectiveMaxTasks,
  });

  const failureEvents = (await readLedgerEvents({ cwd: context.cwd, limit: 30 }))
    .filter((event) => ['task_failed', 'task_blocked', 'verification_failed', 'run_failed'].includes(event.type))
    .slice(0, 5)
    .map((event) => {
      const taskId = typeof event.data['taskId'] === 'string' ? event.data['taskId'] : undefined;
      const reason = typeof event.data['reason'] === 'string'
        ? event.data['reason']
        : typeof event.data['error'] === 'string'
          ? event.data['error']
          : undefined;
      const files = Array.isArray(event.data['outOfScopeFiles'])
        ? (event.data['outOfScopeFiles'] as unknown[]).map((entry) => String(entry)).join(', ')
        : undefined;
      const verification = typeof event.data['verification'] === 'string' ? event.data['verification'] : undefined;
      return [
        `${event.type}${taskId ? ` (${taskId})` : ''}`,
        ...(reason ? [reason] : []),
        ...(files ? [`files=${files}`] : []),
        ...(verification ? [`verification=${verification}`] : []),
      ].join(' • ');
    });
  const recoveryRecommendations = runResult.failedTaskIds.length > 0 || runResult.conflictedTaskIds.length > 0
    ? [
        'Recommended recovery:',
        '- Retry current task after inspecting failure context.',
        '- Replan if failures indicate stale scope or changed direction.',
        '- Revise foundation/goal if constraints no longer match requested outcome.',
      ]
    : [];

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
      ...(requestedMaxTasks > 1 ? ['Only one task attempt runs per execution step in the conversational runtime.'] : []),
      ...(planningWarnings.length > 0
        ? ['Planning warnings to review before next execution step:', ...planningWarnings]
        : []),
      ...(failureEvents.length > 0 ? ['Failure details:', ...failureEvents] : []),
      ...recoveryRecommendations,
    ],
  };
}

export async function checkStatus(context: ToolContext): Promise<AgentToolResult> {
  const ledger = await readLedger(context.cwd);
  const tasks = ledger.tasks.tasks;
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const blocked = tasks.filter((task) => task.status === 'blocked').length;
  const pending = tasks.filter((task) =>
    task.status === 'pending' || task.status === 'ready' || task.status === 'in_progress')
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

export async function repairState(
  context: ToolContext,
  args: Record<string, unknown> = {},
): Promise<AgentToolResult> {
  const strategyInput = typeof args['strategy'] === 'string' ? args['strategy'] : 'auto';
  const strategy = strategyInput === 'clear_stale_execution' || strategyInput === 'mark_failed_and_continue'
    ? strategyInput
    : 'auto';
  const repairs = await mutateLedger(context.cwd, (ledger) => {
    const updates: string[] = [];
    const now = new Date().toISOString();
    const tasks = ledger.tasks.tasks;
    const activeExecution = ledger.runtime.activeExecution;

    if (activeExecution) {
      const activeTask = tasks.find((task) => task.id === activeExecution.taskId);
      const staleExecution = !activeTask || activeTask.status !== 'in_progress';
      if ((strategy === 'auto' || strategy === 'clear_stale_execution') && staleExecution) {
        delete ledger.runtime.activeExecution;
        ledger.runtime.updatedAt = now;
        updates.push(`Cleared stale active execution for task "${activeExecution.taskId}".`);
      }
    }

    if (strategy === 'auto' || strategy === 'mark_failed_and_continue') {
      const activeTaskId = ledger.runtime.activeExecution?.taskId;
      const orphaned = tasks.filter((task) => task.status === 'in_progress' && task.id !== activeTaskId);
      for (const task of orphaned) {
        task.status = 'failed';
        task.error = 'Recovered from stale in_progress state with no matching runtime execution.';
        task.updatedAt = now;
        updates.push(`Marked orphaned in_progress task "${task.id}" as failed.`);
      }

      if (ledger.runtime.activeExecution && !ledger.orchestration.activeRun) {
        const task = tasks.find((entry) => entry.id === ledger.runtime.activeExecution?.taskId);
        if (task) {
          task.status = 'failed';
          task.error = 'Recovered from active runtime execution without orchestration active run.';
          task.updatedAt = now;
          updates.push(`Marked task "${task.id}" as failed due to missing active run.`);
        }
        delete ledger.runtime.activeExecution;
        ledger.runtime.updatedAt = now;
        updates.push('Cleared active execution without active orchestration run.');
      }
    }

    if (ledger.orchestration.activeRun?.pendingBoundary && ledger.runtime.activeExecution && strategy === 'auto') {
      delete ledger.runtime.activeExecution;
      ledger.runtime.updatedAt = now;
      updates.push('Cleared runtime active execution while orchestration was paused on approval boundary.');
    }

    if (updates.length > 0) {
      ledger.tasks.updatedAt = now;
      ledger.orchestration.updatedAt = now;
    }
    return updates;
  });

  return {
    action: 'repair_state',
    summary: repairs.length > 0
      ? 'Applied deterministic state repair actions.'
      : 'No repair was needed; runtime and orchestration state are consistent.',
    details: repairs.length > 0 ? repairs : ['State already consistent.'],
  };
}

export async function recoverFailedTasks(
  context: ToolContext,
  args: Record<string, unknown> = {},
): Promise<AgentToolResult> {
  const limitArg = typeof args['limit'] === 'number'
    ? Math.max(1, Math.min(5, Math.floor(args['limit'])))
    : 1;
  const ledger = await readLedger(context.cwd);
  const recoverable = ledger.tasks.tasks
    .filter((task) => task.status === 'failed' || task.status === 'blocked')
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

  if (recoverable.length === 0) {
    return {
      action: 'recover_failed_tasks',
      summary: 'No failed or blocked tasks required recovery.',
      details: ['Recoverable tasks: none'],
    };
  }

  const selected = recoverable.slice(0, limitArg);
  for (const task of selected) {
    await updateTaskStatus(task.id, 'ready', {
      error: null,
      cwd: context.cwd,
    });
  }

  const refreshed = await readLedger(context.cwd);
  const statusDetails = selected.map((task) => {
    const current = refreshed.tasks.tasks.find((entry) => entry.id === task.id);
    return `${task.id}: ${current?.status ?? 'missing'}`;
  });
  const readyAfter = await getReadyTasks(context.cwd);

  return {
    action: 'recover_failed_tasks',
    summary: `Recovered ${selected.length} task(s) for retry preparation.`,
    details: [
      `Recovered tasks: ${selected.map((task) => task.id).join(', ')}`,
      `Ready tasks after recovery: ${readyAfter.length}`,
      ...statusDetails,
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
    case 'repair_state':
      return repairState(context, args);
    case 'recover_failed_tasks':
      return recoverFailedTasks(context, args);
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
