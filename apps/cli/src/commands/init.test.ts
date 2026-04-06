import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const apiMocks = vi.hoisted(() => ({
  CloudApiError: class CloudApiError extends Error {
    constructor(
      public status: number,
      public body: string,
    ) {
      super(`Cloud API request failed (${status})`);
      this.name = 'CloudApiError';
    }
  },
  formatCloudError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  getPlanRegistryState: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(),
  resolveCloudClientConfig: vi.fn(),
}));

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

vi.mock('../lib/api/index.js', () => apiMocks);
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

describe('init command cloud bootstrap', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scrimble-init-test-'));
    process.chdir(tempDir);

    apiMocks.resolveCloudClientConfig.mockResolvedValue({
      baseUrl: 'https://api.scrimble.dev',
      projectId: 'repo-name',
      accessToken: 'token-1',
    });
    apiMocks.getProject.mockResolvedValue({
      id: 'repo-name',
      name: 'Repo Name',
      goal: 'Ship cloud sync',
      status: 'active',
      createdAt: '2026-04-06T00:00:00.000Z',
      updatedAt: '2026-04-06T00:00:00.000Z',
    });
    apiMocks.listProjects.mockResolvedValue([]);
    apiMocks.getPlanRegistryState.mockResolvedValue({
      projectId: 'repo-name',
      latest: {
        version: 2,
        planHash: 'hash-2',
        plan: {
          version: 2,
          chunks: [
            {
              id: 'chunk-001',
              title: 'Bootstrap from cloud',
              prompt: 'Pull remote state',
              status: 'active',
            },
          ],
        },
        syncedAt: '2026-04-06T01:00:00.000Z',
        createdAt: '2026-04-06T01:00:00.000Z',
      },
    });
    telemetryMocks.recordTelemetry.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('bootstraps cloud project and canonical plan during init', async () => {
    const logs: string[] = [];
    const command = makeCommand(
      {
        goal: 'Ship cloud sync',
        force: false,
        'ai-provider': 'openai',
        'ai-model': undefined,
        'from-cloud': true,
        'project-id': 'repo-name',
      },
      logs,
    );

    await command.run();

    const config = JSON.parse(await fs.readFile(path.join(tempDir, '.scrimble', 'config.json'), 'utf8')) as {
      projectId?: string;
    };
    const project = JSON.parse(await fs.readFile(path.join(tempDir, '.scrimble', 'project.json'), 'utf8')) as {
      id?: string;
      name?: string;
      goal?: string;
    };
    const plan = JSON.parse(await fs.readFile(path.join(tempDir, '.scrimble', 'plan.json'), 'utf8')) as {
      version: number;
      chunks: unknown[];
    };

    expect(config.projectId).toBe('repo-name');
    expect(project.id).toBe('repo-name');
    expect(project.name).toBe('Repo Name');
    expect(project.goal).toBe('Ship cloud sync');
    expect(plan.version).toBe(2);
    expect(plan.chunks.length).toBe(1);
    expect(apiMocks.getProject).toHaveBeenCalled();
    expect(apiMocks.getPlanRegistryState).toHaveBeenCalled();
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
        'from-cloud': false,
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
        'from-cloud': false,
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
        'from-cloud': false,
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
