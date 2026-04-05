import { beforeEach, describe, expect, it, vi } from 'vitest';

const localMocks = vi.hoisted(() => ({
  appendActivity: vi.fn(),
  computePlanHash: vi.fn(),
  ensureScrimbleDirectories: vi.fn(),
  loadPlanState: vi.fn(),
  savePlanState: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  listArtifacts: vi.fn(),
  readArtifact: vi.fn(),
  resolveCloudClientConfig: vi.fn(),
  uploadArtifact: vi.fn(),
}));

const telemetryMocks = vi.hoisted(() => ({
  recordTelemetry: vi.fn(),
}));

vi.mock('../lib/local/index.js', () => localMocks);
vi.mock('../lib/telemetry.js', () => telemetryMocks);
vi.mock('../lib/api/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api/index.js')>();
  return {
    ...actual,
    ...apiMocks,
  };
});

import Sync from './sync.js';

class MockCloudApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Cloud API request failed (${status})`);
    this.name = 'CloudApiError';
  }

  parseBody<T>(): T | undefined {
    try {
      return JSON.parse(this.body) as T;
    } catch {
      return undefined;
    }
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function makePlanState() {
  return {
    version: 1,
    architecture: { summary: 'summary' },
    chunks: [
      {
        id: 'chunk-001',
        sequence: 1,
        title: 'Build API',
        prompt: 'Build API',
        status: 'active',
      },
    ],
    sync: {
      lastRemotePlanHash: 'remote-hash-old',
    },
  };
}

function makeCommand(flags: { 'on-conflict': 'manual' | 'local' | 'cloud'; 'dry-run': boolean }, logs: string[]): Sync {
  const command = Object.create(Sync.prototype) as Sync & {
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
  return command as Sync;
}

describe('sync command cloud failure handling', () => {
  beforeEach(() => {
    localMocks.loadPlanState.mockResolvedValue(makePlanState());
    localMocks.computePlanHash.mockReturnValue('local-hash');
    localMocks.ensureScrimbleDirectories.mockResolvedValue({
      conflictsDir: 'C:\\repo\\.scrimble\\conflicts',
    });
    localMocks.savePlanState.mockResolvedValue(undefined);
    localMocks.appendActivity.mockResolvedValue(undefined);

    apiMocks.resolveCloudClientConfig.mockResolvedValue({
      baseUrl: 'https://api.scrimble.dev',
      projectId: 'project-1',
    });
    apiMocks.listArtifacts.mockResolvedValue([]);
    apiMocks.readArtifact.mockResolvedValue(undefined);
    apiMocks.uploadArtifact.mockResolvedValue({ key: 'artifact-key', bytes: 42 });

    telemetryMocks.recordTelemetry.mockResolvedValue(undefined);
  });

  it('parses validation issues from cloud sync errors and stores lastSyncError', async () => {
    apiMocks.listArtifacts.mockRejectedValue(
      new MockCloudApiError(
        400,
        JSON.stringify({
          error: 'Invalid artifacts list query.',
          message: 'Request validation failed.',
          issues: [{ message: 'Number must be less than or equal to 100' }],
        }),
      ),
    );

    const logs: string[] = [];
    const command = makeCommand({ 'on-conflict': 'manual', 'dry-run': false }, logs);
    await expect(
      command.run(),
    ).rejects.toThrow('EXIT_1');

    const normalizedLogs = stripAnsi(logs.join('\n'));
    const expectedMessage = 'Invalid artifacts list query. Number must be less than or equal to 100';
    expect(normalizedLogs).toContain(`Cloud sync failed: ${expectedMessage}`);
    expect(localMocks.savePlanState).toHaveBeenCalledWith(
      expect.objectContaining({
        sync: expect.objectContaining({
          lastRemotePlanHash: 'remote-hash-old',
          lastSyncError: expectedMessage,
        }),
      }),
    );
    expect(telemetryMocks.recordTelemetry).toHaveBeenCalledWith({
      event: 'state_sync_failed',
      level: 'warn',
      payload: { message: expectedMessage },
    });
    expect(apiMocks.uploadArtifact).not.toHaveBeenCalled();
    expect(localMocks.appendActivity).not.toHaveBeenCalled();
  });

  it('formats non-validation cloud errors with error and message fields', async () => {
    apiMocks.uploadArtifact.mockRejectedValue(
      new MockCloudApiError(
        501,
        JSON.stringify({
          error: 'Not Implemented',
          message: 'Project listing is not implemented yet.',
        }),
      ),
    );

    const logs: string[] = [];
    const command = makeCommand({ 'on-conflict': 'manual', 'dry-run': false }, logs);
    await expect(
      command.run(),
    ).rejects.toThrow('EXIT_1');

    const normalizedLogs = stripAnsi(logs.join('\n'));
    const expectedMessage = 'Not Implemented: Project listing is not implemented yet.';
    expect(normalizedLogs).toContain(`Cloud sync failed: ${expectedMessage}`);
    expect(localMocks.savePlanState).toHaveBeenCalledWith(
      expect.objectContaining({
        sync: expect.objectContaining({
          lastSyncError: expectedMessage,
        }),
      }),
    );
    expect(telemetryMocks.recordTelemetry).toHaveBeenCalledWith({
      event: 'state_sync_failed',
      level: 'warn',
      payload: { message: expectedMessage },
    });
    expect(localMocks.appendActivity).not.toHaveBeenCalled();
  });
});
