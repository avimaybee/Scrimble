import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrchestrationState, ScrimbleConfig } from '@scrimble/shared';

const renderMocks = vi.hoisted(() => ({
  render: vi.fn(),
}));

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

const discoveryMocks = vi.hoisted(() => ({
  loadDiscoveryBootstrap: vi.fn(),
}));

const ledgerStorageMocks = vi.hoisted(() => ({
  readLedger: vi.fn(),
}));

vi.mock('ink', () => renderMocks);
vi.mock('node:child_process', () => childProcessMocks);
vi.mock('../discovery/foundation.js', () => discoveryMocks);
vi.mock('../ledger/storage.js', () => ledgerStorageMocks);

import type { ConversationalOrchestrator } from '../agent/orchestrator.js';
import { buildStartupContext, runOperatorShell } from './run-operator-shell.js';

function createSessionState(): OrchestrationState {
  return {
    version: 1,
    sessionId: 'session-1',
    activeRun: {
      request: 'finish migration',
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      pendingBoundary: {
        id: 'boundary-1',
        action: 'execute_tasks',
        actionSummary: 'Start task execution',
        reason: 'Needs approval',
        scope: { parallel: 1, maxTasks: 1, args: {} },
        choices: ['proceed', 'pause', 'redirect'],
        requestedAt: '2026-01-01T00:00:00.000Z',
      },
      lastPauseReason: 'Waiting for approval',
    },
    lastRunOutcome: {
      status: 'paused',
      request: 'finish migration',
      summary: 'Paused for approval.',
      completedAt: '2026-01-01T00:00:00.000Z',
    },
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function createConfig(): ScrimbleConfig {
  return {
    schemaVersion: 2,
    activeProfileId: 'profile-openai',
    profiles: [
      {
        id: 'profile-openai',
        name: 'OpenAI profile',
        provider: 'openai',
        modelStrategy: 'explicit',
        model: 'gpt-4o',
        auth: {
          strategy: 'api_key',
          apiKey: 'sk-test',
        },
      },
    ],
    interactionMode: 'guide',
    plannerWorker: 'auto',
    workerPreferences: {
      defaultWorker: 'auto',
      allowParallel: false,
      maxParallelWorkers: 1,
    },
    executionDefaults: {
      worker: 'auto',
      timeoutSeconds: 300,
      maxParallelTasks: 1,
      maxRetriesPerTask: 1,
    },
    verificationDefaults: {
      enabled: true,
    },
  };
}

describe('runOperatorShell', () => {
  beforeEach(() => {
    renderMocks.render.mockReset();
    childProcessMocks.execFile.mockReset();
    childProcessMocks.execFile.mockImplementation(
      (_file: string, _args: string[], _opts: unknown, callback: (error: null, stdout: string, stderr: string) => void) => {
        callback(null, 'main\n', '');
      },
    );
    discoveryMocks.loadDiscoveryBootstrap.mockResolvedValue({
      requiresDiscovery: false,
      state: {
        status: 'approved',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      scan: {
        projectType: 'brownfield',
        repoName: 'Scrimble',
        repoPath: 'D:\\vs code\\Scrimble',
        branch: 'main',
        languages: ['TypeScript'],
        frameworks: ['Ink'],
        packageManager: 'pnpm',
        configSummary: [],
        hasScrimbleDir: true,
        hasConductorArtifacts: false,
        conductorArtifacts: [],
      },
      currentIntent: null,
    });
    ledgerStorageMocks.readLedger.mockResolvedValue({
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      tasks: {
        version: 1,
        tasks: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      runtime: {
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      workers: {
        version: 1,
        workers: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      intent: {
        version: 1,
        intent: null,
        discovery: {
          status: 'approved',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        history: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      approval: {
        version: 1,
        approved: false,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      orchestration: createSessionState(),
    });
    renderMocks.render.mockReturnValue({
      waitUntilExit: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('builds startup context with active run details', async () => {
    const startup = await buildStartupContext({
      cwd: 'D:\\vs code\\Scrimble',
      interactionMode: 'operator',
      config: createConfig(),
      session: createSessionState(),
    });

    expect(startup.activeRunRequest).toBe('finish migration');
    expect(startup.pendingBoundary?.action).toBe('execute_tasks');
    expect(startup.recoveryState).toBe('pending_approval');
  });

  it('renders OperatorShell and waits for app exit', async () => {
    const orchestrator = {
      loadSessionState: vi.fn().mockResolvedValue(createSessionState()),
      runRequest: vi.fn(),
      resumeActiveRun: vi.fn(),
    } as unknown as ConversationalOrchestrator;

    await runOperatorShell({
      cwd: 'D:\\vs code\\Scrimble',
      orchestrator,
      interactionMode: 'balanced',
      setupSeed: { interactionMode: 'balanced' },
      autoConfirm: false,
      verbose: true,
      config: createConfig(),
    });

    expect(renderMocks.render).toHaveBeenCalledTimes(1);
    const [element] = renderMocks.render.mock.calls[0] as [{ props: Record<string, unknown> }];
    expect(element.props['startup']).toMatchObject({
      activeRunRequest: 'finish migration',
      mode: 'balanced',
    });
  });
});
