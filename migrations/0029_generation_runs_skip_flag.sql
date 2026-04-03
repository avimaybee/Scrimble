ALTER TABLE generation_runs ADD COLUMN skip_target_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE generation_runs ADD COLUMN skip_target_name TEXT;
