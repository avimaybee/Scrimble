-- OAuth device-code flow support
-- Migration 0002

CREATE TABLE IF NOT EXISTS device_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  user_code TEXT NOT NULL,
  client_id TEXT NOT NULL,
  scope TEXT,
  audience TEXT,
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  consumed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_device_codes_user_id ON device_codes(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_codes_user_code ON device_codes(user_code);
CREATE INDEX IF NOT EXISTS idx_device_codes_expires_at ON device_codes(expires_at);
