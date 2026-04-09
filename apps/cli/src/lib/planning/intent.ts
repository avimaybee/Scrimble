import { randomUUID } from 'node:crypto';
import type { Intent, IntentCaptureInput, IntentState } from '@scrimble/shared';
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

export function normalizeIntent(input: IntentCaptureInput): Intent {
  const now = new Date().toISOString();
  const previous = input.previousIntent;
  const normalizedGoal = normalizeGoal(input.initialGoal);

  const assumptions = previous?.productAssumptions ?? [];
  const constraints = previous?.constraints ?? [];
  const successCriteria = previous?.successCriteria ?? ['Core workflow works end-to-end'];
  const outOfScope = previous?.outOfScope ?? [];

  if (input.repoContext?.frameworks.length) {
    assumptions.push(`Use existing stack: ${input.repoContext.frameworks.join(', ')}`);
  }
  if (input.repoContext?.primaryLanguage) {
    assumptions.push(`Primary language: ${input.repoContext.primaryLanguage}`);
  }

  const dedupe = (items: string[]): string[] => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

  return {
    id: previous?.id ?? randomUUID(),
    goal: normalizedGoal,
    productAssumptions: dedupe(assumptions),
    constraints: dedupe(constraints),
    successCriteria: dedupe(successCriteria),
    outOfScope: dedupe(outOfScope),
    ...(previous?.targetUsers ? { targetUsers: previous.targetUsers } : {}),
    ...(previous?.timeline ? { timeline: previous.timeline } : {}),
    ...(previous?.qualityPreference ? { qualityPreference: previous.qualityPreference } : {}),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

export function mergeIntentNotes(
  intent: Intent,
  updates: {
    assumptions?: string;
    constraints?: string;
    successCriteria?: string;
    outOfScope?: string;
  },
): Intent {
  return {
    ...intent,
    productAssumptions: [...new Set([...intent.productAssumptions, ...splitIntoItems(updates.assumptions ?? '')])],
    constraints: [...new Set([...intent.constraints, ...splitIntoItems(updates.constraints ?? '')])],
    successCriteria: [...new Set([...intent.successCriteria, ...splitIntoItems(updates.successCriteria ?? '')])],
    outOfScope: [...new Set([...intent.outOfScope, ...splitIntoItems(updates.outOfScope ?? '')])],
    updatedAt: new Date().toISOString(),
  };
}

export async function loadCurrentIntent(cwd: string = process.cwd()): Promise<Intent | null> {
  const ledger = await readLedger(cwd);
  return ledger.intent.intent;
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
      history,
      updatedAt: new Date().toISOString(),
    };
    ledger.intent = nextState;
    return nextState;
  });
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

