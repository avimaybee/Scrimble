-- Canonical plan sync registry
-- Migration 0003

CREATE TABLE IF NOT EXISTS plan_sync_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL,
  plan_hash TEXT NOT NULL,
  plan_data TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, version)
);

CREATE INDEX IF NOT EXISTS idx_plan_sync_revisions_project_id ON plan_sync_revisions(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_sync_revisions_project_version ON plan_sync_revisions(project_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_plan_sync_revisions_hash ON plan_sync_revisions(plan_hash);
