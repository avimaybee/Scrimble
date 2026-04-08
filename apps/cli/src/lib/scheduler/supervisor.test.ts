import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import type { ExecutionHandle, ExecutionResult, WorkerDriver, WorkerKind } from '@scrimble/shared';

const factoryMocks = vi.hoisted(() => ({
  getWorkerDriver: vi.fn(),
}));

vi.mock('../workers/factory.js', () => factoryMocks);

import { createTask, getTask } from '../ledger/operations.js';
import { saveLedgerApprovalState } from '../ledger/storage.js';
import { LedgerSupervisor } from './supervisor.js';

function createFakeDriver(
  kind: WorkerKind,
  touchedFiles: string[],
  options: {
    available?: boolean;
    onStart?: (worker: WorkerKind) => void;
    resolveTouchedFiles?: (prompt: string) => string[];
  } = {},
): WorkerDriver {
  let executionPrompt = '';

  return {
    kind,
    async preflight() {
      return {
        worker: kind,
        available: options.available ?? kind === 'gemini',
        authConfigured: true,
        capabilities: this.capabilities(),
        warnings: [],
        errors: [],
      };
    },
    async discoverContextArtifacts() {
      return [];
    },
    buildPrompt(task) {
      return `task:${task.id}`;
    },
    async startExecution(prompt): Promise<ExecutionHandle> {
      executionPrompt = prompt;
      options.onStart?.(kind);
      return {
        sessionId: `${kind}-session`,
        worker: kind,
        startedAt: new Date().toISOString(),
        kill: () => undefined,
        isRunning: () => false,
      };
    },
    async waitForCompletion(): Promise<ExecutionResult> {
      const resolvedTouchedFiles = options.resolveTouchedFiles
        ? options.resolveTouchedFiles(executionPrompt)
        : touchedFiles;
      return {
        success: true,
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        touchedFiles: resolvedTouchedFiles,
        parsedOutput: null,
        timedOut: false,
        killed: false,
        durationMs: 1,
      };
    },
    parseOutput() {
      return null;
    },
    classifyFailure() {
      return {
        kind: 'unknown',
        message: 'failed',
        retryable: false,
      };
    },
    async continueExecution() {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'not implemented',
        touchedFiles: [],
        parsedOutput: null,
        failureReason: 'not implemented',
        timedOut: false,
        killed: false,
        durationMs: 1,
      };
    },
    extractTouchedFiles(result) {
      return result.touchedFiles;
    },
    capabilities() {
      return {
        supportedTaskTypes: ['code_modification'],
        maxParallelTasks: 1,
        supportsCheckpointing: true,
        supportsContinuation: true,
        supportsJsonOutput: true,
      };
    },
  };
}

describe('ledger supervisor', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `scheduler-supervisor-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(testDir, '.git'), { recursive: true });
    await saveLedgerApprovalState(
      {
        version: 1,
        approved: true,
        approvedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      testDir,
    );
    factoryMocks.getWorkerDriver.mockReset();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('completes a ready task on successful execution', async () => {
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'src', 'task.ts'), 'export const value = 1;\n', 'utf8');
    await createTask(
      {
        id: 'task-1',
        title: 'Task 1',
        objective: 'Implement task',
        doneCriteria: 'Done',
        ownedFiles: ['src/task.ts'],
      },
      testDir,
    );

    factoryMocks.getWorkerDriver.mockImplementation((kind: WorkerKind) =>
      createFakeDriver(kind, ['src/task.ts']),
    );

    const supervisor = new LedgerSupervisor();
    const result = await supervisor.run({ cwd: testDir, maxTasks: 1 });

    expect(result.completedTaskIds).toEqual(['task-1']);
    const task = await getTask('task-1', testDir);
    expect(task?.status).toBe('completed');
  });

  it('marks task blocked on out-of-lease edits', async () => {
    await createTask(
      {
        id: 'task-2',
        title: 'Task 2',
        objective: 'Implement task',
        doneCriteria: 'Done',
        ownedFiles: ['src/owned.ts'],
      },
      testDir,
    );

    factoryMocks.getWorkerDriver.mockImplementation((kind: WorkerKind) =>
      createFakeDriver(kind, ['src/not-owned.ts']),
    );

    const supervisor = new LedgerSupervisor();
    const result = await supervisor.run({ cwd: testDir, maxTasks: 1 });

    expect(result.conflictedTaskIds).toEqual(['task-2']);
    const task = await getTask('task-2', testDir);
    expect(task?.status).toBe('blocked');
  });

  it('does not overbook a single-capacity worker in parallel batch routing', async () => {
    const startedWorkers: WorkerKind[] = [];
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    await fs.writeFile(path.join(testDir, 'src', 'b.ts'), 'export const b = 1;\n', 'utf8');

    await createTask(
      {
        id: 'task-3',
        title: 'Task 3',
        objective: 'Implement task',
        doneCriteria: 'Done',
        ownedFiles: ['src/a.ts'],
        preferredWorker: 'gemini',
      },
      testDir,
    );
    await createTask(
      {
        id: 'task-4',
        title: 'Task 4',
        objective: 'Implement task',
        doneCriteria: 'Done',
        ownedFiles: ['src/b.ts'],
        preferredWorker: 'gemini',
        fallbackWorker: 'copilot',
      },
      testDir,
    );

    factoryMocks.getWorkerDriver.mockImplementation((kind: WorkerKind) =>
      createFakeDriver(kind, [], {
        available: true,
        onStart: (worker) => startedWorkers.push(worker),
        resolveTouchedFiles: (prompt) => {
          if (prompt.includes('task:task-3')) {
            return ['src/a.ts'];
          }
          if (prompt.includes('task:task-4')) {
            return ['src/b.ts'];
          }
          return [];
        },
      }),
    );

    const supervisor = new LedgerSupervisor();
    await supervisor.run({ cwd: testDir, parallel: 2, maxTasks: 2 });

    expect(startedWorkers).toHaveLength(2);
    expect(startedWorkers.filter((worker) => worker === 'gemini')).toHaveLength(1);
    expect(startedWorkers.filter((worker) => worker === 'copilot')).toHaveLength(1);
  });

  it('requires approval before dispatching ledger tasks', async () => {
    await saveLedgerApprovalState(
      {
        version: 1,
        approved: false,
        updatedAt: new Date().toISOString(),
      },
      testDir,
    );
    await createTask(
      {
        id: 'task-unapproved',
        title: 'Task unapproved',
        objective: 'Should not run',
        doneCriteria: 'Done',
        ownedFiles: ['src/unapproved.ts'],
      },
      testDir,
    );
    factoryMocks.getWorkerDriver.mockImplementation((kind: WorkerKind) =>
      createFakeDriver(kind, ['src/unapproved.ts']),
    );

    const supervisor = new LedgerSupervisor();
    await expect(supervisor.run({ cwd: testDir, maxTasks: 1 })).rejects.toThrow('Ledger execution is not approved');
  });
});

