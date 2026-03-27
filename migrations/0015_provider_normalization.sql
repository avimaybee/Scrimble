-- ────────────────────────────────────────────────────────────────
-- 014: Normalize AI providers and models
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Migrate existing models from ai_providers
INSERT INTO ai_models (id, provider_id, name)
SELECT 
  lower(hex(randomblob(16))) as id, 
  id as provider_id, 
  model as name
FROM ai_providers 
WHERE model IS NOT NULL AND model != '';
