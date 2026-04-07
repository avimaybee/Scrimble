import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerMocks = vi.hoisted(() => ({
  getWorkerDriver: vi.fn(),
}));

vi.mock('../lib/workers/index.js', () => workerMocks);

import Workers from './workers.js';

function makeCommand(logs: string[], flags: Record<string, unknown> = {}): Workers {
  const command = Object.create(Workers.prototype) as Workers & {
    parse: ReturnType<typeof vi.fn>;
    log: (message?: string) => void;
    exit: (code?: number) => never;
  };
  command.parse = vi.fn().mockResolvedValue({ flags });
  command.log = (message = '') => logs.push(String(message));
  command.exit = (code?: number) => {
    throw new Error(`EXIT_${String(code ?? 0)}`);
  };
  return command as Workers;
}

describe('workers command', () => {
  beforeEach(() => {
    workerMocks.getWorkerDriver.mockImplementation((worker: 'gemini' | 'copilot') => ({
      kind: worker,
      preflight: vi.fn().mockResolvedValue({
        worker,
        available: worker === 'gemini',
        authConfigured: true,
        warnings: [],
        errors: worker === 'gemini' ? [] : ['missing auth'],
      }),
      capabilities: vi.fn().mockReturnValue({
        supportedTaskTypes: ['code_modification'],
        maxParallelTasks: 1,
        supportsCheckpointing: worker === 'gemini',
        supportsContinuation: true,
        supportsJsonOutput: true,
      }),
    }));
  });

  it('renders worker status output', async () => {
    const logs: string[] = [];
    const command = makeCommand(logs);
    await command.run();
    const output = logs.join('\n');
    expect(output).toContain('Worker Status');
    expect(output).toContain('gemini');
    expect(output).toContain('copilot');
  });

  it('prints json payload when --json is set', async () => {
    const logs: string[] = [];
    const command = makeCommand(logs, { json: true });
    await command.run();
    expect(logs[0]).toContain('"worker": "gemini"');
  });
});

