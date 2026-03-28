import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const migrationPath = path.join(repoRoot, 'migrations', '0026_full_canonical_rebuild.sql');
const migrationSql = readFileSync(migrationPath, 'utf8');

const runtimeTs = readFileSync(path.join(repoRoot, 'functions', 'server', 'generation-runtime.ts'), 'utf8');
const pipelineTs = readFileSync(path.join(repoRoot, 'functions', 'server', 'generation-pipeline.ts'), 'utf8');
const appTs = readFileSync(path.join(repoRoot, 'functions', 'server', 'app.ts'), 'utf8');
const typesTs = readFileSync(path.join(repoRoot, 'functions', 'server', 'types.ts'), 'utf8');

function pass(label: string) {
  console.log(`PASS ${label}`);
}

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    fail(message);
  }
}

function extractCreateTable(sql: string, tableName: string): string {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = sql.match(new RegExp(`CREATE TABLE\\s+${escaped}\\s*\\(([^]*?)\\);`, 'i'));
  return match?.[0] || '';
}

function assertMigrationDropsAndRecreatesEverything() {
  assert(/PRAGMA\s+foreign_keys\s*=\s*OFF\s*;/i.test(migrationSql), 'Migration must disable foreign_keys.');
  assert(/PRAGMA\s+foreign_keys\s*=\s*ON\s*;/i.test(migrationSql), 'Migration must re-enable foreign_keys.');
  assert(/DROP TABLE IF EXISTS projects/i.test(migrationSql), 'Migration must drop projects.');
  assert(/DROP TABLE IF EXISTS generation_runs/i.test(migrationSql), 'Migration must drop generation_runs.');
  assert(/DROP TABLE IF EXISTS profiles/i.test(migrationSql), 'Migration must drop profiles.');
  
  const requiredTables = [
    'profiles', 'ai_providers', 'ai_models', 'user_tools', 'mcp_servers',
    'projects', 'workflows', 'stages', 'steps', 'edges', 'checklist_items',
    'agent_runs', 'generation_runs', 'generation_checkpoints',
    'project_generation_events', 'project_intake_messages', 'project_briefs',
    'project_files', 'generation_dispatches', 'project_generation_live_state'
  ];

  for (const table of requiredTables) {
    assert(extractCreateTable(migrationSql, table).length > 0, `Migration must recreate table "${table}".`);
  }

  assert(!/projects_old/i.test(migrationSql), 'Migration must not reference projects_old.');
  assert(!/\b\w+_old\b/i.test(migrationSql), 'Migration must not create or reference *_old tables.');

  pass('Migration 0026 drops and recreates all canonical tables');
}

function assertCanonicalGenerationRunsSchema() {
  const block = extractCreateTable(migrationSql, 'generation_runs');
  assert(block.includes('lifecycle_status'), 'generation_runs must have lifecycle_status.');
  assert(!block.includes(' status '), 'generation_runs must NOT have a "status" column (removed in favor of lifecycle_status).');
  assert(block.includes('run_id'), 'generation_runs must have run_id.');
  assert(block.includes('workflow_instance_id'), 'generation_runs must have workflow_instance_id.');
  pass('generation_runs schema is canonical');
}

function assertCanonicalProfilesSchema() {
  const block = extractCreateTable(migrationSql, 'profiles');
  assert(block.includes('fast_model_provider_id'), 'profiles must have fast_model_provider_id.');
  assert(block.includes('fast_model_name'), 'profiles must have fast_model_name.');
  assert(block.includes('deep_model_provider_id'), 'profiles must have deep_model_provider_id.');
  assert(block.includes('deep_model_name'), 'profiles must have deep_model_name.');
  pass('profiles schema includes model role columns');
}

function assertAgentRunsHasRunId() {
  const block = extractCreateTable(migrationSql, 'agent_runs');
  assert(block.includes('run_id'), 'agent_runs must have run_id.');
  pass('agent_runs includes run_id');
}

function assertRuntimeSqlUsesLifecycleStatus() {
  console.log('Checking lifecycle_status UPDATE...');
  assert(/lifecycle_status\s*=\s*\?/i.test(runtimeTs), 'generation-runtime.ts must target lifecycle_status in UPDATE.');
  console.log('Checking lifecycle_status INSERT...');
  assert(/lifecycle_status/i.test(runtimeTs), 'generation-runtime.ts must target lifecycle_status in INSERT.');
  console.log('Checking status absence...');
  assert(
    !/UPDATE\s+generation_runs[\s\S]*?\bstatus\s*=\s*\?/i.test(runtimeTs),
    'generation-runtime.ts must NOT target status column in UPDATE.',
  );
  pass('server runtime SQL targets canonical columns');
}

