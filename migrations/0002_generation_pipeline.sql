ALTER TABLE projects ADD COLUMN generation_status TEXT DEFAULT 'complete';
ALTER TABLE projects ADD COLUMN generation_error TEXT;
ALTER TABLE projects ADD COLUMN generation_started_at TEXT;
ALTER TABLE projects ADD COLUMN generation_completed_at TEXT;

UPDATE projects
SET generation_status = 'complete'
WHERE generation_status IS NULL;

ALTER TABLE agent_runs ADD COLUMN sequence_index INTEGER;
ALTER TABLE agent_runs ADD COLUMN attempt_count INTEGER DEFAULT 1;
ALTER TABLE agent_runs ADD COLUMN error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_runs_project_sequence
  ON agent_runs(project_id, sequence_index);

CREATE TABLE IF NOT EXISTS project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_files_project
  ON project_files(project_id);
