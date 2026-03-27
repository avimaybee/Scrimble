-- Forward-fix for 0024: restore the canonical project -> runtime pointer.
-- The runtime joins through projects.current_generation_run_id, which 0024 dropped
-- when rebuilding the projects table.

ALTER TABLE projects ADD COLUMN current_generation_run_id TEXT REFERENCES generation_runs(id);

CREATE INDEX IF NOT EXISTS idx_projects_generation_run
  ON projects(current_generation_run_id);
