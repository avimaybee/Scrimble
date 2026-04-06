import { beforeEach, describe, expect, it, vi } from 'vitest';

const conductorMocks = vi.hoisted(() => ({
  loadConductorWorkspace: vi.fn(),
}));

vi.mock('../conductor/index.js', () => conductorMocks);

import { getTaskProvider } from './factory.js';

describe('task provider factory', () => {
  beforeEach(() => {
    conductorMocks.loadConductorWorkspace.mockReset();
  });

  it('returns conductor provider when conductor workspace exists', async () => {
    conductorMocks.loadConductorWorkspace.mockResolvedValue({
      exists: true,
      tracks: [],
    });

    const provider = await getTaskProvider('C:\\repo');
    expect(provider.kind).toBe('conductor');
  });

  it('returns legacy provider when conductor workspace is absent', async () => {
    conductorMocks.loadConductorWorkspace.mockResolvedValue({
      exists: false,
      tracks: [],
    });

    const provider = await getTaskProvider('C:\\repo');
    expect(provider.kind).toBe('legacy');
  });
});
