import { beforeEach, describe, expect, it, vi } from 'vitest';

const ledgerMocks = vi.hoisted(() => ({
  getTask: vi.fn(),
  leaseTask: vi.fn(),
  acquireFileLease: vi.fn(),
}));

vi.mock('../lib/ledger/operations.js', () => ledgerMocks);

import Assign from './assign.js';

function makeCommand(logs: string[], flags: Record<string, unknown>): Assign {
  const command = Object.create(Assign.prototype) as Assign & {
    parse: ReturnType<typeof vi.fn>;
    log: (message?: string) => void;
    exit: (code?: number) => never;
  };
  command.parse = vi.fn().mockResolvedValue({ flags });
  command.log = (message = '') => logs.push(String(message));
  command.exit = (code?: number) => {
    throw new Error(`EXIT_${String(code ?? 0)}`);
  };
  return command as Assign;
}

describe('assign command', () => {
  beforeEach(() => {
    ledgerMocks.getTask.mockReset();
    ledgerMocks.leaseTask.mockReset();
    ledgerMocks.acquireFileLease.mockReset();
  });

  it('exits when task is missing', async () => {
    ledgerMocks.getTask.mockResolvedValue(null);
    const logs: string[] = [];
    const command = makeCommand(logs, { task: 'missing', worker: 'gemini', force: false });
    await expect(command.run()).rejects.toThrow('EXIT_1');
  });

  it('assigns and leases files for task', async () => {
    ledgerMocks.getTask.mockResolvedValue({
      id: 'task-1',
      title: 'Task 1',
      ownedFiles: ['src/a.ts'],
    });

    const logs: string[] = [];
    const command = makeCommand(logs, { task: 'task-1', worker: 'gemini', force: false });
    await command.run();

    expect(ledgerMocks.leaseTask).toHaveBeenCalledWith('task-1', 'gemini', { force: false });
    expect(ledgerMocks.acquireFileLease).toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Assigned Task 1 to gemini');
  });
});

