CREATE TABLE IF NOT EXISTS generation_dispatches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  dispatch_kind TEXT NOT NULL,
  previous_status TEXT,
  target_status TEXT NOT NULL,
  queue_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_generation_dispatches_project
  ON generation_dispatches(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generation_dispatches_status
  ON generation_dispatches(status, created_at DESC);
