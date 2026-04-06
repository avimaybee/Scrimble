import { describe, expect, it, vi } from 'vitest';
import ImportCommand from './import.js';

function makeCommand(
  flags: {
    goal?: string;
    force: boolean;
    'ai-provider'?: string;
    'ai-model'?: string;
    'from-cloud': boolean;
    'project-id'?: string;
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
        'from-cloud': true,
        'project-id': 'repo-name',
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
      '--project-id',
      'repo-name',
      '--skip-preflight',
      '--from-cloud',
    ]);
    expect(logs.join('\n')).toContain('alias for `scrimble init`');
  });

  it('forwards no-cloud flag explicitly when disabled', async () => {
    const runCommand = vi.fn().mockResolvedValue(undefined);
    const logs: string[] = [];
    const command = makeCommand(
      {
        force: false,
        'from-cloud': false,
        'skip-preflight': false,
      },
      runCommand,
      logs,
    );

    await command.run();

    expect(runCommand).toHaveBeenCalledWith('init', ['--no-from-cloud']);
  });
});
