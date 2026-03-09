CREATE TABLE IF NOT EXISTS project_intake_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_intake_messages_project
  ON project_intake_messages(project_id, id);

CREATE TABLE IF NOT EXISTS project_briefs (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  raw_description    TEXT NOT NULL,
  enriched_brief     TEXT NOT NULL,
  what_it_is         TEXT,
  who_its_for        TEXT,
  problem_solved     TEXT,
  v1_scope           TEXT,
  stack_context      TEXT,
  definition_done    TEXT,
  constraints        TEXT,
  future_ideas       TEXT DEFAULT '[]',
  conversation_turns INTEGER DEFAULT 0,
  created_at         TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_briefs_project
  ON project_briefs(project_id);
