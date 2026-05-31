import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  access: vi.fn(),
}));

const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  tool: vi.fn((spec: unknown) => spec),
}));

const configMocks = vi.hoisted(() => ({
  loadScrimbleConfig: vi.fn(),
}));

const providerMocks = vi.hoisted(() => ({
  createLanguageModelFromScrimbleConfig: vi.fn(),
}));

const toolMocks = vi.hoisted(() => ({
  runAgentTool: vi.fn(),
}));

const ledgerStorageMocks = vi.hoisted(() => ({
  readLedger: vi.fn(),
  mutateLedger: vi.fn(),
  current: null as null | Record<string, unknown>,
}));

vi.mock('node:fs/promises', () => fsMocks);
vi.mock('ai', () => aiMocks);
vi.mock('../config/load-config.js', () => configMocks);
vi.mock('../ai/provider.js', () => providerMocks);
vi.mock('../ledger/storage.js', () => ledgerStorageMocks);
vi.mock('./tools.js', async () => {
  const actual = await vi.importActual<typeof import('./tools.js')>('./tools.js');
  return {
    ...actual,
    runAgentTool: toolMocks.runAgentTool,
  };
});

import { ConversationalOrchestrator, isMutatingPlan } from './orchestrator.js';
import type { AgentPlan } from './types.js';

function makeTask(id: string, status: 'pending' | 'completed' | 'blocked' = 'pending'): Record<string, unknown> {
  return {
    id,
    title: id,
    objective: id,
    doneCriteria: 'done',
    ownedFiles: [`src/${id}.ts`],
    allowedFiles: [],
    verificationCommands: [],
    dependencies: [],
    riskScore: 2,
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    attemptCount: 0,
    maxRetries: 1,
  };
}

