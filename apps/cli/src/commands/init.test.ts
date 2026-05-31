import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const telemetryMocks = vi.hoisted(() => ({
  recordTelemetry: vi.fn(),
}));

const migrationMocks = vi.hoisted(() => ({
  migrateLegacyLedgerIfPresent: vi.fn(),
}));

vi.mock('../lib/telemetry.js', () => telemetryMocks);
vi.mock('../lib/ledger/legacy-migration.js', () => migrationMocks);

import Init from './init.js';

function makeCommand(flags: Record<string, unknown>, logs: string[]): Init {
  const command = Object.create(Init.prototype) as Init & {
    parse: ReturnType<typeof vi.fn>;
    log: (message?: string) => void;
    exit: (code?: number) => never;
  };
  command.parse = vi.fn().mockResolvedValue({ flags });
  command.log = (message = '') => {
    logs.push(String(message));
  };
  command.exit = (code?: number) => {
    throw new Error(`EXIT_${String(code ?? 0)}`);
  };
  return command as Init;
}

describe('init command local-first setup', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scrimble-init-test-'));
    process.chdir(tempDir);
    telemetryMocks.recordTelemetry.mockResolvedValue(undefined);
    migrationMocks.migrateLegacyLedgerIfPresent.mockResolvedValue('not_needed');
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('creates local-first config and removes legacy session file', async () => {
    await fs.mkdir(path.join(tempDir, '.scrimble'), { recursive: true });
    await fs.writeFile(path.join(tempDir, '.scrimble', 'session.json'), '{"accessToken":"old"}', 'utf8');

    const logs: string[] = [];
    const command = makeCommand(
      {
        goal: 'Ship local-first workflow',
        force: false,
        'ai-provider': 'openai',
      },
      logs,
    );

    await command.run();

    const config = JSON.parse(await fs.readFile(path.join(tempDir, '.scrimble', 'config.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(config['schemaVersion']).toBe(2);
    expect(config['interactionMode']).toBe('guide');
    expect(config['auth']).toBeUndefined();
    expect(config['projectId']).toBeUndefined();
    expect(config['cloudEndpoint']).toBeUndefined();
    expect(Array.isArray(config['profiles'])).toBe(true);
    expect(typeof config['activeProfileId']).toBe('string');

    const sessionExists = await fs
      .access(path.join(tempDir, '.scrimble', 'session.json'))
      .then(() => true)
      .catch(() => false);
    expect(sessionExists).toBe(false);
    expect(logs.join('\n')).toContain('.scrimble directory created');
    expect(logs.join('\n')).toContain('Run `scrimble` and describe your goal');
  });

  it('repairs incomplete .scrimble state without requiring --force', async () => {
    const scrimbleDir = path.join(tempDir, '.scrimble');
    await fs.mkdir(scrimbleDir, { recursive: true });
    await fs.writeFile(path.join(scrimbleDir, 'incomplete.txt'), 'partial');

    const logs: string[] = [];
    const command = makeCommand(
      {
        goal: undefined,
        force: false,
        'ai-provider': 'openai',
      },
      logs,
    );

    await command.run();

    const projectExists = await fs
      .access(path.join(scrimbleDir, 'project.json'))
      .then(() => true)
      .catch(() => false);

    expect(projectExists).toBe(true);
    expect(logs.join('\n')).toContain('Repairing initialization');
  });

  it('does not overwrite fully initialized setup without --force', async () => {
    const scrimbleDir = path.join(tempDir, '.scrimble');
    await fs.mkdir(scrimbleDir, { recursive: true });
    await fs.writeFile(path.join(scrimbleDir, 'config.json'), '{"schemaVersion":1}', 'utf8');
    await fs.writeFile(path.join(scrimbleDir, 'project.json'), '{"name":"repo"}', 'utf8');

    const logs: string[] = [];
    const command = makeCommand(
      {
        goal: undefined,
        force: false,
        'ai-provider': 'openai',
      },
      logs,
    );

    await command.run();
    expect(logs.join('\n')).toContain('already exists');
  });
});
