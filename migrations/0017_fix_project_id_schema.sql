-- Migration 017: Fix project_id vs workflow_id schema inconsistencies
-- The codebase currently expects workflow_id in stages, steps, and edges.
-- However, some environments might still have code or legacy triggers that 
-- expect project_id, or migrations that failed because project_id was missing.

-- 1. Ensure stages has project_id (referenced by legacy code or migrations)
ALTER TABLE stages ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;

-- 2. Ensure steps has project_id
ALTER TABLE steps ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;

-- 3. Ensure edges has project_id
ALTER TABLE edges ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;

-- 4. Backfill project_id from workflow_id -> workflows -> project_id
UPDATE stages SET project_id = (SELECT project_id FROM workflows WHERE workflows.id = stages.workflow_id) WHERE project_id IS NULL AND workflow_id IS NOT NULL;
UPDATE steps SET project_id = (SELECT project_id FROM workflows WHERE workflows.id = steps.workflow_id) WHERE project_id IS NULL AND workflow_id IS NOT NULL;
UPDATE edges SET project_id = (SELECT project_id FROM workflows WHERE workflows.id = edges.workflow_id) WHERE project_id IS NULL AND workflow_id IS NOT NULL;

-- 5. Create indexes for performance and to satisfy any old code that might be querying by project_id
CREATE INDEX IF NOT EXISTS idx_stages_project_id ON stages(project_id);
CREATE INDEX IF NOT EXISTS idx_steps_project_id ON steps(project_id);
CREATE INDEX IF NOT EXISTS idx_edges_project_id ON edges(project_id);
