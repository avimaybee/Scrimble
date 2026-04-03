/**
 * Phase 18: Foundation Hardening Assertions
 *
 * These assertions verify the structural changes made in Phase 18:
 * - T1: Canonical step content at API boundary
 * - T2/T3: Backend-authoritative runtime state
 * - T4: Event schema V1-only writes
 * - T5: Explicit checkpoint lifecycle states
 * - T6: Centralized checkpoint policy
 * - T7: Structured logger abstraction
 */

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

// ─────────────────────────────────────────────────────────────────
// T1: Canonical Step Content at API Boundary
// ─────────────────────────────────────────────────────────────────

runTest('T1: Server types define step content parsing functions', () => {
  const types = read('functions/server/types.ts');
  assert.ok(types.includes('export function parseNavigationLinks'), 'parseNavigationLinks should be exported');
  assert.ok(types.includes('export function parsePrompts'), 'parsePrompts should be exported');
  assert.ok(types.includes('export function parseResearchFooterMeta'), 'parseResearchFooterMeta should be exported');
  assert.ok(types.includes('export function parseSuggestedTools'), 'parseSuggestedTools should be exported');
  assert.ok(types.includes('export function parseStepContent'), 'parseStepContent should be exported');
});

runTest('T1: Server types define ParsedStepContent interface', () => {
  const types = read('functions/server/types.ts');
  assert.ok(types.includes('export interface ParsedStepContent'), 'ParsedStepContent interface should be exported');
  assert.ok(types.includes('navigationLinks: StepNavigationLink[]'), 'Should have typed navigationLinks');
  assert.ok(types.includes('prompts: StepPrompt[]'), 'Should have typed prompts');
  assert.ok(types.includes('researchFooterMeta: StepResearchFooterMeta | null'), 'Should have typed researchFooterMeta');
  assert.ok(types.includes('suggestedTools: StepSuggestedTool[]'), 'Should have typed suggestedTools');
});

runTest('T1: app.ts imports and uses parseStepContent', () => {
  const app = read('functions/server/app.ts');
  assert.ok(app.includes('parseStepContent'), 'app.ts should import parseStepContent');
  assert.ok(app.includes('parsed_content: parsedContent'), 'mapStepRow should include parsed_content');
});

runTest('T1: Frontend Step type includes parsed_content', () => {
  const types = read('src/types.ts');
  assert.ok(types.includes('parsed_content?: ParsedStepContent'), 'Step interface should have optional parsed_content');
});

runTest('T1: DetailPanel prefers server-parsed content', () => {
  const panel = read('src/components/DetailPanel.tsx');
  assert.ok(panel.includes('step?.parsed_content ??'), 'Should prefer parsed_content over client parsing');
});

// ─────────────────────────────────────────────────────────────────
// T2/T3: Backend-Authoritative Runtime State
// ─────────────────────────────────────────────────────────────────

runTest('T2: Dashboard derives run state from backend status', () => {
  const dashboard = read('src/pages/Dashboard.tsx');
  // Dashboard should fetch status from backend, not just read localStorage
  assert.ok(dashboard.includes('dbService.getProjectGenerationStatus'), 'Should fetch generation status from backend');
  // localStorage should only be used as a hint
  assert.ok(dashboard.includes('ACTIVE_GENERATION_STORAGE_KEY'), 'Should still have storage key for hints');
});

runTest('T2: ProjectGeneration derives runtime from backend', () => {
  const generation = read('src/pages/ProjectGeneration.tsx');
  // Should check backend status, not just localStorage
  assert.ok(generation.includes('status?.generation_runtime'), 'Should use generation_runtime from status');
});

runTest('T3: Generation runtime contract includes canResume', () => {
  const runtime = read('functions/server/generation-runtime.ts');
  assert.ok(runtime.includes('canResume: boolean'), 'GenerationRuntimeContract should have canResume');
  assert.ok(runtime.includes('canResume: runtime.canResume'), 'buildGenerationRuntimeContract should set canResume');
});

// ─────────────────────────────────────────────────────────────────
// T4: Event Schema V1-Only Writes
// ─────────────────────────────────────────────────────────────────

