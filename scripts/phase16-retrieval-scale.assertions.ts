import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

runTest('Batch2 schema exposes candidate/ranking/evidence pack layers', () => {
  const schemas = read('functions/server/generation-schemas.ts');
  assert.ok(schemas.includes('source_candidates'));
  assert.ok(schemas.includes('ranked_sources'));
  assert.ok(schemas.includes('source_notes'));
  assert.ok(schemas.includes('evidence_packs'));
  assert.ok(schemas.includes('retrieval_budget_tokens'));
  assert.ok(schemas.includes('retrieval_coverage_status'));
});

runTest('Chunk schema carries stable source and offset metadata', () => {
  const schemas = read('functions/server/generation-schemas.ts');
  assert.ok(schemas.includes('source_id'));
  assert.ok(schemas.includes('source_title'));
  assert.ok(schemas.includes('source_type'));
  assert.ok(schemas.includes('rank_score'));
  assert.ok(schemas.includes('start_offset'));
  assert.ok(schemas.includes('end_offset'));
});

runTest('Pipeline builds ranked candidates and evidence packs before prompt assembly', () => {
  const pipeline = read('functions/server/generation-pipeline.ts');
  assert.ok(pipeline.includes('buildRankedResearchSources('));
  assert.ok(pipeline.includes('buildSourceNotesAndEvidencePacks('));
  assert.ok(pipeline.includes('source_candidates: sourceCandidates'));
  assert.ok(pipeline.includes('ranked_sources: rankedSources'));
  assert.ok(pipeline.includes('source_notes: sourceNotes'));
  assert.ok(pipeline.includes('evidence_packs: evidencePacks'));
});

runTest('Downstream batches consume evidence-aware retrieval with explicit budgets', () => {
  const pipeline = read('functions/server/generation-pipeline.ts');
  assert.ok(pipeline.includes('const RETRIEVAL_BUDGETS'));
  assert.ok(pipeline.includes("contextKind: RetrievalContextKind"));
  assert.ok(pipeline.includes("RETRIEVAL_BUDGETS.batch_3_architect"));
  assert.ok(pipeline.includes("RETRIEVAL_BUDGETS.batch_4_plan_build"));
  assert.ok(pipeline.includes("RETRIEVAL_BUDGETS.batch_5_enrich_steps"));
  assert.ok(pipeline.includes("RETRIEVAL_BUDGETS.batch_6_generate_files"));
  assert.ok(pipeline.includes('selected_evidence_packs'));
});

runTest('Roadmap marks H1 complete and removes it from active execution order', () => {
  const plan = read('docs/scrimble-repair-dependency-plan.md');
  assert.ok(plan.includes('### [x] H1. Add a markdown download for the canonical PRD'));
  assert.equal(plan.includes('11. H1'), false);
});

console.log('Phase 16 retrieval-scale assertions passed.');
