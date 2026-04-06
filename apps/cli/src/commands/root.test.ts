import { beforeEach, describe, expect, it, vi } from 'vitest';

const localMocks = vi.hoisted(() => ({
  getActiveChunk: vi.fn(),
  getCompletionStats: vi.fn(),
  getNextPendingChunk: vi.fn(),
  isProjectInitialized: vi.fn(),
  loadPlanState: vi.fn(),
  loadProjectState: vi.fn(),
  renderChunkMarkdown: vi.fn(),
}));

const onboardingMocks = vi.hoisted(() => ({
  getAIConfigurationStatus: vi.fn(),
  getAuthStatus: vi.fn(),
}));

const stalenessMocks = vi.hoisted(() => ({
  detectStaleness: vi.fn(),
}));

vi.mock('../lib/local/index.js', () => localMocks);
vi.mock('../lib/onboarding.js', () => onboardingMocks);
vi.mock('../lib/staleness.js', () => stalenessMocks);

import Root from './root.js';

function runRootWith(runCommand: ReturnType<typeof vi.fn>): Promise<void> {
  const logs: string[] = [];
  return Root.prototype.run.call({
    parse: vi.fn().mockResolvedValue({ flags: { verbose: false } }),
    log: (message = '') => {
      logs.push(String(message));
    },
    config: {
      runCommand,
    },
  } as unknown as Root);
}

describe('root onboarding routing', () => {
  beforeEach(() => {
    onboardingMocks.getAuthStatus.mockResolvedValue({ isAuthenticated: true, reason: 'ok' });
    onboardingMocks.getAIConfigurationStatus.mockResolvedValue({ isValid: true, reason: 'ok' });
    localMocks.isProjectInitialized.mockResolvedValue(true);
    localMocks.loadPlanState.mockResolvedValue({
      version: 1,
      chunks: [{ id: 'chunk-001', title: 'Ship feature', prompt: 'Implement', status: 'active' }],
    });
    localMocks.loadProjectState.mockResolvedValue({
      name: 'Scrimble',
      goal: 'Ship runtime',
    });
    localMocks.getActiveChunk.mockReturnValue({
      id: 'chunk-001',
      title: 'Ship feature',
      prompt: 'Implement',
      status: 'active',
    });
    localMocks.getNextPendingChunk.mockReturnValue(undefined);
    localMocks.getCompletionStats.mockReturnValue({
      total: 1,
      completed: 0,
      skipped: 0,
      pending: 0,
      active: 1,
    });
    localMocks.renderChunkMarkdown.mockReturnValue('chunk markdown');
    stalenessMocks.detectStaleness.mockResolvedValue([]);
  });

  it('triggers login flow when user is logged out', async () => {
    onboardingMocks.getAuthStatus
      .mockResolvedValueOnce({ isAuthenticated: false, reason: 'missing_session' })
      .mockResolvedValueOnce({ isAuthenticated: true, reason: 'ok' });

    const runCommand = vi.fn().mockResolvedValue(undefined);
    await runRootWith(runCommand);

    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith('login');
  });

  it('triggers init flow when project is not initialized', async () => {
    localMocks.isProjectInitialized
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const runCommand = vi.fn().mockResolvedValue(undefined);
    await runRootWith(runCommand);

    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith('init');
  });

  it('triggers AI setup flow when AI config is incomplete', async () => {
    onboardingMocks.getAIConfigurationStatus
      .mockResolvedValueOnce({ isValid: false, reason: 'missing_api_key' })
      .mockResolvedValueOnce({ isValid: true, reason: 'ok' });

    const runCommand = vi.fn().mockResolvedValue(undefined);
    await runRootWith(runCommand);

    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith('config:set-ai');
  });

  it('triggers generate flow when no plan exists', async () => {
    localMocks.loadPlanState
      .mockResolvedValueOnce({ version: 1, chunks: [] })
      .mockResolvedValueOnce({
        version: 2,
        chunks: [{ id: 'chunk-001', title: 'Ship feature', prompt: 'Implement', status: 'active' }],
      });

    const runCommand = vi.fn().mockResolvedValue(undefined);
    await runRootWith(runCommand);

    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith('generate');
  });
});
