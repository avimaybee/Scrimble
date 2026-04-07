import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { importConductorToLedger } from './conductor-import.js';

describe('planning conductor import', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `planning-conductor-import-${Date.now()}`);
    await fs.mkdir(path.join(testDir, 'conductor', 'tracks', 'auth-track'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'conductor', 'tracks.md'), '- [ ] Auth Track (auth-track)\n', 'utf8');
    await fs.writeFile(
      path.join(testDir, 'conductor', 'tracks', 'auth-track', 'plan.md'),
      '# Auth Track\n- [ ] Implement auth guard\n  - [ ] Add tests\n- [ ] Manual verification for login\n',
      'utf8',
    );
    await fs.writeFile(path.join(testDir, 'conductor', 'product.md'), '# Product\nAuth platform\n', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('imports conductor plan into intent and task graph', async () => {
    const result = await importConductorToLedger({
      contextOnly: false,
      overwriteIntent: true,
      cwd: testDir,
    });

    expect(result.success).toBe(true);
    expect(result.intent?.goal).toContain('Auth Track');
    expect(result.graph?.tasks.length).toBeGreaterThan(0);
    expect(result.graph?.phases.length).toBeGreaterThan(0);
  });

  it('supports context-only import mode', async () => {
    const result = await importConductorToLedger({
      contextOnly: true,
      overwriteIntent: false,
      cwd: testDir,
    });
    expect(result.success).toBe(true);
    expect(result.graph).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

