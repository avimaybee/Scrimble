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

const conductorMocks = vi.hoisted(() => ({
  getActiveTrack: vi.fn(),
  loadConductorWorkspace: vi.fn(),
  parsePlan: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

const runtimeMocks = vi.hoisted(() => ({
  appendRuntimeEvent: vi.fn(),
  loadRuntimeState: vi.fn(),
  setRunStatus: vi.fn(),
}));

vi.mock('../lib/local/index.js', () => localMocks);
vi.mock('../lib/verify/index.js', () => verifyMocks);
vi.mock('../lib/api/index.js', () => apiMocks);
vi.mock('../lib/telemetry.js', () => telemetryMocks);
vi.mock('../lib/conductor/index.js', () => conductorMocks);
vi.mock('../lib/conductor/runtime.js', () => runtimeMocks);

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
    conductorMocks.loadConductorWorkspace.mockResolvedValue({ exists: false, tracks: [] });
    conductorMocks.getActiveTrack.mockReturnValue(undefined);
    conductorMocks.parsePlan.mockResolvedValue({ trackId: 't-1', phases: [], tasks: [] });
    conductorMocks.updateTaskStatus.mockResolvedValue(undefined);
    runtimeMocks.loadRuntimeState.mockResolvedValue({ status: 'idle', attemptCount: 0, lastActivityAt: '2026-04-06T00:00:00.000Z' });
    runtimeMocks.appendRuntimeEvent.mockResolvedValue(undefined);
    runtimeMocks.setRunStatus.mockResolvedValue(undefined);

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

  it('marks conductor in-progress task complete when conductor workspace exists', async () => {
    conductorMocks.loadConductorWorkspace.mockResolvedValue({
      exists: true,
      tracks: [{ id: 'track-1', title: 'Track One', status: 'active', planPath: 'C:\\tmp\\plan.md' }],
    });
    runtimeMocks.loadRuntimeState.mockResolvedValue({
      status: 'idle',
      activeTrackId: 'track-1',
      activeTaskId: 'task-1',
      attemptCount: 0,
      lastActivityAt: '2026-04-06T00:00:00.000Z',
    });
    conductorMocks.parsePlan
      .mockResolvedValueOnce({
        trackId: 'track-1',
        phases: [],
        tasks: [{ id: 'task-1', title: 'Do work', status: 'in_progress', substeps: [], isManualVerification: false, rawMarkdown: '' }],
      })
      .mockResolvedValueOnce({
        trackId: 'track-1',
        phases: [],
        tasks: [{ id: 'task-2', title: 'Next work', status: 'pending', substeps: [], isManualVerification: false, rawMarkdown: '' }],
      });

    const logs: string[] = [];
    const command = makeCommand(logs);
    await command.run();

    expect(conductorMocks.updateTaskStatus).toHaveBeenCalledWith('C:\\tmp\\plan.md', 'task-1', 'completed');
    expect(conductorMocks.updateTaskStatus).toHaveBeenCalledWith('C:\\tmp\\plan.md', 'task-2', 'in_progress');
    expect(stripAnsi(logs.join('\n'))).toContain('Task completion recorded');
  });
});