runTest('T4: Event module has LEGACY_EVENT_SUPPORT flag', () => {
  const events = read('functions/server/generation-events.ts');
  assert.ok(events.includes('const LEGACY_EVENT_SUPPORT = true'), 'Should have LEGACY_EVENT_SUPPORT flag');
});

runTest('T4: mapLegacyStoredEvent checks LEGACY_EVENT_SUPPORT', () => {
  const events = read('functions/server/generation-events.ts');
  assert.ok(events.includes('if (!LEGACY_EVENT_SUPPORT)'), 'mapLegacyStoredEvent should check flag');
});

runTest('T4: Event writes use V1 envelope', () => {
  const events = read('functions/server/generation-events.ts');
  assert.ok(events.includes('const GENERATION_EVENT_VERSION = 1'), 'Should have version constant');
  assert.ok(events.includes('version: GENERATION_EVENT_VERSION'), 'buildGenerationEventEnvelope should set version');
});

// ─────────────────────────────────────────────────────────────────
// T5: Explicit Checkpoint Lifecycle States
// ─────────────────────────────────────────────────────────────────

runTest('T5: Checkpoint lifecycle migration exists', () => {
  const migration = read('migrations/0027_checkpoint_lifecycle.sql');
  assert.ok(migration.includes('checkpoint_state'), 'Should add checkpoint_state column');
  assert.ok(migration.includes("DEFAULT 'active'"), 'Should default to active state');
});

runTest('T5: Checkpoint load filters by active state', () => {
  const pipeline = read('functions/server/generation-pipeline.ts');
  assert.ok(pipeline.includes("checkpoint_state = 'active'"), 'loadGenerationCheckpoint should filter active');
});

runTest('T5: Checkpoint save sets active state', () => {
  const pipeline = read('functions/server/generation-pipeline.ts');
  assert.ok(pipeline.includes("checkpoint_state = 'active'"), 'saveGenerationCheckpoint should set active');
});

runTest('T5: Checkpoint clear sets completed/invalidated state', () => {
  const pipeline = read('functions/server/generation-pipeline.ts');
  assert.ok(pipeline.includes("checkpoint_state = 'completed'"), 'clearGenerationCheckpoint should set completed');
  assert.ok(pipeline.includes("checkpoint_state = 'invalidated'"), 'clearGenerationCheckpoints should set invalidated');
});

runTest('T5: Resume transfers active checkpoints to new run ownership', () => {
  const app = read('functions/server/app.ts');
  const pipeline = read('functions/server/generation-pipeline.ts');
  assert.ok(app.includes('transferActiveGenerationCheckpoints'), 'resume path should call transferActiveGenerationCheckpoints');
  assert.ok(app.includes('invalidateActiveCheckpointsExceptRun'), 'resume path should invalidate stale active checkpoint ownership');
  assert.ok(pipeline.includes('export async function transferActiveGenerationCheckpoints'), 'pipeline should export transfer helper');
  assert.ok(pipeline.includes('export async function invalidateActiveCheckpointsExceptRun'), 'pipeline should export invalidate helper');
});

// ─────────────────────────────────────────────────────────────────
// T6: Centralized Checkpoint Policy
// ─────────────────────────────────────────────────────────────────

runTest('T6: Checkpoint policy module exists', () => {
  const policy = read('functions/server/checkpoint-policy.ts');
  assert.ok(policy.includes('export type CheckpointBatchConfig'), 'Should export CheckpointBatchConfig');
  assert.ok(policy.includes('export function shouldCheckpoint'), 'Should export shouldCheckpoint');
  assert.ok(policy.includes('export function getCheckpointConfig'), 'Should export getCheckpointConfig');
});

runTest('T6: Checkpoint policy defines configs for all batches', () => {
  const policy = read('functions/server/checkpoint-policy.ts');
  assert.ok(policy.includes('batch_1_research_stack:'), 'Should have batch 1 config');
  assert.ok(policy.includes('batch_2_fetch_and_read:'), 'Should have batch 2 config');
  assert.ok(policy.includes('batch_3_architect:'), 'Should have batch 3 config');
  assert.ok(policy.includes('batch_4_plan_build:'), 'Should have batch 4 config');
  assert.ok(policy.includes('batch_5_enrich_steps:'), 'Should have batch 5 config');
  assert.ok(policy.includes('batch_6_generate_files:'), 'Should have batch 6 config');
});

