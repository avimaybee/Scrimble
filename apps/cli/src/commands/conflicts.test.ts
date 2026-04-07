import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  loadTasksState: vi.fn(),
  loadAssignmentsState: vi.fn(),
  loadFileLeasesState: vi.fn(),
}));

vi.mock('../lib/ledger/storage.js', () => storageMocks);

import Conflicts from './conflicts.js';

function makeCommand(logs: string[]): Conflicts {
  const command = Object.create(Conflicts.prototype) as Conflicts & {
    parse: ReturnType<typeof vi.fn>;
    log: (message?: string) => void;
    exit: (code?: number) => never;
  };
  command.parse = vi.fn().mockResolvedValue({ flags: {} });
  command.log = (message = '') => logs.push(String(message));
  command.exit = (code?: number) => {
    throw new Error(`EXIT_${String(code ?? 0)}`);
  };
  return command as Conflicts;
}

describe('conflicts command', () => {
  beforeEach(() => {
    storageMocks.loadTasksState.mockReset();
    storageMocks.loadAssignmentsState.mockReset();
    storageMocks.loadFileLeasesState.mockReset();
  });

  it('shows empty state when no conflicts exist', async () => {
    storageMocks.loadTasksState.mockResolvedValue({ tasks: [] });
    storageMocks.loadAssignmentsState.mockResolvedValue({ assignments: [] });
    storageMocks.loadFileLeasesState.mockResolvedValue({ leases: [] });

    const logs: string[] = [];
    const command = makeCommand(logs);
    await command.run();
    expect(logs.join('\n')).toContain('No conflicts detected');
  });

  it('lists blocked tasks with details', async () => {
    storageMocks.loadTasksState.mockResolvedValue({
      tasks: [{ id: 'task-1', title: 'Task 1', status: 'blocked', error: 'Lease violation' }],
    });
    storageMocks.loadAssignmentsState.mockResolvedValue({ assignments: [] });
    storageMocks.loadFileLeasesState.mockResolvedValue({
      leases: [{ taskId: 'task-1', worker: 'gemini', paths: ['src/a.ts'] }],
    });

    const logs: string[] = [];
    const command = makeCommand(logs);
    await command.run();
    const output = logs.join('\n');
    expect(output).toContain('Conflicts');
    expect(output).toContain('task-1');
    expect(output).toContain('Lease violation');
  });
});

