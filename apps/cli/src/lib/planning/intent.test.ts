import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { captureIntent, loadCurrentIntent, mergeIntentNotes, normalizeIntent } from './intent.js';

describe('planning intent', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `planning-intent-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('normalizes intent from goal and repo context', () => {
    const intent = normalizeIntent({
      initialGoal: '  Build reliable auth flow  ',
      repoContext: {
        name: 'scrimble',
        frameworks: ['hono'],
        keyDirectories: ['apps', 'packages'],
        primaryLanguage: 'TypeScript',
      },
    });
    expect(intent.goal).toBe('Build reliable auth flow');
    expect(intent.productAssumptions.some((entry) => entry.includes('TypeScript'))).toBe(true);
  });

  it('captures and persists current intent', async () => {
    const captured = await captureIntent(
      {
        initialGoal: 'Implement worker scheduler',
      },
      testDir,
    );
    const loaded = await loadCurrentIntent(testDir);
    expect(loaded?.id).toBe(captured.id);
    expect(loaded?.goal).toBe('Implement worker scheduler');
  });

  it('merges note updates without duplicates', () => {
    const base = normalizeIntent({ initialGoal: 'Goal' });
    const merged = mergeIntentNotes(base, {
      constraints: 'No API changes; No API changes',
      successCriteria: 'All tests pass',
    });
    expect(merged.constraints).toEqual(['No API changes']);
    expect(merged.successCriteria).toContain('All tests pass');
  });
});

