import { beforeEach, describe, expect, it, vi } from 'vitest';

const taskMocks = vi.hoisted(() => ({
  getTaskProvider: vi.fn(),
}));

vi.mock('../lib/tasks/index.js', () => taskMocks);

import Skip from './skip.js';

function makeCommand(flags: Record<string, unknown>, logs: string[]): Skip {
  const command = Object.create(Skip.prototype) as Skip & {
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
  return command as Skip;
}

describe('skip command', () => {
  const provider = {
    skipTask: vi.fn(),
  };

  beforeEach(() => {
    taskMocks.getTaskProvider.mockResolvedValue(provider);
    provider.skipTask.mockResolvedValue(null);
  });

  it('requires --ack-risk', async () => {
    const logs: string[] = [];
    const command = makeCommand(
      {
        reason: 'blocked',
        'ack-risk': false,
      },
      logs,
    );

    await expect(command.run()).rejects.toThrow('EXIT_1');
    expect(taskMocks.getTaskProvider).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Skipping requires explicit risk acknowledgement');
  });

  it('records skip via task provider', async () => {
    provider.skipTask.mockResolvedValue({
      skippedTask: {
        id: 'task-1',
        title: 'Current task',
      },
      nextTask: {
        id: 'task-2',
        title: 'Next task',
      },
    });

    const logs: string[] = [];
    const command = makeCommand(
      {
        reason: 'blocked by API outage',
        'ack-risk': true,
      },
      logs,
    );

    await command.run();

    expect(provider.skipTask).toHaveBeenCalledWith('blocked by API outage');
    expect(logs.join('\n')).toContain('Skipped: Current task');
    expect(logs.join('\n')).toContain('Activated next: Next task');
  });
});
