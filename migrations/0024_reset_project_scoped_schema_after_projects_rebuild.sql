-- Forward-fix hotfix:
-- Rebuild all project-scoped tables against canonical projects(id) and reset project/runtime data.
-- Preserves user/account/provider/profile tables (profiles, ai_providers, ai_models, user_tools, mcp_servers).

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS generation_runs;
DROP TABLE IF EXISTS generation_dispatches;
DROP TABLE IF EXISTS generation_checkpoints;
DROP TABLE IF EXISTS project_generation_events;
DROP TABLE IF EXISTS project_intake_messages;
DROP TABLE IF EXISTS project_briefs;
DROP TABLE IF EXISTS project_files;
DROP TABLE IF EXISTS project_generation_live_state;
DROP TABLE IF EXISTS checklist_items;
DROP TABLE IF EXISTS edges;
DROP TABLE IF EXISTS steps;
DROP TABLE IF EXISTS stages;
DROP TABLE IF EXISTS workflows;
DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS projects;

CREATE TABLE IF NOT EXISTS projects (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  description             TEXT,
  project_type            TEXT,
  stack                   TEXT,
  status                  TEXT DEFAULT 'active',
  risk_score              INTEGER DEFAULT 0,
  generation_status       TEXT DEFAULT 'complete',
  generation_error        TEXT,
  generation_started_at   TEXT,
  generation_completed_at TEXT,
  generation_run_id       TEXT,
  generation_provider_id  TEXT,
  generation_heartbeat_at TEXT,
  intake_answers          TEXT,
  created_at              TEXT DEFAULT (datetime('now')),
  updated_at              TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workflows (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version         INTEGER DEFAULT 1,
  canvas_state    TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stages (
  id              TEXT PRIMARY KEY,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  type            TEXT NOT NULL,
  position_x      REAL DEFAULT 0,
  position_y      REAL DEFAULT 0,
  order_index     INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'locked',
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS steps (
  id                  TEXT PRIMARY KEY,
  workflow_id         TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  project_id          TEXT REFERENCES projects(id) ON DELETE CASCADE,
  stage_id            TEXT REFERENCES stages(id),
  title               TEXT NOT NULL,
  type                TEXT NOT NULL,
  category            TEXT,
  position_x          REAL DEFAULT 0,
  position_y          REAL DEFAULT 0,
  status              TEXT DEFAULT 'locked',
  is_gate             INTEGER DEFAULT 0,
  is_milestone        INTEGER DEFAULT 0,
  milestone_label     TEXT,
  risk_level          TEXT DEFAULT 'low',
  order_index         INTEGER DEFAULT 0,
  objective           TEXT,
  why_it_matters      TEXT,
  suggested_tools     TEXT,
  done_when           TEXT,
  ai_output           TEXT,
  prompts             TEXT,
  navigation_links    TEXT DEFAULT '[]',
  research_footer_meta TEXT,
  is_ai_enriched      INTEGER DEFAULT 0,
  agent_job_id        TEXT,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS edges (
  id              TEXT PRIMARY KEY,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
  source_step_id  TEXT REFERENCES steps(id) ON DELETE CASCADE,
  target_step_id  TEXT REFERENCES steps(id) ON DELETE CASCADE,
  edge_type       TEXT DEFAULT 'default',
  condition       TEXT
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id              TEXT PRIMARY KEY,
  step_id         TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  is_required     INTEGER DEFAULT 0,
  is_completed    INTEGER DEFAULT 0,
  completed_at    TEXT,
  order_index     INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_id         TEXT REFERENCES steps(id),
  run_type        TEXT NOT NULL,
  status          TEXT DEFAULT 'running',
  input           TEXT,
  output          TEXT,
  output_r2_key   TEXT,
  provider        TEXT,
  model           TEXT,
  sequence_index  INTEGER,
  attempt_count   INTEGER DEFAULT 1,
  error_message   TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  completed_at    TEXT
);

CREATE TABLE IF NOT EXISTS generation_runs (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id            TEXT NOT NULL UNIQUE,
  lifecycle_status  TEXT NOT NULL DEFAULT 'queued',
  current_batch     TEXT,
  is_terminal       INTEGER NOT NULL DEFAULT 0,
  can_resume        INTEGER NOT NULL DEFAULT 0,
  is_review_required INTEGER NOT NULL DEFAULT 0,
  provider_id       TEXT,
  heartbeat_at      TEXT,
  completed_batches TEXT DEFAULT '[]',
  failure_class     TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now')),
  completed_at      TEXT
);

CREATE TABLE IF NOT EXISTS generation_checkpoints (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id          TEXT NOT NULL,
  batch_name      TEXT NOT NULL,
  current_index   INTEGER NOT NULL DEFAULT 0,
  payload_inline  TEXT,
  payload_r2_key  TEXT,
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, run_id, batch_name)
);

CREATE TABLE IF NOT EXISTS project_generation_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  batch_name      TEXT,
  payload         TEXT NOT NULL,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_intake_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_briefs (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  raw_description    TEXT NOT NULL,
  enriched_brief     TEXT NOT NULL,
  what_it_is         TEXT,
  who_its_for        TEXT,
  problem_solved     TEXT,
  v1_scope           TEXT,
  stack_context      TEXT,
  definition_done    TEXT,
  constraints        TEXT,
  future_ideas       TEXT DEFAULT '[]',
  conversation_turns INTEGER DEFAULT 0,
  created_at         TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_files (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS generation_dispatches (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id          TEXT NOT NULL,
  dispatch_kind   TEXT NOT NULL,
  previous_status TEXT,
  target_status   TEXT NOT NULL,
  queue_body      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  last_error      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_user
  ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_generation_run
  ON projects(generation_run_id);

CREATE INDEX IF NOT EXISTS idx_workflows_project
  ON workflows(project_id);

CREATE INDEX IF NOT EXISTS idx_stages_workflow
  ON stages(workflow_id);
CREATE INDEX IF NOT EXISTS idx_stages_project_id
  ON stages(project_id);

CREATE INDEX IF NOT EXISTS idx_steps_workflow
  ON steps(workflow_id);
CREATE INDEX IF NOT EXISTS idx_steps_stage
  ON steps(stage_id);
CREATE INDEX IF NOT EXISTS idx_steps_project_id
  ON steps(project_id);

CREATE INDEX IF NOT EXISTS idx_edges_workflow
  ON edges(workflow_id);
CREATE INDEX IF NOT EXISTS idx_edges_project_id
  ON edges(project_id);

CREATE INDEX IF NOT EXISTS idx_checklist_step
  ON checklist_items(step_id);

CREATE INDEX IF NOT EXISTS idx_agent_runs_project
  ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_project_sequence
  ON agent_runs(project_id, sequence_index);

CREATE INDEX IF NOT EXISTS idx_generation_runs_project
  ON generation_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_runs_lifecycle
  ON generation_runs(lifecycle_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generation_checkpoints_project_batch
  ON generation_checkpoints(project_id, run_id, batch_name);

CREATE INDEX IF NOT EXISTS idx_project_generation_events_project
  ON project_generation_events(project_id, id);

CREATE INDEX IF NOT EXISTS idx_project_intake_messages_project
  ON project_intake_messages(project_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_briefs_project
  ON project_briefs(project_id);

CREATE INDEX IF NOT EXISTS idx_project_files_project
  ON project_files(project_id);

CREATE INDEX IF NOT EXISTS idx_generation_dispatches_project
  ON generation_dispatches(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_dispatches_status
  ON generation_dispatches(status, created_at DESC);

PRAGMA foreign_keys = ON;
