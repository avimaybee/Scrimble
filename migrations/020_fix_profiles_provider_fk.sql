-- Repair foreign keys accidentally pinned to *_old tables after 019 table rebuilds.
-- Build canonical *_new tables, copy valid data, then swap tables in place.

PRAGMA foreign_keys=OFF;

CREATE TABLE profiles_new (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  fast_model_provider_id TEXT REFERENCES ai_providers(id) ON DELETE SET NULL,
  fast_model_name TEXT,
  deep_model_provider_id TEXT REFERENCES ai_providers(id) ON DELETE SET NULL,
  deep_model_name TEXT
);

INSERT INTO profiles_new (
  id,
  name,
  email,
  created_at,
  updated_at,
  fast_model_provider_id,
  fast_model_name,
  deep_model_provider_id,
  deep_model_name
)
SELECT
  p.id,
  p.name,
  p.email,
  p.created_at,
  p.updated_at,
  CASE
    WHEN p.fast_model_provider_id IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM ai_providers ap WHERE ap.id = p.fast_model_provider_id) THEN p.fast_model_provider_id
    ELSE NULL
  END,
  p.fast_model_name,
  CASE
    WHEN p.deep_model_provider_id IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM ai_providers ap WHERE ap.id = p.deep_model_provider_id) THEN p.deep_model_provider_id
    ELSE NULL
  END,
  p.deep_model_name
FROM profiles p;

CREATE TABLE ai_models_new (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO ai_models_new (id, provider_id, name, created_at)
SELECT
  m.id,
  m.provider_id,
  m.name,
  m.created_at
FROM ai_models m
WHERE EXISTS (
  SELECT 1
  FROM ai_providers ap
  WHERE ap.id = m.provider_id
);

CREATE TABLE checklist_items_new (
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_required INTEGER DEFAULT 0,
  is_completed INTEGER DEFAULT 0,
  completed_at TEXT,
  order_index INTEGER DEFAULT 0
);

INSERT INTO checklist_items_new (id, step_id, label, is_required, is_completed, completed_at, order_index)
SELECT
  c.id,
  c.step_id,
  c.label,
  c.is_required,
  c.is_completed,
  c.completed_at,
  c.order_index
FROM checklist_items c
WHERE EXISTS (
  SELECT 1
  FROM steps s
  WHERE s.id = c.step_id
);

CREATE TABLE edges_new (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  source_step_id TEXT REFERENCES steps(id) ON DELETE CASCADE,
  target_step_id TEXT REFERENCES steps(id) ON DELETE CASCADE,
  edge_type TEXT DEFAULT 'default',
  condition TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE
);

INSERT INTO edges_new (id, workflow_id, source_step_id, target_step_id, edge_type, condition, project_id)
SELECT
  e.id,
  e.workflow_id,
  e.source_step_id,
  e.target_step_id,
  e.edge_type,
  e.condition,
  e.project_id
FROM edges e
WHERE EXISTS (
  SELECT 1
  FROM workflows w
  WHERE w.id = e.workflow_id
)
AND (e.source_step_id IS NULL OR EXISTS (SELECT 1 FROM steps s WHERE s.id = e.source_step_id))
AND (e.target_step_id IS NULL OR EXISTS (SELECT 1 FROM steps s WHERE s.id = e.target_step_id))
AND (e.project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = e.project_id));

CREATE TABLE agent_runs_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES steps(id),
  run_type TEXT NOT NULL,
  status TEXT DEFAULT 'running',
  input TEXT,
  output TEXT,
  provider TEXT,
  model TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  sequence_index INTEGER,
  attempt_count INTEGER DEFAULT 1,
  error_message TEXT,
  output_r2_key TEXT
);

INSERT INTO agent_runs_new (
  id,
  project_id,
  step_id,
  run_type,
  status,
  input,
  output,
  provider,
  model,
  created_at,
  completed_at,
  sequence_index,
  attempt_count,
  error_message,
  output_r2_key
)
SELECT
  a.id,
  a.project_id,
  a.step_id,
  a.run_type,
  a.status,
  a.input,
  a.output,
  a.provider,
  a.model,
  a.created_at,
  a.completed_at,
  a.sequence_index,
  a.attempt_count,
  a.error_message,
  a.output_r2_key
FROM agent_runs a
WHERE EXISTS (
  SELECT 1
  FROM projects p
  WHERE p.id = a.project_id
)
AND (a.step_id IS NULL OR EXISTS (SELECT 1 FROM steps s WHERE s.id = a.step_id));

DROP TABLE profiles;
DROP TABLE ai_models;
DROP TABLE checklist_items;
DROP TABLE edges;
DROP TABLE agent_runs;

ALTER TABLE profiles_new RENAME TO profiles;
ALTER TABLE ai_models_new RENAME TO ai_models;
ALTER TABLE checklist_items_new RENAME TO checklist_items;
ALTER TABLE edges_new RENAME TO edges;
ALTER TABLE agent_runs_new RENAME TO agent_runs;

CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_checklist_step ON checklist_items(step_id);
CREATE INDEX IF NOT EXISTS idx_edges_workflow ON edges(workflow_id);
CREATE INDEX IF NOT EXISTS idx_edges_project_id ON edges(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_project_sequence ON agent_runs(project_id, sequence_index);

PRAGMA foreign_keys=ON;
