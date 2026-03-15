-- Scrimble D1 Schema — Migration 001
-- Reordered drops to satisfy foreign key constraints
DROP TABLE IF EXISTS edges;
DROP TABLE IF EXISTS checklist_items;
DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS steps;
DROP TABLE IF EXISTS stages;
DROP TABLE IF EXISTS workflows;
DROP TABLE IF EXISTS plans;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS ai_providers;
DROP TABLE IF EXISTS profiles;

-- ────────────────────────────────────────────
-- USER PROFILES
-- Firebase UID is the primary key
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id              TEXT PRIMARY KEY,     -- Firebase UID
  name            TEXT,
  email           TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- AI PROVIDER KEYS
-- User's own API keys — encrypted at rest
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_providers (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,        -- display name e.g. "My OpenAI Key"
  provider        TEXT NOT NULL,        -- 'openai' | 'anthropic' | 'gemini' | 'custom'
  api_key_enc     TEXT NOT NULL,        -- AES-256 encrypted API key
  base_url        TEXT,                 -- for custom providers (OpenAI-compatible)
  model           TEXT,                 -- preferred model for this provider
  is_default      INTEGER DEFAULT 0,    -- one default per user
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- PROJECTS
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  description             TEXT,                 -- raw natural language description from user
  project_type            TEXT,                 -- AI-inferred: 'saas_mvp' | 'client_site' | 'internal_tool' | 'other'
  stack                   TEXT,                 -- JSON: { frontend, backend, auth, deploy, ai_tools, payments }
  status                  TEXT DEFAULT 'active',-- 'active' | 'completed' | 'archived'
  risk_score              INTEGER DEFAULT 0,    -- 0-100, recalculated on step changes
  generation_status       TEXT DEFAULT 'complete', -- 'intake' | 'queued' | 'complete' | 'failed' | 'awaiting_review' | 'approved'
  generation_error        TEXT,
  generation_run_id       TEXT,
  generation_provider_id  TEXT,
  generation_heartbeat_at TEXT,
  created_at              TEXT DEFAULT (datetime('now')),
  updated_at              TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- WORKFLOWS (one per project)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflows (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version         INTEGER DEFAULT 1,
  canvas_state    TEXT,                 -- JSON: React Flow viewport { x, y, zoom }
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- STAGES (top-level groupings of steps)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stages (
  id              TEXT PRIMARY KEY,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  type            TEXT NOT NULL,        -- 'understand' | 'document' | ... (see stage types)
  position_x      REAL DEFAULT 0,
  position_y      REAL DEFAULT 0,
  order_index     INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'locked',-- 'locked' | 'active' | 'complete'
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- STEPS (individual units of work)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS steps (
  id                  TEXT PRIMARY KEY,
  workflow_id         TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  stage_id            TEXT REFERENCES stages(id),
  title               TEXT NOT NULL,
  type                TEXT NOT NULL,    -- 'task' | 'decision' | 'review' | 'ai_output'
  category            TEXT,             -- matches stage type for color coding
  position_x          REAL DEFAULT 0,
  position_y          REAL DEFAULT 0,
  status              TEXT DEFAULT 'locked',
  -- 'locked' | 'active' | 'agent_working' | 'needs_review' | 'complete' | 'skipped'
  is_gate             INTEGER DEFAULT 0, -- 1 = AI pauses here for human review
  risk_level          TEXT DEFAULT 'low',
  order_index         INTEGER DEFAULT 0,
  -- AI-generated shallow content (from initial plan generation)
  objective           TEXT,
  why_it_matters      TEXT,
  suggested_tools     TEXT,             -- JSON: [{ name, url, reason }]
  done_when           TEXT,
  -- AI enrichment content (generated when step is first opened)
  is_ai_enriched      INTEGER DEFAULT 0,
  ai_output           TEXT,             -- generated artifact
  prompts             TEXT,             -- JSON: [{ label, content }]
  -- Agent state
  agent_job_id        TEXT,             -- Cloudflare Queue message ID if running
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- EDGES (connections between steps)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edges (
  id              TEXT PRIMARY KEY,
  workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  source_step_id  TEXT REFERENCES steps(id) ON DELETE CASCADE,
  target_step_id  TEXT REFERENCES steps(id) ON DELETE CASCADE,
  edge_type       TEXT DEFAULT 'default', -- 'default' | 'conditional'
  condition       TEXT
);

-- ────────────────────────────────────────────
-- CHECKLIST ITEMS
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_items (
  id              TEXT PRIMARY KEY,
  step_id         TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  is_required     INTEGER DEFAULT 0,
  is_completed    INTEGER DEFAULT 0,
  completed_at    TEXT,
  order_index     INTEGER DEFAULT 0
);

-- ────────────────────────────────────────────
-- AGENT RUNS (audit log of AI agent activity)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_runs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_id         TEXT REFERENCES steps(id),
  run_type        TEXT NOT NULL,  -- 'generate_plan' | 'enrich_step' | 'update_plan' | 'review_gate'
  status          TEXT DEFAULT 'running', -- 'running' | 'waiting_review' | 'complete' | 'failed'
  input           TEXT,           -- JSON: what was sent to the AI
  output          TEXT,           -- JSON: what the AI returned
  provider        TEXT,           -- which AI provider was used
  model           TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  completed_at    TEXT
);

-- ────────────────────────────────────────────
-- GENERATION DISPATCHES (audit log of queue tasks)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS generation_dispatches (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id          TEXT NOT NULL,
  dispatch_kind   TEXT NOT NULL,
  previous_status TEXT,
  target_status   TEXT,
  queue_body      TEXT,
  status          TEXT DEFAULT 'pending', -- 'pending' | 'success' | 'failed'
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- GENERATION CHECKPOINTS (durable task state)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS generation_checkpoints (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id          TEXT NOT NULL,
  batch_name      TEXT NOT NULL,
  current_index   INTEGER DEFAULT 0,
  payload_inline  TEXT,
  payload_r2_key  TEXT,
  size_bytes      INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- PROJECT GENERATION EVENTS (SSE event persistence)
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_generation_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  batch_name      TEXT,
  payload         TEXT NOT NULL,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- TRANSIENT STATE (Thinking / Reasoning Relay)
-- Rows are physically DELETED on batch/pipeline completion
-- ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_generation_live_state (
  project_id      TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  reasoning       TEXT,                 -- the current accumulated thinking block
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────
-- INDEXES
-- ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_projects_user      ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_project  ON workflows(project_id);
CREATE INDEX IF NOT EXISTS idx_stages_workflow    ON stages(workflow_id);
CREATE INDEX IF NOT EXISTS idx_steps_workflow     ON steps(workflow_id);
CREATE INDEX IF NOT EXISTS idx_steps_stage        ON steps(stage_id);
CREATE INDEX IF NOT EXISTS idx_checklist_step     ON checklist_items(step_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_providers_user  ON ai_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_checkpoints_project ON generation_checkpoints(project_id);
CREATE INDEX IF NOT EXISTS idx_generation_dispatches_project  ON generation_dispatches(project_id);
CREATE INDEX IF NOT EXISTS idx_generation_events_project      ON project_generation_events(project_id);
