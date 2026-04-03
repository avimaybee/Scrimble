/**
 * Phase 20: Cleanup, Error Hygiene, and Verification Assertions
 * 
 * Validates cleanup work:
 * - T1: Server logging hygiene (no raw console.* in functions/server/)
 * - T2: Client logger exists
 * - T3: Silent catches are intentional patterns (verified manually)
 * - T4: Error copy is actionable
 * - T5: Repair plan docs updated
 * - T7: Dead code audit complete
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const SERVER_DIR = path.join(ROOT_DIR, 'functions', 'server');
const CLIENT_LIB_DIR = path.join(ROOT_DIR, 'src', 'lib');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');

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

function getFilesRecursively(dir: string, ext: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getFilesRecursively(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      files.push(fullPath);
    }
  }
  return files;
}

// ─────────────────────────────────────────────────────────────────
// T1: Server Logging Hygiene
// ─────────────────────────────────────────────────────────────────

function assertServerLoggerExists(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'logger.ts');
  return assert(fileExists(filePath), 'functions/server/logger.ts exists');
}

function assertServerLoggerHasLevels(): AssertionResult {
  const filePath = path.join(SERVER_DIR, 'logger.ts');
  const hasDebug = fileContains(filePath, 'export function debug');
  const hasInfo = fileContains(filePath, 'export function info');
  const hasWarn = fileContains(filePath, 'export function warn');
  const hasError = fileContains(filePath, 'export function error');
  return assert(
    hasDebug && hasInfo && hasWarn && hasError,
    'Server logger exports debug, info, warn, error functions',
  );
}

function assertNoRawConsoleInServerCode(): AssertionResult {
  const serverFiles = getFilesRecursively(SERVER_DIR, '.ts')
    .filter((f) => !f.endsWith('logger.ts')); // Exclude logger.ts itself
  
  const rawConsolePattern = /console\.(log|warn|error)\s*\(/;
  const violations: string[] = [];
  
  for (const file of serverFiles) {
    const content = readFile(file);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (rawConsolePattern.test(lines[i])) {
        // Skip if it's a comment or inside a comment block
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        violations.push(`${path.basename(file)}:${i + 1}`);
      }
    }
  }
  
  return assert(
    violations.length === 0,
    violations.length === 0
      ? 'No raw console.* calls in functions/server/ (except logger.ts)'
      : `Raw console calls found at: ${violations.slice(0, 5).join(', ')}${violations.length > 5 ? '...' : ''}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// T2: Client Logger
// ─────────────────────────────────────────────────────────────────

function assertClientLoggerExists(): AssertionResult {
  const filePath = path.join(CLIENT_LIB_DIR, 'logger.ts');
  return assert(fileExists(filePath), 'src/lib/logger.ts exists');
}

function assertClientLoggerHasLevels(): AssertionResult {
  const filePath = path.join(CLIENT_LIB_DIR, 'logger.ts');
  const hasDebug = fileContains(filePath, 'export function debug');
  const hasInfo = fileContains(filePath, 'export function info');
  const hasWarn = fileContains(filePath, 'export function warn');
  const hasError = fileContains(filePath, 'export function error');
  return assert(
    hasDebug && hasInfo && hasWarn && hasError,
    'Client logger exports debug, info, warn, error functions',
  );
}

function assertClientLoggerHasLevelGating(): AssertionResult {
  const filePath = path.join(CLIENT_LIB_DIR, 'logger.ts');
  const hasLogLevel = fileContains(filePath, 'LOG_LEVEL');
  const hasShouldLog = fileContains(filePath, 'shouldLog');
  return assert(
    hasLogLevel && hasShouldLog,
    'Client logger has level gating (LOG_LEVEL, shouldLog)',
  );
}

function assertNoRawConsoleInClientLib(): AssertionResult {
  const clientFiles = getFilesRecursively(CLIENT_LIB_DIR, '.ts')
    .filter((f) => !f.endsWith('logger.ts')); // Exclude logger.ts itself
  
  const rawConsolePattern = /console\.(log|warn|error)\s*\(/;
  const violations: string[] = [];
  
  for (const file of clientFiles) {
    const content = readFile(file);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (rawConsolePattern.test(lines[i])) {
        // Skip if it's a comment
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        violations.push(`${path.basename(file)}:${i + 1}`);
      }
    }
  }
  
  return assert(
    violations.length === 0,
    violations.length === 0
      ? 'No raw console.* calls in src/lib/ (except logger.ts)'
      : `Raw console calls found at: ${violations.slice(0, 5).join(', ')}${violations.length > 5 ? '...' : ''}`,
  );
}

// ─────────────────────────────────────────────────────────────────
// T4: Error Copy Actionability
// ─────────────────────────────────────────────────────────────────

function assertUiCopyExists(): AssertionResult {
  const filePath = path.join(CLIENT_LIB_DIR, 'ui-copy.ts');
  return assert(fileExists(filePath), 'src/lib/ui-copy.ts exists');
}

function assertUiCopyHasActionableMessages(): AssertionResult {
  const filePath = path.join(CLIENT_LIB_DIR, 'ui-copy.ts');
  const content = readFile(filePath);
  
  // Check that messages don't use the old generic pattern
  const oldPatternCount = (content.match(/Could not [^.]+\. Try again\./g) || []).length;
  
  // Check for action-oriented words
  const hasActions = content.includes('Refresh') || 
    content.includes('Check') || 
    content.includes('Verify') ||
    content.includes('from the dashboard');
  
  return assert(
    oldPatternCount === 0 && hasActions,
    oldPatternCount === 0
      ? 'UI copy uses actionable messages (no generic "Could not X. Try again." patterns)'
      : `Found ${oldPatternCount} generic "Could not X. Try again." patterns`,
  );
}

function assertUiCopyMessagesAreShort(): AssertionResult {
  const filePath = path.join(CLIENT_LIB_DIR, 'ui-copy.ts');
  const content = readFile(filePath);
  
  // Extract all string values (simple regex, may not catch all edge cases)
  const stringMatches = content.match(/'[^']{5,}'/g) || [];
  const longMessages = stringMatches.filter((s) => s.length > 102); // 100 + 2 for quotes
  
  return assert(
    longMessages.length === 0,
    longMessages.length === 0
      ? 'All UI copy messages are under 100 characters'
      : `${longMessages.length} messages exceed 100 chars`,
  );
}

// ─────────────────────────────────────────────────────────────────
// T5: Docs Updated
// ─────────────────────────────────────────────────────────────────

function assertRepairPlanMarksC6Complete(): AssertionResult {
  const filePath = path.join(DOCS_DIR, 'scrimble-repair-dependency-plan.md');
  const content = readFile(filePath);
  const hasC6Complete = content.includes('### [x] C6');
  return assert(hasC6Complete, 'Repair plan marks C6 (versioned events) complete');
}

function assertRepairPlanMarksC7Complete(): AssertionResult {
  const filePath = path.join(DOCS_DIR, 'scrimble-repair-dependency-plan.md');
  const content = readFile(filePath);
  const hasC7Complete = content.includes('### [x] C7');
  return assert(hasC7Complete, 'Repair plan marks C7 (logger migration) complete');
}

function assertRepairPlanMarksC8Complete(): AssertionResult {
  const filePath = path.join(DOCS_DIR, 'scrimble-repair-dependency-plan.md');
  const content = readFile(filePath);
  const hasC8Complete = content.includes('### [x] C8');
  return assert(hasC8Complete, 'Repair plan marks C8 (checkpoint semantics) complete');
}

function assertRepairPlanMarksG1Complete(): AssertionResult {
  const filePath = path.join(DOCS_DIR, 'scrimble-repair-dependency-plan.md');
  const content = readFile(filePath);
  const hasG1Complete = content.includes('### [x] G1');
  return assert(hasG1Complete, 'Repair plan marks G1 (source ranking) complete');
}

function assertRepairPlanMarksG2Complete(): AssertionResult {
  const filePath = path.join(DOCS_DIR, 'scrimble-repair-dependency-plan.md');
  const content = readFile(filePath);
  const hasG2Complete = content.includes('### [x] G2');
  return assert(hasG2Complete, 'Repair plan marks G2 (chunking) complete');
}

function assertRepairPlanMarksG3Complete(): AssertionResult {
  const filePath = path.join(DOCS_DIR, 'scrimble-repair-dependency-plan.md');
  const content = readFile(filePath);
  const hasG3Complete = content.includes('### [x] G3');
  return assert(hasG3Complete, 'Repair plan marks G3 (evidence packs) complete');
}

function assertRepairPlanMarksG4Complete(): AssertionResult {
  const filePath = path.join(DOCS_DIR, 'scrimble-repair-dependency-plan.md');
  const content = readFile(filePath);
  const hasG4Complete = content.includes('### [x] G4');
  return assert(hasG4Complete, 'Repair plan marks G4 (budget synthesis) complete');
}

// ─────────────────────────────────────────────────────────────────
// T7: Dead Code (Audit-Based)
// ─────────────────────────────────────────────────────────────────

function assertNoOrphanedExports(): AssertionResult {
  // Verify key exports are still used (spot check)
  const rankingPath = path.join(SERVER_DIR, 'research-ranking.ts');
  const chunksPath = path.join(SERVER_DIR, 'research-chunks.ts');
  const evidencePath = path.join(SERVER_DIR, 'research-evidence.ts');
  const budgetPath = path.join(SERVER_DIR, 'research-budget.ts');
  
  // These modules should exist
  const allExist = 
    fileExists(rankingPath) &&
    fileExists(chunksPath) &&
    fileExists(evidencePath) &&
    fileExists(budgetPath);
    
  return assert(
    allExist,
    'Phase 19 retrieval modules exist (ranking, chunks, evidence, budget)',
  );
}

function assertLegacyAdaptersDocumented(): AssertionResult {
  // Legacy adapters should be documented as backward-compatibility
  const rankingPath = path.join(SERVER_DIR, 'research-ranking.ts');
  const hasLegacyComment = fileContains(rankingPath, 'Legacy Adapter') ||
    fileContains(rankingPath, 'backward compatibility');
  
  return assert(
    hasLegacyComment,
    'Legacy adapters are documented as backward-compatibility features',
  );
}

function assertResumeCheckpointTransferWired(): AssertionResult {
  const appPath = path.join(SERVER_DIR, 'app.ts');
  const content = readFile(appPath);
  const hasTransferCall = content.includes('transferActiveGenerationCheckpoints(c.env, projectId, previousRunId, runId)');
  const hasInvalidateCall = content.includes('invalidateActiveCheckpointsExceptRun(c.env, projectId, runId)');
  return assert(
    hasTransferCall && hasInvalidateCall,
    'Resume path transfers active checkpoints to new run and invalidates stale active ownership',
  );
}

function assertCheckpointOwnershipHelpersExist(): AssertionResult {
  const pipelinePath = path.join(SERVER_DIR, 'generation-pipeline.ts');
  const content = readFile(pipelinePath);
  const hasTransferHelper = content.includes('export async function transferActiveGenerationCheckpoints');
  const hasInvalidateHelper = content.includes('export async function invalidateActiveCheckpointsExceptRun');
  return assert(
    hasTransferHelper && hasInvalidateHelper,
    'Checkpoint ownership helpers exist in generation-pipeline.ts',
  );
}

function assertStructuredPrdDocumentExists(): AssertionResult {
  const pipelinePath = path.join(SERVER_DIR, 'generation-pipeline.ts');
  const content = readFile(pipelinePath);
  const hasPayloadType = content.includes('prd_document_markdown: string');
  const hasPayloadField = content.includes('prd_document_markdown: adr.prd_document_markdown');
  return assert(
    hasPayloadType && hasPayloadField,
    'Architecture review payload includes generated full PRD markdown document',
  );
}

function assertProjectGenerationRendersPrdMarkdown(): AssertionResult {
  const generationPath = path.join(ROOT_DIR, 'src', 'pages', 'ProjectGeneration.tsx');
  const content = readFile(generationPath);
  const hasMarkdownRenderer = content.includes('ReactMarkdown');
  const hasToggle = content.includes('Show full PRD document');
  const bindsReviewPayload = content.includes('reviewData.prd_document_markdown');
  return assert(
    hasMarkdownRenderer && hasToggle && bindsReviewPayload,
    'ProjectGeneration renders expandable full PRD markdown from review payload',
  );
}

function assertWorkflowInvokesBatch7AndGate(): AssertionResult {
  const workflowPath = path.join(SERVER_DIR, 'generation-workflow.ts');
  const content = readFile(workflowPath);
  const hasBatch7Import = content.includes('executeBatch7_verify');
  const hasRunVerificationStep = content.includes("step.do('run-verification'");
  const hasVerificationWait = content.includes("step.waitForEvent<VerificationApprovalEventPayload>")
    && content.includes('WORKFLOW_EVENT_TYPE_VERIFICATION_APPROVED');
  return assert(
    hasBatch7Import && hasRunVerificationStep && hasVerificationWait,
    'Workflow executes batch_7_verify and waits for verification approval event before finalization',
  );
}

function assertWorkflowCompletedBatchQueryIncludesBatch7(): AssertionResult {
  const workflowPath = path.join(SERVER_DIR, 'generation-workflow.ts');
  const content = readFile(workflowPath);
  const includesBatch7 = content.includes("'batch_7_verify'");
  return assert(
    includesBatch7,
    'Workflow completed-batch query includes batch_7_verify',
  );
}

function assertVerificationFinalizeUsesWorkflowDispatch(): AssertionResult {
  const appPath = path.join(SERVER_DIR, 'app.ts');
  const content = readFile(appPath);
  const hasVerificationEvent = content.includes('WORKFLOW_EVENT_TYPE_VERIFICATION_APPROVED');
  const dispatchesEvent = content.includes('sendWorkflowDispatchEvent(c.env')
    && content.includes("eventType: WORKFLOW_EVENT_TYPE_VERIFICATION_APPROVED");
  const noDirectFinalize = !content.includes('await finalizeProjectGeneration(c.env, projectId, runId);');
  return assert(
    hasVerificationEvent && dispatchesEvent && noDirectFinalize,
    'Finalize endpoint dispatches verification approval event instead of directly finalizing',
  );
}

function assertRuntimeReviewGateIncludesVerification(): AssertionResult {
  const runtimePath = path.join(SERVER_DIR, 'generation-runtime.ts');
  const content = readFile(runtimePath);
  const includesVerification = content.includes("lifecycleStatus === 'awaiting_review' || lifecycleStatus === 'awaiting_verification_review'");
  return assert(
    includesVerification,
    'Runtime contract marks awaiting_verification_review as review-required',
  );
}

function assertFrontendBatch7IsVisible(): AssertionResult {
  const sessionPath = path.join(ROOT_DIR, 'src', 'lib', 'generation-session.ts');
  const runtimePath = path.join(ROOT_DIR, 'src', 'lib', 'generation-runtime.ts');
  const sessionContent = readFile(sessionPath);
  const runtimeContent = readFile(runtimePath);
  const sessionHasBatch7 = sessionContent.includes("{ id: 'batch_7_verify', heading: 'Verifying consistency'");
  const runtimeHasBatch7 = runtimeContent.includes("'batch_7_verify'");
  return assert(
    sessionHasBatch7 && runtimeHasBatch7,
    'Frontend generation batches include batch_7_verify in session view and runtime normalizer',
  );
}

function assertVerificationPayloadHydratesOnRefresh(): AssertionResult {
  const appPath = path.join(SERVER_DIR, 'app.ts');
  const uiPath = path.join(ROOT_DIR, 'src', 'pages', 'ProjectGeneration.tsx');
  const appContent = readFile(appPath);
  const uiContent = readFile(uiPath);
  const statusIncludesReport = appContent.includes('verification_report: verificationReport');
  const uiLoadsFromStatus = uiContent.includes('if (statusData.verification_report) {');
  return assert(
    statusIncludesReport && uiLoadsFromStatus,
    'Verification report is returned by status API and hydrated by ProjectGeneration on refresh',
  );
}

// ─────────────────────────────────────────────────────────────────
// Run All Assertions
// ─────────────────────────────────────────────────────────────────

const assertions: Array<() => AssertionResult> = [
  // T1: Server Logging
  assertServerLoggerExists,
  assertServerLoggerHasLevels,
  assertNoRawConsoleInServerCode,
  
  // T2: Client Logger
  assertClientLoggerExists,
  assertClientLoggerHasLevels,
  assertClientLoggerHasLevelGating,
  assertNoRawConsoleInClientLib,
  
  // T4: Error Copy
  assertUiCopyExists,
  assertUiCopyHasActionableMessages,
  assertUiCopyMessagesAreShort,
  
  // T5: Docs Updated
  assertRepairPlanMarksC6Complete,
  assertRepairPlanMarksC7Complete,
  assertRepairPlanMarksC8Complete,
  assertRepairPlanMarksG1Complete,
  assertRepairPlanMarksG2Complete,
  assertRepairPlanMarksG3Complete,
  assertRepairPlanMarksG4Complete,
  
  // T7: Dead Code
  assertNoOrphanedExports,
  assertLegacyAdaptersDocumented,
  assertResumeCheckpointTransferWired,
  assertCheckpointOwnershipHelpersExist,
  assertStructuredPrdDocumentExists,
  assertProjectGenerationRendersPrdMarkdown,
  assertWorkflowInvokesBatch7AndGate,
  assertWorkflowCompletedBatchQueryIncludesBatch7,
  assertVerificationFinalizeUsesWorkflowDispatch,
  assertRuntimeReviewGateIncludesVerification,
  assertFrontendBatch7IsVisible,
  assertVerificationPayloadHydratesOnRefresh,
];

let passed = 0;
let failed = 0;

console.log('Phase 20: Cleanup, Error Hygiene, and Verification Assertions\n');

for (const assertion of assertions) {
  const result = assertion();
  if (result.pass) {
    console.log(`✓ PASS: ${result.message}`);
    passed++;
  } else {
    console.log(`✗ FAIL: ${result.message}`);
    failed++;
  }
}

console.log(`\n${passed}/${passed + failed} assertions passed.`);

if (failed > 0) {
  process.exit(1);
}
