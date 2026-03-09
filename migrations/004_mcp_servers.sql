CREATE TABLE IF NOT EXISTS mcp_servers (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  server_type TEXT NOT NULL,
  name        TEXT NOT NULL,
  config_enc  TEXT NOT NULL,
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_user ON mcp_servers(user_id);
