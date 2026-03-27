ALTER TABLE projects ADD COLUMN workflow_instance_id TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_workflow_instance_id
  ON projects(workflow_instance_id);
