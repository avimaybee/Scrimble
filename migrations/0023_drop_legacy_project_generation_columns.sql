-- Phase 7: retire legacy project-level generation lifecycle mirrors.
-- Keep current_generation_run_id as the canonical pointer to generation_runs.

PRAGMA foreign_keys=OFF;

ALTER TABLE projects RENAME TO projects_old;

CREATE TABLE projects (
  id                        TEXT PRIMARY KEY,
  user_id                   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL,
  description               TEXT,
  project_type              TEXT,
  stack                     TEXT,
  status                    TEXT DEFAULT 'active',
  risk_score                INTEGER DEFAULT 0,
  created_at                TEXT DEFAULT (datetime('now')),
  updated_at                TEXT DEFAULT (datetime('now')),
  intake_answers            TEXT,
  current_generation_run_id TEXT REFERENCES generation_runs(id)
);

INSERT INTO projects (
  id,
  user_id,
  name,
  description,
  project_type,
  stack,
  status,
  risk_score,
  created_at,
  updated_at,
  intake_answers,
  current_generation_run_id
)
SELECT
  id,
  user_id,
  name,
  description,
  project_type,
  stack,
  status,
  risk_score,
  created_at,
  updated_at,
  intake_answers,
  current_generation_run_id
FROM projects_old;

DROP TABLE projects_old;

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

PRAGMA foreign_keys=ON;
