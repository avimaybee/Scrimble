-- ────────────────────────────────────────────────────────────────
-- 012: Add milestone fields to steps
-- 
-- Adds support for milestone nodes on the project canvas.
-- ────────────────────────────────────────────────────────────────

ALTER TABLE steps ADD COLUMN is_milestone INTEGER DEFAULT 0;
ALTER TABLE steps ADD COLUMN milestone_label TEXT;
