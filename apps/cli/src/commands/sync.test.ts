import { describe, expect, it, vi } from 'vitest';
import Sync from './sync.js';

describe('sync command compatibility shim', () => {
  it('prints local-first migration guidance', async () => {
    const logs: string[] = [];
    const command = Object.create(Sync.prototype) as Sync & {
      log: (message?: string) => void;
    };
    command.log = (message = '') => {
      logs.push(String(message));
    };

    await command.run();

    expect(logs.join('\n')).toContain('Scrimble is local-first');
    expect(logs.join('\n')).toContain('no Scrimble sync');
  });
});

