import { describe, expect, it, vi } from 'vitest';
import ImportCommand from './import.js';

function makeCommand(
  flags: {
    goal?: string;
    force: boolean;
    'ai-provider'?: string;
    'ai-model'?: string;
    'skip-preflight': boolean;
  },
  runCommand: ReturnType<typeof vi.fn>,
  logs: string[],
): ImportCommand {
  const command = Object.create(ImportCommand.prototype) as ImportCommand & {
    parse: ReturnType<typeof vi.fn>;
    log: (message?: string) => void;
    config: { runCommand: ReturnType<typeof vi.fn> };
  };

  command.parse = vi.fn().mockResolvedValue({ flags });
  command.log = (message = '') => {
    logs.push(String(message));
  };
  Object.defineProperty(command, 'config', {
    value: { runCommand },
    writable: true,
  });
  return command as ImportCommand;
}

describe('import command alias behavior', () => {
  it('forwards to init command with mapped flags', async () => {
    const runCommand = vi.fn().mockResolvedValue(undefined);
    const logs: string[] = [];
    const command = makeCommand(
      {
        goal: 'Ship smart onboarding',
        force: true,
        'ai-provider': 'openai',
        'ai-model': 'gpt-5',
        'skip-preflight': true,
      },
      runCommand,
      logs,
    );

    await command.run();

    expect(runCommand).toHaveBeenCalledWith('init', [
      '--goal',
      'Ship smart onboarding',
      '--force',
      '--ai-provider',
      'openai',
      '--ai-model',
      'gpt-5',
      '--skip-preflight',
    ]);
    expect(logs.join('\n')).toContain('alias for `scrimble init`');
  });
});
