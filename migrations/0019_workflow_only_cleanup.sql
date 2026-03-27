-- Workflow-only architecture cleanup.
-- Removes stale queue-era artifacts and default-provider semantics.

PRAGMA foreign_keys=OFF;

-- 1) Drop stale queue-era dispatch audit table if present.
DROP TABLE IF EXISTS generation_dispatches;

-- 2) Rebuild ai_providers without is_default.
ALTER TABLE ai_providers RENAME TO ai_providers_old;

CREATE TABLE ai_providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  api_key_enc TEXT NOT NULL,
  base_url TEXT,
  model TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO ai_providers (id, user_id, name, provider, api_key_enc, base_url, model, created_at)
SELECT id, user_id, name, provider, api_key_enc, base_url, model, created_at
FROM ai_providers_old;

DROP TABLE ai_providers_old;
CREATE INDEX IF NOT EXISTS idx_ai_providers_user ON ai_providers(user_id);

-- 3) Rebuild steps without stale agent_job_id column.
ALTER TABLE steps RENAME TO steps_old;

CREATE TABLE steps (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  stage_id TEXT REFERENCES stages(id),
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT,
  position_x REAL DEFAULT 0,
  position_y REAL DEFAULT 0,
  status TEXT DEFAULT 'locked',
  is_gate INTEGER DEFAULT 0,
  risk_level TEXT DEFAULT 'low',
  order_index INTEGER DEFAULT 0,
  objective TEXT,
  why_it_matters TEXT,
  suggested_tools TEXT,
  exit_criteria TEXT,
  is_ai_enriched INTEGER DEFAULT 0,
  ai_output TEXT,
  prompts TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  done_when TEXT,
  is_milestone INTEGER DEFAULT 0,
  milestone_label TEXT,
  research_footer_meta TEXT,
  navigation_links TEXT
);

INSERT INTO steps (
  id, workflow_id, project_id, stage_id, title, type, category,
  position_x, position_y, status, is_gate, risk_level, order_index,
  objective, why_it_matters, suggested_tools, exit_criteria,
  is_ai_enriched, ai_output, prompts, created_at, updated_at,
  done_when, is_milestone, milestone_label, research_footer_meta, navigation_links
)
SELECT
  id, workflow_id, project_id, stage_id, title, type, category,
  position_x, position_y, status, is_gate, risk_level, order_index,
  objective, why_it_matters, suggested_tools, exit_criteria,
  is_ai_enriched, ai_output, prompts, created_at, updated_at,
  done_when, is_milestone, milestone_label, research_footer_meta, '[]'
FROM steps_old;

DROP TABLE steps_old;
CREATE INDEX IF NOT EXISTS idx_steps_project ON steps(project_id);
CREATE INDEX IF NOT EXISTS idx_steps_workflow ON steps(workflow_id);
CREATE INDEX IF NOT EXISTS idx_steps_stage ON steps(stage_id);

-- 4) Remove checkpoint rows for runs that are no longer active/current.
DELETE FROM generation_checkpoints
WHERE run_id NOT IN (
  SELECT DISTINCT generation_run_id
  FROM projects
  WHERE generation_run_id IS NOT NULL AND TRIM(generation_run_id) != ''
);

PRAGMA foreign_keys=ON;
