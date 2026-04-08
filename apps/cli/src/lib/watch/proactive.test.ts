import { describe, expect, it } from 'vitest';
import { evaluateLedgerProactiveSignals, evaluateProactiveSignals } from './proactive.js';

describe('evaluateProactiveSignals', () => {
  it('emits verify and done-oriented signals for execution artifacts with passing verification', () => {
    const signals = evaluateProactiveSignals({
      events: [
        {
          type: 'changed',
          absolutePath: 'D:\\repo\\dist\\index.js',
          relativePath: 'dist/index.js',
          timestamp: '2026-04-06T00:00:00.000Z',
        },
      ],
      plan: {
        version: 1,
        chunks: [
          {
            id: 'chunk-001',
            title: 'Implement feature',
            prompt: 'Implement feature',
            status: 'active',
          },
        ],
      },
      verificationResult: {
        status: 'pass',
        confidence: 0.9,
        checks: [],
        timestamp: '2026-04-06T00:00:00.000Z',
      },
    });

    expect(signals.some((signal) => signal.type === 'execution-signal' && signal.suggestedCommand === 'scrimble verify')).toBe(true);
    expect(signals.some((signal) => signal.type === 'completion-ready' && signal.suggestedCommand === 'scrimble done')).toBe(true);
  });

  it('emits no-active-chunk when plan has no active chunk', () => {
    const signals = evaluateProactiveSignals({
      events: [],
      plan: {
        version: 1,
        chunks: [{ id: 'chunk-001', title: 'Todo', prompt: 'Todo', status: 'pending' }],
      },
      verificationResult: null,
    });

    expect(signals).toEqual([
      expect.objectContaining({
        type: 'no-active-chunk',
        suggestedCommand: 'scrimble next --activate',
      }),
    ]);
  });
});

describe('evaluateLedgerProactiveSignals', () => {
  it('emits run-focused no-active signal when ledger has ready work but no active task', () => {
    const signals = evaluateLedgerProactiveSignals({
      events: [],
      tasks: {
        version: 1,
        tasks: [
          {
            id: 'task-1',
            title: 'Task 1',
            objective: 'Do task',
            doneCriteria: 'Done',
            ownedFiles: [],
            allowedFiles: [],
            verificationCommands: [],
            dependencies: [],
            riskScore: 5,
            status: 'pending',
            createdAt: '2026-04-07T00:00:00.000Z',
            updatedAt: '2026-04-07T00:00:00.000Z',
            attemptCount: 0,
            maxRetries: 1,
          },
        ],
        updatedAt: '2026-04-07T00:00:00.000Z',
      },
      assignments: {
        version: 1,
        assignments: [],
        updatedAt: '2026-04-07T00:00:00.000Z',
      },
      workers: {
        version: 1,
        workers: [{ kind: 'gemini', available: true, tasksCompleted: 0, tasksFailed: 0 }],
        updatedAt: '2026-04-07T00:00:00.000Z',
      },
      verificationResult: null,
    });

    expect(signals.some((signal) => signal.suggestedCommand === 'scrimble run --worker auto')).toBe(true);
  });

  it('emits conflict-oriented signal when blocked tasks exist', () => {
    const signals = evaluateLedgerProactiveSignals({
      events: [],
      tasks: {
        version: 1,
        tasks: [
          {
            id: 'task-2',
            title: 'Task 2',
            objective: 'Blocked task',
            doneCriteria: 'Done',
            ownedFiles: [],
            allowedFiles: [],
            verificationCommands: [],
            dependencies: [],
            riskScore: 5,
            status: 'blocked',
            createdAt: '2026-04-07T00:00:00.000Z',
            updatedAt: '2026-04-07T00:00:00.000Z',
            attemptCount: 0,
            maxRetries: 1,
          },
        ],
        updatedAt: '2026-04-07T00:00:00.000Z',
      },
      assignments: {
        version: 1,
        assignments: [],
        updatedAt: '2026-04-07T00:00:00.000Z',
      },
      workers: {
        version: 1,
        workers: [{ kind: 'gemini', available: true, tasksCompleted: 0, tasksFailed: 0 }],
        updatedAt: '2026-04-07T00:00:00.000Z',
      },
      verificationResult: null,
    });

    expect(signals.some((signal) => signal.suggestedCommand === 'scrimble conflicts')).toBe(true);
  });
});
