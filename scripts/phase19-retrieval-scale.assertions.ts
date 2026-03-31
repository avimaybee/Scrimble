/**
 * Phase 19: Retrieval Scale and Evidence Synthesis Assertions
 * 
 * Validates G1-G4 implementation:
 * - T1: Source ranking module exists and is testable
 * - T2: Chunk store has stable IDs
 * - T3: Evidence packs have explicit citations
 * - T4/T5: Budget tracking exists
 * - T6: data_quality contains ranking factors
 * - T8: Modules are integrated
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.join(__dirname, '..', 'functions', 'server');

type AssertionResult = { pass: boolean; message: string };

function assert(condition: boolean, message: string): AssertionResult {
  return { pass: condition, message };
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

function fileContains(filePath: string, pattern: RegExp | string): boolean {
  const content = readFile(filePath);
  if (typeof pattern === 'string') {
    return content.includes(pattern);
  }
  return pattern.test(content);
}

// ─────────────────────────────────────────────────────────────────
// T1: Source Ranking Module
// ─────────────────────────────────────────────────────────────────

function assertRankingModuleExists(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-ranking.ts');
  return assert(fileExists(filePath), 'research-ranking.ts module exists');
}

function assertRankingModuleHasTypes(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-ranking.ts');
  const hasSourceCandidate = fileContains(filePath, 'export type SourceCandidate');
  const hasScoringFactors = fileContains(filePath, 'export type ScoringFactors');
  const hasScoringWeights = fileContains(filePath, 'export type ScoringWeights');
  return assert(
    hasSourceCandidate && hasScoringFactors && hasScoringWeights,
    'research-ranking.ts exports SourceCandidate, ScoringFactors, ScoringWeights types',
  );
}

function assertRankingModuleHasFunctions(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-ranking.ts');
  const hasRankFunction = fileContains(filePath, 'export function rankSourceCandidates');
  const hasDedupeFunction = fileContains(filePath, 'export function deduplicateCandidates');
  const hasScoreFunction = fileContains(filePath, 'export function scoreCandidate');
  return assert(
    hasRankFunction && hasDedupeFunction && hasScoreFunction,
    'research-ranking.ts exports rankSourceCandidates, deduplicateCandidates, scoreCandidate functions',
  );
}

function assertRankingModuleHasWeights(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-ranking.ts');
  const hasDefaultWeights = fileContains(filePath, 'DEFAULT_SCORING_WEIGHTS');
  const hasRelevance = fileContains(filePath, /relevance:\s*0\.38/);
  const hasFreshness = fileContains(filePath, /freshness:\s*0\.2/);
  const hasAuthority = fileContains(filePath, /authority:\s*0\.24/);
  const hasCoverage = fileContains(filePath, /coverage:\s*0\.18/);
  return assert(
    hasDefaultWeights && hasRelevance && hasFreshness && hasAuthority && hasCoverage,
    'research-ranking.ts has DEFAULT_SCORING_WEIGHTS with documented factor weights',
  );
}

function assertRankingModuleHasLegacyAdapter(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-ranking.ts');
  const hasLegacyCandidate = fileContains(filePath, 'export type LegacySourceCandidate');
  const hasToLegacy = fileContains(filePath, 'export function toLegacyCandidate');
  return assert(
    hasLegacyCandidate && hasToLegacy,
    'research-ranking.ts has legacy adapter for backward compatibility',
  );
}

// ─────────────────────────────────────────────────────────────────
// T2: Chunk Store Module
// ─────────────────────────────────────────────────────────────────

function assertChunkModuleExists(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-chunks.ts');
  return assert(fileExists(filePath), 'research-chunks.ts module exists');
}

function assertChunkModuleHasTypes(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-chunks.ts');
  const hasResearchChunk = fileContains(filePath, 'export type ResearchChunk');
  const hasChunkConfig = fileContains(filePath, 'export type ChunkConfig');
  const hasChunkSource = fileContains(filePath, 'export type ChunkSource');
  return assert(
    hasResearchChunk && hasChunkConfig && hasChunkSource,
    'research-chunks.ts exports ResearchChunk, ChunkConfig, ChunkSource types',
  );
}

function assertChunkModuleHasStableIds(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-chunks.ts');
  const hasComputeChunkId = fileContains(filePath, 'export function computeChunkId');
  const hasContentHash = fileContains(filePath, 'export function computeContentHash');
  // Check that the function uses deterministic inputs for ID generation
  const hasDeterministicLogic = fileContains(filePath, 'normalizedUrl') && 
    fileContains(filePath, 'startOffset') && 
    fileContains(filePath, 'endOffset') &&
    fileContains(filePath, 'technology');
  return assert(
    hasComputeChunkId && hasContentHash && hasDeterministicLogic,
    'research-chunks.ts has deterministic chunk ID computation',
  );
}

function assertChunkModuleHasChunkingFunctions(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-chunks.ts');
  const hasChunkText = fileContains(filePath, 'export function chunkText');
  const hasChunkDocument = fileContains(filePath, 'export function chunkDocument');
  const hasBuildStore = fileContains(filePath, 'export function buildChunkStore');
  return assert(
    hasChunkText && hasChunkDocument && hasBuildStore,
    'research-chunks.ts exports chunkText, chunkDocument, buildChunkStore functions',
  );
}

function assertChunkModuleHasConfig(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-chunks.ts');
  const hasDefaultConfig = fileContains(filePath, 'DEFAULT_CHUNK_CONFIG');
  const hasChunkSize = fileContains(filePath, /chunkSize:\s*1600/);
  const hasOverlap = fileContains(filePath, /overlap:\s*200/);
  return assert(
    hasDefaultConfig && hasChunkSize && hasOverlap,
    'research-chunks.ts has DEFAULT_CHUNK_CONFIG with documented settings',
  );
}

// ─────────────────────────────────────────────────────────────────
// T3: Evidence Pack Module
// ─────────────────────────────────────────────────────────────────

function assertEvidenceModuleExists(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-evidence.ts');
  return assert(fileExists(filePath), 'research-evidence.ts module exists');
}

function assertEvidenceModuleHasTypes(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-evidence.ts');
  const hasEvidencePack = fileContains(filePath, 'export type EvidencePack');
  const hasSourceNote = fileContains(filePath, 'export type SourceNote');
  const hasConcern = fileContains(filePath, 'export type EvidencePackConcern');
  return assert(
    hasEvidencePack && hasSourceNote && hasConcern,
    'research-evidence.ts exports EvidencePack, SourceNote, EvidencePackConcern types',
  );
}

function assertEvidencePacksHaveCitations(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-evidence.ts');
  const hasChunkCitations = fileContains(filePath, 'chunkCitations: string[]');
  const hasSourceNoteIds = fileContains(filePath, 'sourceNoteIds: string[]');
  const hasCitationLogic = fileContains(filePath, /chunkCitations.*=.*Array\.from/);
  return assert(
    hasChunkCitations && hasSourceNoteIds && hasCitationLogic,
    'EvidencePack has explicit chunkCitations and sourceNoteIds for tracing',
  );
}

function assertEvidenceModuleHasConcerns(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-evidence.ts');
  const hasGotchas = fileContains(filePath, "'gotchas'");
  const hasMigration = fileContains(filePath, "'migration'");
  const hasSecurity = fileContains(filePath, "'security'");
  const hasPerformance = fileContains(filePath, "'performance'");
  return assert(
    hasGotchas && hasMigration && hasSecurity && hasPerformance,
    'research-evidence.ts has entity-level concerns (gotchas, migration, security, performance)',
  );
}

function assertEvidenceModuleHasCoverage(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-evidence.ts');
  const hasCoverageType = fileContains(filePath, "export type CoverageStatus = 'strong' | 'thin' | 'degraded'");
  const hasCoverageFunction = fileContains(filePath, 'export function coverageFromNoteCount');
  return assert(
    hasCoverageType && hasCoverageFunction,
    'research-evidence.ts has explicit CoverageStatus type and derivation function',
  );
}

// ─────────────────────────────────────────────────────────────────
// T4/T5: Budget Module
// ─────────────────────────────────────────────────────────────────

function assertBudgetModuleExists(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-budget.ts');
  return assert(fileExists(filePath), 'research-budget.ts module exists');
}

function assertBudgetModuleHasTypes(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-budget.ts');
  const hasTokenBudget = fileContains(filePath, 'export type TokenBudget');
  const hasBatchAllocation = fileContains(filePath, 'export type BatchBudgetAllocation');
  const hasAggregateBudget = fileContains(filePath, 'export type AggregateBudget');
  return assert(
    hasTokenBudget && hasBatchAllocation && hasAggregateBudget,
    'research-budget.ts exports TokenBudget, BatchBudgetAllocation, AggregateBudget types',
  );
}

function assertBudgetModuleHasFetchGating(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-budget.ts');
  const hasCanAfford = fileContains(filePath, 'export function canAffordFetch');
  const hasRecordConsumption = fileContains(filePath, 'export function recordConsumption');
  const hasShouldFetch = fileContains(filePath, 'export function shouldFetch');
  return assert(
    hasCanAfford && hasRecordConsumption && hasShouldFetch,
    'research-budget.ts exports canAffordFetch, recordConsumption, shouldFetch functions',
  );
}

function assertBudgetModuleHasCrossPooling(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-budget.ts');
  const hasReallocate = fileContains(filePath, 'export function reallocateUnused');
  const hasCarryoverChain = fileContains(filePath, 'export function applyStandardCarryoverChain');
  const hasCarryoverTokens = fileContains(filePath, 'carryoverTokens');
  return assert(
    hasReallocate && hasCarryoverChain && hasCarryoverTokens,
    'research-budget.ts has cross-batch budget pooling (reallocateUnused, carryoverTokens)',
  );
}

function assertBudgetModuleHasSkippedSources(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'research-budget.ts');
  const hasSkippedType = fileContains(filePath, 'export type SkippedSource');
  const hasReasonField = fileContains(filePath, "'budget_exhausted'");
  return assert(
    hasSkippedType && hasReasonField,
    'research-budget.ts tracks skipped sources with explicit reasons',
  );
}

// ─────────────────────────────────────────────────────────────────
// T6: Ranking Factors in data_quality
// ─────────────────────────────────────────────────────────────────

function assertSchemaHasRankingFields(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'generation-schemas.ts');
  const hasRankingWeights = fileContains(filePath, 'ranking_weights');
  const hasSelectionCutoff = fileContains(filePath, 'selection_cutoff_score');
  const hasSkippedCount = fileContains(filePath, 'skipped_sources_count');
  const hasBudgetExhausted = fileContains(filePath, 'budget_exhausted');
  return assert(
    hasRankingWeights && hasSelectionCutoff && hasSkippedCount && hasBudgetExhausted,
    'generation-schemas.ts data_quality has ranking_weights, selection_cutoff_score, skipped_sources_count, budget_exhausted',
  );
}

function assertPipelinePopulatesRankingFields(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'generation-pipeline.ts');
  const hasRankingWeights = fileContains(filePath, /ranking_weights:\s*\{/);
  const hasSelectionCutoff = fileContains(filePath, /selection_cutoff_score:/);
  const hasAggregateTokens = fileContains(filePath, /aggregate_tokens_consumed:/);
  return assert(
    hasRankingWeights && hasSelectionCutoff && hasAggregateTokens,
    'generation-pipeline.ts populates ranking transparency fields in dataQuality',
  );
}

// ─────────────────────────────────────────────────────────────────
// Retrieval Contracts
// ─────────────────────────────────────────────────────────────────

function assertNoRawDocumentsInPrompt(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'generation-pipeline.ts');
  const hasChunkRetrieval = fileContains(filePath, 'retrieveRelevantChunks');
  const hasEvidencePacks = fileContains(filePath, 'composeEvidencePackContext');
  const hasTokenLimit = fileContains(filePath, 'RESEARCH_CONTEXT_TOKEN_HARD_LIMIT');
  return assert(
    hasChunkRetrieval && hasEvidencePacks && hasTokenLimit,
    'generation-pipeline.ts uses chunk retrieval and evidence packs, not raw documents',
  );
}

function assertTokenBudgetTracking(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'generation-pipeline.ts');
  const hasRetrievalBudgets = fileContains(filePath, 'RETRIEVAL_BUDGETS');
  const hasBudgetMap = fileContains(filePath, /retrieval_budget_tokens/);
  return assert(
    hasRetrievalBudgets && hasBudgetMap,
    'generation-pipeline.ts tracks token budgets per batch',
  );
}

function assertCoverageStatusExplicit(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'generation-pipeline.ts');
  const hasCoverageStatus = fileContains(filePath, 'retrieval_coverage_status');
  const hasExplicitEnum = fileContains(filePath, /coverageStatus.*'strong'.*'thin'.*'degraded'/s);
  return assert(
    hasCoverageStatus && hasExplicitEnum,
    'generation-pipeline.ts has explicit coverage status (strong/thin/degraded)',
  );
}

// ─────────────────────────────────────────────────────────────────
// Run All Assertions
// ─────────────────────────────────────────────────────────────────

const assertions = [
  // T1: Ranking Module
  { name: 'T1.1 Ranking module exists', fn: assertRankingModuleExists },
  { name: 'T1.2 Ranking module has types', fn: assertRankingModuleHasTypes },
  { name: 'T1.3 Ranking module has functions', fn: assertRankingModuleHasFunctions },
  { name: 'T1.4 Ranking module has weights', fn: assertRankingModuleHasWeights },
  { name: 'T1.5 Ranking module has legacy adapter', fn: assertRankingModuleHasLegacyAdapter },
  
  // T2: Chunk Store Module
  { name: 'T2.1 Chunk module exists', fn: assertChunkModuleExists },
  { name: 'T2.2 Chunk module has types', fn: assertChunkModuleHasTypes },
  { name: 'T2.3 Chunk module has stable IDs', fn: assertChunkModuleHasStableIds },
  { name: 'T2.4 Chunk module has functions', fn: assertChunkModuleHasChunkingFunctions },
  { name: 'T2.5 Chunk module has config', fn: assertChunkModuleHasConfig },
  
  // T3: Evidence Pack Module
  { name: 'T3.1 Evidence module exists', fn: assertEvidenceModuleExists },
  { name: 'T3.2 Evidence module has types', fn: assertEvidenceModuleHasTypes },
  { name: 'T3.3 Evidence packs have citations', fn: assertEvidencePacksHaveCitations },
  { name: 'T3.4 Evidence module has concerns', fn: assertEvidenceModuleHasConcerns },
  { name: 'T3.5 Evidence module has coverage', fn: assertEvidenceModuleHasCoverage },
  
  // T4/T5: Budget Module
  { name: 'T4.1 Budget module exists', fn: assertBudgetModuleExists },
  { name: 'T4.2 Budget module has types', fn: assertBudgetModuleHasTypes },
  { name: 'T4.3 Budget module has fetch gating', fn: assertBudgetModuleHasFetchGating },
  { name: 'T5.1 Budget module has cross pooling', fn: assertBudgetModuleHasCrossPooling },
  { name: 'T5.2 Budget module tracks skipped sources', fn: assertBudgetModuleHasSkippedSources },
  
  // T6: Ranking Factors
  { name: 'T6.1 Schema has ranking fields', fn: assertSchemaHasRankingFields },
  { name: 'T6.2 Pipeline populates ranking fields', fn: assertPipelinePopulatesRankingFields },
  
  // Retrieval Contracts
  { name: 'Contract: No raw documents in prompt', fn: assertNoRawDocumentsInPrompt },
  { name: 'Contract: Token budget tracking', fn: assertTokenBudgetTracking },
  { name: 'Contract: Explicit coverage status', fn: assertCoverageStatusExplicit },
];

let passed = 0;
let failed = 0;

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  Phase 19: Retrieval Scale and Evidence Synthesis Assertions');
console.log('═══════════════════════════════════════════════════════════════\n');

for (const { name, fn } of assertions) {
  const result = fn();
  if (result.pass) {
    console.log(`✅ PASS: ${name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Expected: ${result.message}`);
    failed++;
  }
}

console.log('\n───────────────────────────────────────────────────────────────');
console.log(`  Results: ${passed} passed, ${failed} failed (${assertions.length} total)`);
console.log('───────────────────────────────────────────────────────────────\n');

if (failed > 0) {
  process.exit(1);
}

console.log('All Phase 19 assertions passed.\n');
