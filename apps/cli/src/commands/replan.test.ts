import { describe, expect, it, vi } from 'vitest';
import Replan from './replan.js';

describe('replan command alias behavior', () => {
  it('forwards request to generate --replan', async () => {
    const runCommand = vi.fn().mockResolvedValue(undefined);
    const command = Object.create(Replan.prototype) as Replan & {
      parse: ReturnType<typeof vi.fn>;
      config: { runCommand: ReturnType<typeof vi.fn> };
    };
    command.parse = vi.fn().mockResolvedValue({
      flags: { request: 'Update scope' },
    });
    Object.defineProperty(command, 'config', {
      value: { runCommand },
      writable: true,
    });

    await command.run();

    expect(runCommand).toHaveBeenCalledWith('generate', ['--goal', 'Update scope', '--replan']);
  });
});

