-- ────────────────────────────────────────────────────────────────
-- 021: Generation Runtime State (Task A2)
--
-- Problem: The `projects` table mixes durable project state with
-- transient workflow runtime state. This makes resume, cancel, and
-- recovery fragile because the same fields are used for different
-- purposes at different times.
--
-- Solution: Create a dedicated `generation_runs` table that owns all
-- runtime state for a single generation execution. The `projects`
-- table keeps only durable project facts.
--
-- Migration strategy:
-- 1. Create the new generation_runs table
-- 2. Migrate active runs from projects to generation_runs
-- 3. Keep existing projects columns for backward compatibility
--    (will be removed in a future cleanup migration after A6)
-- ────────────────────────────────────────────────────────────────

-- The generation_runs table owns all state for a single generation execution.
-- One project may have many runs over time, but only one can be "current".
CREATE TABLE IF NOT EXISTS generation_runs (
  id                  TEXT PRIMARY KEY,  -- Same as projects.generation_run_id
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_instance_id TEXT,             -- Cloudflare Workflow instance ID
  
  -- Lifecycle state (mirrors existing ProjectGenerationStatus)
  status              TEXT NOT NULL DEFAULT 'queued',
  -- 'queued' | 'batch_1_...' ... 'batch_6_...' | 'awaiting_review' | 'approved' | 'complete' | 'failed' | 'cancelled'
  
  -- Runtime tracking
  current_batch       TEXT,              -- Currently executing batch name (null when not in batch)
  provider_id         TEXT,              -- AI provider being used for this run
  heartbeat_at        TEXT,              -- Last heartbeat timestamp
  
  -- Error handling
  error_message       TEXT,              -- Error message if status='failed'
  
  -- Timestamps
  started_at          TEXT DEFAULT (datetime('now')),
  completed_at        TEXT,              -- Set when status becomes 'complete', 'failed', or 'cancelled'
  
  -- Audit
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

-- A project can only have one "current" run at a time
-- This tracks which run is active (null if no generation in progress)
ALTER TABLE projects ADD COLUMN current_generation_run_id TEXT REFERENCES generation_runs(id);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_generation_runs_project ON generation_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_runs_status ON generation_runs(status) WHERE status NOT IN ('complete', 'failed', 'cancelled');
CREATE INDEX IF NOT EXISTS idx_generation_runs_heartbeat ON generation_runs(heartbeat_at) WHERE status NOT IN ('complete', 'failed', 'cancelled', 'awaiting_review');

-- Migrate existing active runs to the new table
INSERT INTO generation_runs (
  id,
  project_id,
  workflow_instance_id,
  status,
  current_batch,
  provider_id,
  heartbeat_at,
  error_message,
  started_at,
  completed_at,
  created_at,
  updated_at
)
SELECT
  generation_run_id,
  id,
  workflow_instance_id,
  COALESCE(generation_status, 'queued'),
  CASE 
    WHEN generation_status LIKE 'batch_%' THEN generation_status
    ELSE NULL
  END,
  generation_provider_id,
  generation_heartbeat_at,
  generation_error,
  COALESCE(generation_started_at, created_at),
  generation_completed_at,
  created_at,
  updated_at
FROM projects
WHERE generation_run_id IS NOT NULL 
  AND generation_run_id != ''
  AND generation_status NOT IN ('intake', 'complete');

-- Link the migrated runs back to projects
UPDATE projects
SET current_generation_run_id = generation_run_id
WHERE generation_run_id IS NOT NULL 
  AND generation_run_id != ''
  AND generation_status NOT IN ('intake', 'complete', 'failed', 'cancelled');
