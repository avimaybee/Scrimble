import { beforeEach, describe, expect, it, vi } from 'vitest';

const taskMocks = vi.hoisted(() => ({
  getTaskProvider: vi.fn(),
}));

vi.mock('../lib/tasks/index.js', () => taskMocks);

import Prompt from './prompt.js';

function makeCommand(logs: string[]): Prompt {
  const command = Object.create(Prompt.prototype) as Prompt & {
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
  return command as Prompt;
}

describe('prompt command', () => {
  const provider = {
    getPromptPayload: vi.fn(),
  };

  beforeEach(() => {
    taskMocks.getTaskProvider.mockResolvedValue(provider);
  });

  it('prints empty-state message when no active prompt is available', async () => {
    provider.getPromptPayload.mockResolvedValue(null);

    const logs: string[] = [];
    const command = makeCommand(logs);
    await command.run();

    expect(logs.join('\n')).toContain('No active task context available');
  });

  it('prints current task prompt from provider payload', async () => {
    provider.getPromptPayload.mockResolvedValue({
      task: {
        id: 'task-1',
        title: 'Current task',
      },
      prompt: 'Implement the feature end-to-end.',
    });

    const logs: string[] = [];
    const command = makeCommand(logs);
    await command.run();

    expect(logs.join('\n')).toContain('Current task prompt');
    expect(logs.join('\n')).toContain('Implement the feature end-to-end.');
  });
});
