import { beforeEach, describe, expect, it, vi } from 'vitest';

const localMocks = vi.hoisted(() => ({
  appendActivity: vi.fn(),
  getActiveChunk: vi.fn(),
  getNextPendingChunk: vi.fn(),
  loadPlanState: vi.fn(),
  savePlanState: vi.fn(),
  writeCurrentChunkFromPlan: vi.fn(),
}));

const verifyMocks = vi.hoisted(() => ({
  runVerification: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  formatCloudError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  recordChunkCompletion: vi.fn(),
  resolveCloudClientConfig: vi.fn(),
}));

const telemetryMocks = vi.hoisted(() => ({
  recordTelemetry: vi.fn(),
}));

vi.mock('../lib/local/index.js', () => localMocks);
vi.mock('../lib/verify/index.js', () => verifyMocks);
vi.mock('../lib/api/index.js', () => apiMocks);
vi.mock('../lib/telemetry.js', () => telemetryMocks);

import Done from './done.js';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function makePlanState() {
  return {
    version: 1,
    chunks: [
      {
        id: 'chunk-001',
        sequence: 1,
        title: 'Build sync registry',
        prompt: 'Build sync registry',
        status: 'active',
      },
      {
        id: 'chunk-002',
        sequence: 2,
        title: 'Emit completion events',
        prompt: 'Emit completion events',
        status: 'pending',
      },
    ],
    sync: {},
  };
}

function makeCommand(logs: string[]): Done {
  const command = Object.create(Done.prototype) as Done & {
    parse: ReturnType<typeof vi.fn>;
    log: (message?: string) => void;
    exit: (code?: number) => never;
  };
  command.parse = vi.fn().mockResolvedValue({
    flags: {
      force: false,
      reason: undefined,
      'no-verify': false,
      'verify-command': undefined,
      cloud: true,
    },
  });
  command.log = (message = '') => {
    logs.push(String(message));
  };
  command.exit = (code?: number) => {
    throw new Error(`EXIT_${String(code ?? 0)}`);
  };
  return command as Done;
}

describe('done command cloud completion emission', () => {
  beforeEach(() => {
    localMocks.loadPlanState.mockResolvedValue(makePlanState());
    localMocks.getActiveChunk.mockReturnValue(makePlanState().chunks[0]);
    localMocks.getNextPendingChunk.mockReturnValue(makePlanState().chunks[1]);
    localMocks.savePlanState.mockResolvedValue(undefined);
    localMocks.writeCurrentChunkFromPlan.mockResolvedValue(undefined);
    localMocks.appendActivity.mockResolvedValue(undefined);

    verifyMocks.runVerification.mockResolvedValue({ status: 'pass' });

    apiMocks.resolveCloudClientConfig.mockResolvedValue({
      baseUrl: 'https://api.scrimble.dev',
      projectId: 'project-1',
    });
    apiMocks.recordChunkCompletion.mockResolvedValue({
      status: 'recorded',
      projectId: 'project-1',
      chunkId: 'chunk-001',
      completedAt: '2026-04-06T00:00:00.000Z',
    });

    telemetryMocks.recordTelemetry.mockResolvedValue(undefined);
  });

  it('records chunk completion to cloud history when cloud emission succeeds', async () => {
    const logs: string[] = [];
    const command = makeCommand(logs);

    await command.run();

    expect(apiMocks.recordChunkCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
      }),
      expect.objectContaining({
        chunkId: 'chunk-001',
        chunkTitle: 'Build sync registry',
        nextChunkId: 'chunk-002',
      }),
    );
    expect(stripAnsi(logs.join('\n'))).toContain('Cloud history updated.');
  });

  it('warns on cloud emission failure while still completing local chunk state', async () => {
    apiMocks.recordChunkCompletion.mockRejectedValueOnce(new Error('Unauthorized'));

    const logs: string[] = [];
    const command = makeCommand(logs);

    await command.run();

    expect(localMocks.savePlanState).toHaveBeenCalled();
    expect(telemetryMocks.recordTelemetry).toHaveBeenCalledWith({
      event: 'chunk_done_cloud_emit_failed',
      level: 'warn',
      payload: { message: 'Unauthorized' },
    });
    expect(stripAnsi(logs.join('\n'))).toContain('Cloud history update failed: Unauthorized');
  });
});
