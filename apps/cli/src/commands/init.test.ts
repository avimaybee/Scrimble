import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const telemetryMocks = vi.hoisted(() => ({
  recordTelemetry: vi.fn(),
}));

const geminiMocks = vi.hoisted(() => ({
  runPreflight: vi.fn().mockResolvedValue({
    canProceed: true,
    warnings: [],
    errors: [],
    gemini: { available: true, path: '/usr/bin/gemini', version: '0.1.0' },
    headlessAuth: { available: true },
    folderTrust: { enabled: true, workspaceTrusted: true },
    conductor: { installed: true, enabled: true },
  }),
  formatPreflightResult: vi.fn().mockReturnValue('Preflight OK'),
}));

const conductorMocks = vi.hoisted(() => ({
  loadConductorWorkspace: vi.fn().mockResolvedValue({
    exists: false,
    tracks: [],
  }),
}));

const conductorRuntimeMocks = vi.hoisted(() => ({
  ensureRuntimeDirs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/telemetry.js', () => telemetryMocks);
vi.mock('../lib/gemini/index.js', () => geminiMocks);
vi.mock('../lib/conductor/index.js', () => conductorMocks);
vi.mock('../lib/conductor/runtime.js', () => conductorRuntimeMocks);

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
        'ai-model': undefined,
        'skip-preflight': false,
      },
      logs,
    );

    await command.run();

    const config = JSON.parse(await fs.readFile(path.join(tempDir, '.scrimble', 'config.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(config['schemaVersion']).toBe(1);
    expect(config['auth']).toBeUndefined();
    expect(config['projectId']).toBeUndefined();
    expect(config['cloudEndpoint']).toBeUndefined();

    const sessionExists = await fs
      .access(path.join(tempDir, '.scrimble', 'session.json'))
      .then(() => true)
      .catch(() => false);
    expect(sessionExists).toBe(false);
    expect(logs.join('\n')).toContain('.scrimble directory created');
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
        'ai-model': undefined,
        'skip-preflight': false,
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

  it('stops when preflight fails and no conductor workspace is present', async () => {
    geminiMocks.runPreflight.mockResolvedValueOnce({
      canProceed: false,
      warnings: [],
      errors: ['Gemini CLI not found'],
      gemini: { available: false, error: 'Gemini CLI not found' },
      headlessAuth: { available: false, error: 'Auth missing' },
      folderTrust: { enabled: true, workspaceTrusted: true },
      conductor: { installed: false, enabled: false, error: 'Conductor missing' },
    });

    const logs: string[] = [];
    const command = makeCommand(
      {
        goal: undefined,
        force: false,
        'ai-provider': 'openai',
        'ai-model': undefined,
        'skip-preflight': false,
      },
      logs,
    );

    await command.run();

    const projectExists = await fs
      .access(path.join(tempDir, '.scrimble', 'project.json'))
      .then(() => true)
      .catch(() => false);

    expect(projectExists).toBe(false);
    expect(logs.join('\n')).toContain('Preflight failed and no Conductor workspace is available');
  });

  it('allows local initialization when --skip-preflight is set', async () => {
    geminiMocks.runPreflight.mockClear();

    const logs: string[] = [];
    const command = makeCommand(
      {
        goal: undefined,
        force: false,
        'ai-provider': 'openai',
        'ai-model': undefined,
        'skip-preflight': true,
      },
      logs,
    );

    await command.run();

    const projectExists = await fs
      .access(path.join(tempDir, '.scrimble', 'project.json'))
      .then(() => true)
      .catch(() => false);

    expect(projectExists).toBe(true);
    expect(geminiMocks.runPreflight).not.toHaveBeenCalled();
  });
});