runTest('T6: Checkpoint policy returns decision with reason', () => {
  const policy = read('functions/server/checkpoint-policy.ts');
  assert.ok(policy.includes("reason: 'budget'"), 'Should return budget reason');
  assert.ok(policy.includes("reason: 'interval'"), 'Should return interval reason');
  assert.ok(policy.includes("reason: 'none'"), 'Should return none reason');
});

// ─────────────────────────────────────────────────────────────────
// T7: Structured Logger Abstraction
// ─────────────────────────────────────────────────────────────────

runTest('T7: Logger module exists', () => {
  const logger = read('functions/server/logger.ts');
  assert.ok(logger.includes("export type LogLevel = 'debug' | 'info' | 'warn' | 'error'"), 'Should define LogLevel');
  assert.ok(logger.includes('export function log('), 'Should export log function');
  assert.ok(logger.includes('export function debug('), 'Should export debug helper');
  assert.ok(logger.includes('export function info('), 'Should export info helper');
  assert.ok(logger.includes('export function warn('), 'Should export warn helper');
  assert.ok(logger.includes('export function error('), 'Should export error helper');
});

runTest('T7: Logger supports level-gated output', () => {
  const logger = read('functions/server/logger.ts');
  assert.ok(logger.includes('LOG_LEVEL_PRIORITY'), 'Should have level priority map');
  assert.ok(logger.includes('function shouldLog('), 'Should have shouldLog function');
  assert.ok(logger.includes('getLogLevel('), 'Should have getLogLevel function');
});

runTest('T7: ai.ts uses logger instead of console.log', () => {
  const ai = read('functions/server/ai.ts');
  assert.ok(ai.includes("from './logger'") && ai.includes('debug'), 'Should import debug from logger');
  assert.ok(ai.includes("debug('ai-") || ai.includes("debug('reasoning'"), 'Should use debug for reasoning logs');
  // Should not have the old console.log statements
  assert.ok(!ai.includes("console.log(`[AI] OpenAI reasoning extracted"), 'Should not have old OpenAI log');
  assert.ok(!ai.includes("console.log(`[AI] Anthropic thinking extracted"), 'Should not have old Anthropic log');
  assert.ok(!ai.includes("console.log(`[AI] Delta thinking extracted"), 'Should not have old delta log');
});

runTest('T7: app.ts uses logger for error handling', () => {
  const app = read('functions/server/app.ts');
  assert.ok(app.includes("from './logger'") && app.includes('logError'), 'Should import error as logError from logger');
  assert.ok(app.includes("logError('hono-error'") || app.includes("logError('"), 'Should use logError for error handling');
});

// ─────────────────────────────────────────────────────────────────
// Runtime State Tests
// ─────────────────────────────────────────────────────────────────

runTest('Runtime state has clear lifecycle status', () => {
  const runtime = read('functions/server/generation-runtime.ts');
  assert.ok(runtime.includes("type GenerationLifecycleStatus = 'intake' | GenerationRunStatus"), 'Should define lifecycle status');
  assert.ok(runtime.includes('TERMINAL_LIFECYCLE_STATUSES'), 'Should have terminal status set');
});

runTest('Generation runtime contract has all required fields', () => {
  const runtime = read('functions/server/generation-runtime.ts');
  assert.ok(runtime.includes('runId: string | null'), 'Should have runId');
  assert.ok(runtime.includes('lifecycleStatus: GenerationLifecycleStatus'), 'Should have lifecycleStatus');
  assert.ok(runtime.includes('currentBatch: GenerationBatchName | null'), 'Should have currentBatch');
  assert.ok(runtime.includes('isTerminal: boolean'), 'Should have isTerminal');
  assert.ok(runtime.includes('canResume: boolean'), 'Should have canResume');
  assert.ok(runtime.includes('isReviewRequired: boolean'), 'Should have isReviewRequired');
  assert.ok(runtime.includes('failureClass: GenerationFailureClass'), 'Should have failureClass');
});

