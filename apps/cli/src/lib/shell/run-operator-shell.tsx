import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import React from 'react';
import {
  CONFIG_FILE,
  SCRIMBLE_DIR,
  type OrchestrationBoundaryState,
  type OrchestrationState,
  type ScrimbleConfig,
  type InteractionMode,
} from '@scrimble/shared';
import { render } from 'ink';
import { OperatorShell } from '../../components/shell/OperatorShell.js';
import type { StartupContext } from '../../components/shell/types.js';
import { detectConsistencyIssue } from '../agent/orchestrator-consistency.js';
import type { ConversationalOrchestrator } from '../agent/orchestrator.js';
import type { AgentSetupInput, AgentToolAction, OperatorBoundary } from '../agent/types.js';
import { evaluateProfileHealth, hasValidActiveProfile } from '../ai/provider.js';
import { buildDefaultScrimbleConfig, describeProfileModel, getActiveProfile } from '../ai/profiles.js';
import { runProviderSetupStudio } from '../ai/setup-studio.js';
import { loadScrimbleConfig } from '../config/load-config.js';
import { loadDiscoveryBootstrap } from '../discovery/foundation.js';
import { readLedger } from '../ledger/storage.js';
import { writeSecureJson } from '../security.js';

const execFileAsync = promisify(execFile);

const TOOL_ACTIONS: AgentToolAction[] = [
  'inspect_repo',
  'check_setup',
  'configure_ai',
  'generate_or_update_tasks',
  'show_plan',
  'execute_tasks',
  'repair_state',
  'recover_failed_tasks',
  'check_status',
  'show_logs',
  'doctor',
];

function toOperatorBoundary(boundary: OrchestrationBoundaryState | undefined): OperatorBoundary | undefined {
  if (!boundary) {
    return undefined;
  }

  const action = boundary.action as AgentToolAction;
  if (!TOOL_ACTIONS.includes(action)) {
    return undefined;
  }

  return {
    id: boundary.id,
    action,
    actionSummary: boundary.actionSummary,
    reason: boundary.reason,
    ...(boundary.category ? { category: boundary.category } : {}),
    ...(boundary.riskLevel ? { riskLevel: boundary.riskLevel } : {}),
    ...(boundary.nextStepHint ? { nextStepHint: boundary.nextStepHint } : {}),
    scope: boundary.scope,
    choices: boundary.choices,
  };
}

