-- Seed mock data for Scrimble local testing (Corrected for Migration 001+)

-- 1. Profiles (Firebase UID format)
INSERT INTO profiles (id, name, email) VALUES 
('user_123', 'John Doe', 'john@example.com'),
('user_456', 'Jane Smith', 'jane@example.com');

-- 2. AI Providers
INSERT INTO ai_providers (id, user_id, name, provider, api_key_enc, is_default) VALUES
('provider_1', 'user_123', 'OpenAI Pro', 'openai', 'enc_key_abc', 1),
('provider_2', 'user_123', 'Anthropic Key', 'anthropic', 'enc_key_def', 0);

-- 3. Projects
INSERT INTO projects (id, user_id, name, description, project_type, status) VALUES
('project_1', 'user_123', 'SaaS MVP', 'A simple task management app.', 'saas_mvp', 'active'),
('project_2', 'user_123', 'Portfolio Site', 'Personal developer portfolio.', 'client_site', 'active');

-- 4. Workflows (replacing plans)
INSERT INTO workflows (id, project_id, version) VALUES
('wf_1', 'project_1', 1),
('wf_2', 'project_2', 1);

-- 5. Stages (references workflow_id)
INSERT INTO stages (id, workflow_id, title, type, order_index, status) VALUES
('stage_1', 'wf_1', 'Planning', 'understand', 0, 'complete'),
('stage_2', 'wf_1', 'Development', 'build', 1, 'active'),
('stage_3', 'wf_2', 'Design', 'document', 0, 'active');

-- 6. Steps (references workflow_id and stage_id)
INSERT INTO steps (id, workflow_id, stage_id, title, type, status, order_index) VALUES
('step_1', 'wf_1', 'stage_1', 'Market Research', 'task', 'complete', 0),
('step_2', 'wf_1', 'stage_1', 'Core Features List', 'task', 'complete', 1),
('step_3', 'wf_1', 'stage_2', 'Setup Database', 'task', 'active', 0),
('step_4', 'wf_2', 'stage_3', 'Mockup Design', 'task', 'active', 0);

-- 7. MCP Servers
INSERT INTO mcp_servers (id, user_id, server_type, name, config_enc, is_active) VALUES
('mcp_1', 'user_123', 'database', 'Local Postgres', 'enc_config_1', 1),
('mcp_2', 'user_123', 'api', 'Stripe Integration', 'enc_config_2', 1);

-- 8. Checklist Items
INSERT INTO checklist_items (id, step_id, label, is_required, is_completed) VALUES
('check_1', 'step_1', 'Competitor Analysis', 1, 1),
('check_2', 'step_1', 'User Surveys', 0, 1),
('check_3', 'step_3', 'Schema Definition', 1, 0),
('check_4', 'step_3', 'Migration Script', 1, 0);
