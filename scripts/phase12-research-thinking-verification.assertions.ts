import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCanonicalRetrievalInput,
  buildResearchQuery,
} from '@scrimble/core';
import { buildResearchManifest } from '@scrimble/core';
import { buildGenerationEventEnvelope } from '@scrimble/core';
import { buildGenerationSessionViewModel } from '../src/lib/generation-session.ts';
import type {
  GenerationRuntime,
  ProjectGenerationStatusResponse,
} from '../src/types.ts';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFilePath);
const repoRoot = resolve(currentDir, '..');

function read(relativePath: string) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

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
    runId: 'run-phase12',
    lifecycleStatus: 'running',
    currentBatch: 'batch_3_architect',
    isTerminal: false,
    canResume: false,
    isReviewRequired: false,
    providerId: 'provider-phase12',
    heartbeatAt: '2026-03-01T00:00:00.000Z',
    completedBatches: ['batch_1_research_stack', 'batch_2_fetch_and_read'],
    failureClass: null,
    ...overrides,
  };
}

function makeStatus(overrides: Partial<ProjectGenerationStatusResponse> = {}): ProjectGenerationStatusResponse {
  return {
    project_id: 'project-phase12',
    generation_runtime: makeRuntime(),
    generation_error: null,
    workflow_instance_id: 'wf-phase12',
    completed_batches: [],
    completed_batch_count: 2,
    total_batches: 6,
    progress_percent: 33,
    is_intake: false,
    is_complete: false,
    is_failed: false,
    is_review_required: false,
    is_approved: false,
    execution_stale: false,
    can_resume: false,
    ...overrides,
  };
}

runTest('B2 precedence keeps builder-profile target metadata over inferred duplicates', () => {
  const retrievalInput = buildCanonicalRetrievalInput({
    builderProfileTools: [
      {
        name: 'Clerk',
        docs_topic: 'authentication',
        docs_url: 'https://clerk.com/docs',
        github_url: 'https://github.com/clerk/javascript',
      },
    ],
    confirmedStackTools: ['clerk'],
    inferredTechnologies: ['clerk', 'postgres'],
  });

  const clerk = retrievalInput.targets.find((target) => target.technology.toLowerCase() === 'clerk');
  assert.ok(clerk);
  assert.equal(clerk?.source, 'builder_profile');
  assert.equal(clerk?.docsTopic, 'authentication');
  assert.equal(clerk?.githubRepo, 'clerk/javascript');
});

runTest('B2/B5 manifest varies by confirmed stack and produces stack-specific graph', () => {
  const workspaceProfile = {
    declaredTools: [
      {
        name: 'Clerk',
        category: 'auth' as const,
        docs_url: 'https://clerk.com/docs',
        github_url: 'https://github.com/clerk/javascript',
        docs_topic: 'authentication',
      },
      {
        name: 'Railway',
        category: 'backend_hosting' as const,
        docs_url: 'https://docs.railway.com',
        github_url: 'https://github.com/railwayapp/cli',
        docs_topic: 'deployment',
      },
      {
        name: 'Supabase',
        category: 'database' as const,
        docs_url: 'https://supabase.com/docs',
        github_url: 'https://github.com/supabase/supabase-js',
        docs_topic: 'database',
      },
    ],
  };

  const stackA = buildResearchManifest(
    workspaceProfile,
    'Build an app with Clerk, Railway, and Supabase.',
    {
      confirmedStackTools: ['Clerk', 'Railway', 'Supabase'],
      inferredTechnologies: ['Drizzle'],
    },
  );

  const stackB = buildResearchManifest(
    workspaceProfile,
    'Build an app with Firebase, Vercel, and Auth0.',
    {
      confirmedStackTools: ['Firebase', 'Vercel', 'Auth0'],
      inferredTechnologies: ['Prisma'],
    },
  );

  const stackATechs = new Set(stackA.tools.map((tool) => tool.name.toLowerCase()));
  const stackBTechs = new Set(stackB.tools.map((tool) => tool.name.toLowerCase()));

  assert.ok(stackATechs.has('clerk'));
  assert.ok(stackATechs.has('railway'));
  assert.ok(stackATechs.has('supabase'));
  assert.ok(!stackBTechs.has('clerk') || stackATechs.size !== stackBTechs.size);
});

runTest('B5 query families are explicit and deterministic', () => {
  assert.equal(
    buildResearchQuery({ technology: 'clerk', family: 'setup', year: 2026, intent: 'authentication setup' }),
    'clerk authentication setup 2026',
  );
  assert.equal(
    buildResearchQuery({ technology: 'stripe', family: 'errors', year: 2026 }),
    'stripe errors troubleshooting 2026',
  );
  assert.equal(
    buildResearchQuery({ technology: 'drizzle orm', family: 'release_notes', year: 2026 }),
    'drizzle orm changelog release notes 2026',
  );
  assert.equal(
    buildResearchQuery({ technology: 'railway', family: 'deployment', year: 2026 }),
    'railway deployment production 2026',
  );
});

runTest('B6 thinking event uses canonical generation event envelope', () => {
  const envelope = buildGenerationEventEnvelope({
    projectId: 'project-phase12',
    runId: 'run-phase12',
    batchName: 'batch_5_enrich_steps',
    timestamp: '2026-03-01T00:00:00.000Z',
    event: {
      type: 'thinking',
      content: 'Model is comparing two migration strategies.',
    },
  });

  assert.equal(envelope.version, 1);
  assert.equal(envelope.eventType, 'thinking');
  assert.equal(envelope.projectId, 'project-phase12');
  assert.equal(envelope.runId, 'run-phase12');
  assert.equal(envelope.batch, 'batch_5_enrich_steps');
  assert.equal(envelope.payload.content, 'Model is comparing two migration strategies.');
});

runTest('F3 review-required status resolves to actionable review state', () => {
  const status = makeStatus({
    generation_runtime: makeRuntime({
      lifecycleStatus: 'awaiting_review',
      currentBatch: null,
      isReviewRequired: true,
      isTerminal: false,
    }),
    is_review_required: true,
  });
  const view = buildGenerationSessionViewModel(status);
  assert.equal(view.isReviewRequired, true);
  assert.equal(view.isAgentWorking, false);
  assert.equal(view.lifecycleStatus, 'awaiting_review');
});

runTest('F3 failed/cancelled runtime stays resumable in session view model', () => {
  const failed = buildGenerationSessionViewModel(
    makeStatus({
      generation_runtime: makeRuntime({
        lifecycleStatus: 'failed',
        currentBatch: null,
        isTerminal: true,
        canResume: true,
        failureClass: 'run_failed',
      }),
      is_failed: true,
      can_resume: true,
    }),
  );
  assert.equal(failed.hasResumableFailure, true);

  const cancelled = buildGenerationSessionViewModel(
    makeStatus({
      generation_runtime: makeRuntime({
        lifecycleStatus: 'cancelled',
        currentBatch: null,
        isTerminal: true,
        canResume: true,
        failureClass: 'cancelled',
      }),
      can_resume: true,
    }),
  );
  assert.equal(cancelled.hasResumableFailure, true);
});

runTest('F4 vision audit file contains all stated product promises', () => {
  const vision = read('docs/the-vision.md').toLowerCase();
  assert.ok(vision.includes('deep research'));
  assert.ok(vision.includes('turn-by-turn navigation'));
  assert.ok(vision.includes('forcing function'));
  assert.ok(vision.includes('workspace profile'));
  assert.ok(vision.includes('daily re-entry'));
  assert.ok(vision.includes('living plan'));
});

console.log('Phase 12 research/thinking/verification assertions passed.');