async function detectBranch(cwd: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      windowsHide: true,
      timeout: 1_500,
      maxBuffer: 16 * 1024,
    });
    const value = result.stdout.trim();
    if (!value || value === 'HEAD') {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

async function tryLoadConfig(cwd: string): Promise<ScrimbleConfig | null> {
  try {
    return await loadScrimbleConfig(cwd);
  } catch {
    return null;
  }
}

function syncSetupSeedFromConfig(setupSeed: AgentSetupInput, config: ScrimbleConfig, mode: InteractionMode): void {
  const active = getActiveProfile(config);
  if (!active) {
    return;
  }
  setupSeed.profileId = active.id;
  setupSeed.profileName = active.name;
  setupSeed.provider = active.provider;
  setupSeed.modelStrategy = active.modelStrategy;
  if (active.model) {
    setupSeed.model = active.model;
  } else {
    delete setupSeed.model;
  }
  setupSeed.authStrategy = active.auth.strategy;
  if (active.auth.apiKey) {
    setupSeed.apiKey = active.auth.apiKey;
  }
  if (active.auth.token) {
    setupSeed.token = active.auth.token;
  }
  if (active.baseUrl) {
    setupSeed.baseUrl = active.baseUrl;
  }
  setupSeed.interactionMode = mode;
}

export interface RunOperatorShellOptions {
  cwd: string;
  orchestrator: ConversationalOrchestrator;
  interactionMode: InteractionMode;
  setupSeed: AgentSetupInput;
  autoConfirm: boolean;
  verbose: boolean;
  config?: ScrimbleConfig | null;
}

export interface StartupContextOptions {
  cwd: string;
  interactionMode: InteractionMode;
  config: ScrimbleConfig | null;
  session: OrchestrationState | null;
}

export async function buildStartupContext(options: StartupContextOptions): Promise<StartupContext> {
  const ledger = await readLedger(options.cwd);
  const session = options.session ?? ledger.orchestration;
  const discovery = await loadDiscoveryBootstrap(options.cwd);
  const issue = detectConsistencyIssue(ledger);
  const activeExecution = ledger.runtime.activeExecution;
  const blockedTask = ledger.tasks.tasks.find((task) => task.status === 'blocked');
  const failedTask = ledger.tasks.tasks.find((task) => task.status === 'failed');
  const activeProfile = options.config ? getActiveProfile(options.config) : undefined;
  const profileHealth = activeProfile ? evaluateProfileHealth(activeProfile, { cwd: options.cwd }) : undefined;
  const profileValid = Boolean(activeProfile && profileHealth && profileHealth.usableNow);
  const recentOutcomes = (session.recentOutcomes ?? (session.lastRunOutcome ? [session.lastRunOutcome] : []))
    .slice(-5)
    .reverse()
    .map((outcome) => ({
      status: outcome.status,
      request: outcome.request,
      summary: outcome.summary,
      completedAt: outcome.completedAt,
    }));

  const recoveryActions = !profileValid
    ? [
        { kind: 'configure_providers', label: 'Configure providers', description: 'Open setup studio for provider/auth/model configuration.' },
      ]
    : issue
      ? [
          { kind: 'repair_state', label: 'Repair state', description: 'Clear stale runtime state and repair in_progress mismatches.' },
          { kind: 'show_logs', label: 'Inspect logs', description: 'Inspect recent runtime events before continuing.' },
          { kind: 'replan', label: 'Replan', description: 'Regenerate next steps from the current ledger state.' },
        ]
      : session.activeRun?.pendingBoundary
        ? [
            { kind: 'approve', label: 'Approve boundary', description: 'Proceed with the currently requested action.' },
            { kind: 'redirect', label: 'Redirect', description: 'Change direction with a new instruction.' },
            { kind: 'pause', label: 'Pause', description: 'Keep run paused and continue later.' },
          ]
        : activeExecution
          ? [
              { kind: 'resume', label: 'Resume run', description: 'Continue from the current active run state.' },
              { kind: 'show_logs', label: 'Inspect logs', description: 'Review runtime output before steering.' },
            ]
          : blockedTask
            ? [
                { kind: 'retry_task', label: 'Retry task', description: 'Retry the blocked task in bounded mode.' },
                { kind: 'replan', label: 'Replan', description: 'Refresh tasks and recover from blockers.' },
                { kind: 'show_logs', label: 'Inspect logs', description: 'Inspect details for ownership/verification failure.' },
              ]
            : failedTask
              ? [
                  { kind: 'retry_task', label: 'Retry task', description: 'Retry failed attempt with bounded execution.' },
                  { kind: 'replan', label: 'Replan', description: 'Rebuild task graph if direction has changed.' },
                  { kind: 'show_logs', label: 'Inspect logs', description: 'Inspect failure details and involved files/commands.' },
                ]
              : session.lastRunOutcome?.status === 'completed'
                ? [
                    { kind: 'dismiss_completed', label: 'Dismiss', description: 'Clear completed run context from startup surface.' },
                    { kind: 'show_plan', label: 'Show plan', description: 'Review next tasks and recommendations.' },
                  ]
                : [];

  const recoveryState = issue
    ? 'inconsistent'
    : session.activeRun?.pendingBoundary
      ? 'pending_approval'
      : activeExecution || session.activeRun
        ? 'resumable'
        : blockedTask
          ? 'blocked'
          : failedTask
            ? 'failed'
            : session.lastRunOutcome?.status === 'completed'
              ? 'completed'
              : 'idle';

  const recoveryMessage = !profileValid
    ? profileHealth?.usabilityIssues[0] ?? profileHealth?.issues[0] ?? 'No valid active provider profile is configured.'
    : issue
      ? issue
      : session.activeRun?.pendingBoundary
        ? `Pending approval: ${session.activeRun.pendingBoundary.actionSummary}`
        : activeExecution
          ? `Active execution: ${activeExecution.taskId} (${activeExecution.phase ?? 'executing'})`
          : blockedTask
            ? `Blocked task: ${blockedTask.id}${blockedTask.error ? ` (${blockedTask.error})` : ''}`
            : failedTask
              ? `Failed task: ${failedTask.id}${failedTask.error ? ` (${failedTask.error})` : ''}`
              : session.lastRunOutcome
                ? `Last outcome: ${session.lastRunOutcome.summary}`
                : undefined;

  return {
    repoName: path.basename(options.cwd),
    repoPath: options.cwd,
    branch: await detectBranch(options.cwd),
    mode: options.interactionMode,
    ...(activeProfile ? { profileName: activeProfile.name } : {}),
    ...(activeProfile ? { provider: activeProfile.provider } : {}),
    ...(activeProfile ? { modelStrategy: activeProfile.modelStrategy } : {}),
    ...(activeProfile ? { model: describeProfileModel(activeProfile) } : {}),
    ...(profileHealth ? { modelAvailability: profileHealth.modelAvailability } : {}),
    ...(profileHealth ? { capabilitySource: profileHealth.capabilitySource } : {}),
    ...(profileHealth ? { validationFreshness: profileHealth.validationFreshness } : {}),
    ...(profileHealth ? { validatedAt: profileHealth.validatedAt } : {}),
    ...(profileHealth ? { authStatus: profileHealth.status } : {}),
    ...(profileHealth?.authSource ? { authSource: profileHealth.authSource } : {}),
    profileValid,
    hasConfig: Boolean(options.config),
    hasScrimbleDir: existsSync(path.join(options.cwd, SCRIMBLE_DIR)),
    activeRunRequest: session.activeRun?.request,
    pendingBoundary: toOperatorBoundary(session.activeRun?.pendingBoundary),
    lastPauseReason: session.activeRun?.lastPauseReason,
    lastOutcomeSummary: session.lastRunOutcome?.summary,
    lastOutcomeStatus: session.lastRunOutcome?.status,
    foundationReady: !discovery.requiresDiscovery,
    discoveryMode: discovery.state.mode,
    discoveryStep: discovery.state.step,
    discoveryQuestionIndex: discovery.state.questionIndex,
    discoveryScan: discovery.scan,
    discoveryDraft: discovery.state.draft,
    activeExecutionTaskId: activeExecution?.taskId,
    activeExecutionPhase: activeExecution?.phase,
    activeExecutionStatusMessage: activeExecution?.statusMessage,
    lastCompletedStep: session.activeRun?.lastCompletedStep?.summary,
    blockedTaskId: blockedTask?.id,
    blockedTaskReason: blockedTask?.error,
    failedTaskId: failedTask?.id,
    failedTaskReason: failedTask?.error,
    recoveryState,
    ...(recoveryMessage ? { recoveryMessage } : {}),
    recoveryActions,
    recentOutcomes,
  };
}

async function ensureProviderSetup(options: {
  cwd: string;
  interactionMode: InteractionMode;
  config: ScrimbleConfig | null;
  setupSeed: AgentSetupInput;
  reason: string;
}): Promise<ScrimbleConfig | null | undefined> {
  const scrimbleDirPath = path.join(options.cwd, SCRIMBLE_DIR);
  if (!existsSync(scrimbleDirPath)) {
    return options.config;
  }
  if (options.config && hasValidActiveProfile(options.config, { cwd: options.cwd })) {
    return options.config;
  }

  const baseline = options.config ?? buildDefaultScrimbleConfig(options.interactionMode, options.setupSeed.provider ?? 'openai');
  const result = await runProviderSetupStudio({
    config: baseline,
    reason: options.reason,
    seed: {
      ...(options.setupSeed.provider ? { provider: options.setupSeed.provider } : {}),
      ...(options.setupSeed.model ? { model: options.setupSeed.model } : {}),
      ...(options.setupSeed.profileName ? { profileName: options.setupSeed.profileName } : {}),
    },
  });
  if (!result) {
    return undefined;
  }
  const configPath = path.join(options.cwd, SCRIMBLE_DIR, CONFIG_FILE);
  await writeSecureJson(configPath, result.config);
  syncSetupSeedFromConfig(options.setupSeed, result.config, options.interactionMode);
  return result.config;
}

export async function runOperatorShell(options: RunOperatorShellOptions): Promise<void> {
  let config = options.config ?? await tryLoadConfig(options.cwd);
  if (config) {
    syncSetupSeedFromConfig(options.setupSeed, config, options.interactionMode);
  }

  const preparedConfig = await ensureProviderSetup({
    cwd: options.cwd,
    interactionMode: options.interactionMode,
    config,
    setupSeed: options.setupSeed,
    reason: 'No valid active provider profile was found.',
  });
  if (preparedConfig === undefined) {
    return;
  }
  config = preparedConfig;

  for (;;) {
    const session = await options.orchestrator.loadSessionState();
    const startup = await buildStartupContext({
      cwd: options.cwd,
      interactionMode: options.interactionMode,
      config,
      session,
    });

    let wantsProviderSetup = false;
    const instance = render(
      <OperatorShell
        startup={startup}
        initialMode={options.interactionMode}
        autoConfirm={options.autoConfirm}
        initialVerbose={options.verbose}
        setupSeed={options.setupSeed}
        runRequest={(request, runOptions) => options.orchestrator.runRequest(request, runOptions)}
        resumeActiveRun={(runOptions) => options.orchestrator.resumeActiveRun(runOptions)}
        onExitAction={(action) => {
          wantsProviderSetup = action === 'configure_providers';
        }}
      />,
      { exitOnCtrlC: false },
    );
    await instance.waitUntilExit();

    if (!wantsProviderSetup) {
      return;
    }

    const updatedConfig = await ensureProviderSetup({
      cwd: options.cwd,
      interactionMode: options.interactionMode,
      config,
      setupSeed: options.setupSeed,
      reason: 'Configure providers from shell steering action.',
    });
    if (updatedConfig === undefined) {
      return;
    }
    config = updatedConfig;
  }
}
