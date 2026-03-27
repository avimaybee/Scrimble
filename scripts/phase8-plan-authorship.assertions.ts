import assert from 'node:assert/strict';
import {
  buildPlanMarkdown,
  computePlanAuthoringHash,
  mergePlanWithEnrichments,
  normalizePlanStructure,
} from '../functions/server/generation-pipeline.ts';
import {
  Batch5EnrichStepsSchema,
  PlanAuthoringRecordSchema,
  type Batch5EnrichSteps,
  type PlanAuthoringRecord,
} from '../functions/server/generation-schemas.ts';

async function runTest(name: string, test: () => void | Promise<void>) {
  try {
    await test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function makePlan(overrides: Partial<PlanAuthoringRecord> = {}): PlanAuthoringRecord {
  return normalizePlanStructure(PlanAuthoringRecordSchema.parse({
    project_name: 'Runtime Canonical Project',
    project_type: 'saas_mvp',
    problem: 'Builders lose time guessing implementation order.',
    solution: 'Provide guided, deterministic execution plans with clear step evidence.',
    target_user: 'Solo builders shipping first products.',
    mvp_scope: 'Core generation flow, review checkpoints, and downloadable plan artifacts.',
    done_when: 'A builder can complete intake through launch with no manual migration steps.',
    architecture_notes: 'Cloudflare Workers runtime with D1 persistence and SSE progress updates.',
    data_model_notes: 'projects -> generation_runs pointer with workflow stages and step records.',
    stages: [
      {
        id: 'stage-foundation',
        title: 'Foundation',
        type: 'foundation',
        order_index: 0,
        steps: [
          {
            id: 'step-intake',
            title: 'Capture intake requirements',
            type: 'task',
            category: 'intake',
            objective: 'Collect complete intake answers and normalize them.',
            why_it_matters: 'Prevents downstream ambiguity.',
            risk_level: 'low',
            is_gate: false,
            is_milestone: false,
            milestone_label: '',
            done_when: 'All intake answers are persisted and validated.',
            suggested_tools: ['hono@latest'],
            checklist: [
              { id: 'check-intake-1', label: 'Collect questions', is_required: true },
            ],
          },
          {
            id: 'step-mvp-gate',
            title: 'MVP complete',
            type: 'task',
            category: 'build',
            objective: 'Validate the MVP end-to-end.',
            why_it_matters: 'Guarantees shippable outcomes.',
            risk_level: 'medium',
            is_gate: true,
            is_milestone: true,
            milestone_label: 'MVP complete',
            done_when: 'All MVP workflows succeed locally.',
            suggested_tools: ['vitest@latest'],
            checklist: [
              { id: 'check-gate-1', label: 'Verify MVP flow', is_required: true },
            ],
          },
        ],
      },
    ],
    edges: [
      {
        id: 'edge-intake-gate',
        source_step_id: 'step-intake',
        target_step_id: 'step-mvp-gate',
        edge_type: 'default',
      },
    ],
    ...overrides,
  }));
}

function makeEnrichments(plan: PlanAuthoringRecord): Batch5EnrichSteps {
  return Batch5EnrichStepsSchema.parse({
    enrichments: plan.stages.flatMap((stage) =>
      stage.steps.map((step, index) => ({
        step_id: step.id,
        ai_output: `Follow ${step.title} carefully and capture evidence.`,
        done_when: `${step.title} passes deterministic checks.`,
        research_footer_meta: {
          researched_at: '2026-01-01',
          tools: ['Context7', 'GitHub'],
        },
        navigation_links: [
          {
            label: 'Read docs',
            url: `https://example.com/${index + 1}`,
            when: 'Start here',
          },
        ],
        prompts: [
          {
            label: 'Implement',
            content: `Implement ${step.title} based on runtime contract.`,
          },
        ],
      })),
    ),
  });
}

async function main() {
  await runTest('plan authoring schema accepts canonical record and normalizes ids', () => {
  const plan = makePlan();
  assert.equal(plan.project_name, 'Runtime Canonical Project');
  assert.ok(plan.stages[0].steps[0].id.length > 0);
});

  await runTest('legacy batch4 payload is compat-read into canonical authored record', () => {
  const legacyParsed = PlanAuthoringRecordSchema.parse({
    project_name: 'Legacy Project',
    project_type: 'internal_tool',
    prd_markdown: `## The problem\n\nLegacy problem section\n\n## What we're building\n\nLegacy solution`,
    prd_hash: 'legacyhash',
    stages: [
      {
        id: 'stage-legacy',
        title: 'Legacy stage',
        type: 'build',
        order_index: 0,
        steps: [
          {
            id: 'step-legacy',
            title: 'Legacy step',
            type: 'task',
            checklist: [],
          },
        ],
      },
    ],
    edges: [],
  });

  assert.equal(legacyParsed.problem, 'Legacy problem section');
  assert.equal(legacyParsed.solution, 'Legacy solution');
  assert.equal(legacyParsed.authoring_hash, 'legacyhash');
});

  await runTest('authoring hash is stable for semantically equivalent key orders', async () => {
  const left = makePlan();
  const right = makePlan({
    stages: [...left.stages].map((stage) => ({
      steps: [...stage.steps],
      type: stage.type,
      id: stage.id,
      title: stage.title,
      order_index: stage.order_index,
    })),
  });

  const [leftHash, rightHash] = await Promise.all([
    computePlanAuthoringHash(left),
    computePlanAuthoringHash(right),
  ]);

  assert.equal(leftHash, rightHash);
});

  await runTest('authoring hash changes when narrative or topology changes', async () => {
  const base = makePlan();
  const changedNarrative = makePlan({ solution: 'A changed authored narrative.' });
  const changedTopology = makePlan({
    stages: [
      ...base.stages,
      {
        id: 'stage-extra',
        title: 'Extra Stage',
        type: 'qa',
        order_index: 1,
        steps: [
          {
            id: 'step-extra',
            title: 'Run smoke checks',
            type: 'task',
            category: 'qa',
            objective: 'Run smoke tests.',
            why_it_matters: 'Catches regressions.',
            risk_level: 'low',
            is_gate: false,
            is_milestone: false,
            milestone_label: '',
            done_when: 'Smoke checks pass.',
            suggested_tools: [],
            checklist: [],
          },
        ],
      },
    ],
    edges: base.edges,
  });

  const [baseHash, narrativeHash, topologyHash] = await Promise.all([
    computePlanAuthoringHash(base),
    computePlanAuthoringHash(changedNarrative),
    computePlanAuthoringHash(changedTopology),
  ]);

  assert.notEqual(baseHash, narrativeHash);
  assert.notEqual(baseHash, topologyHash);
});

  await runTest('deterministic renderer output is stable for same authored plan', () => {
  const plan = makePlan();
  const enrichments = makeEnrichments(plan);
  const enriched = mergePlanWithEnrichments(plan, enrichments.enrichments);

  const first = buildPlanMarkdown(plan, enriched, 'Review once more before launch.');
  const second = buildPlanMarkdown(plan, enriched, 'Review once more before launch.');

  assert.equal(first, second);
  assert.ok(first.includes('## The problem'));
  assert.ok(first.includes('## Build plan'));
});

  await runTest('batch5 enrichments do not mutate authored narrative sections', () => {
  const plan = makePlan();
  const enrichments = makeEnrichments(plan);
  const enriched = mergePlanWithEnrichments(plan, enrichments.enrichments);

  assert.equal(enriched.problem, plan.problem);
  assert.equal(enriched.solution, plan.solution);
  assert.equal(enriched.target_user, plan.target_user);
  assert.equal(enriched.mvp_scope, plan.mvp_scope);
  assert.equal(enriched.done_when, plan.done_when);
  assert.equal(enriched.stages.length, plan.stages.length);
});

console.log('Phase 8 plan authorship assertions passed.');
}

await main();