function assertPipelineWritesRunScopedAgentRows() {
  assert(
    /INSERT INTO agent_runs\s*\(\s*id,\s*project_id,\s*run_id,\s*run_type/i.test(pipelineTs),
    'generation-pipeline.ts must insert run_id into agent_runs.',
  );
  assert(
    /await insertAgentRun\(env,\s*\{[^]*?runId,/i.test(pipelineTs),
    'generation-pipeline.ts batch completion/failure inserts must pass runId.',
  );
  pass('pipeline persists run_id on agent_runs rows');
}

function assertRuntimeReadPathsUseCanonicalPointer() {
  assert(
    /LEFT JOIN generation_runs gr ON gr\.id = p\.current_generation_run_id/i.test(runtimeTs),
    'generation-runtime.ts must resolve active run through projects.current_generation_run_id.',
  );
  assert(
    /gr\.lifecycle_status AS status/i.test(runtimeTs),
    'generation-runtime.ts must read lifecycle_status from generation_runs.',
  );
  pass('runtime reads from canonical project-to-run pointer');
}

function assertProfileBootstrapAndModelRolesUseCanonicalColumns() {
  assert(
    /INSERT OR IGNORE INTO profiles \(id\) VALUES \(\?\)/i.test(appTs),
    'app.ts must auto-create profile rows on authenticated access.',
  );
  assert(
    /UPDATE profiles[\s\S]*fast_model_provider_id[\s\S]*fast_model_name[\s\S]*deep_model_provider_id[\s\S]*deep_model_name/i.test(appTs),
    'app.ts model-role writes must target canonical profile columns.',
  );
  pass('profile bootstrap and model role SQL use canonical profiles schema');
}

function assertCoreFlowsTargetCanonicalTables() {
  assert(
    /app\.post\('\/intake\/start'[\s\S]*INSERT INTO projects[\s\S]*id,\s*user_id,\s*name,\s*description,\s*project_type,\s*stack,\s*status,\s*risk_score/i.test(appTs),
    'intake/start must write canonical projects columns.',
  );
  assert(
    /app\.post\('\/intake\/:id\/confirm'[\s\S]*createGenerationRun\(/i.test(appTs),
    'intake/confirm must create generation_runs row via runtime helper.',
  );
  assert(
    /app\.delete\('\/projects\/:id'[\s\S]*DELETE FROM generation_dispatches[\s\S]*DELETE FROM project_files[\s\S]*DELETE FROM generation_checkpoints[\s\S]*DELETE FROM generation_runs[\s\S]*DELETE FROM projects/i.test(appTs),
    'project delete flow must clean canonical runtime tables on rebuilt schema.',
  );
  pass('core intake/delete flows target canonical rebuilt schema');
}

function assertNoLegacyCompatColumns() {
  assert(!migrationSql.includes('status TEXT DEFAULT \'queued\''), 'Legacy "status" column must not exist in any CREATE TABLE.');
  // Check projects table specifically for removed columns
  const projectsBlock = extractCreateTable(migrationSql, 'projects');
  assert(!projectsBlock.includes('generation_status'), 'projects must NOT have generation_status.');
  assert(!projectsBlock.includes('generation_error'), 'projects must NOT have generation_error.');
  pass('no legacy compatibility columns found in 0026');
}

function assertProjectsRunPointerIsCanonical() {
  const block = extractCreateTable(migrationSql, 'projects');
  assert(block.includes('current_generation_run_id'), 'projects must keep current_generation_run_id.');
  assert(!block.includes('generation_status'), 'projects must not include generation_status.');
  assert(!/\bgeneration_run_id\b\s+TEXT/i.test(block), 'projects must not include generation_run_id.');
  assert(!block.includes('generation_provider_id'), 'projects must not include generation_provider_id.');
  assert(!block.includes('generation_heartbeat_at'), 'projects must not include generation_heartbeat_at.');
  assert(!block.includes('generation_started_at'), 'projects must not include generation_started_at.');
  assert(!block.includes('generation_completed_at'), 'projects must not include generation_completed_at.');
  pass('projects table keeps only canonical run pointer');
}

function run() {
  console.log('Starting Phase 14D Canonical Rebuild Assertions...');
  assertMigrationDropsAndRecreatesEverything();
  assertCanonicalGenerationRunsSchema();
  assertCanonicalProfilesSchema();
  assertAgentRunsHasRunId();
  assertRuntimeSqlUsesLifecycleStatus();
  assertPipelineWritesRunScopedAgentRows();
  assertRuntimeReadPathsUseCanonicalPointer();
  assertProfileBootstrapAndModelRolesUseCanonicalColumns();
  assertCoreFlowsTargetCanonicalTables();
  assertNoLegacyCompatColumns();
  assertProjectsRunPointerIsCanonical();
  console.log('✅ ALL Phase 14D assertions passed.');
}

run();
