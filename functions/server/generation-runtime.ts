/**
 * Generation Runtime Service
 *
 * Canonical generation lifecycle state is stored in generation_runs.
 * Projects only retain a pointer (current_generation_run_id) and durable
 * project metadata.
 */

import type {
  Bindings,
  GenerationBatchName,
  GenerationRun,
  GenerationRunStatus,
  ProjectGenerationStatus,
} from './types';
import { GENERATION_BATCHES, projectStatusToRunStatus } from './types';
import { persistGenerationStreamEvent } from './generation-events';

export const GENERATION_STALE_MS = 15 * 60 * 1000;
export const QUEUED_GENERATION_RESUME_MS = 2 * 60 * 1000;

const invariantCache = new Map<string, number>();
const INVARIANT_DEDUPE_MS = 60 * 1000;

export interface GenerationRuntimeState {
  hasActiveRun: boolean;
  run: GenerationRun | null;
  isRunning: boolean;
  isAwaitingReview: boolean;
  isApproved: boolean;
  isComplete: boolean;
  isFailed: boolean;
  isCancelled: boolean;
  isStale: boolean;
  canResume: boolean;
  currentBatch: GenerationBatchName | null;
  completedBatches: GenerationBatchName[];
  progressPercent: number;
}

export type GenerationLifecycleStatus = 'intake' | GenerationRunStatus;

export type GenerationFailureClass = 'run_failed' | 'stalled' | 'cancelled' | null;

export interface GenerationRuntimeContract {
  runId: string | null;
  lifecycleStatus: GenerationLifecycleStatus;
  currentBatch: GenerationBatchName | null;
  isTerminal: boolean;
  canResume: boolean;
  isReviewRequired: boolean;
  providerId: string | null;
  heartbeatAt: string | null;
  completedBatches: GenerationBatchName[];
  failureClass: GenerationFailureClass;
}

const TERMINAL_LIFECYCLE_STATUSES = new Set<GenerationLifecycleStatus>(['complete', 'failed', 'cancelled']);

function asOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isTerminalLifecycleStatus(status: GenerationLifecycleStatus): boolean {
  return TERMINAL_LIFECYCLE_STATUSES.has(status);
}

export function buildGenerationRuntimeContract(
  runtime: GenerationRuntimeState,
): GenerationRuntimeContract {
  const lifecycleStatus: GenerationLifecycleStatus = runtime.run?.status ?? 'intake';
  const isTerminal = isTerminalLifecycleStatus(lifecycleStatus);

  let failureClass: GenerationFailureClass = null;
  if (lifecycleStatus === 'failed') {
    failureClass = 'run_failed';
  } else if (lifecycleStatus === 'cancelled') {
    failureClass = 'cancelled';
  } else if (!isTerminal && runtime.canResume && runtime.isStale) {
    failureClass = 'stalled';
  }

  return {
    runId: runtime.run?.id ?? null,
    lifecycleStatus,
    currentBatch: lifecycleStatus === 'running' ? runtime.currentBatch : null,
    isTerminal,
    canResume: runtime.canResume,
    isReviewRequired: lifecycleStatus === 'awaiting_review',
    providerId: runtime.run?.provider_id ?? null,
    heartbeatAt: runtime.run?.heartbeat_at ?? null,
    completedBatches: runtime.completedBatches,
    failureClass,
  };
}

