const LOCAL_USER_ID = 'local-user';
const LOCAL_USER_EMAIL = 'local@scrimble.dev';

export interface EnsureLocalProjectInput {
  projectId: string;
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

export interface PersistedPlanChunk {
  sequence: number;
  title: string;
  prompt: string;
  doneCondition: string;
  doNotTouch?: string;
  verificationHints?: string[];
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

export interface AppendProjectEventInput {
  projectId: string;
  type: string;
  data?: Record<string, unknown>;
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

export async function ensureLocalProjectRecord(
  db: D1Database,
  input: EnsureLocalProjectInput,
): Promise<void> {
  await db.prepare(
    `
      INSERT INTO users (id, email)
      VALUES (?1, ?2)
      ON CONFLICT(id) DO NOTHING
    `,
  ).bind(LOCAL_USER_ID, LOCAL_USER_EMAIL).run();

  await db.prepare(
    `
      INSERT INTO projects (id, user_id, name, goal, status)
      VALUES (?1, ?2, ?3, ?4, 'active')
      ON CONFLICT(id) DO UPDATE SET
        goal = COALESCE(excluded.goal, projects.goal),
        updated_at = datetime('now')
    `,
  ).bind(input.projectId, LOCAL_USER_ID, input.projectId, input.goal ?? null).run();
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
