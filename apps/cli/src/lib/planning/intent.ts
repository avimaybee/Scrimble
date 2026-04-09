import { randomUUID } from 'node:crypto';
import type {
  DiscoveryMode,
  DiscoveryStep,
  Intent,
  IntentCaptureInput,
  IntentDiscoveryState,
  IntentState,
  RepoScanSummary,
} from '@scrimble/shared';
import { mutateLedger, readLedger } from '../ledger/storage.js';

function splitIntoItems(value: string): string[] {
  return value
    .split(/\r?\n|;/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeGoal(goal: string): string {
  return goal.replace(/\s+/g, ' ').trim();
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function defaultDiscoveryState(): IntentDiscoveryState {
  return {
    status: 'not_started',
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeIntent(input: IntentCaptureInput): Intent {
  const now = new Date().toISOString();
  const previous = input.previousIntent;
  const normalizedGoal = normalizeGoal(input.initialGoal);

  const assumptions = previous?.productAssumptions ?? [];
  const technicalConstraints = previous?.technicalConstraints ?? previous?.constraints ?? [];
  const productConstraints = previous?.productConstraints ?? [];
  const successCriteria = previous?.successCriteria ?? ['Core workflow works end-to-end'];
  const nonGoals = previous?.nonGoals ?? previous?.outOfScope ?? [];
  const outOfScope = previous?.outOfScope ?? previous?.nonGoals ?? [];

  if (input.repoContext?.frameworks.length) {
    assumptions.push(`Use existing stack: ${input.repoContext.frameworks.join(', ')}`);
  }
  if (input.repoContext?.primaryLanguage) {
    assumptions.push(`Primary language: ${input.repoContext.primaryLanguage}`);
  }

  return {
    id: previous?.id ?? randomUUID(),
    projectName: previous?.projectName ?? input.repoContext?.name ?? 'Project',
    goal: normalizedGoal,
    productVision: previous?.productVision ?? normalizedGoal,
    productAssumptions: dedupe(assumptions),
    productConstraints: dedupe(productConstraints),
    technicalConstraints: dedupe(technicalConstraints),
    constraints: dedupe(technicalConstraints),
    successCriteria: dedupe(successCriteria),
    nonGoals: dedupe(nonGoals),
    outOfScope: dedupe(outOfScope),
    targetUsers: previous?.targetUsers ?? 'Primary users of this project',
    timeline: previous?.timeline ?? 'flexible',
    qualityPreference: previous?.qualityPreference ?? 'production',
    inferredStack: previous?.inferredStack ?? {
      projectType: input.repoContext?.projectType ?? 'brownfield',
      repoName: input.repoContext?.name ?? 'project',
      repoPath: input.repoContext?.path ?? '.',
      ...(input.repoContext?.branch ? { branch: input.repoContext.branch } : {}),
      languages: input.repoContext?.primaryLanguage ? [input.repoContext.primaryLanguage] : [],
      frameworks: input.repoContext?.frameworks ?? [],
      ...(input.repoContext?.packageManager ? { packageManager: input.repoContext.packageManager } : {}),
    },
    ...(previous?.designDirection ? { designDirection: previous.designDirection } : {}),
    discoveryMode: previous?.discoveryMode ?? 'autogenerate',
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

export function mergeIntentNotes(
  intent: Intent,
  updates: {
    assumptions?: string;
    constraints?: string;
    productConstraints?: string;
    successCriteria?: string;
    outOfScope?: string;
    nonGoals?: string;
  },
): Intent {
  const mergedTechnical = dedupe([...intent.technicalConstraints, ...splitIntoItems(updates.constraints ?? '')]);
  const mergedNonGoals = dedupe([
    ...intent.nonGoals,
    ...intent.outOfScope,
    ...splitIntoItems(updates.nonGoals ?? ''),
    ...splitIntoItems(updates.outOfScope ?? ''),
  ]);
  return {
    ...intent,
    productAssumptions: dedupe([...intent.productAssumptions, ...splitIntoItems(updates.assumptions ?? '')]),
    productConstraints: dedupe([...intent.productConstraints, ...splitIntoItems(updates.productConstraints ?? '')]),
    technicalConstraints: mergedTechnical,
    constraints: mergedTechnical,
    successCriteria: dedupe([...intent.successCriteria, ...splitIntoItems(updates.successCriteria ?? '')]),
    nonGoals: mergedNonGoals,
    outOfScope: mergedNonGoals,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadIntentState(cwd: string = process.cwd()): Promise<IntentState> {
  const ledger = await readLedger(cwd);
  const state = ledger.intent;
  return {
    ...state,
    discovery: state.discovery ?? defaultDiscoveryState(),
  };
}

export async function loadCurrentIntent(cwd: string = process.cwd()): Promise<Intent | null> {
  const state = await loadIntentState(cwd);
  return state.intent;
}

export function isFoundationReady(state: IntentState): boolean {
  return state.discovery.status === 'approved' || state.discovery.status === 'skipped';
}

export async function hasApprovedOrSkippedFoundation(cwd: string = process.cwd()): Promise<boolean> {
  const state = await loadIntentState(cwd);
  return isFoundationReady(state);
}

export async function saveCurrentIntent(
  intent: Intent,
  options: { reason: string; cwd?: string } = { reason: 'intent_update' },
): Promise<IntentState> {
  const cwd = options.cwd ?? process.cwd();
  return mutateLedger(cwd, (ledger) => {
    const state = ledger.intent;
    const history = state.intent
      ? [...state.history, { intent: state.intent, reason: options.reason, changedAt: new Date().toISOString() }]
      : state.history;

    const nextState: IntentState = {
      version: state.version,
      intent,
      discovery: state.discovery ?? defaultDiscoveryState(),
      history,
      updatedAt: new Date().toISOString(),
    };
    ledger.intent = nextState;
    return nextState;
  });
}

export async function saveDiscoveryState(
  discovery: IntentDiscoveryState,
  cwd: string = process.cwd(),
): Promise<IntentDiscoveryState> {
  return mutateLedger(cwd, (ledger) => {
    const current = ledger.intent;
    ledger.intent = {
      ...current,
      discovery: {
        ...discovery,
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
    return ledger.intent.discovery;
  });
}

export async function saveDiscoveryDraft(
  draft: Intent,
  options: {
    mode: DiscoveryMode;
    step: DiscoveryStep;
    scan: RepoScanSummary;
    cwd?: string;
  },
): Promise<IntentDiscoveryState> {
  const cwd = options.cwd ?? process.cwd();
  return saveDiscoveryState({
    status: 'draft_ready',
    mode: options.mode,
    step: options.step,
    scan: options.scan,
    draft,
    updatedAt: new Date().toISOString(),
  }, cwd);
}

export async function markDiscoveryInProgress(
  options: {
    mode: DiscoveryMode;
    step: DiscoveryStep;
    questionIndex?: number;
    scan: RepoScanSummary;
    draft?: Intent;
    cwd?: string;
  },
): Promise<IntentDiscoveryState> {
  const cwd = options.cwd ?? process.cwd();
  return saveDiscoveryState({
    status: 'in_progress',
    mode: options.mode,
    step: options.step,
    ...(typeof options.questionIndex === 'number' ? { questionIndex: options.questionIndex } : {}),
    scan: options.scan,
    ...(options.draft ? { draft: options.draft } : {}),
    updatedAt: new Date().toISOString(),
  }, cwd);
}

export async function approveDiscoveryFoundation(
  intent: Intent,
  options: {
    mode: DiscoveryMode;
    scan: RepoScanSummary;
    reason?: string;
    cwd?: string;
  },
): Promise<IntentState> {
  const cwd = options.cwd ?? process.cwd();
  return mutateLedger(cwd, (ledger) => {
    const state = ledger.intent;
    const history = state.intent
      ? [...state.history, { intent: state.intent, reason: options.reason ?? 'foundation_approved', changedAt: new Date().toISOString() }]
      : state.history;
    ledger.intent = {
      version: state.version,
      intent: {
        ...intent,
        discoveryMode: options.mode,
        updatedAt: new Date().toISOString(),
      },
      discovery: {
        status: 'approved',
        mode: options.mode,
        step: 'draft_review',
        scan: options.scan,
        draft: intent,
        updatedAt: new Date().toISOString(),
      },
      history,
      updatedAt: new Date().toISOString(),
    };
    return ledger.intent;
  });
}

export async function skipDiscoveryFoundation(cwd: string = process.cwd()): Promise<IntentDiscoveryState> {
  return saveDiscoveryState({
    status: 'skipped',
    updatedAt: new Date().toISOString(),
  }, cwd);
}

export async function captureIntent(input: IntentCaptureInput, cwd: string = process.cwd()): Promise<Intent> {
  const existing = await loadCurrentIntent(cwd);
  const intent = normalizeIntent({
    ...input,
    ...(existing ? { previousIntent: existing } : {}),
  });
  await saveCurrentIntent(intent, { reason: existing ? 'intent_refined' : 'intent_created', cwd });
  return intent;
}
