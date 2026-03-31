-- Add explicit checkpoint lifecycle state (Phase 18, T5)
-- States: active | completed | invalidated
-- This replaces implicit nullability-based lifecycle inference.

ALTER TABLE generation_checkpoints ADD COLUMN checkpoint_state TEXT NOT NULL DEFAULT 'active';

-- Existing checkpoints are assumed active
UPDATE generation_checkpoints SET checkpoint_state = 'active' WHERE checkpoint_state IS NULL OR checkpoint_state = '';

CREATE INDEX IF NOT EXISTS idx_generation_checkpoints_state
  ON generation_checkpoints(project_id, checkpoint_state);
