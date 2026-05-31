import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('node:child_process', () => childProcessMocks);

import { runGeminiHeadless } from './session.js';

interface FakeProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
}

function createFakeProcess(): FakeProcess {
  const proc = new EventEmitter() as FakeProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = vi.fn().mockImplementation(() => {
    proc.killed = true;
    return true;
  });
  return proc;
}

describe('runGeminiHeadless', () => {
  beforeEach(() => {
    childProcessMocks.spawn.mockReset();
  });

  it('uses documented prompt flag and default automation flags', async () => {
    const proc = createFakeProcess();
    childProcessMocks.spawn.mockReturnValue(proc);

    const responsePromise = runGeminiHeadless('Explain this repository', {
      outputFormat: 'text',
      timeout: 0,
    });

    proc.emit('close', 0, null);
    await responsePromise;

    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      'gemini',
      ['-p', 'Explain this repository', '--approval-mode=yolo', '--output-format=text', '--checkpointing'],
      expect.objectContaining({
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );
  });
});
