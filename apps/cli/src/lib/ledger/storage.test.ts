import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  ensureLedgerDirs,
  getLedgerPaths,
  loadAssignmentsState,
  loadFileLeasesState,
  loadIntentState,
  loadTasksState,
  loadWorkersState,
  saveTasksState,
} from './storage.js';

describe('ledger storage', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `ledger-storage-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('returns expected ledger paths', () => {
    const paths = getLedgerPaths(testDir);
    expect(paths.ledgerFile).toContain('.scrimble');
    expect(paths.ledgerFile).toContain('ledger.json');
    expect(paths.events).toContain('runtime');
    expect(paths.attempts).toContain('attempts');
  });

  it('ensures ledger directories', async () => {
    await ensureLedgerDirs(testDir);
    const paths = getLedgerPaths(testDir);
    const scrimbleStats = await fs.stat(paths.scrimble);
    const attemptsStats = await fs.stat(paths.attempts);
    expect(scrimbleStats.isDirectory()).toBe(true);
    expect(attemptsStats.isDirectory()).toBe(true);
  });

  it('loads default states when files are missing', async () => {
    const [tasks, assignments, leases, workers, intent] = await Promise.all([
      loadTasksState(testDir),
      loadAssignmentsState(testDir),
      loadFileLeasesState(testDir),
      loadWorkersState(testDir),
      loadIntentState(testDir),
    ]);

    expect(tasks.tasks).toEqual([]);
    expect(assignments.assignments).toEqual([]);
    expect(leases.leases).toEqual([]);
    expect(workers.workers).toEqual([]);
    expect(intent.intent).toBeNull();
  });

  it('saves and loads tasks state', async () => {
    await saveTasksState(
      {
        version: 1,
        tasks: [
          {
            id: 'task-1',
            title: 'Task 1',
            objective: 'Build task 1',
            doneCriteria: 'Pass tests',
            ownedFiles: ['src/task1.ts'],
            allowedFiles: [],
            verificationCommands: ['pnpm test'],
            dependencies: [],
            riskScore: 3,
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attemptCount: 0,
            maxRetries: 1,
          },
        ],
        updatedAt: new Date().toISOString(),
      },
      testDir,
    );

    const loaded = await loadTasksState(testDir);
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0]?.id).toBe('task-1');
    expect(loaded.tasks[0]?.verificationCommands).toEqual(['pnpm test']);
  });

  it('migrates legacy split files into ledger.json on read', async () => {
    const paths = getLedgerPaths(testDir);
    await fs.mkdir(paths.legacyLedgerDir, { recursive: true });
    await fs.mkdir(paths.runtime, { recursive: true });
    await fs.writeFile(
      paths.legacyTasks,
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: 'legacy-task',
            title: 'Legacy task',
            objective: 'migrate',
            doneCriteria: 'ok',
            ownedFiles: [],
            allowedFiles: [],
            verificationCommands: [],
            dependencies: [],
            riskScore: 1,
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attemptCount: 0,
            maxRetries: 1,
          },
        ],
        updatedAt: new Date().toISOString(),
      }),
      'utf8',
    );

    const loaded = await loadTasksState(testDir);
    expect(loaded.tasks[0]?.id).toBe('legacy-task');

    const ledgerContent = JSON.parse(await fs.readFile(paths.ledgerFile, 'utf8')) as {
      tasks?: { tasks?: Array<{ id: string }> };
    };
    expect(ledgerContent.tasks?.tasks?.[0]?.id).toBe('legacy-task');
  });
});

