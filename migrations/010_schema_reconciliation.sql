-- ────────────────────────────────────────────────────────────────
-- 010: Schema reconciliation
-- 
-- Migration 0000 creates tables with project_id FKs on steps/edges/stages.
-- Migration 001 creates the same tables with workflow_id FKs.
-- Since 0000 runs first, CREATE TABLE IF NOT EXISTS in 001 is a no-op
-- for existing tables, leaving them with 0000's schema.
-- 
-- The codebase uniformly uses workflow_id. This migration adds the
-- missing workflow_id columns so both old (project_id) and new
-- (workflow_id) references work.
-- ────────────────────────────────────────────────────────────────

-- Add workflow_id to steps (code INSERT/SELECT uses this column)
ALTER TABLE steps ADD COLUMN workflow_id TEXT REFERENCES workflows(id) ON DELETE CASCADE;

-- Add workflow_id to stages (code INSERT/SELECT uses this column)
ALTER TABLE stages ADD COLUMN workflow_id TEXT REFERENCES workflows(id) ON DELETE CASCADE;

-- Add workflow_id to edges (code INSERT/SELECT uses this column)
ALTER TABLE edges ADD COLUMN workflow_id TEXT REFERENCES workflows(id) ON DELETE CASCADE;

-- Add position columns to stages (001 schema has these, 0000 does not)
ALTER TABLE stages ADD COLUMN position_x REAL DEFAULT 0;
ALTER TABLE stages ADD COLUMN position_y REAL DEFAULT 0;

-- Create indexes for the new workflow_id columns
CREATE INDEX IF NOT EXISTS idx_steps_workflow ON steps(workflow_id);
CREATE INDEX IF NOT EXISTS idx_stages_workflow ON stages(workflow_id);
CREATE INDEX IF NOT EXISTS idx_edges_workflow ON edges(workflow_id);

-- Add last_error to generation_dispatches (009 defines it but 001 created the table first)
ALTER TABLE generation_dispatches ADD COLUMN last_error TEXT;

-- Drop the orphaned live_state table (thinking deltas are no longer persisted)
DROP TABLE IF EXISTS project_generation_live_state;
