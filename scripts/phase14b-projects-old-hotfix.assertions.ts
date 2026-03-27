import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const migration0024Path = path.join(
  repoRoot,
  'migrations',
  '0024_reset_project_scoped_schema_after_projects_rebuild.sql',
);
const migration0024 = readFileSync(migration0024Path, 'utf8');

const appTs = readFileSync(path.join(repoRoot, 'functions', 'server', 'app.ts'), 'utf8');
const generationPipelineTs = readFileSync(path.join(repoRoot, 'functions', 'server', 'generation-pipeline.ts'), 'utf8');
const generationDispatchTs = readFileSync(path.join(repoRoot, 'functions', 'server', 'generation-dispatch.ts'), 'utf8');

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
  const match = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${escaped}\\s*\\(([^]*?)\\);`, 'i'));
  return match?.[0] || '';
}

function assertMigrationNoProjectsOld() {
  assert(!/projects_old/i.test(migration0024), 'Migration 0024 must not reference projects_old.');
  assert(/PRAGMA\s+foreign_keys\s*=\s*OFF\s*;/i.test(migration0024), 'Migration 0024 must disable foreign_keys during rebuild.');
  assert(/PRAGMA\s+foreign_keys\s*=\s*ON\s*;/i.test(migration0024), 'Migration 0024 must re-enable foreign_keys after rebuild.');
  pass('0024 migration avoids projects_old and wraps FK rebuild');
}

function assertCanonicalProjectScopedSchema() {
  const requiredTables = [
    'projects',
    'workflows',
    'stages',
    'steps',
    'edges',
    'checklist_items',
    'agent_runs',
    'generation_runs',
    'generation_checkpoints',
    'project_generation_events',
    'project_intake_messages',
    'project_briefs',
    'project_files',
    'generation_dispatches',
  ];

  for (const table of requiredTables) {
    const block = extractCreateTable(migration0024, table);
    assert(block.length > 0, `Migration 0024 must create table "${table}".`);
    assert(!/REFERENCES\s+projects_old/i.test(block), `Table "${table}" must not reference projects_old.`);
  }

  const directProjectFkTables = [
    'workflows',
    'stages',
    'steps',
    'edges',
    'agent_runs',
    'generation_runs',
    'generation_checkpoints',
    'project_generation_events',
    'project_intake_messages',
    'project_briefs',
    'project_files',
    'generation_dispatches',
  ];

  for (const table of directProjectFkTables) {
    const block = extractCreateTable(migration0024, table);
    assert(
      /project_id\s+[^,\n]*REFERENCES\s+projects\s*\(\s*id\s*\)/i.test(block),
      `Table "${table}" must reference projects(id) via project_id.`,
    );
  }

  const checklistItemsBlock = extractCreateTable(migration0024, 'checklist_items');
  assert(
    /step_id\s+[^,\n]*REFERENCES\s+steps\s*\(\s*id\s*\)/i.test(checklistItemsBlock),
    'checklist_items must remain linked to steps(id).',
  );

  pass('0024 defines canonical project-scoped schema against projects(id)');
}

function assertServerSqlPathsAgainstHotfixSchema() {
  const intakeStartInsert = appTs.match(/app\.post\('\/intake\/start'[^]*?INSERT INTO projects\s*\(([^]*?)\)\s*[\r\n]+\s*VALUES/i)?.[1] || '';
  const intakeConfirmUpdate = appTs.match(/UPDATE projects\s+SET[^]*?generation_completed_at\s*=\s*NULL[^]*?WHERE id = \? AND user_id = \? AND generation_status = 'intake'/i)?.[0] || '';
  const projectDeleteBlock = appTs.match(/app\.delete\('\/projects\/:id'[^]*?await c\.env\.DB\.batch\(\[([^]*?)\]\);/i)?.[1] || '';

  assert(
    intakeStartInsert.includes('generation_status') && intakeStartInsert.includes('generation_error'),
    'Intake start insert must target projects columns that exist in 0024 schema.',
  );
  assert(intakeConfirmUpdate.includes('generation_provider_id') && intakeConfirmUpdate.includes('generation_heartbeat_at'), 'Intake confirm update must target generation columns present in 0024 projects schema.');

  const expectedDeleteStatements = [
    'DELETE FROM project_generation_events',
    'DELETE FROM project_intake_messages',
    'DELETE FROM project_briefs',
    'DELETE FROM agent_runs',
    'DELETE FROM edges',
    'DELETE FROM checklist_items',
    'DELETE FROM steps',
    'DELETE FROM stages',
    'DELETE FROM workflows',
    'DELETE FROM projects',
  ];
  for (const statement of expectedDeleteStatements) {
    assert(projectDeleteBlock.includes(statement), `Project delete path must include "${statement}" cleanup.`);
  }

  assert(/INSERT INTO generation_dispatches/i.test(generationDispatchTs), 'Generation dispatch path must still write to generation_dispatches.');
  assert(/FROM generation_checkpoints/i.test(generationPipelineTs), 'Generation pipeline must still read generation_checkpoints.');
  assert(/INSERT INTO project_files/i.test(generationPipelineTs), 'Generation pipeline must still persist project_files.');

  pass('server SQL paths for intake start/confirm/delete remain valid after 0024 reset schema');
}

function assertNoProjectsOldRuntimeReferences() {
  const combined = `${appTs}\n${generationPipelineTs}\n${generationDispatchTs}`;
  assert(!/projects_old/i.test(combined), 'Runtime server surfaces must not reference projects_old.');
  pass('runtime server surfaces contain no projects_old references');
}

function run() {
  assertMigrationNoProjectsOld();
  assertCanonicalProjectScopedSchema();
  assertServerSqlPathsAgainstHotfixSchema();
  assertNoProjectsOldRuntimeReferences();
  console.log('Phase 14B projects_old hotfix assertions passed.');
}

run();
