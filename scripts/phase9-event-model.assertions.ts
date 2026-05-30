import assert from 'node:assert/strict';
import {
  buildGenerationEventEnvelope,
  type GenerationStreamEvent,
} from '@scrimble/core';

function runTest(name: string, test: () => void) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function makeEvent(event: Exclude<GenerationStreamEvent, { type: 'thinking' }>) {
  return buildGenerationEventEnvelope({
    projectId: 'project-phase9',
    runId: 'run-phase9',
    batchName: 'batch_4_plan_build',
    timestamp: '2026-01-01T00:00:00.000Z',
    event,
  });
}

runTest('batch_start envelope carries stable v1 fields', () => {
  const envelope = makeEvent({
    type: 'batch_start',
    batch: 'batch_4_plan_build',
    label: 'Building your plan',
  });

  assert.equal(envelope.version, 1);
  assert.equal(envelope.eventType, 'batch_start');
  assert.equal(envelope.projectId, 'project-phase9');
  assert.equal(envelope.runId, 'run-phase9');
  assert.equal(envelope.batch, 'batch_4_plan_build');
  assert.equal(envelope.payload.batch, 'batch_4_plan_build');
  assert.equal(envelope.payload.label, 'Building your plan');
});

runTest('checkpoint envelope preserves run id and ADR payload', () => {
  const envelope = makeEvent({
    type: 'checkpoint',
    adr: {
      project_name: 'Phase9 Demo',
      project_type: 'saas_mvp',
      project_summary: 'Demo',
      how_it_connects: 'API',
      recommended_stack: {
        frontend: 'React',
        backend: 'Hono',
        auth: 'Firebase Auth',
        database: 'D1',
        payments: 'Stripe',
        email: 'Resend',
        deploy: 'Cloudflare',
      },
      data_model: [],
      integrations: [],
      security_surface: [],
      gotchas: [],
    },
    run_id: 'run-phase9',
  });

  assert.equal(envelope.eventType, 'checkpoint');
  assert.equal(envelope.runId, 'run-phase9');
  assert.equal(envelope.payload.run_id, 'run-phase9');
  assert.ok(typeof envelope.payload.adr === 'object');
});

runTest('pipeline_failed envelope carries canonical failure payload', () => {
  const envelope = makeEvent({
    type: 'pipeline_failed',
    error: 'Generation failed for test.',
    failureClass: 'run_failed',
  });

  assert.equal(envelope.eventType, 'pipeline_failed');
  assert.equal(envelope.payload.error, 'Generation failed for test.');
  assert.equal(envelope.payload.failureClass, 'run_failed');
});

console.log('Phase 9 event-model assertions passed.');
