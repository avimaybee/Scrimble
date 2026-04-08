import { beforeEach, describe, expect, it, vi } from 'vitest';

const conductorMocks = vi.hoisted(() => ({
  loadConductorWorkspace: vi.fn(),
}));

const ledgerMocks = vi.hoisted(() => ({
  loadTasksState: vi.fn(),
}));

vi.mock('../conductor/index.js', () => conductorMocks);
vi.mock('../ledger/storage.js', () => ledgerMocks);

import { getTaskProvider } from './factory.js';

describe('task provider factory', () => {
  beforeEach(() => {
    conductorMocks.loadConductorWorkspace.mockReset();
    ledgerMocks.loadTasksState.mockReset();
    ledgerMocks.loadTasksState.mockResolvedValue({
      version: 1,
      tasks: [],
      updatedAt: '2026-04-07T00:00:00.000Z',
    });
  });

  it('returns ledger provider when ledger tasks exist', async () => {
    ledgerMocks.loadTasksState.mockResolvedValue({
      version: 1,
      tasks: [
        {
          id: 'task-1',
          title: 'Task 1',
          objective: 'Do task',
          doneCriteria: 'Done',
          ownedFiles: [],
          allowedFiles: [],
          verificationCommands: [],
          dependencies: [],
          riskScore: 5,
          status: 'pending',
          createdAt: '2026-04-07T00:00:00.000Z',
          updatedAt: '2026-04-07T00:00:00.000Z',
          attemptCount: 0,
          maxRetries: 1,
        },
      ],
      updatedAt: '2026-04-07T00:00:00.000Z',
    });

    const provider = await getTaskProvider('C:\\repo');
    expect(provider.kind).toBe('ledger');
  });

  it('returns conductor provider when conductor workspace exists', async () => {
    conductorMocks.loadConductorWorkspace.mockResolvedValue({
      exists: true,
      tracks: [],
    });

    const provider = await getTaskProvider('C:\\repo');
    expect(provider.kind).toBe('conductor');
  });

  it('returns legacy provider when conductor workspace is absent', async () => {
    conductorMocks.loadConductorWorkspace.mockResolvedValue({
      exists: false,
      tracks: [],
    });

    const provider = await getTaskProvider('C:\\repo');
    expect(provider.kind).toBe('legacy');
  });
});
