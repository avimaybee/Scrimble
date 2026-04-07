import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  acquireFileLease,
  checkLeaseConflict,
  completeTask,
  createTask,
  getBlockedTasks,
  getDependencyChain,
  getReadyTasks,
  leaseTask,
  releaseTask,
  setAssignmentStatus,
} from './operations.js';
import { loadAssignmentsState, loadFileLeasesState, loadTasksState } from './storage.js';

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

  it('leases task and updates assignment state', async () => {
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

    const assignment = await leaseTask('task-a', 'gemini', { sessionId: 'session-1', cwd: testDir });
    expect(assignment.status).toBe('assigned');
    expect(assignment.worker).toBe('gemini');
    expect(assignment.sessionId).toBe('session-1');

    await setAssignmentStatus('task-a', 'in_progress', { cwd: testDir });
    const assignmentsState = await loadAssignmentsState(testDir);
    expect(assignmentsState.assignments[0]?.status).toBe('in_progress');
    expect(assignmentsState.assignments[0]?.startedAt).toBeDefined();
  });

  it('detects and prevents conflicting file leases', async () => {
    await acquireFileLease('task-a', 'gemini', { paths: ['src/auth/index.ts'], globs: [] }, testDir);

    const check = await checkLeaseConflict(
      'task-b',
      {
        paths: ['src/auth/index.ts'],
        globs: [],
      },
      testDir,
    );
    expect(check.canLease).toBe(false);
    expect(check.conflicts).toHaveLength(1);

    await expect(
      acquireFileLease('task-b', 'copilot', { paths: ['src/auth/index.ts'], globs: [] }, testDir),
    ).rejects.toThrow(/Lease conflict/);
  });

  it('completes task and releases leases', async () => {
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
    await leaseTask('task-a', 'gemini', { cwd: testDir });
    await acquireFileLease('task-a', 'gemini', { paths: ['src/a.ts'], globs: [] }, testDir);

    await completeTask('task-a', { cwd: testDir });

    const tasksState = await loadTasksState(testDir);
    const task = tasksState.tasks.find((entry) => entry.id === 'task-a');
    expect(task?.status).toBe('completed');

    const leasesState = await loadFileLeasesState(testDir);
    expect(leasesState.leases).toHaveLength(0);
  });

  it('releases task back to pending and clears assignment', async () => {
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
    await leaseTask('task-a', 'gemini', { cwd: testDir });
    await releaseTask('task-a', { cwd: testDir });

    const tasksState = await loadTasksState(testDir);
    expect(tasksState.tasks.find((entry) => entry.id === 'task-a')?.status).toBe('pending');

    const assignmentsState = await loadAssignmentsState(testDir);
    expect(assignmentsState.assignments).toHaveLength(0);
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

