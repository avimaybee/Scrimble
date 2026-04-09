import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  blockActiveTask,
  completeActiveTask,
  createTask,
  failActiveTask,
  getActiveExecution,
  getBlockedTasks,
  getDependencyChain,
  getReadyTasks,
  startNextReadyTask,
} from './operations.js';
import { readLedger } from './storage.js';

describe('ledger operations', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `ledger-operations-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('creates tasks and computes ready/blocked sets', async () => {
    await createTask(
      {
        id: 'task-a',
        title: 'Task A',
        objective: 'Build A',
        doneCriteria: 'A works',
        ownedFiles: ['src/a.ts'],
      },
      testDir,
    );
    await createTask(
      {
        id: 'task-b',
        title: 'Task B',
        objective: 'Build B',
        doneCriteria: 'B works',
        ownedFiles: ['src/b.ts'],
        dependencies: ['task-a'],
      },
      testDir,
    );

    const ready = await getReadyTasks(testDir);
    const blocked = await getBlockedTasks(testDir);

    expect(ready.map((task) => task.id)).toEqual(['task-a']);
    expect(blocked.map((task) => task.id)).toEqual(['task-b']);
  });

  it('starts one ready task and creates activeExecution state', async () => {
    await createTask(
      {
        id: 'task-a',
        title: 'Task A',
        objective: 'Build A',
        doneCriteria: 'A works',
        ownedFiles: ['src/a.ts'],
      },
      testDir,
    );

    const started = await startNextReadyTask({
      taskId: 'task-a',
      worker: 'gemini',
      cwd: testDir,
    });
    expect(started.status).toBe('in_progress');

    const active = await getActiveExecution(testDir);
    expect(active).toMatchObject({
      taskId: 'task-a',
      workerId: 'gemini',
      attempt: 1,
    });
  });

  it('completes active task and clears active execution', async () => {
    await createTask(
      {
        id: 'task-a',
        title: 'Task A',
        objective: 'Build A',
        doneCriteria: 'A works',
        ownedFiles: ['src/a.ts'],
      },
      testDir,
    );
    await startNextReadyTask({ taskId: 'task-a', worker: 'gemini', cwd: testDir });

    await completeActiveTask({ taskId: 'task-a', cwd: testDir });

    const ledger = await readLedger(testDir);
    const task = ledger.tasks.tasks.find((entry) => entry.id === 'task-a');
    expect(task?.status).toBe('completed');
    expect(ledger.runtime.activeExecution).toBeUndefined();
  });

  it('returns retryable active task to ready while clearing active execution', async () => {
    await createTask(
      {
        id: 'task-a',
        title: 'Task A',
        objective: 'Build A',
        doneCriteria: 'A works',
        ownedFiles: ['src/a.ts'],
      },
      testDir,
    );
    await startNextReadyTask({ taskId: 'task-a', worker: 'gemini', cwd: testDir });

    await failActiveTask({
      taskId: 'task-a',
      toStatus: 'ready',
      error: 'temporary failure',
      cwd: testDir,
    });

    const ledger = await readLedger(testDir);
    const task = ledger.tasks.tasks.find((entry) => entry.id === 'task-a');
    expect(task?.status).toBe('ready');
    expect(task?.error).toBe('temporary failure');
    expect(ledger.runtime.activeExecution).toBeUndefined();
  });

  it('blocks active task and clears active execution', async () => {
    await createTask(
      {
        id: 'task-a',
        title: 'Task A',
        objective: 'Build A',
        doneCriteria: 'A works',
        ownedFiles: ['src/a.ts'],
      },
      testDir,
    );
    await startNextReadyTask({ taskId: 'task-a', worker: 'gemini', cwd: testDir });

    await blockActiveTask({
      taskId: 'task-a',
      error: 'scope violation',
      cwd: testDir,
    });

    const ledger = await readLedger(testDir);
    const task = ledger.tasks.tasks.find((entry) => entry.id === 'task-a');
    expect(task?.status).toBe('blocked');
    expect(task?.error).toBe('scope violation');
    expect(ledger.runtime.activeExecution).toBeUndefined();
  });

  it('computes dependency chain recursively', async () => {
    await createTask(
      {
        id: 'task-a',
        title: 'Task A',
        objective: 'Build A',
        doneCriteria: 'A works',
        ownedFiles: ['src/a.ts'],
      },
      testDir,
    );
    await createTask(
      {
        id: 'task-b',
        title: 'Task B',
        objective: 'Build B',
        doneCriteria: 'B works',
        ownedFiles: ['src/b.ts'],
        dependencies: ['task-a'],
      },
      testDir,
    );
    await createTask(
      {
        id: 'task-c',
        title: 'Task C',
        objective: 'Build C',
        doneCriteria: 'C works',
        ownedFiles: ['src/c.ts'],
        dependencies: ['task-b'],
      },
      testDir,
    );

    const chain = await getDependencyChain('task-c', testDir);
    expect(chain).toEqual(['task-b', 'task-a']);
  });
});
