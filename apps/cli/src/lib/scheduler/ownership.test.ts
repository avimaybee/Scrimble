import { describe, expect, it } from 'vitest';
import type { LedgerTask } from '@scrimble/shared';
import { detectOutOfScopeEdits, hasExplicitOwnership } from './ownership.js';

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
    status: 'ready',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attemptCount: 0,
    maxRetries: 1,
    ...overrides,
  };
}

describe('scheduler ownership scope safety', () => {
  it('requires explicit ownership for execution safety', () => {
    const task = makeTask({ id: 'task-b', ownedFiles: [] });
    expect(hasExplicitOwnership(task)).toBe(false);
  });

  it('detects out-of-scope edits', () => {
    const task = makeTask({ ownedFiles: ['src/task.ts'] });
    const validation = detectOutOfScopeEdits(task, ['src/task.ts', 'src/other.ts']);
    expect(validation.valid).toBe(false);
    expect(validation.outOfScopeFiles).toEqual(['src/other.ts']);
  });
});
