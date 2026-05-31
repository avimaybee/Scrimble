import { describe, expect, it } from 'vitest';
import type { OperatorBoundary, OperatorEvent } from '../../lib/agent/types.js';
import { buildStartupTranscript, mapOperatorEventToTranscript, mapRunOutcomeToTranscript } from './OperatorShell.js';
import type { StartupContext } from './types.js';

const boundary: OperatorBoundary = {
  id: 'boundary-1',
  action: 'execute_tasks',
  actionSummary: 'Start working through the planned tasks.',
  reason: 'Execution requires confirmation.',
  scope: { parallel: 1, maxTasks: 1, args: {} },
  choices: ['proceed', 'pause', 'redirect'],
};

describe('OperatorShell transcript helpers', () => {
  it('builds startup transcript with active run and boundary context', () => {
    const startup: StartupContext = {
      repoName: 'Scrimble',
      repoPath: 'D:\\vs code\\Scrimble',
      mode: 'operator',
      hasConfig: true,
      profileValid: true,
      hasScrimbleDir: true,
      foundationReady: true,
      recoveryState: 'idle',
      recoveryActions: [],
      recentOutcomes: [],
      activeRunRequest: 'finish migration',
      pendingBoundary: boundary,
    };

    const transcript = buildStartupTranscript(startup);
    expect(transcript.map((entry) => entry.kind)).toContain('approval_needed');
    expect(transcript.map((entry) => entry.message).join('\n')).toContain('finish migration');
  });

  it('maps operator events to typed transcript entries', () => {
    const event: OperatorEvent = {
      type: 'step_completed',
      request: 'test',
      message: 'Generated tasks.',
      result: {
        action: 'generate_or_update_tasks',
        summary: 'Created task graph',
        details: ['Added 3 tasks'],
      },
    };
    const mapped = mapOperatorEventToTranscript(event);
    expect(mapped).toMatchObject({
      kind: 'step_completed',
      message: 'Generated tasks.',
      details: ['Added 3 tasks'],
    });
  });

  it('maps run outcomes to paused entries with reason details', () => {
    const entry = mapRunOutcomeToTranscript({
      status: 'paused',
      summary: 'Waiting for approval.',
      reason: 'boundary_pending',
      lastRequest: 'run tasks',
      boundary,
      results: [],
    });
    expect(entry.kind).toBe('paused');
    expect(entry.details).toEqual(['boundary_pending']);
  });
});
