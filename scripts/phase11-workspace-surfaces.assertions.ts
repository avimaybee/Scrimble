import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveWorkspaceReadiness } from '../src/lib/workspace-readiness.ts';

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

runTest('WorkspaceReadiness marks complete setup as ready with no next actions', () => {
  const readiness = deriveWorkspaceReadiness({
    aiProviderCount: 2,
    builderProfileCount: 4,
    alwaysOnResearchToolCount: 3,
    optionalResearchToolCount: 1,
  });

  assert.equal(readiness.overallReadiness, 'ready');
  assert.equal(readiness.aiSetup.isReady, true);
  assert.equal(readiness.builderProfile.isReady, true);
  assert.equal(readiness.researchConnectivity.isReady, true);
  assert.deepEqual(readiness.nextActions, []);
});

runTest('WorkspaceReadiness reports missing setup with actionable next actions', () => {
  const readiness = deriveWorkspaceReadiness({
    aiProviderCount: 0,
    builderProfileCount: 1,
    alwaysOnResearchToolCount: 0,
    optionalResearchToolCount: 0,
  });

  assert.equal(readiness.overallReadiness, 'needs_setup');
  assert.equal(readiness.aiSetup.isReady, false);
  assert.equal(readiness.builderProfile.isReady, false);
  assert.equal(readiness.researchConnectivity.isReady, false);
  assert.equal(readiness.nextActions.length, 3);
});

runTest('Settings surface includes readiness anchor and collapsible advanced controls', () => {
  const settings = read('src/pages/Settings.tsx');
  assert.ok(settings.includes('id="workspace"'));
  assert.ok(settings.includes('Workspace readiness'));
  assert.ok(settings.includes('showAdvancedControls'));
  assert.ok(settings.includes('Hidden until you need role-specific model routing.'));
});

runTest('Auth surface keeps only real sign-in messaging', () => {
  const auth = read('src/pages/AuthPage.tsx');
  assert.ok(auth.includes('Continue with Google'));
  assert.ok(auth.includes('Google sign-in is the only supported method right now.'));
  assert.equal(auth.includes('Coming soon'), false);
});

runTest('Landing surface removes placeholder avatars and keeps real links only', () => {
  const landing = read('src/pages/LandingPage.tsx');
  assert.equal(landing.includes('pravatar.cc'), false);
  assert.ok(landing.includes('mailto:support@scrimble.com'));
  assert.ok(landing.includes('SCRIMBLE_GITHUB_URL'));
  assert.ok(landing.includes('href="#how-it-works"'));
});

runTest('Dropdown menu semantics use real menu roles and button controls', () => {
  const dropdown = read('src/components/ui/dropdown-menu.tsx');
  assert.ok(dropdown.includes('role="menu"'));
  assert.ok(dropdown.includes('role="menuitem"'));
  assert.ok(dropdown.includes('aria-haspopup="menu"'));
  assert.ok(dropdown.includes('type="button"'));
});

runTest('ProjectCanvas guided mode keeps advanced editing hidden by default', () => {
  const canvas = read('src/pages/ProjectCanvas.tsx');
  assert.ok(canvas.includes('Guided mode keeps editing controls hidden by default.'));
  assert.ok(canvas.includes("isAdvancedMode ? 'Advanced mode: on' : 'Advanced mode: off'"));
  assert.ok(canvas.includes('aria-label={`Open stage ${stage.title}`}'));
});

console.log('Phase 11 workspace-surfaces assertions passed.');
