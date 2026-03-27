CREATE TABLE IF NOT EXISTS user_tools (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category     TEXT NOT NULL,
  name         TEXT NOT NULL,
  proficiency  TEXT DEFAULT 'comfortable',
  notes        TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_tools_user ON user_tools(user_id);
