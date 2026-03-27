-- ────────────────────────────────────────────────────────────────
-- 013: Add fast/deep model role settings to profiles
-- ────────────────────────────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN fast_model_provider_id TEXT REFERENCES ai_providers(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN fast_model_name TEXT;
ALTER TABLE profiles ADD COLUMN deep_model_provider_id TEXT REFERENCES ai_providers(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN deep_model_name TEXT;
