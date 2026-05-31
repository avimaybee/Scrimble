import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  ensureLedgerDirs,
  getLedgerPaths,
  mutateLedger,
  readLedger,
  writeLedger,
} from './storage.js';
import { migrateLegacyLedgerIfPresent } from './legacy-migration.js';

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

  it('loads default whole-document state when ledger is missing', async () => {
    const ledger = await readLedger(testDir);
    expect(ledger.tasks.tasks).toEqual([]);
    expect(ledger.runtime.activeExecution).toBeUndefined();
    expect(ledger.workers.workers).toEqual([]);
    expect(ledger.intent.intent).toBeNull();
    expect(ledger.orchestration.sessionId).toBeTruthy();
    expect(ledger.orchestration.activeRun).toBeUndefined();
    expect(ledger.orchestration.lastRunOutcome).toBeUndefined();
  });

  it('writes and reads the whole ledger document', async () => {
    const ledger = await readLedger(testDir);
    ledger.tasks.tasks.push({
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
    });
    await writeLedger(ledger, testDir);

    const loaded = await readLedger(testDir);
    expect(loaded.tasks.tasks).toHaveLength(1);
    expect(loaded.tasks.tasks[0]?.id).toBe('task-1');
    expect(loaded.tasks.tasks[0]?.verificationCommands).toEqual(['pnpm test']);
  });

  it('supports one-read one-write mutation flow', async () => {
    await mutateLedger(testDir, (ledger) => {
      ledger.approval.approved = true;
      ledger.approval.approvedAt = new Date().toISOString();
      ledger.approval.updatedAt = new Date().toISOString();
    });

    const loaded = await readLedger(testDir);
    expect(loaded.approval.approved).toBe(true);
  });

  async function seedLegacyTaskFile(): Promise<ReturnType<typeof getLedgerPaths>> {
    const paths = getLedgerPaths(testDir);
    const legacyLedgerDir = path.join(testDir, '.scrimble', 'ledger');
    await fs.mkdir(legacyLedgerDir, { recursive: true });
    await fs.mkdir(paths.runtime, { recursive: true });
    await fs.writeFile(
      path.join(legacyLedgerDir, 'tasks.json'),
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
    return paths;
  }

  it('does not migrate legacy split files in readLedger hot path', async () => {
    const paths = await seedLegacyTaskFile();
    const loaded = await readLedger(testDir);
    expect(loaded.tasks.tasks).toHaveLength(0);

    const ledgerExists = await fs.access(paths.ledgerFile).then(() => true).catch(() => false);
    expect(ledgerExists).toBe(false);
  });

  it('migrates legacy split files into ledger.json via bootstrap migration utility', async () => {
    const paths = await seedLegacyTaskFile();

    const status = await migrateLegacyLedgerIfPresent(testDir);
    expect(status).toBe('migrated');

    const loaded = await readLedger(testDir);
    expect(loaded.tasks.tasks[0]?.id).toBe('legacy-task');
    expect(loaded.runtime.activeExecution).toBeUndefined();

    const ledgerContent = JSON.parse(await fs.readFile(paths.ledgerFile, 'utf8')) as {
      tasks?: { tasks?: Array<{ id: string }> };
    };
    expect(ledgerContent.tasks?.tasks?.[0]?.id).toBe('legacy-task');
  });

  it('persists orchestration continuity in the ledger document', async () => {
    const ledger = await readLedger(testDir);
    ledger.orchestration = {
      version: 1,
      sessionId: 'session-123',
      activeRun: {
        request: 'implement feature',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedSteps: [{ action: 'generate_or_update_tasks', summary: 'planned', completedAt: new Date().toISOString() }],
        lastCompletedStep: { action: 'generate_or_update_tasks', summary: 'planned', completedAt: new Date().toISOString() },
        pendingBoundary: {
          id: 'boundary-1',
          action: 'execute_tasks',
          actionSummary: 'Start working through the planned tasks.',
          reason: 'Execution requires confirmation.',
          scope: { parallel: 1, maxTasks: 1, args: {} },
          choices: ['proceed', 'pause', 'redirect'],
          requestedAt: new Date().toISOString(),
        },
        lastPauseReason: 'Execution requires confirmation.',
      },
      lastRunOutcome: {
        status: 'paused',
        request: 'implement feature',
        summary: 'Paused: Execution requires confirmation.',
        reason: 'Execution requires confirmation.',
        nextSuggestedAction: 'Confirm to continue.',
        completedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
    await writeLedger(ledger, testDir);

    const loaded = await readLedger(testDir);
    expect(loaded.orchestration.sessionId).toBe('session-123');
    expect(loaded.orchestration.activeRun?.lastCompletedStep?.action).toBe('generate_or_update_tasks');
    expect(loaded.orchestration.activeRun?.pendingBoundary?.action).toBe('execute_tasks');
    expect(loaded.orchestration.lastRunOutcome?.status).toBe('paused');
  });
});

