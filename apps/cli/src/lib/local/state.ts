import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { VerificationResult } from '@scrimble/shared';
import {
  ACTIVITY_LOG,
  ARCHITECTURE_FILE,
  CONFIG_FILE,
  CURRENT_CHUNK_FILE,
  PLAN_FILE,
  PROJECT_FILE,
  RESEARCH_FILE,
  PROMPTS_DIR,
  RULES_DIR,
  SCRIMBLE_DIR,
  VERIFICATION_DIR,
} from '@scrimble/shared';

export type LocalChunkStatus = 'pending' | 'active' | 'completed' | 'skipped';

export interface LocalChunk {
  id: string;
  title: string;
  prompt: string;
  status: LocalChunkStatus;
  sequence?: number;
  doNotTouch?: string;
  doneWhen?: string;
  verificationSignals?: string[];
  completedAt?: string;
  skippedAt?: string;
  skipReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LocalArchitectureState {
  summary?: string;
  approved?: boolean;
  approvedAt?: string;
  rejectedAt?: string;
  notes?: string;
}

export interface LocalSyncState {
  lastSyncedAt?: string;
  lastSyncedHash?: string;
  lastSyncError?: string;
  lastRemotePlanHash?: string;
}

export interface LocalPlanState {
  version: number;
  architecture?: LocalArchitectureState;
  chunks: LocalChunk[];
  sync?: LocalSyncState;
  metadata?: Record<string, unknown>;
}

export interface ScrimblePaths {
  root: string;
  config: string;
  project: string;
  plan: string;
  architecture: string;
  research: string;
  currentChunk: string;
  activityLog: string;
  verificationDir: string;
  verificationLatest: string;
  promptsDir: string;
  rulesDir: string;
  telemetry: string;
  watchState: string;
  conflictsDir: string;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export function getScrimblePaths(cwd = process.cwd()): ScrimblePaths {
  const root = path.join(cwd, SCRIMBLE_DIR);
  const verificationDir = path.join(root, VERIFICATION_DIR);
  return {
    root,
    config: path.join(root, CONFIG_FILE),
    project: path.join(root, PROJECT_FILE),
    plan: path.join(root, PLAN_FILE),
    architecture: path.join(root, ARCHITECTURE_FILE),
    research: path.join(root, RESEARCH_FILE),
    currentChunk: path.join(root, CURRENT_CHUNK_FILE),
    activityLog: path.join(root, ACTIVITY_LOG),
    verificationDir,
    verificationLatest: path.join(verificationDir, 'latest.json'),
    promptsDir: path.join(root, PROMPTS_DIR),
    rulesDir: path.join(root, RULES_DIR),
    telemetry: path.join(root, 'telemetry.ndjson'),
    watchState: path.join(root, 'watch-state.json'),
    conflictsDir: path.join(root, 'conflicts'),
  };
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

export async function ensureScrimbleDirectories(cwd = process.cwd()): Promise<ScrimblePaths> {
  const paths = getScrimblePaths(cwd);
  await fs.mkdir(paths.root, { recursive: true });
  await fs.mkdir(paths.verificationDir, { recursive: true });
  await fs.mkdir(paths.promptsDir, { recursive: true });
  await fs.mkdir(paths.rulesDir, { recursive: true });
  await fs.mkdir(paths.conflictsDir, { recursive: true });
  return paths;
}

export async function isProjectInitialized(cwd = process.cwd()): Promise<boolean> {
  const paths = getScrimblePaths(cwd);
  try {
    await fs.access(paths.root);
    await fs.access(paths.project);
    return true;
  } catch {
    return false;
  }
}

function normalizeChunk(chunk: Partial<LocalChunk>, index: number): LocalChunk {
  const id = chunk.id?.trim() || `chunk-${String(index + 1).padStart(3, '0')}`;
  const title = chunk.title?.trim() || `Chunk ${index + 1}`;
  const prompt = chunk.prompt?.trim() || 'No prompt provided yet.';
  const status: LocalChunkStatus =
    chunk.status === 'active' || chunk.status === 'completed' || chunk.status === 'skipped'
      ? chunk.status
      : 'pending';

  return {
    id,
    title,
    prompt,
    status,
    ...(chunk.sequence === undefined ? { sequence: index + 1 } : { sequence: chunk.sequence }),
    ...(chunk.doNotTouch ? { doNotTouch: chunk.doNotTouch } : {}),
    ...(chunk.doneWhen ? { doneWhen: chunk.doneWhen } : {}),
    ...(chunk.verificationSignals ? { verificationSignals: chunk.verificationSignals } : {}),
    ...(chunk.completedAt ? { completedAt: chunk.completedAt } : {}),
    ...(chunk.skippedAt ? { skippedAt: chunk.skippedAt } : {}),
    ...(chunk.skipReason ? { skipReason: chunk.skipReason } : {}),
    ...(chunk.createdAt ? { createdAt: chunk.createdAt } : {}),
    ...(chunk.updatedAt ? { updatedAt: chunk.updatedAt } : {}),
  };
}

function normalizePlan(input: Partial<LocalPlanState>): LocalPlanState {
  const normalizedChunks = (input.chunks ?? []).map((chunk, index) => normalizeChunk(chunk, index));
  const syncState: LocalSyncState = {
    ...(input.sync?.lastSyncedAt ? { lastSyncedAt: input.sync.lastSyncedAt } : {}),
    ...(input.sync?.lastSyncedHash ? { lastSyncedHash: input.sync.lastSyncedHash } : {}),
    ...(input.sync?.lastSyncError ? { lastSyncError: input.sync.lastSyncError } : {}),
    ...(input.sync?.lastRemotePlanHash ? { lastRemotePlanHash: input.sync.lastRemotePlanHash } : {}),
  };

  return {
    version: typeof input.version === 'number' ? input.version : 1,
    chunks: normalizedChunks,
    ...(input.architecture ? { architecture: input.architecture } : {}),
    sync: syncState,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export async function loadPlanState(cwd = process.cwd()): Promise<LocalPlanState> {
  const paths = getScrimblePaths(cwd);
  const raw = await readJsonFile<Partial<LocalPlanState>>(paths.plan, { version: 1, chunks: [] });
  return normalizePlan(raw);
}

export async function savePlanState(plan: LocalPlanState, cwd = process.cwd()): Promise<void> {
  const paths = await ensureScrimbleDirectories(cwd);
  await fs.writeFile(paths.plan, `${JSON.stringify(normalizePlan(plan), null, 2)}\n`, 'utf8');
}

export async function loadProjectState(cwd = process.cwd()): Promise<Record<string, unknown>> {
  const paths = getScrimblePaths(cwd);
  return readJsonFile<Record<string, unknown>>(paths.project, {});
}

export function getActiveChunk(plan: LocalPlanState): LocalChunk | undefined {
  return plan.chunks.find((chunk) => chunk.status === 'active');
}

export function getNextPendingChunk(plan: LocalPlanState): LocalChunk | undefined {
  const activeIndex = plan.chunks.findIndex((chunk) => chunk.status === 'active');
  if (activeIndex === -1) {
    return plan.chunks.find((chunk) => chunk.status === 'pending');
  }
  return plan.chunks.find((chunk, index) => index > activeIndex && chunk.status === 'pending');
}

export function getCompletionStats(plan: LocalPlanState): {
  total: number;
  completed: number;
  skipped: number;
  pending: number;
  active: number;
} {
  const total = plan.chunks.length;
  const completed = plan.chunks.filter((chunk) => chunk.status === 'completed').length;
  const skipped = plan.chunks.filter((chunk) => chunk.status === 'skipped').length;
  const active = plan.chunks.filter((chunk) => chunk.status === 'active').length;
  return { total, completed, skipped, pending: total - completed - skipped - active, active };
}

export function activateFirstPendingChunk(plan: LocalPlanState): LocalPlanState {
  if (plan.chunks.some((chunk) => chunk.status === 'active')) {
    return plan;
  }

  const nextPending = plan.chunks.findIndex((chunk) => chunk.status === 'pending');
  if (nextPending === -1) return plan;

  const nextChunks = [...plan.chunks];
  const pendingChunk = nextChunks[nextPending];
  if (!pendingChunk) {
    throw new Error('Pending chunk lookup failed during activation.');
  }
  nextChunks[nextPending] = {
    ...pendingChunk,
    status: 'active',
    updatedAt: new Date().toISOString(),
  };
  return { ...plan, chunks: nextChunks };
}

export function renderChunkMarkdown(chunk: LocalChunk, projectName?: string): string {
  const projectContext = projectName
    ? `Project: ${projectName}\nChunk: ${chunk.title} (${chunk.id})`
    : `Chunk: ${chunk.title} (${chunk.id})`;
  const requirements = chunk.prompt;
  const doNotTouch = chunk.doNotTouch ?? 'Respect existing architecture boundaries and unrelated files.';
  const doneWhen = chunk.doneWhen ?? 'The chunk objective is implemented and verified locally.';
  const verificationSignals =
    chunk.verificationSignals && chunk.verificationSignals.length > 0
      ? chunk.verificationSignals.map((signal) => `- ${signal}`).join('\n')
      : '- Run `scrimble verify` and confirm checks are passing.';

  return [
    `# ${chunk.title}`,
    '',
    '## Project Context',
    projectContext,
    '',
    '## Your Job Right Now',
    requirements,
    '',
    '## Requirements',
    requirements,
    '',
    '## Do Not Touch',
    doNotTouch,
    '',
    '## Done When',
    doneWhen,
    '',
    '## Verification Signals',
    verificationSignals,
    '',
  ].join('\n');
}

export async function writeCurrentChunkFromPlan(plan: LocalPlanState, cwd = process.cwd()): Promise<void> {
  const paths = await ensureScrimbleDirectories(cwd);
  const activeChunk = getActiveChunk(plan);
  if (!activeChunk) {
    try {
      await fs.unlink(paths.currentChunk);
    } catch (error) {
      if (!(isNodeError(error) && error.code === 'ENOENT')) {
        throw error;
      }
    }
    return;
  }

  const project = await loadProjectState(cwd);
  const projectName = typeof project['name'] === 'string' ? project['name'] : undefined;
  await fs.writeFile(paths.currentChunk, renderChunkMarkdown(activeChunk, projectName), 'utf8');
}

export async function appendActivity(
  event: string,
  payload: Record<string, unknown> = {},
  cwd = process.cwd(),
): Promise<void> {
  const paths = await ensureScrimbleDirectories(cwd);
  const entry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    event,
    payload,
  };
  await fs.appendFile(paths.activityLog, `${JSON.stringify(entry)}\n`, 'utf8');
}

export function computePlanHash(plan: LocalPlanState): string {
  const stablePayload = {
    version: plan.version,
    architecture: plan.architecture ?? null,
    chunks: plan.chunks,
    metadata: plan.metadata ?? null,
  };
  return createHash('sha256').update(JSON.stringify(stablePayload)).digest('hex');
}

export async function readLatestVerification(cwd = process.cwd()): Promise<VerificationResult | null> {
  const paths = getScrimblePaths(cwd);
  const content = await readJsonFile<VerificationResult | null>(paths.verificationLatest, null);
  return content;
}
