import { beforeEach, describe, expect, it, vi } from 'vitest';

const taskMocks = vi.hoisted(() => ({
  getTaskProvider: vi.fn(),
}));

vi.mock('../lib/tasks/index.js', () => taskMocks);

import Next from './next.js';

function makeCommand(logs: string[]): Next {
  const command = Object.create(Next.prototype) as Next & {
    parse: ReturnType<typeof vi.fn>;
    log: (message?: string) => void;
    exit: (code?: number) => never;
  };
  command.parse = vi.fn().mockResolvedValue({ flags: {} });
  command.log = (message = '') => {
    logs.push(String(message));
  };
  command.exit = (code?: number) => {
    throw new Error(`EXIT_${String(code ?? 0)}`);
  };
  return command as Next;
}

describe('next command', () => {
  const provider = {
    activateNextTask: vi.fn(),
  };

  beforeEach(() => {
    taskMocks.getTaskProvider.mockResolvedValue(provider);
  });

  it('shows already-active task when one exists', async () => {
    provider.activateNextTask.mockResolvedValue({
      alreadyActiveTask: {
        id: 'task-1',
        title: 'Current task',
      },
    });

    const logs: string[] = [];
    const command = makeCommand(logs);
    await command.run();

    expect(logs.join('\n')).toContain('Task already active: Current task');
  });

  it('activates next task when available', async () => {
    provider.activateNextTask.mockResolvedValue({
      activatedTask: {
        id: 'task-2',
        title: 'Next task',
      },
    });

    const logs: string[] = [];
    const command = makeCommand(logs);
    await command.run();

    expect(logs.join('\n')).toContain('Activated: Next task');
  });
});
