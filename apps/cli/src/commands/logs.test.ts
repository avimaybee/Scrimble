import { beforeEach, describe, expect, it, vi } from 'vitest';

const ledgerRecordMocks = vi.hoisted(() => ({
  readLedgerEvents: vi.fn(),
}));

const migrationMocks = vi.hoisted(() => ({
  migrateLegacyLedgerIfPresent: vi.fn(),
}));

vi.mock('../lib/ledger/records.js', () => ledgerRecordMocks);
vi.mock('../lib/ledger/legacy-migration.js', () => migrationMocks);

import Logs from './logs.js';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function makeCommand(flags: {
  type?: string;
  since?: string;
  limit: number;
  follow: boolean;
  'poll-interval-ms': number;
  json: boolean;
}, output: string[]): Logs {
  const command = Object.create(Logs.prototype) as Logs & {
    parse: ReturnType<typeof vi.fn>;
    log: (message?: string) => void;
    exit: (code?: number) => never;
  };
  command.parse = vi.fn().mockResolvedValue({ flags });
  command.log = (message = '') => {
    output.push(String(message));
  };
  command.exit = (code?: number) => {
    throw new Error(`EXIT_${String(code ?? 0)}`);
  };
  return command as Logs;
}

describe('logs command', () => {
  beforeEach(() => {
    migrationMocks.migrateLegacyLedgerIfPresent.mockReset();
    migrationMocks.migrateLegacyLedgerIfPresent.mockResolvedValue('not_needed');
    ledgerRecordMocks.readLedgerEvents.mockResolvedValue([
      {
        id: 'evt-2',
        type: 'task_completed',
        data: { taskId: 'task-1', worker: 'gemini' },
        timestamp: '2026-04-06T08:00:00.000Z',
      },
      {
        id: 'evt-1',
        type: 'run_started',
        data: { worker: 'auto' },
        timestamp: '2026-04-06T07:59:00.000Z',
      },
    ]);
  });

  it('prints human-readable local event lines', async () => {
    const output: string[] = [];
    const command = makeCommand(
      {
        limit: 40,
        follow: false,
        'poll-interval-ms': 2000,
        json: false,
      },
      output,
    );

    await command.run();

    const text = stripAnsi(output.join('\n'));
    expect(text).toContain('task_completed');
    expect(text).toContain('run_started');
    expect(text).toContain('taskId=task-1');
  });

  it('prints JSON payload when --json is enabled', async () => {
    const output: string[] = [];
    const command = makeCommand(
      {
        limit: 10,
        follow: false,
        'poll-interval-ms': 2000,
        json: true,
      },
      output,
    );

    await command.run();

    const payload = JSON.parse(output.join('\n')) as {
      localEvents: unknown[];
    };
    expect(payload.localEvents.length).toBe(2);
  });
});

