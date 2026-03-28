import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const appTs = readFileSync(path.join(repoRoot, 'functions', 'server', 'app.ts'), 'utf8');
const dispatchTs = readFileSync(path.join(repoRoot, 'functions', 'server', 'generation-dispatch.ts'), 'utf8');
const consumerTs = readFileSync(path.join(repoRoot, 'worker-consumer.ts'), 'utf8');
const protocolTs = readFileSync(path.join(repoRoot, 'functions', 'server', 'workflow-protocol.ts'), 'utf8');
const dbTs = readFileSync(path.join(repoRoot, 'src', 'lib', 'db.ts'), 'utf8');
const projectGenerationTs = readFileSync(path.join(repoRoot, 'src', 'pages', 'ProjectGeneration.tsx'), 'utf8');

function pass(label: string) {
  console.log(`PASS ${label}`);
}

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    fail(message);
  }
}

function assertIntakeConfirmRollbackIsFailureSafe() {
  const intakeConfirmBlockMatch = appTs.match(/app\.post\('\/intake\/:id\/confirm'[\s\S]*?return c\.json\(\{[\s\S]*?\n\}\);/);
  const block = intakeConfirmBlockMatch?.[0] || '';
  assert(block.length > 0, 'intake confirm route must exist.');

  assert(
    /updateGenerationRunStatus\(c\.env,\s*runId,\s*'failed'/.test(block),
    'intake confirm dispatch failure must mark the run failed.',
  );
  assert(
    /clearCurrentGenerationRun\(c\.env,\s*projectId\)/.test(block),
    'intake confirm dispatch failure must clear projects.current_generation_run_id.',
  );
  assert(
    !/updateGenerationRunStatus\(c\.env,\s*runId,\s*'intake'/.test(block),
    'intake confirm must never map rollback through intake->queued run status.',
  );
  pass('intake confirm rollback uses failed run + cleared project pointer');
}

function assertSharedWorkflowServiceGuard() {
  assert(
    /function requireWorkflowServiceBinding\(c: AppContext\)/.test(appTs),
    'app.ts must define shared workflow service guard helper.',
  );
  assert(
    /return c\.json\(\{\s*error:\s*'Project generation is temporarily unavailable\./.test(appTs),
    'workflow service guard must return actionable service-unavailable response.',
  );

  const guardUsages = [...appTs.matchAll(/const workflowServiceError = requireWorkflowServiceBinding\(c\);/g)].length;
  assert(guardUsages >= 5, 'workflow service guard must be reused by generation-starting routes.');
  pass('generation routes share one workflow service binding guard');
}

function assertWorkflowProtocolVersionContract() {
  assert(
    /export const GENERATION_WORKFLOW_PROTOCOL_VERSION = 1 as const;/.test(protocolTs),
    'workflow protocol file must export a canonical protocol version constant.',
  );
  assert(
    /import \{ GENERATION_WORKFLOW_PROTOCOL_VERSION \} from '\.\/workflow-protocol';/.test(dispatchTs),
    'dispatch must import the shared workflow protocol constant.',
  );
  assert(
    /protocolVersion:\s*GENERATION_WORKFLOW_PROTOCOL_VERSION/.test(dispatchTs),
    'dispatch payloads must include shared protocolVersion.',
  );
  assert(
    /import \{ assertWorkflowProtocolVersion \} from '\.\/functions\/server\/workflow-protocol';/.test(consumerTs),
    'consumer must import shared protocol assertion helper.',
  );
  assert(
    /assertWorkflowProtocolVersion\(payload\.protocolVersion\);/.test(consumerTs),
    'consumer must validate protocolVersion before workflow creation.',
  );
  pass('dispatch and consumer share one explicit workflow protocol contract');
}

function assertProjectGenerationNoUpdatedAtLivenessFallback() {
  assert(
    !/noteProgressTimestamp\(statusData\.generation_runtime\?\.heartbeatAt \|\| projectData\.updated_at\)/.test(projectGenerationTs),
    'generation screen must not use project.updated_at as runner liveness signal.',
  );
  assert(
    !/pickLatestTimestamp\(\s*lastProgressAt,\s*status\?\.generation_runtime\?\.heartbeatAt,\s*project\?\.updated_at/.test(projectGenerationTs),
    'latest progress timestamp must not include project.updated_at fallback.',
  );
  pass('generation screen liveness uses heartbeat/events only');
}

function assertInvariantEventHandling() {
  assert(
    /onInvariant\?: \(event: ProjectGenerationInvariantEvent\) => void;/.test(dbTs),
    'stream options must support invariant event callback.',
  );
  assert(
    /case 'invariant': \{[\s\S]*drift_type[\s\S]*message[\s\S]*timestamp[\s\S]*\}/.test(dbTs),
    'stream parser must parse invariant events into typed shape.',
  );
  assert(
    /case 'invariant':[\s\S]*options\.onInvariant\?\.\(parsed\.event\);/.test(dbTs),
    'stream dispatch loop must route invariant events instead of dropping them.',
  );
  pass('invariant generation events are parsed and surfaced intentionally');
}

function run() {
  console.log('Starting Phase 14E reliability-hardening assertions...');
  assertIntakeConfirmRollbackIsFailureSafe();
  assertSharedWorkflowServiceGuard();
  assertWorkflowProtocolVersionContract();
  assertProjectGenerationNoUpdatedAtLivenessFallback();
  assertInvariantEventHandling();
  console.log('Phase 14E reliability-hardening assertions passed.');
}

run();
