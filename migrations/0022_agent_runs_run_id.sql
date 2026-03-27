-- Migration: Add run_id to agent_runs for strict scoping --
ALTER TABLE agent_runs ADD COLUMN run_id TEXT;
CREATE INDEX idx_agent_runs_run_id ON agent_runs(run_id);