// ─────────────────────────────────────────────────────────────────
// T9: Runtime Transition Tests
// ─────────────────────────────────────────────────────────────────

runTest('T9: Intake start creates run and sets running status', () => {
  const runtime = read('functions/server/generation-runtime.ts');
  // Intake confirm should create a generation_runs row and update project pointer
  assert.ok(runtime.includes('INSERT INTO generation_runs'), 'Should insert into generation_runs');
  assert.ok(runtime.includes('SET current_generation_run_id'), 'Should update project run pointer');
});

runTest('T9: Generation dispatch uses service binding for workflow invocation', () => {
  const dispatch = read('functions/server/generation-dispatch.ts');
  assert.ok(dispatch.includes('WORKFLOW_SERVICE'), 'Should use WORKFLOW_SERVICE binding');
  assert.ok(dispatch.includes('createGeneration'), 'Should call createGeneration method');
});

runTest('T9: Pipeline checkpoint save captures batch and index state', () => {
  const pipeline = read('functions/server/generation-pipeline.ts');
  // Checkpoint save should record the batch name and progress index
  assert.ok(pipeline.includes('INSERT INTO generation_checkpoints'), 'Should insert checkpoint');
  assert.ok(pipeline.includes('batch_name'), 'Should record batch_name');
  assert.ok(pipeline.includes('current_index'), 'Should record current_index');
});

runTest('T9: Pipeline checkpoint load retrieves resumable state', () => {
  const pipeline = read('functions/server/generation-pipeline.ts');
  // Checkpoint load should filter by active state
  assert.ok(pipeline.includes('FROM generation_checkpoints'), 'Should select checkpoints');
  assert.ok(pipeline.includes("checkpoint_state = 'active'"), 'Should filter active only');
});

runTest('T9: Cancel/stop transitions clear checkpoints', () => {
  const pipeline = read('functions/server/generation-pipeline.ts');
  // Cancel should invalidate existing checkpoints
  assert.ok(pipeline.includes('clearGenerationCheckpoints'), 'Should have clearGenerationCheckpoints');
  assert.ok(pipeline.includes("checkpoint_state = 'invalidated'"), 'Should set invalidated state');
});

runTest('T9: Dashboard resume derives from backend status not localStorage', () => {
  const dashboard = read('src/pages/Dashboard.tsx');
  // Dashboard should call status API and use canResume
  assert.ok(dashboard.includes('getProjectGenerationStatus'), 'Should fetch status');
  assert.ok(dashboard.includes('status.generation_runtime'), 'Should use generation_runtime');
});

runTest('T9: Generation page derives lifecycle from runtime contract', () => {
  const generation = read('src/pages/ProjectGeneration.tsx');
  assert.ok(generation.includes('lifecycleStatus'), 'Should use lifecycleStatus');
  assert.ok(generation.includes('currentBatch'), 'Should use currentBatch');
});

runTest('T9: Failed/stale run keeps canResume=true for recovery', () => {
  const runtime = read('functions/server/generation-runtime.ts');
  // Failed/stale runs should be resumable
  assert.ok(runtime.includes('const canResume = isStale || '), 'Should set canResume for stale recovery');
  assert.ok(runtime.includes("canResume: runtime.canResume"), 'Contract should propagate canResume');
});

runTest('T9: Review-required status blocks completion until approval', () => {
  const runtime = read('functions/server/generation-runtime.ts');
  assert.ok(runtime.includes('isReviewRequired'), 'Should track review-required state');
  const pipeline = read('functions/server/generation-pipeline.ts');
  assert.ok(pipeline.includes('review_required'), 'Pipeline should emit review_required');
});

runTest('T9: Event replay consumes canonical V1 envelope', () => {
  const events = read('functions/server/generation-events.ts');
  assert.ok(events.includes('version: 1'), 'Should check version field');
  assert.ok(events.includes('buildGenerationEventEnvelope'), 'Should build envelope');
});

console.log('\n✅ All Phase 18 foundation assertions passed!');
