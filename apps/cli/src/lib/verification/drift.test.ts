import { describe, expect, it } from 'vitest';
import type { LedgerTask } from '@scrimble/shared';
import { analyzeTaskDrift, detectDependencyInvalidation, detectVerificationStaleness } from './drift.js';

function makeTask(overrides: Partial<LedgerTask> = {}): LedgerTask {
  return {
    id: 'task-1',
    title: 'Task',
    objective: 'Do work',
    doneCriteria: 'Done',
    ownedFiles: ['src/owned.ts'],
    allowedFiles: [],
    verificationCommands: [],
    dependencies: ['dep-1'],
    riskScore: 5,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attemptCount: 0,
    maxRetries: 1,
    ...overrides,
  };
}

describe('drift detector', () => {
  it('detects stale verification by timestamps', () => {
    const stale = detectVerificationStaleness('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z');
    expect(stale).toBe(true);
  });

  it('detects incomplete dependencies', () => {
    const invalid = detectDependencyInvalidation(['dep-1', 'dep-2'], [
      { taskId: 'dep-1', status: 'completed' },
      { taskId: 'dep-2', status: 'pending' },
    ]);
    expect(invalid).toEqual(['dep-2']);
  });

  it('reports lease violations in drift analysis', () => {
    const result = analyzeTaskDrift({
      task: makeTask(),
      touchedFiles: ['src/owned.ts', 'src/not-owned.ts'],
      dependencyStatuses: [{ taskId: 'dep-1', status: 'completed' }],
    });
    expect(result.valid).toBe(false);
    expect(result.findings.some((finding) => finding.type === 'out_of_lease')).toBe(true);
  });
});

