import { beforeEach, describe, expect, it, vi } from 'vitest';

const localMocks = vi.hoisted(() => ({
  appendActivity: vi.fn(),
}));

const configMocks = vi.hoisted(() => ({
  loadScrimbleConfig: vi.fn(),
}));

const planningIntentMocks = vi.hoisted(() => ({
  captureIntent: vi.fn(),
}));

const planningGeneratorMocks = vi.hoisted(() => ({
  generateTaskGraph: vi.fn(),
}));

const stackMocks = vi.hoisted(() => ({
  detectStack: vi.fn(),
}));

const workerFactoryMocks = vi.hoisted(() => ({
  getWorkerDriver: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  loadLedgerApprovalState: vi.fn(),
  loadTasksState: vi.fn(),
  loadAssignmentsState: vi.fn(),
  loadFileLeasesState: vi.fn(),
  saveLedgerApprovalState: vi.fn(),
  saveTasksState: vi.fn(),
  saveAssignmentsState: vi.fn(),
  saveFileLeasesState: vi.fn(),
}));

const recordMocks = vi.hoisted(() => ({
  appendLedgerEvent: vi.fn(),
}));

const telemetryMocks = vi.hoisted(() => ({
  recordTelemetry: vi.fn(),
}));

vi.mock('../lib/local/index.js', () => localMocks);
vi.mock('../lib/config/load-config.js', () => configMocks);
vi.mock('../lib/planning/intent.js', () => planningIntentMocks);
vi.mock('../lib/planning/generator.js', () => planningGeneratorMocks);
vi.mock('../lib/init/stack-detection.js', () => stackMocks);
vi.mock('../lib/workers/factory.js', () => workerFactoryMocks);
vi.mock('../lib/ledger/storage.js', () => storageMocks);
vi.mock('../lib/ledger/records.js', () => recordMocks);
vi.mock('../lib/telemetry.js', () => telemetryMocks);

import Generate from './generate.js';

function makeGeneratedTask(id: string, status: 'pending' | 'completed' = 'pending') {
  return {
    id,
    title: id,
    objective: id,
    doneCriteria: id,
    ownedFiles: [],
    allowedFiles: [],
    verificationCommands: [],
    dependencies: [],
    riskScore: 4,
    status,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    attemptCount: 0,
    maxRetries: 1,
  };
}

describe('generate command local-first flow', () => {
  beforeEach(() => {
    localMocks.appendActivity.mockResolvedValue(undefined);
    configMocks.loadScrimbleConfig.mockResolvedValue({
      schemaVersion: 1,
      ai: {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: '${OPENAI_API_KEY}',
      },
      workerPreferences: {
        defaultWorker: 'gemini',
        allowParallel: false,
        maxParallelWorkers: 1,
      },
    });
    planningIntentMocks.captureIntent.mockResolvedValue({
      id: 'intent-1',
      goal: 'Ship runtime',
      productAssumptions: [],
      constraints: [],
      successCriteria: [],
      outOfScope: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    planningGeneratorMocks.generateTaskGraph.mockReturnValue({
      graph: {
        intentId: 'intent-1',
        tasks: [makeGeneratedTask('task-1'), makeGeneratedTask('task-2')],
        edges: [],
        phases: [],
        generatedAt: '2024-01-01T00:00:00.000Z',
        metadata: {
          totalComplexity: 8,
          parallelGroups: 1,
          criticalPathLength: 2,
          contextSourcesUsed: [],
        },
      },
      warnings: [],
      suggestions: [],
    });
    stackMocks.detectStack.mockResolvedValue({
      languages: ['typescript'],
      frameworks: ['hono'],
      packageManagers: [],
      buildTools: [],
      testFrameworks: [],
      hasDocker: false,
    });
    workerFactoryMocks.getWorkerDriver.mockImplementation(() => ({
      preflight: vi.fn().mockResolvedValue({ available: true, warnings: [], errors: [] }),
      discoverContextArtifacts: vi.fn().mockResolvedValue([]),
    }));
    storageMocks.loadTasksState.mockResolvedValue({ version: 1, tasks: [], updatedAt: '2024-01-01T00:00:00.000Z' });
    storageMocks.loadLedgerApprovalState.mockResolvedValue({
      version: 1,
      approved: false,
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    storageMocks.loadAssignmentsState.mockResolvedValue({
      version: 1,
      assignments: [],
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    storageMocks.loadFileLeasesState.mockResolvedValue({
      version: 1,
      leases: [],
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    storageMocks.saveTasksState.mockResolvedValue(undefined);
    storageMocks.saveLedgerApprovalState.mockResolvedValue(undefined);
    storageMocks.saveAssignmentsState.mockResolvedValue(undefined);
    storageMocks.saveFileLeasesState.mockResolvedValue(undefined);
    recordMocks.appendLedgerEvent.mockResolvedValue(undefined);
    telemetryMocks.recordTelemetry.mockResolvedValue(undefined);
  });

  it('generates local ledger tasks and resets assignments + leases', async () => {
    await Generate.prototype.run.call({
      parse: vi.fn().mockResolvedValue({
        flags: { goal: 'Ship runtime', replan: false },
        argv: [],
      }),
      log: vi.fn(),
    } as unknown as Generate);

    expect(storageMocks.saveTasksState).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [expect.objectContaining({ id: 'task-1' }), expect.objectContaining({ id: 'task-2' })],
      }),
      expect.any(String),
    );
    expect(storageMocks.saveAssignmentsState).toHaveBeenCalledWith(
      expect.objectContaining({ assignments: [] }),
      expect.any(String),
    );
    expect(storageMocks.saveFileLeasesState).toHaveBeenCalledWith(
      expect.objectContaining({ leases: [] }),
      expect.any(String),
    );
    expect(storageMocks.saveLedgerApprovalState).toHaveBeenCalledWith(
      expect.objectContaining({ approved: false }),
      expect.any(String),
    );
  });

  it('preserves completed tasks during replan', async () => {
    storageMocks.loadTasksState.mockResolvedValue({
      version: 1,
      tasks: [makeGeneratedTask('done-1', 'completed'), makeGeneratedTask('old-2', 'pending')],
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    planningGeneratorMocks.generateTaskGraph.mockReturnValue({
      graph: {
        intentId: 'intent-1',
        tasks: [makeGeneratedTask('new-1'), makeGeneratedTask('new-2')],
        edges: [],
        phases: [],
        generatedAt: '2024-01-01T00:00:00.000Z',
        metadata: {
          totalComplexity: 8,
          parallelGroups: 1,
          criticalPathLength: 2,
          contextSourcesUsed: [],
        },
      },
      warnings: [],
      suggestions: [],
    });

    await Generate.prototype.run.call({
      parse: vi.fn().mockResolvedValue({
        flags: { goal: 'Ship runtime', replan: true },
        argv: [],
      }),
      log: vi.fn(),
    } as unknown as Generate);

    expect(storageMocks.saveTasksState).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [
          expect.objectContaining({ id: 'done-1', status: 'completed' }),
          expect.objectContaining({ id: 'new-1' }),
          expect.objectContaining({ id: 'new-2' }),
        ],
      }),
      expect.any(String),
    );
  });
});

