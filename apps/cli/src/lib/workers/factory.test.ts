import { describe, expect, it } from 'vitest';
import { getPreferredWorker, getWorkerDriver } from './factory.js';

describe('worker factory', () => {
  it('returns the requested worker driver', () => {
    const gemini = getWorkerDriver('gemini');
    const copilot = getWorkerDriver('copilot');
    expect(gemini.kind).toBe('gemini');
    expect(copilot.kind).toBe('copilot');
  });

  it('uses task preference when choosing worker', () => {
    const preferred = getPreferredWorker({
      id: 'task-1',
      title: 'Task 1',
      objective: 'Build feature',
      doneCriteria: 'Tests pass',
      ownedFiles: ['src/a.ts'],
      allowedFiles: [],
      verificationCommands: [],
      dependencies: [],
      preferredWorker: 'gemini',
      riskScore: 2,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attemptCount: 0,
      maxRetries: 1,
    });
    expect(preferred).toBe('gemini');
  });

  it('falls back to risk heuristic when no preference set', () => {
    const highRisk = getPreferredWorker({
      id: 'task-2',
      title: 'Task 2',
      objective: 'Refactor core',
      doneCriteria: 'Stable',
      ownedFiles: ['src/core.ts'],
      allowedFiles: [],
      verificationCommands: [],
      dependencies: [],
      riskScore: 9,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attemptCount: 0,
      maxRetries: 1,
    });
    const lowRisk = getPreferredWorker({
      id: 'task-3',
      title: 'Task 3',
      objective: 'Update docs',
      doneCriteria: 'Docs updated',
      ownedFiles: ['README.md'],
      allowedFiles: [],
      verificationCommands: [],
      dependencies: [],
      riskScore: 3,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attemptCount: 0,
      maxRetries: 1,
    });

    expect(highRisk).toBe('gemini');
    expect(lowRisk).toBe('copilot');
  });
});

