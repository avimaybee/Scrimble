-- Persist per-step research footer metadata for dedicated footer rendering.
ALTER TABLE steps ADD COLUMN research_footer_meta TEXT;
