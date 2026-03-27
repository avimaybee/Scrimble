import assert from 'node:assert/strict';
import {
  buildGenerationRuntimeContract,
  type GenerationRuntimeState,
} from '../functions/server/generation-runtime.ts';

function runTest(name: string, test: () => void) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function makeRuntimeState(overrides: Partial<GenerationRuntimeState>): GenerationRuntimeState {
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

runTest('intake -> generation -> review -> approve -> complete uses runtime-only lifecycle', () => {
  const intake = buildGenerationRuntimeContract(makeRuntimeState({ run: null, isComplete: true }));
  assert.equal(intake.lifecycleStatus, 'intake');

  const running = buildGenerationRuntimeContract(makeRuntimeState({
    hasActiveRun: true,
    run: {
      id: 'run-flow-1',
      project_id: 'project-flow',
      workflow_instance_id: 'wf-1',
      status: 'running',
      current_batch: 'batch_3_architect',
      provider_id: 'provider-1',
      heartbeat_at: '2026-01-01T00:00:00.000Z',
      error_message: null,
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    isRunning: true,
    currentBatch: 'batch_3_architect',
    completedBatches: ['batch_1_research_stack', 'batch_2_fetch_and_read'],
  }));
  assert.equal(running.lifecycleStatus, 'running');
  assert.equal(running.currentBatch, 'batch_3_architect');
  assert.equal(running.isReviewRequired, false);

  const awaitingReview = buildGenerationRuntimeContract(makeRuntimeState({
    hasActiveRun: true,
    run: {
      id: 'run-flow-1',
      project_id: 'project-flow',
      workflow_instance_id: 'wf-1',
      status: 'awaiting_review',
      current_batch: null,
      provider_id: 'provider-1',
      heartbeat_at: '2026-01-01T00:00:00.000Z',
      error_message: null,
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    isAwaitingReview: true,
    completedBatches: ['batch_1_research_stack', 'batch_2_fetch_and_read', 'batch_3_architect'],
  }));
  assert.equal(awaitingReview.lifecycleStatus, 'awaiting_review');
  assert.equal(awaitingReview.isReviewRequired, true);

  const approved = buildGenerationRuntimeContract(makeRuntimeState({
    hasActiveRun: true,
    run: {
      id: 'run-flow-1',
      project_id: 'project-flow',
      workflow_instance_id: 'wf-1',
      status: 'approved',
      current_batch: null,
      provider_id: 'provider-1',
      heartbeat_at: '2026-01-01T00:00:00.000Z',
      error_message: null,
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    isApproved: true,
  }));
  assert.equal(approved.lifecycleStatus, 'approved');

  const complete = buildGenerationRuntimeContract(makeRuntimeState({
    run: {
      id: 'run-flow-1',
      project_id: 'project-flow',
      workflow_instance_id: 'wf-1',
      status: 'complete',
      current_batch: null,
      provider_id: 'provider-1',
      heartbeat_at: '2026-01-01T00:00:00.000Z',
      error_message: null,
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-01-01T01:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T01:00:00.000Z',
    },
    isComplete: true,
  }));
  assert.equal(complete.lifecycleStatus, 'complete');
  assert.equal(complete.isTerminal, true);
});

runTest('failed -> resume and cancelled -> resume map to canonical runtime semantics', () => {
  const failed = buildGenerationRuntimeContract(makeRuntimeState({
    hasActiveRun: true,
    run: {
      id: 'run-failed',
      project_id: 'project-failed',
      workflow_instance_id: 'wf-failed',
      status: 'failed',
      current_batch: null,
      provider_id: 'provider-1',
      heartbeat_at: '2026-01-01T00:00:00.000Z',
      error_message: 'boom',
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-01-01T00:10:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:10:00.000Z',
    },
    isFailed: true,
    canResume: true,
  }));
  assert.equal(failed.lifecycleStatus, 'failed');
  assert.equal(failed.failureClass, 'run_failed');
  assert.equal(failed.canResume, true);

  const resumedFromFailed = buildGenerationRuntimeContract(makeRuntimeState({
    hasActiveRun: true,
    run: {
      id: 'run-failed-resume',
      project_id: 'project-failed',
      workflow_instance_id: 'wf-failed-resume',
      status: 'running',
      current_batch: 'batch_4_plan_build',
      provider_id: 'provider-1',
      heartbeat_at: '2026-01-01T00:20:00.000Z',
      error_message: null,
      started_at: '2026-01-01T00:20:00.000Z',
      completed_at: null,
      created_at: '2026-01-01T00:20:00.000Z',
      updated_at: '2026-01-01T00:20:00.000Z',
    },
    isRunning: true,
    canResume: false,
    currentBatch: 'batch_4_plan_build',
  }));
  assert.equal(resumedFromFailed.lifecycleStatus, 'running');
  assert.equal(resumedFromFailed.failureClass, null);

  const cancelled = buildGenerationRuntimeContract(makeRuntimeState({
    hasActiveRun: true,
    run: {
      id: 'run-cancelled',
      project_id: 'project-cancelled',
      workflow_instance_id: 'wf-cancelled',
      status: 'cancelled',
      current_batch: null,
      provider_id: 'provider-1',
      heartbeat_at: '2026-01-01T00:00:00.000Z',
      error_message: 'cancelled',
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-01-01T00:05:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:05:00.000Z',
    },
    isCancelled: true,
    canResume: true,
  }));
  assert.equal(cancelled.lifecycleStatus, 'cancelled');
  assert.equal(cancelled.failureClass, 'cancelled');
  assert.equal(cancelled.canResume, true);
});

console.log('Phase 9 runtime-validation assertions passed.');
