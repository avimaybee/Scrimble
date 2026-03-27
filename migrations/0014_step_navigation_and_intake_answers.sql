-- ────────────────────────────────────────────────────────────────
-- 014: Add step navigation links + intake answers payload
-- ────────────────────────────────────────────────────────────────

ALTER TABLE steps ADD COLUMN navigation_links TEXT DEFAULT '[]';
ALTER TABLE projects ADD COLUMN intake_answers TEXT;
