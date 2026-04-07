import { describe, expect, it } from 'vitest';
import type { FileLease, LedgerTask } from '@scrimble/shared';
import { checkParallelDispatch, detectOutOfLeaseEdits, validateParallelBatch } from './parallel.js';

function makeTask(overrides: Partial<LedgerTask> = {}): LedgerTask {
  return {
    id: 'task-1',
    title: 'Task',
    objective: 'Do thing',
    doneCriteria: 'Works',
    ownedFiles: ['src/a.ts'],
    allowedFiles: [],
    verificationCommands: [],
    dependencies: [],
    riskScore: 4,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attemptCount: 0,
    maxRetries: 1,
    ...overrides,
  };
}

describe('scheduler parallel safety', () => {
  it('rejects dispatch when ownership overlaps active lease', () => {
    const task = makeTask({ id: 'task-b', ownedFiles: ['src/auth/index.ts'] });
    const leases: FileLease[] = [
      {
        taskId: 'task-a',
        worker: 'gemini',
        paths: ['src/auth/index.ts'],
        globs: [],
        leasedAt: new Date().toISOString(),
      },
    ];

    const check = checkParallelDispatch(task, [], leases);
    expect(check.allowed).toBe(false);
    expect(check.conflicts).toEqual(['task-a']);
  });

  it('rejects parallel batch with duplicate ownership', () => {
    const result = validateParallelBatch([
      makeTask({ id: 'task-a', ownedFiles: ['src/shared.ts'] }),
      makeTask({ id: 'task-b', ownedFiles: ['src/shared.ts'] }),
    ]);
    expect(result.allowed).toBe(false);
  });

  it('detects out-of-lease edits', () => {
    const task = makeTask({ ownedFiles: ['src/task.ts'] });
    const validation = detectOutOfLeaseEdits(task, ['src/task.ts', 'src/other.ts']);
    expect(validation.valid).toBe(false);
    expect(validation.outOfLeaseFiles).toEqual(['src/other.ts']);
  });
});

