export interface EnsureProjectRecordForUserInput {
  userId: string;
  userEmail?: string;
  projectId: string;
  name?: string;
  goal?: string;
}

export interface CreateGenerationRunInput {
  runId: string;
  projectId: string;
  type: 'initial' | 'replan' | 'update';
  input: unknown;
}

export interface MarkGenerationRunCompletedInput {
  runId: string;
  output: unknown;
}

export interface MarkGenerationRunFailedInput {
  runId: string;
  error: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  repoUrl?: string;
  goal?: string;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  currentChunkId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectForUserInput {
  userId: string;
  userEmail?: string;
  id: string;
  name: string;
  repoUrl?: string;
  goal: string;
}

export interface PersistedPlanChunk {
  sequence: number;
  title: string;
  prompt: string;
  doneCondition: string;
  doNotTouch?: string | undefined;
  verificationHints?: string[] | undefined;
}

export interface PersistPlanRevisionInput {
  projectId: string;
  architecture: string;
  chunks: PersistedPlanChunk[];
}

export interface PersistPlanRevisionResult {
  revisionId: string;
  version: number;
  activeChunkId?: string;
}

export interface PlanSyncRevisionRecord {
  projectId: string;
  version: number;
  planHash: string;
  plan: unknown;
  syncedAt: string;
  createdAt: string;
}

export interface AppendPlanSyncRevisionInput {
  projectId: string;
  planHash: string;
  plan: unknown;
  syncedAt: string;
}

export interface AppendProjectEventInput {
  projectId: string;
  type: string;
  data?: Record<string, unknown>;
}

export interface ProjectEventRecord {
  id: string;
  projectId: string;
  type: string;
  data?: unknown;
  createdAt: string;
}

export interface RunStepDiagnostics {
  retryCount: number;
  failedStepCount: number;
  latestFailure?: {
    step?: string;
    attempt?: number;
    maxAttempts?: number;
    error?: string;
    occurredAt: string;
  };
}

export interface GenerationRunRecord {
  runId: string;
  projectId: string;
  type: 'initial' | 'replan' | 'update';
  status: 'pending' | 'running' | 'completed' | 'failed';
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

interface GenerationRunRow {
  id: string;
  project_id: string;
  type: 'initial' | 'replan' | 'update';
  status: 'pending' | 'running' | 'completed' | 'failed';
  input_data: string | null;
  output_data: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface ProjectRow {
  id: string;
  name: string;
  repo_url: string | null;
  goal: string | null;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  current_chunk_id: string | null;
  created_at: string;
  updated_at: string;
}

interface EventDiagnosticsRow {
  type: string;
  data: string | null;
  created_at: string;
}

interface ProjectEventRow {
  id: string;
  project_id: string;
  type: string;
  data: string | null;
  created_at: string;
}

interface PlanSyncRevisionRow {
  project_id: string;
  version: number;
  plan_hash: string;
  plan_data: string;
  synced_at: string;
  created_at: string;
}

function parseJsonColumn(value: string | null): unknown | undefined {
  if (value === null) return undefined;
  return JSON.parse(value) as unknown;
}

function mapGenerationRunRow(row: GenerationRunRow): GenerationRunRecord {
  return {
    runId: row.id,
    projectId: row.project_id,
    type: row.type,
    status: row.status,
    ...(row.input_data !== null ? { input: parseJsonColumn(row.input_data) } : {}),
    ...(row.output_data !== null ? { output: parseJsonColumn(row.output_data) } : {}),
    ...(row.error !== null ? { error: row.error } : {}),
    ...(row.started_at !== null ? { startedAt: row.started_at } : {}),
    ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
    createdAt: row.created_at,
  };
}

function mapProjectRow(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    ...(row.repo_url !== null ? { repoUrl: row.repo_url } : {}),
    ...(row.goal !== null ? { goal: row.goal } : {}),
    status: row.status,
    ...(row.current_chunk_id !== null ? { currentChunkId: row.current_chunk_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPlanSyncRow(row: PlanSyncRevisionRow): PlanSyncRevisionRecord {
  return {
    projectId: row.project_id,
    version: row.version,
    planHash: row.plan_hash,
    plan: JSON.parse(row.plan_data) as unknown,
    syncedAt: row.synced_at,
    createdAt: row.created_at,
  };
}

function mapProjectEventRow(row: ProjectEventRow): ProjectEventRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    ...(row.data !== null ? { data: parseJsonColumn(row.data) } : {}),
    createdAt: row.created_at,
  };
}

async function ensureUserRecord(
  db: D1Database,
  userId: string,
  userEmail: string,
): Promise<void> {
  await db.prepare(
    `
      INSERT INTO users (id, email)
      VALUES (?1, ?2)
      ON CONFLICT(id) DO NOTHING
    `,
  ).bind(userId, userEmail).run();
}

export async function ensureProjectRecordForUser(
  db: D1Database,
  input: EnsureProjectRecordForUserInput,
): Promise<void> {
  const userEmail = input.userEmail ?? `${input.userId}@scrimble.dev`;
  await ensureUserRecord(db, input.userId, userEmail);

  await db.prepare(
    `
      INSERT INTO projects (id, user_id, name, goal, status)
      VALUES (?1, ?2, ?3, ?4, 'active')
      ON CONFLICT(id) DO UPDATE SET
        goal = COALESCE(excluded.goal, projects.goal),
        updated_at = datetime('now')
    `,
  ).bind(
    input.projectId,
    input.userId,
    input.name ?? input.projectId,
    input.goal ?? null,
  ).run();
}


export async function listProjectsForUser(
  db: D1Database,
  userId: string,
): Promise<ProjectRecord[]> {
  const rows = await db.prepare(
    `
      SELECT id, name, repo_url, goal, status, current_chunk_id, created_at, updated_at
      FROM projects
      WHERE user_id = ?1
      ORDER BY created_at DESC
    `,
  ).bind(userId).all<ProjectRow>();

  return (rows.results ?? []).map((row) => mapProjectRow(row));
}


export async function getProjectForUser(
  db: D1Database,
  userId: string,
  projectId: string,
): Promise<ProjectRecord | null> {
  const row = await db.prepare(
    `
      SELECT id, name, repo_url, goal, status, current_chunk_id, created_at, updated_at
      FROM projects
      WHERE id = ?1
        AND user_id = ?2
      LIMIT 1
    `,
  ).bind(projectId, userId).first<ProjectRow>();

  return row ? mapProjectRow(row) : null;
}


export async function createProjectForUser(
  db: D1Database,
  input: CreateProjectForUserInput,
): Promise<ProjectRecord> {
  const userEmail = input.userEmail ?? `${input.userId}@scrimble.dev`;
  await ensureUserRecord(db, input.userId, userEmail);

  await db.prepare(
    `
      INSERT INTO projects (id, user_id, name, repo_url, goal, status, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, 'active', datetime('now'), datetime('now'))
    `,
  ).bind(input.id, input.userId, input.name, input.repoUrl ?? null, input.goal).run();

  const created = await getProjectForUser(db, input.userId, input.id);
  if (!created) {
    throw new Error(`Failed to load created project ${input.id}.`);
  }
  return created;
}


export async function createGenerationRunRecord(
  db: D1Database,
  input: CreateGenerationRunInput,
): Promise<void> {
  await db.prepare(
    `
      INSERT INTO generation_runs (id, project_id, type, status, input_data, created_at)
      VALUES (?1, ?2, ?3, 'pending', ?4, datetime('now'))
    `,
  ).bind(input.runId, input.projectId, input.type, JSON.stringify(input.input)).run();
}

export async function markGenerationRunRunning(db: D1Database, runId: string): Promise<void> {
  await db.prepare(
    `
      UPDATE generation_runs
      SET status = 'running',
          started_at = datetime('now'),
          error = NULL
      WHERE id = ?1
    `,
  ).bind(runId).run();
}

export async function markGenerationRunCompleted(
  db: D1Database,
  input: MarkGenerationRunCompletedInput,
): Promise<void> {
  await db.prepare(
    `
      UPDATE generation_runs
      SET status = 'completed',
          output_data = ?2,
          error = NULL,
          completed_at = datetime('now')
      WHERE id = ?1
    `,
  ).bind(input.runId, JSON.stringify(input.output)).run();
}

export async function markGenerationRunFailed(
  db: D1Database,
  input: MarkGenerationRunFailedInput,
): Promise<void> {
  await db.prepare(
    `
      UPDATE generation_runs
      SET status = 'failed',
          error = ?2,
          completed_at = datetime('now')
      WHERE id = ?1
    `,
  ).bind(input.runId, input.error).run();
}

export async function getActiveRunForProject(
  db: D1Database,
  projectId: string,
): Promise<GenerationRunRecord | null> {
  const row = await db.prepare(
    `
      SELECT id, project_id, type, status, input_data, output_data, error, started_at, completed_at, created_at
      FROM generation_runs
      WHERE project_id = ?1
        AND status IN ('pending', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `,
  ).bind(projectId).first<GenerationRunRow>();
  return row ? mapGenerationRunRow(row) : null;
}

export async function getLatestRunForProject(
  db: D1Database,
  options: { projectId: string; type?: 'initial' | 'replan' | 'update' },
): Promise<GenerationRunRecord | null> {
  const row = options.type
    ? await db.prepare(
      `
        SELECT id, project_id, type, status, input_data, output_data, error, started_at, completed_at, created_at
        FROM generation_runs
        WHERE project_id = ?1
          AND type = ?2
        ORDER BY created_at DESC
        LIMIT 1
      `,
    ).bind(options.projectId, options.type).first<GenerationRunRow>()
    : await db.prepare(
      `
        SELECT id, project_id, type, status, input_data, output_data, error, started_at, completed_at, created_at
        FROM generation_runs
        WHERE project_id = ?1
        ORDER BY created_at DESC
        LIMIT 1
      `,
    ).bind(options.projectId).first<GenerationRunRow>();
  return row ? mapGenerationRunRow(row) : null;
}

export async function getLatestPlanSyncRevision(
  db: D1Database,
  projectId: string,
): Promise<PlanSyncRevisionRecord | null> {
  const row = await db.prepare(
    `
      SELECT project_id, version, plan_hash, plan_data, synced_at, created_at
      FROM plan_sync_revisions
      WHERE project_id = ?1
      ORDER BY version DESC
      LIMIT 1
    `,
  ).bind(projectId).first<PlanSyncRevisionRow>();

  return row ? mapPlanSyncRow(row) : null;
}

export async function appendPlanSyncRevision(
  db: D1Database,
  input: AppendPlanSyncRevisionInput,
): Promise<PlanSyncRevisionRecord> {
  const versionRow = await db.prepare(
    `
      SELECT MAX(version) AS maxVersion
      FROM plan_sync_revisions
      WHERE project_id = ?1
    `,
  ).bind(input.projectId).first<{ maxVersion: number | null }>();
  const version = (versionRow?.maxVersion ?? 0) + 1;

  await db.prepare(
    `
      INSERT INTO plan_sync_revisions (
        id,
        project_id,
        version,
        plan_hash,
        plan_data,
        synced_at,
        created_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
    `,
  ).bind(
    crypto.randomUUID(),
    input.projectId,
    version,
    input.planHash,
    JSON.stringify(input.plan),
    input.syncedAt,
  ).run();

  const inserted = await db.prepare(
    `
      SELECT project_id, version, plan_hash, plan_data, synced_at, created_at
      FROM plan_sync_revisions
      WHERE project_id = ?1
        AND version = ?2
      LIMIT 1
    `,
  ).bind(input.projectId, version).first<PlanSyncRevisionRow>();

  if (!inserted) {
    throw new Error(`Failed to load appended sync revision for project ${input.projectId}.`);
  }

  return mapPlanSyncRow(inserted);
}

export async function persistPlanRevision(
  db: D1Database,
  input: PersistPlanRevisionInput,
): Promise<PersistPlanRevisionResult> {
  const chunks = [...input.chunks].sort((a, b) => a.sequence - b.sequence);

  const versionRow = await db.prepare(
    `
      SELECT MAX(version) AS maxVersion
      FROM plan_revisions
      WHERE project_id = ?1
    `,
  ).bind(input.projectId).first<{ maxVersion: number | null }>();
  const version = (versionRow?.maxVersion ?? 0) + 1;
  const revisionId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Keep plan_revisions as lightweight metadata; chunks table is the execution source of truth.
  const planData = {
    architecture: input.architecture,
    chunkCount: chunks.length,
    source: 'chunks-table',
  };

  await db.prepare(
    `
      INSERT INTO plan_revisions (id, project_id, version, plan_data, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `,
  ).bind(revisionId, input.projectId, version, JSON.stringify(planData), now).run();

  let activeChunkId: string | undefined;
  for (const [index, chunk] of chunks.entries()) {
    const chunkId = `${revisionId}:chunk:${String(chunk.sequence).padStart(3, '0')}`;
    if (index === 0) {
      activeChunkId = chunkId;
    }
    await db.prepare(
      `
        INSERT INTO chunks (
          id,
          project_id,
          plan_revision_id,
          sequence,
          title,
          prompt,
          done_condition,
          do_not_touch,
          verification_hints,
          status,
          created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
      `,
    ).bind(
      chunkId,
      input.projectId,
      revisionId,
      chunk.sequence,
      chunk.title,
      chunk.prompt,
      chunk.doneCondition,
      chunk.doNotTouch ?? null,
      chunk.verificationHints ? JSON.stringify(chunk.verificationHints) : null,
      index === 0 ? 'active' : 'pending',
      now,
    ).run();
  }

  await db.prepare(
    `
      UPDATE projects
      SET current_chunk_id = ?1,
          updated_at = datetime('now')
      WHERE id = ?2
    `,
  ).bind(activeChunkId ?? null, input.projectId).run();

  return {
    revisionId,
    version,
    ...(activeChunkId ? { activeChunkId } : {}),
  };
}

export async function appendProjectEvent(
  db: D1Database,
  input: AppendProjectEventInput,
): Promise<void> {
  await db.prepare(
    `
      INSERT INTO events (id, project_id, type, data, created_at)
      VALUES (?1, ?2, ?3, ?4, datetime('now'))
    `,
  ).bind(
    crypto.randomUUID(),
    input.projectId,
    input.type,
    input.data ? JSON.stringify(input.data) : null,
  ).run();
}

export async function listProjectEvents(
  db: D1Database,
  options: {
    projectId: string;
    type?: string;
    since?: string;
    limit?: number;
  },
): Promise<ProjectEventRecord[]> {
  const predicates = ['project_id = ?1'];
  const bindings: Array<string | number> = [options.projectId];

  if (options.type) {
    predicates.push(`type = ?${bindings.length + 1}`);
    bindings.push(options.type);
  }
  if (options.since) {
    predicates.push(`created_at >= ?${bindings.length + 1}`);
    bindings.push(options.since);
  }

  const limit = options.limit ?? 100;
  bindings.push(limit);
  const limitParam = `?${bindings.length}`;

  const rows = await db.prepare(
    `
      SELECT id, project_id, type, data, created_at
      FROM events
      WHERE ${predicates.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ${limitParam}
    `,
  ).bind(...bindings).all<ProjectEventRow>();

  return (rows.results ?? []).map((row) => mapProjectEventRow(row));
}

export async function getRunStepDiagnostics(
  db: D1Database,
  options: { projectId: string; runId: string; type: 'generation' | 'replan' },
): Promise<RunStepDiagnostics> {
  const rows = await db.prepare(
    `
      SELECT type, data, created_at
      FROM events
      WHERE project_id = ?1
        AND (type = ?2 OR type = ?3)
        AND json_extract(data, '$.runId') = ?4
      ORDER BY created_at DESC
    `,
  ).bind(
    options.projectId,
    `${options.type}_step_retrying`,
    `${options.type}_step_failed`,
    options.runId,
  ).all<EventDiagnosticsRow>();

  const events = rows.results ?? [];
  let latestFailure: RunStepDiagnostics['latestFailure'];
  let retryCount = 0;
  let failedStepCount = 0;

  for (const event of events) {
    if (event.type === `${options.type}_step_retrying`) {
      retryCount += 1;
      continue;
    }

    if (event.type === `${options.type}_step_failed`) {
      failedStepCount += 1;
      if (!latestFailure) {
        const parsed = parseJsonColumn(event.data) as
          | { step?: string; attempt?: number; maxAttempts?: number; error?: string }
          | undefined;
        latestFailure = {
          ...(parsed?.step ? { step: parsed.step } : {}),
          ...(typeof parsed?.attempt === 'number' ? { attempt: parsed.attempt } : {}),
          ...(typeof parsed?.maxAttempts === 'number' ? { maxAttempts: parsed.maxAttempts } : {}),
          ...(parsed?.error ? { error: parsed.error } : {}),
          occurredAt: event.created_at,
        };
      }
    }
  }

  return {
    retryCount,
    failedStepCount,
    ...(latestFailure ? { latestFailure } : {}),
  };
}
