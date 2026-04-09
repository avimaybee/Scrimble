import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadScrimbleConfig } from './load-config.js';

describe('loadScrimbleConfig', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
    tempDirs.length = 0;
  });

  it('migrates legacy single-ai config into provider profiles', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'scrimble-config-migrate-'));
    tempDirs.push(cwd);
    const scrimbleDir = path.join(cwd, '.scrimble');
    await fs.mkdir(scrimbleDir, { recursive: true });
    await fs.writeFile(path.join(scrimbleDir, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      ai: {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: '${OPENAI_API_KEY}',
      },
      interactionMode: 'balanced',
    }, null, 2));

    const config = await loadScrimbleConfig(cwd);
    expect(config.activeProfileId).toBeTruthy();
    expect(config.profiles).toHaveLength(1);
    expect(config.profiles[0]?.provider).toBe('openai');
    expect(config.profiles[0]?.modelStrategy).toBe('explicit');
    expect(config.interactionMode).toBe('balanced');

    const saved = JSON.parse(await fs.readFile(path.join(scrimbleDir, 'config.json'), 'utf8')) as Record<string, unknown>;
    expect(saved['ai']).toBeUndefined();
    expect(saved['profiles']).toBeDefined();
  });
});
