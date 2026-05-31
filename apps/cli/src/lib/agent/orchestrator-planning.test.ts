import { describe, expect, it } from 'vitest';
import type { AgentToolResult } from './types.js';
import type { LedgerDocument, LedgerTask } from '@scrimble/shared';
import { selectDeterministicStep } from './orchestrator-planning.js';

function setupReadyResult(): AgentToolResult {
  return {
    action: 'check_setup',
    summary: 'Setup is ready.',
    details: [],
  };
}

function makeTask(overrides: Partial<LedgerTask> = {}): LedgerTask {
  return {
    id: 'task-1',
    title: 'Task',
    objective: 'Implement requested feature',
    doneCriteria: 'Feature works end-to-end.',
    ownedFiles: ['src/**/*'],
    allowedFiles: [],
    verificationCommands: ['npm run test'],
    dependencies: [],
    riskScore: 4,
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    attemptCount: 0,
    maxRetries: 1,
    ...overrides,
  };
}

function makeLedger(overrides: Partial<LedgerDocument> = {}): LedgerDocument {
  return {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: {
      version: 1,
      tasks: [],
      planningBasis: {
        intentId: 'intent-1',
        intentUpdatedAt: '2026-01-01T00:00:00.000Z',
        discoveryMode: 'interactive',
      },
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...(overrides.tasks ?? {}),
    },
    runtime: {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...(overrides.runtime ?? {}),
    },
    workers: {
      version: 1,
      workers: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...(overrides.workers ?? {}),
    },
    intent: {
      version: 1,
      intent: {
        id: 'intent-1',
        projectName: 'scrimble',
        goal: 'Ship conversation-first planning',
        productVision: 'Operator-first workflow',
        productAssumptions: ['Use local runtime'],
        productConstraints: [],
        technicalConstraints: [],
        constraints: [],
        successCriteria: ['Tasks are scoped and verifiable'],
        nonGoals: [],
        outOfScope: [],
        targetUsers: 'CLI maintainers',
        timeline: 'flexible',
        qualityPreference: 'production',
        inferredStack: {
          projectType: 'brownfield',
          repoName: 'scrimble',
          repoPath: '.',
          languages: ['TypeScript'],
          frameworks: ['oclif'],
          packageManager: 'pnpm',
        },
        discoveryMode: 'interactive',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      discovery: {
        status: 'approved',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      history: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...(overrides.intent ?? {}),
    },
    approval: {
      version: 1,
      approved: false,
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...(overrides.approval ?? {}),
    },
    orchestration: {
      version: 1,
      sessionId: 'session-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...(overrides.orchestration ?? {}),
    },
  };
}

describe('selectDeterministicStep', () => {
  it('generates tasks when no task graph exists', () => {
    const step = selectDeterministicStep({
      request: 'implement task planning',
      interactionMode: 'operator',
      ledger: makeLedger(),
      setupResult: setupReadyResult(),
    });
    expect(step?.action).toBe('generate_or_update_tasks');
    expect(step?.args['replan']).toBe(false);
  });

  it('shows plan before first execution when ready tasks exist', () => {
    const ledger = makeLedger({
      tasks: {
        version: 1,
        tasks: [makeTask()],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const step = selectDeterministicStep({
      request: 'continue implementation',
      interactionMode: 'operator',
      ledger,
      setupResult: setupReadyResult(),
    });
    expect(step?.action).toBe('show_plan');
  });

  it('executes bounded task after plan was reviewed in current run', () => {
    const ledger = makeLedger({
      tasks: {
        version: 1,
        tasks: [makeTask()],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      orchestration: {
        version: 1,
        sessionId: 'session-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        activeRun: {
          request: 'continue implementation',
          startedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          completedSteps: [
            {
              action: 'show_plan',
              summary: 'plan reviewed',
              completedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          lastCompletedStep: {
            action: 'show_plan',
            summary: 'plan reviewed',
            completedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    const step = selectDeterministicStep({
      request: 'continue implementation',
      interactionMode: 'operator',
      ledger,
      setupResult: setupReadyResult(),
    });
    expect(step?.action).toBe('execute_tasks');
    expect(step?.args['parallel']).toBe(1);
    expect(step?.args['maxTasks']).toBe(1);
  });

  it('triggers deterministic replanning for explicit steering requests', () => {
    const ledger = makeLedger({
      tasks: {
        version: 1,
        tasks: [makeTask()],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      orchestration: {
        version: 1,
        sessionId: 'session-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        activeRun: {
          request: 'pivot',
          startedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          completedSteps: [
            {
              action: 'show_plan',
              summary: 'plan reviewed',
              completedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          lastCompletedStep: {
            action: 'show_plan',
            summary: 'plan reviewed',
            completedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    const step = selectDeterministicStep({
      request: 'replan from current state and regenerate the task graph',
      interactionMode: 'operator',
      ledger,
      setupResult: setupReadyResult(),
    });
    expect(step?.action).toBe('generate_or_update_tasks');
    expect(step?.args['replan']).toBe(true);
  });

  it('triggers replanning when planning basis no longer matches approved intent', () => {
    const ledger = makeLedger({
      tasks: {
        version: 1,
        tasks: [makeTask()],
        planningBasis: {
          intentId: 'intent-stale',
          intentUpdatedAt: '2026-01-01T00:00:00.000Z',
          discoveryMode: 'interactive',
        },
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const step = selectDeterministicStep({
      request: 'continue implementation',
      interactionMode: 'operator',
      ledger,
      setupResult: setupReadyResult(),
    });
    expect(step?.action).toBe('generate_or_update_tasks');
    expect(step?.args['replan']).toBe(true);
  });

  it('triggers replanning when legacy low-quality template tasks are detected', () => {
    const ledger = makeLedger({
      tasks: {
        version: 1,
        tasks: [
          makeTask({
            objective: 'Audit current repository state for goal: old goal',
          }),
        ],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const step = selectDeterministicStep({
      request: 'continue implementation',
      interactionMode: 'operator',
      ledger,
      setupResult: setupReadyResult(),
    });
    expect(step?.action).toBe('generate_or_update_tasks');
    expect(step?.args['replan']).toBe(true);
  });

  it('routes inconsistent runtime/orchestration state to repair_state', () => {
    const ledger = makeLedger({
      tasks: {
        version: 1,
        tasks: [makeTask({ id: 'task-1', status: 'in_progress' })],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      runtime: {
        version: 1,
        activeExecution: {
          taskId: 'task-1',
          workerId: 'gemini',
          startedAt: '2026-01-01T00:00:00.000Z',
          attempt: 1,
          phase: 'executing',
        },
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      orchestration: {
        version: 1,
        sessionId: 'session-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        activeRun: {
          request: 'continue',
          startedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          pendingBoundary: {
            id: 'boundary-1',
            action: 'execute_tasks',
            actionSummary: 'Execute next bounded task',
            reason: 'Requires approval',
            scope: { parallel: 1, maxTasks: 1, args: {} },
            choices: ['proceed', 'pause', 'redirect'],
            requestedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    const step = selectDeterministicStep({
      request: 'continue',
      interactionMode: 'operator',
      ledger,
      setupResult: setupReadyResult(),
    });
    expect(step?.action).toBe('repair_state');
  });

  it('recovers failed tasks before replanning when no ready task exists', () => {
    const ledger = makeLedger({
      tasks: {
        version: 1,
        tasks: [makeTask({ status: 'failed' })],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const step = selectDeterministicStep({
      request: 'continue implementation',
      interactionMode: 'operator',
      ledger,
      setupResult: setupReadyResult(),
    });
    expect(step?.action).toBe('recover_failed_tasks');
    expect(step?.args['limit']).toBe(1);
  });

  it('does not repeat repair_state after one repair in same run', () => {
    const ledger = makeLedger({
      tasks: {
        version: 1,
        tasks: [makeTask({ status: 'failed' })],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      orchestration: {
        version: 1,
        sessionId: 'session-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        activeRun: {
          request: 'repair state',
          startedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          completedSteps: [
            {
              action: 'repair_state',
              summary: 'state repaired',
              completedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          lastCompletedStep: {
            action: 'repair_state',
            summary: 'state repaired',
            completedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    const step = selectDeterministicStep({
      request: 'repair state and continue',
      interactionMode: 'operator',
      ledger,
      setupResult: setupReadyResult(),
    });
    expect(step?.action).toBe('recover_failed_tasks');
  });

  it('replans after recovery step if failed tasks remain', () => {
    const ledger = makeLedger({
      tasks: {
        version: 1,
        tasks: [makeTask({ status: 'failed' })],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      orchestration: {
        version: 1,
        sessionId: 'session-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        activeRun: {
          request: 'continue',
          startedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          completedSteps: [
            {
              action: 'recover_failed_tasks',
              summary: 'recovered task',
              completedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          lastCompletedStep: {
            action: 'recover_failed_tasks',
            summary: 'recovered task',
            completedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    const step = selectDeterministicStep({
      request: 'continue',
      interactionMode: 'operator',
      ledger,
      setupResult: setupReadyResult(),
    });
    expect(step?.action).toBe('generate_or_update_tasks');
    expect(step?.args['replan']).toBe(true);
  });
});
