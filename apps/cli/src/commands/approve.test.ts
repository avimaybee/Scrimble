import { beforeEach, describe, expect, it, vi } from 'vitest';

const conductorMocks = vi.hoisted(() => ({
  loadConductorWorkspace: vi.fn(),
}));

const conductorRuntimeMocks = vi.hoisted(() => ({
  approveTrack: vi.fn(),
  isTrackApproved: vi.fn(),
  revokeTrackApproval: vi.fn(),
  loadApprovals: vi.fn(),
}));

const ledgerMocks = vi.hoisted(() => ({
  loadTasksState: vi.fn(),
  loadLedgerApprovalState: vi.fn(),
  saveLedgerApprovalState: vi.fn(),
}));

const telemetryMocks = vi.hoisted(() => ({
  recordTelemetry: vi.fn(),
}));

vi.mock('../lib/conductor/index.js', () => conductorMocks);
vi.mock('../lib/conductor/runtime.js', () => conductorRuntimeMocks);
vi.mock('../lib/ledger/storage.js', () => ledgerMocks);
vi.mock('../lib/telemetry.js', () => telemetryMocks);

import Approve from './approve.js';

function makeCommand(flags: Record<string, unknown>, args: Record<string, unknown>, logs: string[]): Approve {
  const command = Object.create(Approve.prototype) as Approve & {
    parse: ReturnType<typeof vi.fn>;
    log: (message?: string) => void;
    exit: (code?: number) => never;
  };
  command.parse = vi.fn().mockResolvedValue({ flags, args });
  command.log = (message = '') => {
    logs.push(String(message));
  };
  command.exit = (code?: number) => {
    throw new Error(`EXIT_${String(code ?? 0)}`);
  };
  return command as Approve;
}

describe('approve command local ledger flow', () => {
  beforeEach(() => {
    conductorMocks.loadConductorWorkspace.mockResolvedValue({
      exists: false,
      tracks: [],
    });
    conductorRuntimeMocks.loadApprovals.mockResolvedValue({ approvals: [] });
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
    ledgerMocks.loadLedgerApprovalState.mockResolvedValue({
      version: 1,
      approved: false,
      updatedAt: '2026-04-07T00:00:00.000Z',
    });
    ledgerMocks.saveLedgerApprovalState.mockResolvedValue(undefined);
    telemetryMocks.recordTelemetry.mockResolvedValue(undefined);
  });

  it('approves ledger execution when local tasks exist', async () => {
    const logs: string[] = [];
    const command = makeCommand(
      {
        reject: false,
        revoke: false,
        list: false,
        notes: undefined,
        'activate-first': true,
        scope: 'full',
      },
      {},
      logs,
    );
    await command.run();

    expect(ledgerMocks.saveLedgerApprovalState).toHaveBeenCalledWith(
      expect.objectContaining({ approved: true }),
      expect.any(String),
    );
    expect(logs.join('\n')).toContain('Ledger autonomous execution approved');
  });

  it('revokes ledger approval with --revoke', async () => {
    const logs: string[] = [];
    const command = makeCommand(
      {
        reject: false,
        revoke: true,
        list: false,
        notes: undefined,
        'activate-first': true,
        scope: 'full',
      },
      {},
      logs,
    );
    await command.run();

    expect(ledgerMocks.saveLedgerApprovalState).toHaveBeenCalledWith(
      expect.objectContaining({ approved: false }),
      expect.any(String),
    );
    expect(logs.join('\n')).toContain('approval revoked');
  });
});

