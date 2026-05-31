import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { verifyTaskExecution } from './engine.js';
import type { LedgerTask } from '@scrimble/shared';

function makeTask(overrides: Partial<LedgerTask> = {}): LedgerTask {
  return {
    id: 'task-1',
    title: 'Verification task',
    objective: 'Verify behavior',
    doneCriteria: 'Pass checks',
    ownedFiles: [],
    allowedFiles: [],
    verificationCommands: [],
    dependencies: [],
    riskScore: 3,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attemptCount: 0,
    maxRetries: 1,
    ...overrides,
  };
}

describe('verification engine', () => {
  it('passes for successful verification command', async () => {
    const repoRoot = path.resolve(process.cwd(), '..', '..');
    const result = await verifyTaskExecution({
      task: makeTask({
        verificationCommands: ['node -e "process.exit(0)"'],
      }),
      cwd: repoRoot,
    });
    expect(result.passed).toBe(true);
    expect(result.status === 'pass' || result.status === 'warn').toBe(true);
  });

  it('fails when expected owned file is missing', async () => {
    const result = await verifyTaskExecution({
      task: makeTask({
        ownedFiles: ['src/non-existent-file.ts'],
      }),
    });
    expect(result.passed).toBe(false);
    expect(result.status).toBe('fail');
  });
});

