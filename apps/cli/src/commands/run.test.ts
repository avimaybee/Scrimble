import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConductorPlan } from '@scrimble/shared';

const conductorMocks = vi.hoisted(() => ({
  appendRuntimeEvent: vi.fn(),
  completeTaskAttempt: vi.fn(),
  createTaskAttempt: vi.fn(),
  getActiveTrack: vi.fn(),
  getNextTask: vi.fn(),
  isTrackApproved: vi.fn(),
  loadConductorWorkspace: vi.fn(),
  loadRuntimeState: vi.fn(),
  parsePlan: vi.fn(),
  saveRuntimeState: vi.fn(),
  setRunStatus: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

const geminiMocks = vi.hoisted(() => ({
  formatPreflightResult: vi.fn(),
  runPreflight: vi.fn(),
}));

const geminiSessionMocks = vi.hoisted(() => ({
  buildTaskPrompt: vi.fn(),
  getGeminiError: vi.fn(),
  isGeminiSuccess: vi.fn(),
  runGeminiHeadless: vi.fn(),
}));

const verificationMocks = vi.hoisted(() => ({
  formatVerificationResult: vi.fn(),
  verifyTask: vi.fn(),
}));

const recoveryMocks = vi.hoisted(() => ({
  buildAttemptSummary: vi.fn(),
  determineRecoveryAction: vi.fn(),
}));

const telemetryMocks = vi.hoisted(() => ({
  recordTelemetry: vi.fn(),
}));

vi.mock('../lib/conductor/index.js', () => conductorMocks);
vi.mock('../lib/gemini/index.js', () => geminiMocks);
vi.mock('../lib/gemini/session.js', () => geminiSessionMocks);
vi.mock('../lib/conductor/verification.js', () => verificationMocks);
vi.mock('../lib/conductor/recovery.js', () => recoveryMocks);
vi.mock('../lib/telemetry.js', () => telemetryMocks);

import Run from './run.js';

function makePlan(tasks: ConductorPlan['tasks']): ConductorPlan {
  return {
    trackId: 'track-1',
    phases: [],
    tasks,
  };
}

function makeCommand(flags: {
  track?: string;
  'dry-run': boolean;
  verify: boolean;
  timeout: number;
  'max-tasks': number;
}, logs: string[]): Run {
  const command = Object.create(Run.prototype) as Run & {
    parse: ReturnType<typeof vi.fn>;
    log: (message?: string) => void;
    exit: (code?: number) => never;
  };
  command.parse = vi.fn().mockResolvedValue({ flags });
  command.log = (message = '') => {
    logs.push(String(message));
  };
  command.exit = (code?: number) => {
    throw new Error(`EXIT_${String(code ?? 0)}`);
  };
  return command as Run;
}

describe('run command', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    geminiMocks.runPreflight.mockResolvedValue({
      canProceed: true,
      warnings: [],
      errors: [],
      gemini: { available: true, path: 'gemini', version: '1.0.0' },
      conductor: { installed: true, enabled: true },
    });
    geminiMocks.formatPreflightResult.mockReturnValue('ok');

    conductorMocks.loadConductorWorkspace.mockResolvedValue({
      exists: true,
      productPath: undefined,
      guidelinesPath: undefined,
      techStackPath: undefined,
      tracks: [{ id: 'track-1', title: 'Track One', status: 'active', planPath: 'C:\\temp\\plan.md' }],
    });
    conductorMocks.getActiveTrack.mockReturnValue({ id: 'track-1', title: 'Track One', status: 'active', planPath: 'C:\\temp\\plan.md' });
    conductorMocks.isTrackApproved.mockResolvedValue(true);
    conductorMocks.loadRuntimeState.mockResolvedValue({
      status: 'idle',
      activeTrackId: 'track-1',
      attemptCount: 0,
      lastActivityAt: '2026-04-06T00:00:00.000Z',
    });
    conductorMocks.setRunStatus.mockResolvedValue(undefined);
    conductorMocks.appendRuntimeEvent.mockResolvedValue(undefined);
    conductorMocks.saveRuntimeState.mockResolvedValue(undefined);
    conductorMocks.createTaskAttempt.mockResolvedValue({
      id: 'attempt-1',
      taskId: 'task-1',
      trackId: 'track-1',
      startedAt: '2026-04-06T00:00:00.000Z',
      stalled: false,
      promptHash: 'abc123',
    });
    conductorMocks.completeTaskAttempt.mockResolvedValue(undefined);
    conductorMocks.updateTaskStatus.mockResolvedValue(undefined);

    conductorMocks.getNextTask.mockImplementation((plan: ConductorPlan) =>
      plan.tasks.find((task) => task.status === 'in_progress') ??
      plan.tasks.find((task) => task.status === 'pending'),
    );

    geminiSessionMocks.buildTaskPrompt.mockReturnValue('prompt');
    geminiSessionMocks.runGeminiHeadless.mockResolvedValue({
      sessionId: 'session-1',
      exitCode: 0,
      timedOut: false,
      killed: false,
      stdout: 'ok',
      stderr: '',
      json: null,
      durationMs: 1000,
      startedAt: '2026-04-06T00:00:00.000Z',
      endedAt: '2026-04-06T00:00:01.000Z',
    });
    geminiSessionMocks.isGeminiSuccess.mockReturnValue(true);
    geminiSessionMocks.getGeminiError.mockReturnValue('failed');

    recoveryMocks.determineRecoveryAction.mockReturnValue({
      action: 'continue',
      reason: 'ok',
    });
    recoveryMocks.buildAttemptSummary.mockReturnValue('attempt summary');

    verificationMocks.verifyTask.mockResolvedValue({
      passed: true,
      checks: [],
      summary: '0/0 checks passed',
      durationMs: 10,
      timestamp: '2026-04-06T00:00:00.000Z',
    });
    verificationMocks.formatVerificationResult.mockReturnValue('verification ok');

    telemetryMocks.recordTelemetry.mockResolvedValue(undefined);
  });

  it('updates plan task status from pending -> in_progress -> completed on success', async () => {
    conductorMocks.parsePlan
      .mockResolvedValueOnce(
        makePlan([
          {
            id: 'task-1',
            title: 'Build thing',
            status: 'pending',
            substeps: [],
            isManualVerification: false,
            rawMarkdown: '',
          },
        ]),
      )
      .mockResolvedValueOnce(makePlan([]));

    const logs: string[] = [];
    const command = makeCommand(
      {
        'dry-run': false,
        verify: true,
        timeout: 300,
        'max-tasks': 0,
      },
      logs,
    );

    await command.run();

    expect(conductorMocks.updateTaskStatus).toHaveBeenCalledWith('C:\\temp\\plan.md', 'task-1', 'in_progress');
    expect(conductorMocks.updateTaskStatus).toHaveBeenCalledWith('C:\\temp\\plan.md', 'task-1', 'completed');
    expect(conductorMocks.completeTaskAttempt).toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Task completed: Build thing');
  });

  it('pauses at manual verification checkpoints', async () => {
    conductorMocks.parsePlan.mockResolvedValue(
      makePlan([
        {
          id: 'task-manual',
          title: 'Manual verification step',
          status: 'pending',
          substeps: [],
          isManualVerification: true,
          rawMarkdown: '',
        },
      ]),
    );

    const logs: string[] = [];
    const command = makeCommand(
      {
        'dry-run': false,
        verify: true,
        timeout: 300,
        'max-tasks': 0,
      },
      logs,
    );

    await command.run();

    expect(geminiSessionMocks.runGeminiHeadless).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Manual verification required');
  });

  it('dry-run progresses in-memory and exits without invoking Gemini', async () => {
    conductorMocks.parsePlan.mockResolvedValue(
      makePlan([
        {
          id: 'task-1',
          title: 'Task one',
          status: 'pending',
          substeps: [],
          isManualVerification: false,
          rawMarkdown: '',
        },
        {
          id: 'task-2',
          title: 'Task two',
          status: 'pending',
          substeps: [],
          isManualVerification: false,
          rawMarkdown: '',
        },
      ]),
    );

    const logs: string[] = [];
    const command = makeCommand(
      {
        'dry-run': true,
        verify: true,
        timeout: 300,
        'max-tasks': 0,
      },
      logs,
    );

    await command.run();

    expect(geminiSessionMocks.runGeminiHeadless).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('[dry-run] Would execute this task and mark complete');
    expect(logs.join('\n')).toContain('All tasks completed');
  });
});
