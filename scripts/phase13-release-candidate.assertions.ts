import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapProjectRowToResponse } from '@scrimble/core';
import {
  appendGenerationThinkingDelta,
  buildGenerationEventEnvelope,
  listPersistedGenerationEventsSince,
} from '@scrimble/core';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFilePath);
const repoRoot = resolve(currentDir, '..');

function read(relativePath: string) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

async function runTest(name: string, test: () => void | Promise<void>) {
  try {
    await test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function containsAny(source: string, fragments: string[]) {
  return fragments.some((fragment) => source.includes(fragment));
}

async function main() {
  await runTest('023 migration removes legacy project generation lifecycle columns', () => {
    const migration = read('migrations/0023_drop_legacy_project_generation_columns.sql');
    const createProjectsMatch = migration.match(/CREATE TABLE projects\s*\(([\s\S]*?)\);\s*/);
    assert.ok(createProjectsMatch, 'Migration 023 must recreate projects table');
    const createProjectsSql = createProjectsMatch?.[1] || '';
    assert.ok(createProjectsSql.includes('current_generation_run_id TEXT REFERENCES generation_runs(id)'));

    const droppedColumns = [
      'generation_status',
      'generation_run_id',
      'generation_provider_id',
      'generation_heartbeat_at',
      'generation_started_at',
      'generation_completed_at',
      'generation_error',
      'workflow_instance_id',
    ];

    for (const column of droppedColumns) {
      const columnPattern = new RegExp(`\\b${column}\\b`);
      assert.equal(columnPattern.test(createProjectsSql), false, `Migration 023 should not retain ${column}`);
    }
  });

  await runTest('runtime serializer remains compatible after 023 by using generation_runs aliases only', () => {
    const serialized = mapProjectRowToResponse({
      id: 'project-rc-1',
      user_id: 'user-rc-1',
      name: 'RC Project',
      description: '',
      project_type: 'saas_mvp',
      stack: '{}',
      status: 'active',
      progress: 0,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      canonical_run_status: 'running',
      canonical_run_provider_id: 'provider-rc',
      canonical_run_heartbeat_at: '2026-03-01T00:00:00.000Z',
      canonical_run_id: 'run-rc-1',
      canonical_run_error: null,
      canonical_run_current_batch: 'batch_2_fetch_and_read',
      canonical_run_workflow_instance_id: 'run-rc-1',
      canonical_run_started_at: '2026-03-01T00:00:00.000Z',
      canonical_run_completed_at: null,
      canonical_run_created_at: '2026-03-01T00:00:00.000Z',
      canonical_run_updated_at: '2026-03-01T00:00:00.000Z',
    });

    assert.equal(serialized.generation_runtime.lifecycleStatus, 'running');
    assert.equal(serialized.workflow_instance_id, 'run-rc-1');
    assert.equal('generation_status' in serialized, false);
    assert.equal('generation_run_id' in serialized, false);
  });

  await runTest('server runtime SQL paths contain no dropped projects column references', () => {
    const runtimeFiles = [
      read('functions/server/app.ts'),
      read('functions/server/generation-runtime.ts'),
      read('functions/server/generation-workflow.ts'),
    ].join('\n');

    const disallowed = [
      'projects.generation_status',
      'projects.generation_run_id',
      'projects.generation_provider_id',
      'projects.generation_heartbeat_at',
      'projects.generation_started_at',
      'projects.generation_completed_at',
      'projects.generation_error',
      'projects.workflow_instance_id',
      'p.generation_status',
      'p.generation_run_id',
      'p.generation_provider_id',
      'p.generation_heartbeat_at',
      'p.generation_started_at',
      'p.generation_completed_at',
      'p.generation_error',
      'p.workflow_instance_id',
    ];

    assert.equal(containsAny(runtimeFiles, disallowed), false);
  });

  await runTest('thinking events stay canonical and replay only active-run window', async () => {
    const dbRows: Array<Record<string, unknown>> = [];
    let activeThinkingRunId: string | null = 'run-rc-active';

    const env = {
      DB: {
        prepare(sql: string) {
          return {
            bind(...args: unknown[]) {
              return {
                async run() {
                  if (sql.includes('INSERT INTO project_generation_events')) {
                    const payload = typeof args[3] === 'string' ? args[3] : '{}';
                    dbRows.push({
                      id: dbRows.length + 1,
                      project_id: args[0],
                      event_type: args[1],
                      batch_name: args[2],
                      payload,
                      created_at: new Date().toISOString(),
                    });
                  }
                  return { meta: { last_row_id: dbRows.length, changes: 1 } };
                },
                async all() {
                  return { results: dbRows };
                },
                async first() {
                  if (sql.includes('SELECT p.current_generation_run_id AS run_id')) {
                    if (!activeThinkingRunId) {
                      return {
                        run_id: null,
                        run_status: null,
                      };
                    }

                    return {
                      run_id: activeThinkingRunId,
                      run_status: 'running',
                    };
                  }

                  return {
                    id: null,
                  };
                },
              };
            },
          };
        },
      },
    } as any;

    await appendGenerationThinkingDelta(env, {
      projectId: 'project-rc-thinking',
      runId: 'run-rc-active',
      batchName: 'batch_3_architect',
      content: 'Evaluating auth and data isolation paths.',
    });

    const replay = await listPersistedGenerationEventsSince(env, 'project-rc-thinking', 0, {
      activeThinkingRunId: 'run-rc-active',
    });
    assert.equal(replay.length > 0, true);
    assert.equal(replay[0].event.type, 'thinking');

    activeThinkingRunId = null;
    const noReplay = await listPersistedGenerationEventsSince(env, 'project-rc-thinking', 0, {
      activeThinkingRunId,
    });
    assert.equal(noReplay.length, 0);
  });

  await runTest('RC docs include go-live gate essentials', () => {
    const goLiveDoc = read('docs/release-candidate-go-live.md').toLowerCase();
    assert.ok(goLiveDoc.includes('migration order'));
    assert.ok(goLiveDoc.includes('deploy and migration order'));
    assert.ok(goLiveDoc.includes('rollback'));
    assert.ok(goLiveDoc.includes('rc checklist'));
    assert.ok(goLiveDoc.includes('go/no-go'));
  });

  await runTest('event envelope remains versioned and stable for RC', () => {
    const envelope = buildGenerationEventEnvelope({
      projectId: 'project-rc-envelope',
      runId: 'run-rc-envelope',
      batchName: 'batch_5_enrich_steps',
      timestamp: '2026-03-01T00:00:00.000Z',
      event: {
        type: 'pipeline_failed',
        error: 'Provider timeout',
        failureClass: 'transport_provider_transient',
      },
    });

    assert.equal(envelope.version, 1);
    assert.equal(envelope.eventType, 'pipeline_failed');
    assert.equal(envelope.runId, 'run-rc-envelope');
    assert.equal(envelope.batch, 'batch_5_enrich_steps');
  });

  console.log('Phase 13 release-candidate assertions passed.');
}

void main();
