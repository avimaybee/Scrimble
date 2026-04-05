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

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-_.]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function ensureNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} is required.`);
  }
  return trimmed;
}

function localUserIdFromProject(projectId: string): string {
  const safe = slug(projectId);
  return safe ? `local-${safe}` : `local-${crypto.randomUUID()}`;
}

function localEmailFromProject(projectId: string): string {
  const safe = slug(projectId);
  const localPart = safe || `project-${crypto.randomUUID().slice(0, 8)}`;
  return `${localPart}@local.scrimble.dev`;
}

function normalizePlanChunks(chunks: PersistedPlanChunk[]): PersistedPlanChunk[] {
  return chunks
    .map((chunk, index) => ({
      sequence: chunk.sequence > 0 ? chunk.sequence : index + 1,
      title: ensureNonEmpty(chunk.title, 'chunk.title'),
      prompt: ensureNonEmpty(chunk.prompt, 'chunk.prompt'),
      doneCondition: ensureNonEmpty(chunk.doneCondition, 'chunk.doneCondition'),
      ...(chunk.doNotTouch?.trim() ? { doNotTouch: chunk.doNotTouch.trim() } : {}),
      ...(chunk.verificationHints && chunk.verificationHints.length > 0
        ? { verificationHints: chunk.verificationHints }
        : {}),
    }))
    .sort((a, b) => a.sequence - b.sequence);
}

export async function ensureLocalProjectRecord(
  db: D1Database,
  input: EnsureLocalProjectInput,
): Promise<void> {
  const projectId = ensureNonEmpty(input.projectId, 'projectId');
  const userId = localUserIdFromProject(projectId);
  const email = localEmailFromProject(projectId);
  const goal = input.goal?.trim() || null;

  await db.prepare(
    `
      INSERT INTO users (id, email)
      VALUES (?1, ?2)
      ON CONFLICT(id) DO NOTHING
    `,
  ).bind(userId, email).run();

  await db.prepare(
    `
      INSERT INTO projects (id, user_id, name, goal, status)
      VALUES (?1, ?2, ?3, ?4, 'active')
      ON CONFLICT(id) DO UPDATE SET
        goal = COALESCE(excluded.goal, projects.goal),
        updated_at = datetime('now')
    `,
  ).bind(projectId, userId, projectId, goal).run();
}

export async function createGenerationRunRecord(
  db: D1Database,
  input: CreateGenerationRunInput,
): Promise<void> {
  const runId = ensureNonEmpty(input.runId, 'runId');
  const projectId = ensureNonEmpty(input.projectId, 'projectId');
  const inputJson = JSON.stringify(input.input);

  await db.prepare(
    `
      INSERT INTO generation_runs (id, project_id, type, status, input_data, created_at)
      VALUES (?1, ?2, ?3, 'pending', ?4, datetime('now'))
    `,
  ).bind(runId, projectId, input.type, inputJson).run();
}

export async function markGenerationRunRunning(db: D1Database, runId: string): Promise<void> {
  const safeRunId = ensureNonEmpty(runId, 'runId');
  await db.prepare(
    `
      UPDATE generation_runs
      SET status = 'running',
          started_at = datetime('now'),
          error = NULL
      WHERE id = ?1
    `,
  ).bind(safeRunId).run();
}

export async function markGenerationRunCompleted(
  db: D1Database,
  input: MarkGenerationRunCompletedInput,
): Promise<void> {
  const runId = ensureNonEmpty(input.runId, 'runId');
  const outputJson = JSON.stringify(input.output);
  await db.prepare(
    `
      UPDATE generation_runs
      SET status = 'completed',
          output_data = ?2,
          error = NULL,
          completed_at = datetime('now')
      WHERE id = ?1
    `,
  ).bind(runId, outputJson).run();
}

export async function markGenerationRunFailed(
  db: D1Database,
  input: MarkGenerationRunFailedInput,
): Promise<void> {
  const runId = ensureNonEmpty(input.runId, 'runId');
  const error = ensureNonEmpty(input.error, 'error');
  await db.prepare(
    `
      UPDATE generation_runs
      SET status = 'failed',
          error = ?2,
          completed_at = datetime('now')
      WHERE id = ?1
    `,
  ).bind(runId, error).run();
}

export async function persistPlanRevision(
  db: D1Database,
  input: PersistPlanRevisionInput,
): Promise<PersistPlanRevisionResult> {
  const projectId = ensureNonEmpty(input.projectId, 'projectId');
  const architecture = ensureNonEmpty(input.architecture, 'architecture');
  const chunks = normalizePlanChunks(input.chunks);

  const versionRow = await db.prepare(
    `
      SELECT MAX(version) AS maxVersion
      FROM plan_revisions
      WHERE project_id = ?1
    `,
  ).bind(projectId).first<{ maxVersion: number | null }>();
  const version = (versionRow?.maxVersion ?? 0) + 1;
  const revisionId = crypto.randomUUID();
  const now = new Date().toISOString();

  const planData = {
    architecture,
    chunks: chunks.map((chunk, index) => ({
      id: `chunk-${String(index + 1).padStart(3, '0')}`,
      sequence: chunk.sequence,
      title: chunk.title,
      prompt: chunk.prompt,
      doneCondition: chunk.doneCondition,
      ...(chunk.doNotTouch ? { doNotTouch: chunk.doNotTouch } : {}),
      ...(chunk.verificationHints ? { verificationHints: chunk.verificationHints } : {}),
    })),
  };

  await db.prepare(
    `
      INSERT INTO plan_revisions (id, project_id, version, plan_data, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `,
  ).bind(revisionId, projectId, version, JSON.stringify(planData), now).run();

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
      projectId,
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
  ).bind(activeChunkId ?? null, projectId).run();

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
  const projectId = ensureNonEmpty(input.projectId, 'projectId');
  const type = ensureNonEmpty(input.type, 'type');
  await db.prepare(
    `
      INSERT INTO events (id, project_id, type, data, created_at)
      VALUES (?1, ?2, ?3, ?4, datetime('now'))
    `,
  ).bind(
    crypto.randomUUID(),
    projectId,
    type,
    input.data ? JSON.stringify(input.data) : null,
  ).run();
}
