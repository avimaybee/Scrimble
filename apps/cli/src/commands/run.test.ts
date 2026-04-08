import { describe, expect, it, vi } from 'vitest';

const supervisorMocks = vi.hoisted(() => ({
  run: vi.fn(),
}));

vi.mock('../lib/scheduler/supervisor.js', () => ({
  LedgerSupervisor: class {
    run = supervisorMocks.run;
  },
}));

import Run from './run.js';

function makeCommand(flags: {
  worker: 'auto' | 'gemini' | 'copilot';
  parallel: number;
  timeout: number;
  'max-tasks': number;
  json: boolean;
}, logs: string[]): Run {
  const command = Object.create(Run.prototype) as Run & {
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
  return command as Run;
}

describe('run command', () => {
  it('runs supervisor and prints summary', async () => {
    supervisorMocks.run.mockResolvedValue({
      completedTaskIds: ['task-1'],
      failedTaskIds: [],
      conflictedTaskIds: [],
      retriedTaskIds: [],
      skippedTaskIds: [],
    });

    const logs: string[] = [];
    const command = makeCommand(
      {
        worker: 'auto',
        parallel: 1,
        timeout: 300,
        'max-tasks': 0,
        json: false,
      },
      logs,
    );
    await command.run();

    expect(supervisorMocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        worker: 'auto',
        parallel: 1,
        timeoutMs: 300000,
      }),
    );
    expect(logs.join('\n')).toContain('Run Summary');
    expect(logs.join('\n')).toContain('completed: 1');
  });

  it('exits non-zero when failures are present', async () => {
    supervisorMocks.run.mockResolvedValue({
      completedTaskIds: [],
      failedTaskIds: ['task-1'],
      conflictedTaskIds: [],
      retriedTaskIds: [],
      skippedTaskIds: [],
    });

    const logs: string[] = [];
    const command = makeCommand(
      {
        worker: 'auto',
        parallel: 1,
        timeout: 300,
        'max-tasks': 0,
        json: false,
      },
      logs,
    );

    await expect(command.run()).rejects.toThrow('EXIT_1');
    expect(logs.join('\n')).toContain('Failed tasks: task-1');
  });
});

