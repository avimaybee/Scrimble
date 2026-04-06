import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  formatCloudError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  listProjectEvents: vi.fn(),
  resolveCloudClientConfig: vi.fn(),
}));

const runtimeMocks = vi.hoisted(() => ({
  readRuntimeEvents: vi.fn(),
}));

vi.mock('../lib/api/index.js', () => apiMocks);
vi.mock('../lib/conductor/runtime.js', () => runtimeMocks);

import Logs from './logs.js';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function makeCommand(flags: {
  source: 'all' | 'local' | 'cloud';
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
    runtimeMocks.readRuntimeEvents.mockResolvedValue([]);
    apiMocks.resolveCloudClientConfig.mockResolvedValue({
      baseUrl: 'https://api.scrimble.dev',
      projectId: 'project-1',
      accessToken: 'token',
    });
    apiMocks.listProjectEvents.mockResolvedValue([
      {
        id: 'evt-2',
        projectId: 'project-1',
        type: 'generation_step_retrying',
        data: { runId: 'run-1', step: 'generate_chunks', attempt: 2 },
        createdAt: '2026-04-06T08:00:00.000Z',
      },
      {
        id: 'evt-1',
        projectId: 'project-1',
        type: 'chunk_completed',
        data: { chunkId: 'chunk-002' },
        createdAt: '2026-04-06T07:59:00.000Z',
      },
    ]);
  });

  it('prints human-readable cloud event lines', async () => {
    const output: string[] = [];
    const command = makeCommand(
      {
        limit: 40,
        source: 'all',
        follow: false,
        'poll-interval-ms': 2000,
        json: false,
      },
      output,
    );

    await command.run();

    const text = stripAnsi(output.join('\n'));
    expect(text).toContain('chunk_completed');
    expect(text).toContain('generation_step_retrying');
    expect(text).toContain('runId=run-1');
  });

  it('prints JSON payload when --json is enabled', async () => {
    const output: string[] = [];
    const command = makeCommand(
      {
        limit: 10,
        source: 'all',
        follow: false,
        'poll-interval-ms': 2000,
        json: true,
      },
      output,
    );

    await command.run();

    const payload = JSON.parse(output.join('\n')) as {
      projectId: string;
      localEvents: unknown[];
      cloudEvents: unknown[];
    };
    expect(payload.projectId).toBe('project-1');
    expect(payload.localEvents.length).toBe(0);
    expect(payload.cloudEvents.length).toBe(2);
  });
});