export async function getGenerationRuntimeState(
  env: Bindings,
  projectId: string,
): Promise<GenerationRuntimeState> {
  const now = Date.now();
  const runResult = await env.DB.prepare(`
    SELECT
      gr.id,
      gr.project_id,
      gr.workflow_instance_id,
      gr.lifecycle_status AS status,
      gr.current_batch,
      gr.provider_id,
      gr.heartbeat_at,
      gr.error_message,
      gr.started_at,
      gr.completed_at,
      gr.created_at,
      gr.updated_at
    FROM projects p
    LEFT JOIN generation_runs gr ON gr.id = p.current_generation_run_id
    WHERE p.id = ?
  `).bind(projectId).first() as {
    id: string | null;
    project_id: string | null;
    workflow_instance_id: string | null;
    status: string | null;
    current_batch: string | null;
    provider_id: string | null;
    heartbeat_at: string | null;
    error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string | null;
    updated_at: string | null;
  } | null;

  if (!runResult?.id) {
    return createEmptyRuntimeState();
  }

  const run: GenerationRun = {
    id: runResult.id,
    project_id: runResult.project_id || projectId,
    workflow_instance_id: runResult.workflow_instance_id || null,
    status: (runResult.status || 'queued') as GenerationRunStatus,
    current_batch: runResult.current_batch as GenerationBatchName | null,
    provider_id: runResult.provider_id || null,
    heartbeat_at: runResult.heartbeat_at || null,
    error_message: runResult.error_message || null,
    started_at: runResult.started_at || new Date().toISOString(),
    completed_at: runResult.completed_at || null,
    created_at: runResult.created_at || new Date().toISOString(),
    updated_at: runResult.updated_at || new Date().toISOString(),
  };

  const completedBatches = await getCompletedBatches(env, projectId, run.id);
  const isTerminal = ['complete', 'failed', 'cancelled'].includes(run.status);
  const isStale = !isTerminal && isHeartbeatStale(run.heartbeat_at, now);
  const canResume = isStale || (run.status === 'queued' && isQueuedTooLong(run.heartbeat_at, now));

  return {
    hasActiveRun: !isTerminal,
    run,
    isRunning: run.status === 'running',
    isAwaitingReview: run.status === 'awaiting_review',
    isApproved: run.status === 'approved',
    isComplete: run.status === 'complete',
    isFailed: run.status === 'failed',
    isCancelled: run.status === 'cancelled',
    isStale,
    canResume,
    currentBatch: run.current_batch,
    completedBatches,
    progressPercent: Math.round((completedBatches.length / GENERATION_BATCHES.length) * 100),
  };
}

function createEmptyRuntimeState(): GenerationRuntimeState {
  return {
    hasActiveRun: false,
    run: null,
    isRunning: false,
    isAwaitingReview: false,
    isApproved: false,
    isComplete: true,
    isFailed: false,
    isCancelled: false,
    isStale: false,
    canResume: false,
    currentBatch: null,
    completedBatches: [],
    progressPercent: 0,
  };
}

export async function persistInvariantViolation(
  env: Bindings,
  projectId: string,
  runId: string,
  driftType: string,
  message: string,
): Promise<void> {
  const cacheKey = `${projectId}:${runId}:${driftType}`;
  const now = Date.now();
  const lastEmitted = invariantCache.get(cacheKey) || 0;

  if (now - lastEmitted < INVARIANT_DEDUPE_MS) {
    return;
  }

  invariantCache.set(cacheKey, now);

  await persistGenerationStreamEvent(env, {
    projectId,
    runId,
    event: {
      type: 'invariant',
      drift_type: driftType,
      message,
      timestamp: new Date().toISOString(),
    },
  });
}

async function getCompletedBatches(
  env: Bindings,
  projectId: string,
  runId: string,
): Promise<GenerationBatchName[]> {
  const result = await env.DB.prepare(`
    SELECT run_type
    FROM agent_runs
    WHERE project_id = ? AND run_id = ? AND status = 'complete'
    ORDER BY completed_at
  `).bind(projectId, runId).all() as { results: Array<{ run_type: string }> | null };

  if (!result.results) {
    return [];
  }

  return result.results
    .map((row) => row.run_type)
    .filter((runType): runType is GenerationBatchName => GENERATION_BATCHES.includes(runType as GenerationBatchName));
}

function isHeartbeatStale(heartbeatAt: string | null, now: number): boolean {
  if (!heartbeatAt) {
    return true;
  }
  const heartbeatTime = new Date(heartbeatAt).getTime();
  return now - heartbeatTime > GENERATION_STALE_MS;
}

function isQueuedTooLong(heartbeatAt: string | null, now: number): boolean {
  if (!heartbeatAt) {
    return true;
  }
  const heartbeatTime = new Date(heartbeatAt).getTime();
  return now - heartbeatTime > QUEUED_GENERATION_RESUME_MS;
}

