import { beforeEach, describe, expect, it, vi } from 'vitest';

const taskMocks = vi.hoisted(() => ({
  getTaskProvider: vi.fn(),
}));

vi.mock('../lib/tasks/index.js', () => taskMocks);

import Done from './done.js';

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

describe('done command', () => {
  beforeEach(() => {
    taskMocks.getTaskProvider.mockResolvedValue({
      completeTask: vi.fn().mockResolvedValue({
        completedTask: { id: 'task-1', title: 'Task One' },
        nextTask: { id: 'task-2', title: 'Task Two' },
      }),
    });
  });

  it('records completion and prints next task', async () => {
    const logs: string[] = [];
    const command = makeCommand(logs);
    await command.run();
    expect(logs.join('\n')).toContain('Task completion recorded.');
    expect(logs.join('\n')).toContain('Next active: Task Two');
  });

  it('prints no-active-task message when provider returns null', async () => {
    taskMocks.getTaskProvider.mockResolvedValue({
      completeTask: vi.fn().mockResolvedValue(null),
    });
    const logs: string[] = [];
    const command = makeCommand(logs);
    await command.run();
    expect(logs.join('\n')).toContain('No active task available to complete.');
  });
});

