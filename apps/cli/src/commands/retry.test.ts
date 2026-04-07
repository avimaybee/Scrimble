import { beforeEach, describe, expect, it, vi } from 'vitest';

const ledgerMocks = vi.hoisted(() => ({
  getTask: vi.fn(),
  releaseTask: vi.fn(),
}));

vi.mock('../lib/ledger/operations.js', () => ledgerMocks);

import Retry from './retry.js';

function makeCommand(logs: string[], flags: Record<string, unknown>): Retry {
  const command = Object.create(Retry.prototype) as Retry & {
    parse: ReturnType<typeof vi.fn>;
    log: (message?: string) => void;
    exit: (code?: number) => never;
  };
  command.parse = vi.fn().mockResolvedValue({ flags });
  command.log = (message = '') => logs.push(String(message));
  command.exit = (code?: number) => {
    throw new Error(`EXIT_${String(code ?? 0)}`);
  };
  return command as Retry;
}

describe('retry command', () => {
  beforeEach(() => {
    ledgerMocks.getTask.mockReset();
    ledgerMocks.releaseTask.mockReset();
  });

  it('warns when task is not retryable', async () => {
    ledgerMocks.getTask.mockResolvedValue({
      id: 'task-1',
      title: 'Task 1',
      status: 'pending',
    });
    const logs: string[] = [];
    const command = makeCommand(logs, { task: 'task-1' });
    await command.run();
    expect(logs.join('\n')).toContain('retry is only for failed/blocked tasks');
  });

  it('resets failed task to pending', async () => {
    ledgerMocks.getTask.mockResolvedValue({
      id: 'task-2',
      title: 'Task 2',
      status: 'failed',
    });
    const logs: string[] = [];
    const command = makeCommand(logs, { task: 'task-2' });
    await command.run();
    expect(ledgerMocks.releaseTask).toHaveBeenCalledWith('task-2', { toStatus: 'pending' });
    expect(logs.join('\n')).toContain('Task reset to pending');
  });
});