export async function createGenerationRun(
  env: Bindings,
  projectId: string,
  runId: string,
  providerId: string | null,
): Promise<GenerationRun> {
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO generation_runs (
        id, project_id, status, provider_id, heartbeat_at, started_at, created_at, updated_at
      ) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)
    `).bind(runId, projectId, providerId, now, now, now, now),
    env.DB.prepare(`
      UPDATE projects
      SET current_generation_run_id = ?,
          updated_at = datetime("now")
      WHERE id = ?
    `).bind(runId, projectId),
  ]);

  return {
    id: runId,
    project_id: projectId,
    workflow_instance_id: null,
    status: 'queued',
    current_batch: null,
    provider_id: providerId,
    heartbeat_at: now,
    error_message: null,
    started_at: now,
    completed_at: null,
    created_at: now,
    updated_at: now,
  };
}

export async function updateGenerationRunStatus(
  env: Bindings,
  runId: string,
  projectStatus: ProjectGenerationStatus,
  options: {
    currentBatch?: GenerationBatchName | null;
    errorMessage?: string | null;
    workflowInstanceId?: string | null;
    providerId?: string | null;
  } = {},
): Promise<{ changes: number }> {
  const status = projectStatusToRunStatus(projectStatus);
  const now = new Date().toISOString();
  const isTerminal = ['complete', 'failed', 'cancelled'].includes(status);

  const result = await env.DB.prepare(`
    UPDATE generation_runs
    SET status = ?,
        current_batch = ?,
        error_message = COALESCE(?, error_message),
        workflow_instance_id = COALESCE(?, workflow_instance_id),
        provider_id = COALESCE(?, provider_id),
        completed_at = CASE WHEN ? THEN ? ELSE completed_at END,
        updated_at = ?
    WHERE id = ?
  `).bind(
    status,
    options.currentBatch ?? null,
    options.errorMessage ?? null,
    options.workflowInstanceId ?? null,
    options.providerId ?? null,
    isTerminal,
    isTerminal ? now : null,
    now,
    runId,
  ).run();

  const changes = Number(result.meta?.changes || 0);
  return { changes };
}

export async function touchGenerationRunHeartbeat(
  env: Bindings,
  runId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE generation_runs
    SET heartbeat_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(now, now, runId).run();
}

export async function clearCurrentGenerationRun(
  env: Bindings,
  projectId: string,
): Promise<void> {
  await env.DB.prepare(`
    UPDATE projects
    SET current_generation_run_id = NULL
    WHERE id = ?
  `).bind(projectId).run();
}

export function mapProjectRowToResponse(row: any): any {
  const now = new Date().toISOString();
  const canonicalStatus = asOptionalString(row.canonical_run_status) as GenerationRunStatus | null;
  const runId = asOptionalString(row.canonical_run_id);
  const hasCanonicalRun = Boolean(runId);

  const run: GenerationRun | null = hasCanonicalRun
    ? {
      id: runId as string,
      project_id: row.project_id || row.id,
      workflow_instance_id: asOptionalString(row.canonical_run_workflow_instance_id),
      status: canonicalStatus || 'queued',
      current_batch: asOptionalString(row.canonical_run_current_batch) as GenerationBatchName | null,
      provider_id: asOptionalString(row.canonical_run_provider_id),
      heartbeat_at: asOptionalString(row.canonical_run_heartbeat_at),
      error_message: asOptionalString(row.canonical_run_error),
      started_at: asOptionalString(row.canonical_run_started_at) || now,
      completed_at: asOptionalString(row.canonical_run_completed_at),
      created_at: asOptionalString(row.canonical_run_created_at) || now,
      updated_at: asOptionalString(row.canonical_run_updated_at) || now,
    }
    : null;

  const isTerminal = !run || ['complete', 'failed', 'cancelled'].includes(run.status);
  const runtime: GenerationRuntimeState = {
    hasActiveRun: !isTerminal,
    run,
    isRunning: run?.status === 'running',
    isAwaitingReview: run?.status === 'awaiting_review',
    isApproved: run?.status === 'approved',
    isComplete: run?.status === 'complete',
    isFailed: run?.status === 'failed',
    isCancelled: run?.status === 'cancelled',
    isStale: false,
    canResume: false,
    currentBatch: run?.current_batch || null,
    completedBatches: [],
    progressPercent: Number(row.progress || 0),
  };

  const generationRuntime = buildGenerationRuntimeContract(runtime);

  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description || '',
    project_type: row.project_type || 'other',
    stack: row.stack || '{}',
    status: row.status || 'active',
    generation_runtime: generationRuntime,
    generation_error: run?.error_message || undefined,
    generation_started_at: run?.started_at || undefined,
    generation_completed_at: run?.completed_at || undefined,
    workflow_instance_id: run?.workflow_instance_id || undefined,
    intake_answers: row.intake_answers || undefined,
    progress: Number(row.progress || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
