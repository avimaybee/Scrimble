import { describe, expect, it } from 'vitest';
import type { LedgerTask, WorkerHealth } from '@scrimble/shared';
import { routeTask } from './router.js';

function makeTask(overrides: Partial<LedgerTask> = {}): LedgerTask {
  return {
    id: 'task-1',
    title: 'Build auth endpoint',
    objective: 'Implement auth flow',
    doneCriteria: 'Auth tests pass',
    ownedFiles: ['src/auth.ts'],
    allowedFiles: [],
    verificationCommands: ['pnpm test'],
    dependencies: [],
    riskScore: 5,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attemptCount: 0,
    maxRetries: 1,
    ...overrides,
  };
}

describe('scheduler router', () => {
  it('honors manual worker override', () => {
    const workers: WorkerHealth[] = [
      { kind: 'gemini', available: true, tasksCompleted: 1, tasksFailed: 0 },
      { kind: 'copilot', available: true, tasksCompleted: 1, tasksFailed: 0 },
    ];

    const decision = routeTask(makeTask(), { workers, manualWorker: 'copilot' });
    expect(decision.worker).toBe('copilot');
    expect(decision.confidence).toBe(1);
  });

  it('prefers preferredWorker when available', () => {
    const workers: WorkerHealth[] = [
      { kind: 'gemini', available: true, tasksCompleted: 3, tasksFailed: 0 },
      { kind: 'copilot', available: true, tasksCompleted: 10, tasksFailed: 4 },
    ];

    const decision = routeTask(
      makeTask({
        preferredWorker: 'gemini',
      }),
      { workers },
    );
    expect(decision.worker).toBe('gemini');
  });

  it('uses fallbackWorker when preferred worker is unavailable', () => {
    const workers: WorkerHealth[] = [
      { kind: 'gemini', available: false, tasksCompleted: 3, tasksFailed: 0 },
      { kind: 'copilot', available: true, tasksCompleted: 10, tasksFailed: 4 },
    ];

    const decision = routeTask(
      makeTask({
        preferredWorker: 'gemini',
        fallbackWorker: 'copilot',
      }),
      { workers },
    );
    expect(decision.worker).toBe('copilot');
  });

  it('falls back to deterministic worker priority when no preference is set', () => {
    const workers: WorkerHealth[] = [
      { kind: 'gemini', available: true, tasksCompleted: 3, tasksFailed: 0 },
      { kind: 'copilot', available: true, tasksCompleted: 10, tasksFailed: 4 },
    ];

    const decision = routeTask(makeTask(), { workers });
    expect(decision.worker).toBe('gemini');
  });
});

