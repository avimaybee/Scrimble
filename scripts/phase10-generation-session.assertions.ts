import assert from 'node:assert/strict';
import {
  buildGenerationSessionViewModel,
  getDashboardGenerationAction,
  mergeCompletedGenerationEvents,
} from '../src/lib/generation-session.ts';
import type {
  GenerationRuntime,
  ProjectGenerationEvent,
  ProjectGenerationStatusResponse,
  Step,
} from '../src/types.ts';

function runTest(name: string, test: () => void) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function makeRuntime(overrides: Partial<GenerationRuntime> = {}): GenerationRuntime {
  return {
    runId: 'run-phase10',
    lifecycleStatus: 'running',
    currentBatch: 'batch_3_architect',
    isTerminal: false,
    canResume: false,
    isReviewRequired: false,
    providerId: 'provider-phase10',
    heartbeatAt: '2026-02-01T00:00:00.000Z',
    completedBatches: ['batch_1_research_stack', 'batch_2_fetch_and_read'],
    failureClass: null,
    ...overrides,
  };
}

function makeStatus(overrides: Partial<ProjectGenerationStatusResponse> = {}): ProjectGenerationStatusResponse {
  const base: ProjectGenerationStatusResponse = {
    project_id: 'project-phase10',
    generation_runtime: makeRuntime(),
    generation_error: null,
    workflow_instance_id: 'wf-phase10',
    completed_batches: [
      {
        batch: 'batch_1_research_stack',
        completed_at: '2026-02-01T00:01:00.000Z',
        message: 'Stack complete',
      },
      {
        batch: 'batch_2_fetch_and_read',
        completed_at: '2026-02-01T00:02:00.000Z',
        message: 'Docs complete',
      },
    ],
    completed_batch_count: 2,
    total_batches: 7,
    progress_percent: 33,
    is_intake: false,
    is_complete: false,
    is_failed: false,
    is_review_required: false,
    is_approved: false,
    execution_stale: false,
    can_resume: false,
  };

  return {
    ...base,
    ...overrides,
  };
}

runTest('session view model resolves current batch from runtime-first semantics', () => {
  const status = makeStatus({
    generation_runtime: makeRuntime({
      lifecycleStatus: 'running',
      currentBatch: 'batch_4_plan_build',
    }),
  });

  const view = buildGenerationSessionViewModel(status);

  assert.equal(view.lifecycleStatus, 'running');
  assert.equal(view.currentBatchId, 'batch_4_plan_build');
  assert.equal(view.currentBatchIndex, 3);
  assert.equal(view.isRunningLifecycle, true);
  assert.equal(view.isAgentWorking, true);
  assert.equal(view.completedBatchCount, 2);
});

runTest('session view model marks resumable failures and cancelled resume paths', () => {
  const failedStatus = makeStatus({
    generation_runtime: makeRuntime({
      lifecycleStatus: 'failed',
      isTerminal: true,
      canResume: true,
      failureClass: 'run_failed',
      currentBatch: null,
    }),
    is_failed: true,
    can_resume: true,
  });
  const failedView = buildGenerationSessionViewModel(failedStatus);
  assert.equal(failedView.isFailed, true);
  assert.equal(failedView.hasResumableFailure, true);

  const cancelledStatus = makeStatus({
    generation_runtime: makeRuntime({
      lifecycleStatus: 'cancelled',
      isTerminal: true,
      canResume: true,
      failureClass: 'cancelled',
      currentBatch: null,
    }),
  });
  const cancelledView = buildGenerationSessionViewModel(cancelledStatus);
  assert.equal(cancelledView.isCancelled, true);
  assert.equal(cancelledView.hasResumableFailure, true);
});

runTest('completed events merge keeps one event per batch using canonical order', () => {
  const status = makeStatus();
  const streamEvents: ProjectGenerationEvent[] = [
    {
      batch: 'batch_2_fetch_and_read',
      completed_at: '2026-02-01T00:03:00.000Z',
      message: 'Docs complete (stream)',
    },
    {
      batch: 'batch_3_architect',
      completed_at: '2026-02-01T00:04:00.000Z',
      message: 'Architect complete',
    },
  ];

  const merged = mergeCompletedGenerationEvents(status, streamEvents);
  assert.equal(merged.length, 3);
  assert.equal(merged[1].message, 'Docs complete (stream)');
  assert.equal(merged[2].batch, 'batch_3_architect');
});

runTest('dashboard action prioritizes review over other statuses', () => {
  const project = {
    id: 'project-review',
    generation_runtime: makeRuntime({
      lifecycleStatus: 'awaiting_review',
      isReviewRequired: true,
      currentBatch: null,
      isTerminal: false,
    }),
  };
  const nextStep: Pick<Step, 'status' | 'title'> = {
    status: 'needs_review',
    title: 'Review architecture checkpoint',
  };

  const action = getDashboardGenerationAction(project, nextStep);
  assert.equal(action.kind, 'review');
  assert.equal(action.ctaLabel, 'Review build');
});

runTest('dashboard action treats failed/cancelled as resumable first-class actions', () => {
  const failedProject = {
    id: 'project-failed',
    generation_runtime: makeRuntime({
      lifecycleStatus: 'failed',
      canResume: true,
      isTerminal: true,
      currentBatch: null,
      failureClass: 'run_failed',
    }),
  };
  const failedAction = getDashboardGenerationAction(failedProject, null);
  assert.equal(failedAction.kind, 'resume');
  assert.equal(failedAction.ctaLabel, 'Resume build');

  const cancelledProject = {
    id: 'project-cancelled',
    generation_runtime: makeRuntime({
      lifecycleStatus: 'cancelled',
      canResume: true,
      isTerminal: true,
      currentBatch: null,
      failureClass: 'cancelled',
    }),
  };
  const cancelledAction = getDashboardGenerationAction(cancelledProject, null);
  assert.equal(cancelledAction.kind, 'resume');
});

console.log('Phase 10 generation-session assertions passed.');