function makeLedger(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: {
      version: 1,
      tasks: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    runtime: {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    workers: {
      version: 1,
      workers: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    intent: {
      version: 1,
      intent: null,
      history: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    approval: {
      version: 1,
      approved: false,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    orchestration: {
      version: 1,
      sessionId: 'session-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('conversational orchestrator', () => {
  beforeEach(() => {
    toolMocks.runAgentTool.mockReset();
    aiMocks.generateText.mockReset();
    fsMocks.access.mockResolvedValue(undefined);
    ledgerStorageMocks.readLedger.mockReset();
    ledgerStorageMocks.mutateLedger.mockReset();
    configMocks.loadScrimbleConfig.mockResolvedValue({
      schemaVersion: 2,
      activeProfileId: 'profile-openai',
      profiles: [
        {
          id: 'profile-openai',
          name: 'OpenAI profile',
          provider: 'openai',
          modelStrategy: 'explicit',
          model: 'gpt-4o',
          auth: { strategy: 'api_key', apiKey: 'sk-test' },
        },
      ],
      interactionMode: 'guide',
    });
    providerMocks.createLanguageModelFromScrimbleConfig.mockReturnValue({ model: 'mock' });
    aiMocks.generateText.mockResolvedValue({
      text: 'planned',
      toolCalls: [],
      toolResults: [],
    });
    toolMocks.runAgentTool.mockImplementation(async (action: string) => {
      if (action === 'check_setup') {
        return {
          action: 'check_setup',
          summary: 'Local setup looks ready for planning and execution.',
          details: [],
        };
      }
      return {
        action,
        summary: `${action} ok`,
        details: [],
      };
    });
    ledgerStorageMocks.current = makeLedger();
    ledgerStorageMocks.readLedger.mockImplementation(async () => ledgerStorageMocks.current);
    ledgerStorageMocks.mutateLedger.mockImplementation(async (_cwd: string, mutator: (ledger: unknown) => unknown) => {
      if (!ledgerStorageMocks.current) {
        ledgerStorageMocks.current = makeLedger();
      }
      return mutator(ledgerStorageMocks.current);
    });
  });

  it('returns setup plan when setup checks report missing prerequisites', async () => {
    toolMocks.runAgentTool.mockImplementation(async (action: string) => {
      if (action === 'check_setup') {
        return {
          action: 'check_setup',
          summary: 'Setup needs attention: .scrimble directory is missing.',
          details: ['.scrimble directory is missing.'],
          setupRequired: true,
        };
      }
      return {
        action,
        summary: `${action} ok`,
        details: [],
      };
    });

    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const plan = await orchestrator.proposePlan('ship feature');

    expect(plan.calls.map((call) => call.action)).toEqual(['check_setup', 'configure_ai']);
    expect(plan.requiresConfirmation).toBe(true);
    expect(aiMocks.generateText).not.toHaveBeenCalled();
  });

  it('builds plan from LLM tool calls', async () => {
    aiMocks.generateText.mockResolvedValueOnce({
      text: 'plan',
      toolCalls: [
        {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'check_setup',
          args: {},
        },
        {
          type: 'tool-call',
          toolCallId: 't2',
          toolName: 'generate_or_update_tasks',
          args: { goal: 'Ship auth' },
        },
      ],
      toolResults: [
        {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'check_setup',
          args: {},
          result: { action: 'check_setup', summary: 'setup ok', details: [] },
        },
        {
          type: 'tool-result',
          toolCallId: 't2',
          toolName: 'generate_or_update_tasks',
          args: { goal: 'Ship auth' },
          result: {
            action: 'generate_or_update_tasks',
            summary: 'planned',
            details: ['Arguments: {"goal":"Ship auth"}'],
            dryRun: true,
          },
        },
      ],
    });

    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const plan = await orchestrator.proposePlan('ship auth');

    expect(plan.calls.map((call) => call.action)).toEqual(['check_setup', 'generate_or_update_tasks']);
    expect(plan.previewResults).toHaveLength(2);
    expect(plan.requiresConfirmation).toBe(true);
    expect(isMutatingPlan(plan)).toBe(true);
  });

  it('executes mutating calls from a proposed plan', async () => {
    const plan: AgentPlan = {
      id: 'plan-1',
      request: 'ship auth',
      goal: 'ship auth',
      calls: [
        { id: 'c1', action: 'check_status', args: {}, mutating: false },
        { id: 'c2', action: 'execute_tasks', args: { worker: 'auto' }, mutating: true },
      ],
      steps: [
        { action: 'check_status', summary: 'status', mutating: false },
        { action: 'execute_tasks', summary: 'execute', mutating: true },
      ],
      previewResults: [{ action: 'check_status', summary: 'status ok', details: [], callId: 'c1' }],
      requiresConfirmation: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    toolMocks.runAgentTool.mockResolvedValueOnce({
      action: 'execute_tasks',
      summary: 'executed',
      details: ['done'],
    });

    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const result = await orchestrator.executePlan(plan);

    expect(toolMocks.runAgentTool).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(2);
  });

  it('handles read-only requests deterministically and writes only planning/completion boundaries', async () => {
    toolMocks.runAgentTool.mockImplementation(async (action: string) => {
      if (action === 'check_setup') {
        return { action: 'check_setup', summary: 'setup ok', details: [] };
      }
      if (action === 'check_status') {
        return { action: 'check_status', summary: 'Progress: 0/0 tasks complete.', details: ['Pending tasks: 0'] };
      }
      return { action, summary: `${action} ok`, details: [] };
    });

    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const result = await orchestrator.runRequest('show status', {
      interactionMode: 'operator',
      autoConfirm: true,
    });

    expect(result.status).toBe('completed');
    expect(result.results[0]?.action).toBe('check_status');
    expect(ledgerStorageMocks.mutateLedger).toHaveBeenCalledTimes(2);
    const orchestration = (ledgerStorageMocks.current as Record<string, any>)['orchestration'];
    expect(orchestration.lastRunOutcome.status).toBe('completed');
    expect(orchestration.activeRun).toBeUndefined();
  });

  it('routes missing setup to configure_ai deterministically', async () => {
    toolMocks.runAgentTool.mockImplementation(async (action: string) => {
      if (action === 'check_setup') {
        return {
          action: 'check_setup',
          summary: 'Setup missing.',
          details: ['AI config is missing or invalid.'],
          setupRequired: true,
        };
      }
      return { action, summary: `${action} ok`, details: [] };
    });

    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const resolver = vi.fn().mockResolvedValue({ kind: 'pause' });
    const result = await orchestrator.runRequest('ship feature', {
      interactionMode: 'balanced',
      resolveBoundary: resolver,
    });

    expect(result.status).toBe('paused');
    expect(result.boundary?.action).toBe('configure_ai');
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('pauses with a single setup blocker when setup remains unresolved after configure_ai', async () => {
    let checkSetupCalls = 0;
    let configureCalls = 0;
    toolMocks.runAgentTool.mockImplementation(async (action: string) => {
      if (action === 'check_setup') {
        checkSetupCalls += 1;
        return {
          action: 'check_setup',
          summary: 'Before I can continue, I need to fix: No active AI profile is configured.',
          details: ['No active AI profile is configured.'],
          setupRequired: true,
        };
      }
      if (action === 'configure_ai') {
        configureCalls += 1;
        return {
          action: 'configure_ai',
          summary: 'Updated AI provider profile, but setup/auth still needs attention.',
          details: ['Remaining setup issue: No active AI profile is configured.'],
          setupRequired: true,
        };
      }
      return { action, summary: `${action} ok`, details: [] };
    });

    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const result = await orchestrator.runRequest('continue with planning', {
      interactionMode: 'operator',
      resolveBoundary: vi.fn().mockResolvedValue({ kind: 'proceed' }),
    });

    expect(result.status).toBe('paused');
    expect(result.reason).toBe('setup_required');
    expect(configureCalls).toBe(1);
    expect(checkSetupCalls).toBeGreaterThanOrEqual(2);
  });

  it('pauses for execution approval in balanced mode with a ready task', async () => {
    ledgerStorageMocks.current = makeLedger({
      tasks: {
        version: 1,
        tasks: [makeTask('task-1', 'pending')],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const resolver = vi.fn().mockResolvedValue({ kind: 'pause' });
    const result = await orchestrator.runRequest('ship feature', {
      interactionMode: 'balanced',
      resolveBoundary: resolver,
    });

    expect(result.status).toBe('paused');
    expect(result.boundary?.action).toBe('execute_tasks');
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(toolMocks.runAgentTool).not.toHaveBeenCalledWith(
      'execute_tasks',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('absorbs redirects inside orchestrator loop', async () => {
    ledgerStorageMocks.current = makeLedger({
      tasks: {
        version: 1,
        tasks: [makeTask('task-1', 'pending')],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    toolMocks.runAgentTool.mockImplementation(async (action: string) => {
      if (action === 'check_setup') {
        return { action: 'check_setup', summary: 'setup ok', details: [] };
      }
      if (action === 'check_status') {
        return { action: 'check_status', summary: 'status ok', details: [] };
      }
      return { action, summary: `${action} ok`, details: ['Failed tasks: none', 'Conflicted tasks: none'] };
    });

    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const result = await orchestrator.runRequest('ship feature', {
      interactionMode: 'guide',
      resolveBoundary: vi.fn().mockResolvedValue({ kind: 'redirect', request: 'show status' }),
    });

    expect(result.status).toBe('completed');
    expect(result.lastRequest).toBe('show status');
    expect(result.results.some((entry) => entry.action === 'check_status')).toBe(true);
  });

  it('resumes pending boundaries and pauses when approval is deferred', async () => {
    ledgerStorageMocks.current = makeLedger({
      orchestration: {
        version: 1,
        sessionId: 'session-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        activeRun: {
          request: 'finish migration',
          startedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          pendingBoundary: {
            id: 'boundary-1',
            action: 'execute_tasks',
            actionSummary: 'Start the next task.',
            reason: 'I need your approval to start the next bounded task.',
            scope: { parallel: 1, maxTasks: 1, args: {} },
            choices: ['proceed', 'pause', 'redirect'],
            requestedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });

    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const result = await orchestrator.resumeActiveRun({
      interactionMode: 'balanced',
      resolveBoundary: vi.fn().mockResolvedValue({ kind: 'pause' }),
    });

    expect(result.status).toBe('paused');
    expect(result.boundary?.action).toBe('execute_tasks');
    expect(result.lastRequest).toBe('finish migration');
  });

  it('resumes an approved boundary without requesting the same boundary twice', async () => {
    ledgerStorageMocks.current = makeLedger({
      tasks: {
        version: 1,
        tasks: [makeTask('task-1', 'pending')],
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      orchestration: {
        version: 1,
        sessionId: 'session-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        activeRun: {
          request: 'finish migration',
          startedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          completedSteps: [
            {
              action: 'show_plan',
              summary: 'Plan review complete.',
              completedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          lastCompletedStep: {
            action: 'show_plan',
            summary: 'Plan review complete.',
            completedAt: '2026-01-01T00:00:00.000Z',
          },
          pendingBoundary: {
            id: 'boundary-1',
            action: 'execute_tasks',
            actionSummary: 'Start the next task.',
            reason: 'I need your approval to start the next bounded task.',
            scope: { parallel: 1, maxTasks: 1, args: {} },
            choices: ['proceed', 'pause', 'redirect'],
            requestedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });

    toolMocks.runAgentTool.mockImplementation(async (action: string) => {
      if (action === 'check_setup') {
        return { action: 'check_setup', summary: 'setup ok', details: [] };
      }
      if (action === 'execute_tasks') {
        const ledger = ledgerStorageMocks.current as Record<string, any>;
        const tasks = ledger['tasks']?.['tasks'];
        if (Array.isArray(tasks) && tasks[0]) {
          tasks[0].status = 'completed';
        }
        return {
          action: 'execute_tasks',
          summary: 'Worked through the plan: 1 completed, 0 failed, 0 conflicted.',
          details: ['Failed tasks: none', 'Conflicted tasks: none'],
        };
      }
      return { action, summary: `${action} ok`, details: [] };
    });

    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const resolver = vi.fn().mockResolvedValue({ kind: 'proceed' });
    const result = await orchestrator.resumeActiveRun({
      interactionMode: 'balanced',
      resolveBoundary: resolver,
    });

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(result.reason).not.toBe('I need your approval to start the next bounded task.');
    expect(result.results.some((entry) => entry.action === 'execute_tasks')).toBe(true);
    expect(toolMocks.runAgentTool).toHaveBeenCalledWith(
      'execute_tasks',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('resumes pending boundaries and supports redirect without restating the request', async () => {
    ledgerStorageMocks.current = makeLedger({
      orchestration: {
        version: 1,
        sessionId: 'session-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        activeRun: {
          request: 'finish migration',
          startedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          pendingBoundary: {
            id: 'boundary-1',
            action: 'execute_tasks',
            actionSummary: 'Start the next task.',
            reason: 'I need your approval to start the next bounded task.',
            scope: { parallel: 1, maxTasks: 1, args: {} },
            choices: ['proceed', 'pause', 'redirect'],
            requestedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });

    toolMocks.runAgentTool.mockImplementation(async (action: string) => {
      if (action === 'check_setup') {
        return { action: 'check_setup', summary: 'setup ok', details: [] };
      }
      if (action === 'check_status') {
        return { action: 'check_status', summary: 'status ok', details: [] };
      }
      return { action, summary: `${action} ok`, details: [] };
    });

    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const result = await orchestrator.resumeActiveRun({
      interactionMode: 'guide',
      resolveBoundary: vi.fn().mockResolvedValue({ kind: 'redirect', request: 'show status' }),
    });

    expect(result.status).toBe('completed');
    expect(result.lastRequest).toBe('show status');
  });
});
