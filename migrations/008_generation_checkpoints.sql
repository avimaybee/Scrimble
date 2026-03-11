ALTER TABLE agent_runs ADD COLUMN output_r2_key TEXT;

ALTER TABLE projects ADD COLUMN generation_run_id TEXT;
ALTER TABLE projects ADD COLUMN generation_provider_id TEXT;
ALTER TABLE projects ADD COLUMN generation_heartbeat_at TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_generation_run
  ON projects(generation_run_id);

CREATE TABLE IF NOT EXISTS generation_checkpoints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  batch_name TEXT NOT NULL,
  current_index INTEGER NOT NULL DEFAULT 0,
  payload_inline TEXT,
  payload_r2_key TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, run_id, batch_name)
);

CREATE INDEX IF NOT EXISTS idx_generation_checkpoints_project_batch
  ON generation_checkpoints(project_id, run_id, batch_name);

UPDATE projects
SET generation_run_id = COALESCE(generation_run_id, id),
    generation_heartbeat_at = COALESCE(generation_heartbeat_at, generation_started_at)
WHERE generation_status != 'complete';
