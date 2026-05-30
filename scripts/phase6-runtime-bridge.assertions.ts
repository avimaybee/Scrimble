import assert from 'node:assert/strict';
import {
  buildGenerationRuntimeContract,
  mapProjectRowToResponse,
  type GenerationRuntimeState,
} from '@scrimble/core';
import { normalizeGenerationRuntime } from '../src/lib/generation-runtime.ts';

function runTest(name: string, test: () => void) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function createRuntimeState(overrides: Partial<GenerationRuntimeState> = {}): GenerationRuntimeState {
  return {
    hasActiveRun: false,
    run: null,
    isRunning: false,
    isAwaitingReview: false,
    isApproved: false,
    isComplete: true,
    isFailed: false,
    isCancelled: false,
    isStale: false,
    canResume: false,
    currentBatch: null,
    completedBatches: [],
    progressPercent: 0,
    ...overrides,
  };
}

runTest('backend runtime contract derives running lifecycle and batch', () => {
  const runtime = createRuntimeState({
    hasActiveRun: true,
    run: {
      id: 'run-canonical-1',
      project_id: 'project-1',
      workflow_instance_id: 'workflow-1',
      status: 'running',
      current_batch: 'batch_2_fetch_and_read',
      provider_id: 'provider-canonical',
      heartbeat_at: '2026-01-01T00:00:00.000Z',
      error_message: null,
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    isRunning: true,
    currentBatch: 'batch_2_fetch_and_read',
    completedBatches: ['batch_1_research_stack'],
  });

  const contract = buildGenerationRuntimeContract(runtime);

  assert.equal(contract.lifecycleStatus, 'running');
  assert.equal(contract.currentBatch, 'batch_2_fetch_and_read');
  assert.equal(contract.runId, 'run-canonical-1');
  assert.equal(contract.providerId, 'provider-canonical');
  assert.equal(contract.isTerminal, false);
  assert.equal(contract.failureClass, null);
  assert.deepEqual(contract.completedBatches, ['batch_1_research_stack']);
});

runTest('backend runtime contract marks stalled failure class for resumable stale run', () => {
  const runtime = createRuntimeState({
    hasActiveRun: true,
    run: {
      id: 'run-canonical-2',
      project_id: 'project-2',
      workflow_instance_id: null,
      status: 'running',
      current_batch: 'batch_3_architect',
      provider_id: 'provider-canonical',
      heartbeat_at: '2026-01-01T00:00:00.000Z',
      error_message: null,
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    isRunning: true,
    isStale: true,
    canResume: true,
    currentBatch: 'batch_3_architect',
  });

  const contract = buildGenerationRuntimeContract(runtime);
  assert.equal(contract.failureClass, 'stalled');
  assert.equal(contract.canResume, true);
});

runTest('backend serializer emits runtime contract without legacy generation_status', () => {
  const serialized = mapProjectRowToResponse({
    id: 'project-3',
    user_id: 'user-1',
    name: 'Project 3',
    description: '',
    project_type: 'saas_mvp',
    stack: '{}',
    status: 'active',
    progress: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    canonical_run_status: 'running',
    canonical_run_provider_id: 'provider-canonical',
    canonical_run_heartbeat_at: '2026-01-01T00:00:00.000Z',
    canonical_run_id: 'run-canonical-3',
    canonical_run_error: null,
    canonical_run_current_batch: 'batch_3_architect',
    canonical_run_workflow_instance_id: null,
    canonical_run_started_at: '2026-01-01T00:00:00.000Z',
    canonical_run_completed_at: null,
    canonical_run_created_at: '2026-01-01T00:00:00.000Z',
    canonical_run_updated_at: '2026-01-01T00:00:00.000Z',
  });

  assert.equal('generation_status' in serialized, false);
  assert.equal(serialized.generation_runtime.lifecycleStatus, 'running');
  assert.equal(serialized.generation_runtime.currentBatch, 'batch_3_architect');
});

runTest('frontend normalizer derives runtime from canonical runtime payload', () => {
  const normalized = normalizeGenerationRuntime({
    generation_runtime: {
      runId: 'run-canonical-5',
      lifecycleStatus: 'running',
      currentBatch: 'batch_4_plan_build',
      isTerminal: false,
      canResume: true,
      isReviewRequired: false,
      providerId: 'provider-legacy',
      heartbeatAt: '2026-01-01T00:00:00.000Z',
      completedBatches: ['batch_1_research_stack', 'batch_2_fetch_and_read'],
      failureClass: 'stalled',
    },
  });

  assert.equal(normalized.lifecycleStatus, 'running');
  assert.equal(normalized.currentBatch, 'batch_4_plan_build');
  assert.equal(normalized.canResume, true);
  assert.equal(normalized.failureClass, 'stalled');
  assert.equal(normalized.isTerminal, false);
  assert.deepEqual(normalized.completedBatches, ['batch_1_research_stack', 'batch_2_fetch_and_read']);
});

runTest('frontend normalizer prefers canonical runtime over stale legacy fields', () => {
  const normalized = normalizeGenerationRuntime({
    generation_runtime: {
      runId: 'run-canonical-4',
      lifecycleStatus: 'awaiting_review',
      currentBatch: null,
      isTerminal: false,
      canResume: false,
      isReviewRequired: true,
      providerId: 'provider-canonical',
      heartbeatAt: '2026-01-01T00:00:00.000Z',
      completedBatches: ['batch_1_research_stack', 'batch_2_fetch_and_read', 'batch_3_architect'],
      failureClass: null,
    },
  });

  assert.equal(normalized.lifecycleStatus, 'awaiting_review');
  assert.equal(normalized.isReviewRequired, true);
  assert.equal(normalized.failureClass, null);
  assert.equal(normalized.isTerminal, false);
});

console.log('All runtime contract assertions passed.');
