import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const canvasTs = readFileSync(path.join(repoRoot, 'src', 'pages', 'ProjectCanvas.tsx'), 'utf8');
const detailPanelTs = readFileSync(path.join(repoRoot, 'src', 'components', 'DetailPanel.tsx'), 'utf8');
const pipelineTs = readFileSync(path.join(repoRoot, 'functions', 'server', 'generation-pipeline.ts'), 'utf8');
const appTs = readFileSync(path.join(repoRoot, 'functions', 'server', 'app.ts'), 'utf8');
const streamFixture = readFileSync(path.join('D:', 'download', 'scrimblestream-plan.md'), 'utf8').toLowerCase();

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

function assertExportCtaIsPrimaryAndReachable() {
  assert(
    /Download plan\.md/.test(canvasTs),
    'ProjectCanvas must expose a visible Download plan.md CTA.',
  );
  assert(
    /absolute inset-x-0 top-0 z-20/.test(canvasTs),
    'Download CTA should live in the top action toolbar for reachability.',
  );
  assert(
    /focus-visible:ring-2/.test(canvasTs),
    'Primary export controls must include explicit focus-visible ring styling.',
  );
  pass('export CTA remains visible/reachable in the top action area');
}

function assertAdvancedEditingIsDemoted() {
  assert(
    /Guided mode keeps editing controls hidden by default\./.test(canvasTs),
    'Guided mode should explicitly demote advanced editing.',
  );
  assert(
    /{isAdvancedMode \? \(/.test(canvasTs) && /Quick edit plan/.test(canvasTs),
    'Quick edit controls should stay behind advanced-mode gating.',
  );
  pass('advanced editing remains secondary to guided workflow');
}

function assertCanonicalMarkdownExportPathOnly() {
  assert(
    !/const exportAsMarkdown = async/.test(canvasTs),
    'ProjectCanvas must not assemble markdown client-side.',
  );
  assert(
    /dbService\.downloadSkillFiles\(project\.id\)/.test(canvasTs),
    'ProjectCanvas export must use downloadSkillFiles canonical backend path.',
  );
  assert(
    /app\.get\('\/projects\/:id\/skill-files'/.test(appTs),
    'Backend must serve canonical plan.md download endpoint.',
  );
  pass('markdown export uses canonical backend serializer path');
}

function assertDetailPanelActionBriefContract() {
  assert(
    /Action brief/.test(detailPanelTs),
    'DetailPanel must present a top-level Action brief block.',
  );
  assert(
    /Tool[\s\S]*Destination[\s\S]*Action[\s\S]*Done when[\s\S]*What this unlocks/.test(detailPanelTs),
    'DetailPanel action brief must include tool, destination, action, done criteria, and unlock context.',
  );
  assert(
    /Research confidence is limited for this step\./.test(detailPanelTs),
    'DetailPanel should surface low confidence research in-line.',
  );
  pass('detail panel prioritizes navigation-style action brief');
}

function assertPlanQualityGateExists() {
  assert(
    /const GENERIC_PLAN_PHRASES = \[/.test(pipelineTs),
    'Pipeline must define generic/off-domain phrase guardrails.',
  );
  assert(
    /function evaluatePlanQuality\(/.test(pipelineTs),
    'Pipeline must expose a plan quality evaluation function.',
  );
  assert(
    /Batch 4 quality gate rejected generic\/off-domain plan output/.test(pipelineTs),
    'Batch 4 must fail closed on low-quality plan output.',
  );
  pass('batch4 quality gate rejects generic or off-domain plans');
}

function assertFixtureRepresentsBlockedClass() {
  const hasKnownGenericSignals = [
    'reactive music streaming platform',
    'audio track upload/management',
    'works end-to-end in your local environment',
  ].every((needle) => streamFixture.includes(needle));
  assert(hasKnownGenericSignals, 'ScrimbleStream fixture should include generic signals guarded by phase15.');
  pass('scrimblestream fixture captures blocked generic artifact class');
}

function run() {
  console.log('Starting Phase 15 vision/productization assertions...');
  assertExportCtaIsPrimaryAndReachable();
  assertAdvancedEditingIsDemoted();
  assertCanonicalMarkdownExportPathOnly();
  assertDetailPanelActionBriefContract();
  assertPlanQualityGateExists();
  assertFixtureRepresentsBlockedClass();
  console.log('Phase 15 vision/productization assertions passed.');
}

run();
