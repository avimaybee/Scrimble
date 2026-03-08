-- Initial Scrimble D1 Schema

-- USER PROFILES
CREATE TABLE IF NOT EXISTS profiles (
  id              TEXT PRIMARY KEY,     -- Firebase UID
  name            TEXT,
  email           TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- AI PROVIDER KEYS
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

-- PROJECTS
CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  project_type    TEXT,                 -- 'saas_mvp' | 'client_site' | 'internal_tool' | 'other'
  stack           TEXT,                 -- JSON: { frontend, backend, ... }
  status          TEXT DEFAULT 'active',-- 'active' | 'completed' | 'archived'
  risk_score      INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- PLANS (Workflows)
CREATE TABLE IF NOT EXISTS plans (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version         INTEGER DEFAULT 1,
  canvas_state    TEXT,                 -- JSON: viewport state
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- STAGES
CREATE TABLE IF NOT EXISTS stages (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  type            TEXT NOT NULL,
  order_index     INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'locked',-- 'locked' | 'active' | 'complete'
  created_at      TEXT DEFAULT (datetime('now'))
);

-- STEPS
CREATE TABLE IF NOT EXISTS steps (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id            TEXT REFERENCES stages(id),
  title               TEXT NOT NULL,
  type                TEXT NOT NULL,    -- 'task' | 'decision' | 'review' | 'ai_output'
  category            TEXT,             -- matches stage type for color coding
  position_x          REAL DEFAULT 0,
  position_y          REAL DEFAULT 0,
  status              TEXT DEFAULT 'locked',
  -- 'locked' | 'active' | 'agent_working' | 'needs_review' | 'complete' | 'skipped'
  is_gate             INTEGER DEFAULT 0,
  risk_level          TEXT DEFAULT 'low',
  order_index         INTEGER DEFAULT 0,
  objective           TEXT,
  why_it_matters      TEXT,
  suggested_tools     TEXT,             -- JSON
  done_when           TEXT,
  is_ai_enriched      INTEGER DEFAULT 0,
  ai_output           TEXT,             -- generated artifact
  prompts             TEXT,             -- JSON: [{ label, content }]
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

-- EDGES
CREATE TABLE IF NOT EXISTS edges (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_step_id  TEXT REFERENCES steps(id) ON DELETE CASCADE,
  target_step_id  TEXT REFERENCES steps(id) ON DELETE CASCADE,
  edge_type       TEXT DEFAULT 'default',
  condition       TEXT
);

-- CHECKLIST ITEMS
CREATE TABLE IF NOT EXISTS checklist_items (
  id              TEXT PRIMARY KEY,
  step_id         TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  is_required     INTEGER DEFAULT 0,
  is_completed    INTEGER DEFAULT 0,
  completed_at    TEXT,
  order_index     INTEGER DEFAULT 0
);

-- AGENT RUNS
CREATE TABLE IF NOT EXISTS agent_runs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_id         TEXT REFERENCES steps(id),
  run_type        TEXT NOT NULL,  -- 'generate_plan' | 'enrich_step' | 'update_plan' | 'review_gate'
  status          TEXT DEFAULT 'running', -- 'running' | 'waiting_review' | 'complete' | 'failed'
  input           TEXT,           -- JSON
  output          TEXT,           -- JSON
  provider        TEXT,
  model           TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  completed_at    TEXT
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_projects_user      ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_project      ON plans(project_id);
CREATE INDEX IF NOT EXISTS idx_stages_project     ON stages(project_id);
CREATE INDEX IF NOT EXISTS idx_steps_project      ON steps(project_id);
CREATE INDEX IF NOT EXISTS idx_steps_stage        ON steps(stage_id);
CREATE INDEX IF NOT EXISTS idx_checklist_step     ON checklist_items(step_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_providers_user  ON ai_providers(user_id);
