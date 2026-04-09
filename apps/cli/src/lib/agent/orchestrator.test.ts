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
  createLanguageModel: vi.fn(),
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
import type { AgentPlan, AgentToolCall } from './types.js';

function makeLedger(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: {
      version: 1,
      tasks: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    assignments: {
      version: 1,
      assignments: [],
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

describe('conversational orchestrator tool loop', () => {
  beforeEach(() => {
    toolMocks.runAgentTool.mockReset();
    aiMocks.generateText.mockReset();
    fsMocks.access.mockResolvedValue(undefined);
    ledgerStorageMocks.readLedger.mockReset();
    ledgerStorageMocks.mutateLedger.mockReset();
    configMocks.loadScrimbleConfig.mockResolvedValue({
      schemaVersion: 1,
      ai: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' },
    });
    providerMocks.createLanguageModel.mockReturnValue({ model: 'mock' });
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
        action: 'check_status',
        summary: 'status ok',
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
        action: 'check_status',
        summary: 'status ok',
        details: [],
      };
    });

    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const plan = await orchestrator.proposePlan('ship feature');

    expect(plan.calls.map((call) => call.action)).toEqual(['check_setup', 'configure_ai']);
    expect(plan.requiresConfirmation).toBe(true);
    expect(aiMocks.generateText).not.toHaveBeenCalled();
    expect(toolMocks.runAgentTool).toHaveBeenCalledWith(
      'check_setup',
      expect.objectContaining({ request: 'ship feature' }),
      {},
    );
    expect(ledgerStorageMocks.mutateLedger).toHaveBeenCalled();
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
    expect(ledgerStorageMocks.mutateLedger).toHaveBeenCalled();
  });

  it('executes only mutating calls from a proposed plan', async () => {
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
    const progress: string[] = [];
    const result = await orchestrator.executePlan(plan, {
      onProgress: (line: string) => progress.push(line),
    });

    expect(toolMocks.runAgentTool).toHaveBeenCalledTimes(1);
    expect(toolMocks.runAgentTool).toHaveBeenCalledWith(
      'execute_tasks',
      expect.objectContaining({ request: 'ship auth' }),
      { worker: 'auto' },
      expect.objectContaining({ execute: expect.any(Object) }),
    );
    expect(ledgerStorageMocks.mutateLedger).toHaveBeenCalled();
    expect(result.results).toHaveLength(2);
    expect(progress.length).toBeGreaterThan(0);
  });

  it('continues looping after execute_tasks and uses bounded execution defaults', async () => {
    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const makePlan = (id: string, request: string, calls: AgentToolCall[]): AgentPlan => ({
      id,
      request,
      goal: request,
      calls,
      steps: calls.map((call) => ({
        action: call.action,
        summary: call.action,
        mutating: call.mutating,
      })),
      previewResults: [],
      requiresConfirmation: calls.some((call) => call.mutating),
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const proposeSpy = vi.spyOn(orchestrator, 'proposePlan')
      .mockResolvedValueOnce(makePlan('p1', 'ship feature', [
        { id: 'c1', action: 'execute_tasks', args: {}, mutating: true },
      ]))
      .mockResolvedValueOnce(makePlan('p2', 'ship feature', [
        { id: 'c2', action: 'generate_or_update_tasks', args: {}, mutating: true },
      ]))
      .mockResolvedValueOnce(makePlan('p3', 'ship feature', [
        { id: 'c3', action: 'check_status', args: {}, mutating: false },
      ]));

    const executeSpy = vi.spyOn(orchestrator, 'executePlan')
      .mockResolvedValueOnce({
        summary: 'execute step',
        results: [{ action: 'execute_tasks', summary: 'executed one task', details: ['Failed tasks: none', 'Conflicted tasks: none'] }],
      })
      .mockResolvedValueOnce({
        summary: 'task graph step',
        results: [{ action: 'generate_or_update_tasks', summary: 'updated graph', details: [] }],
      });

    const result = await orchestrator.runRequest('ship feature', {
      interactionMode: 'operator',
      autoConfirm: true,
    });

    expect(result.status).toBe('paused');
    expect(result.reason).toBe('no_next_action');
    expect(proposeSpy).toHaveBeenCalledTimes(3);
    expect(executeSpy).toHaveBeenCalledTimes(2);
    expect(executeSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        calls: [expect.objectContaining({ action: 'execute_tasks', args: expect.objectContaining({ parallel: 1, maxTasks: 1 }) })],
      }),
      expect.objectContaining({ parallel: 1, maxTasks: 1 }),
    );
  });

  it('requires boundary confirmation for bounded execution in balanced mode', async () => {
    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    vi.spyOn(orchestrator, 'proposePlan').mockResolvedValue({
      id: 'p1',
      request: 'run tasks',
      goal: 'run tasks',
      calls: [{ id: 'c1', action: 'execute_tasks', args: {}, mutating: true }],
      steps: [{ action: 'execute_tasks', summary: 'execute', mutating: true }],
      previewResults: [],
      requiresConfirmation: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const executeSpy = vi.spyOn(orchestrator, 'executePlan').mockResolvedValue({
      summary: 'executed',
      results: [{ action: 'execute_tasks', summary: 'executed', details: ['Failed tasks: none', 'Conflicted tasks: none'] }],
    });

    const boundaryResolver = vi.fn().mockResolvedValue({ kind: 'pause' });
    const result = await orchestrator.runRequest('run tasks', {
      interactionMode: 'balanced',
      resolveBoundary: boundaryResolver,
    });

    expect(result.status).toBe('paused');
    expect(result.boundary?.action).toBe('execute_tasks');
    expect(boundaryResolver).toHaveBeenCalledTimes(1);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('normalizes broad execute scope to single-task execution in conversational mode', async () => {
    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const makePlan = (id: string, request: string, calls: AgentToolCall[]): AgentPlan => ({
      id,
      request,
      goal: request,
      calls,
      steps: calls.map((call) => ({ action: call.action, summary: call.action, mutating: call.mutating })),
      previewResults: [],
      requiresConfirmation: calls.some((call) => call.mutating),
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    vi.spyOn(orchestrator, 'proposePlan')
      .mockResolvedValueOnce(makePlan('p1', 'run broadly', [
        { id: 'c1', action: 'execute_tasks', args: { parallel: 2, maxTasks: 3 }, mutating: true },
      ]))
      .mockResolvedValueOnce(makePlan('p2', 'run broadly', [
        { id: 'c2', action: 'check_status', args: {}, mutating: false },
      ]));
    const executeSpy = vi.spyOn(orchestrator, 'executePlan').mockResolvedValue({
      summary: 'executed',
      results: [{ action: 'execute_tasks', summary: 'executed', details: ['Failed tasks: none', 'Conflicted tasks: none'] }],
    });
    const boundaryResolver = vi.fn().mockResolvedValue({ kind: 'pause' });
    const result = await orchestrator.runRequest('run broadly', {
      interactionMode: 'operator',
      resolveBoundary: boundaryResolver,
    });

    expect(result.status).toBe('paused');
    expect(result.reason).toBe('no_next_action');
    expect(boundaryResolver).not.toHaveBeenCalled();
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        calls: [expect.objectContaining({ action: 'execute_tasks', args: expect.objectContaining({ parallel: 1, maxTasks: 1 }) })],
      }),
      expect.objectContaining({ parallel: 1, maxTasks: 1 }),
    );
  });

  it('absorbs redirects inside orchestrator loop', async () => {
    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const makePlan = (request: string, calls: AgentToolCall[]): AgentPlan => ({
      id: `p-${request}`,
      request,
      goal: request,
      calls,
      steps: calls.map((call) => ({ action: call.action, summary: call.action, mutating: call.mutating })),
      previewResults: [],
      requiresConfirmation: calls.some((call) => call.mutating),
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const proposeSpy = vi.spyOn(orchestrator, 'proposePlan')
      .mockResolvedValueOnce(makePlan('initial work', [
        { id: 'c1', action: 'generate_or_update_tasks', args: {}, mutating: true },
      ]))
      .mockResolvedValueOnce(makePlan('show status', [
        { id: 'c2', action: 'check_status', args: {}, mutating: false },
      ]));
    vi.spyOn(orchestrator, 'executePlan').mockResolvedValue({
      summary: 'status ok',
      results: [{ action: 'check_status', summary: 'status ok', details: [] }],
    });

    const result = await orchestrator.runRequest('initial work', {
      interactionMode: 'guide',
      resolveBoundary: vi.fn().mockResolvedValue({ kind: 'redirect', request: 'show status' }),
    });

    expect(result.status).toBe('completed');
    expect(result.lastRequest).toBe('show status');
    expect(proposeSpy).toHaveBeenNthCalledWith(2, 'show status', expect.any(Object));
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
          stepCount: 2,
          completedSteps: [],
          pendingBoundary: {
            id: 'boundary-1',
            action: 'execute_tasks',
            actionSummary: 'Start working through the planned tasks.',
            reason: 'Execution requires confirmation.',
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
          stepCount: 1,
          completedSteps: [],
          pendingBoundary: {
            id: 'boundary-1',
            action: 'execute_tasks',
            actionSummary: 'Start working through the planned tasks.',
            reason: 'Execution requires confirmation.',
            scope: { parallel: 1, maxTasks: 1, args: {} },
            choices: ['proceed', 'pause', 'redirect'],
            requestedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });

    const orchestrator = new ConversationalOrchestrator('D:\\repo');
    const makePlan = (request: string, calls: AgentToolCall[]): AgentPlan => ({
      id: `p-${request}`,
      request,
      goal: request,
      calls,
      steps: calls.map((call) => ({ action: call.action, summary: call.action, mutating: call.mutating })),
      previewResults: [],
      requiresConfirmation: calls.some((call) => call.mutating),
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const proposeSpy = vi.spyOn(orchestrator, 'proposePlan').mockResolvedValue(
      makePlan('show status', [{ id: 'c1', action: 'check_status', args: {}, mutating: false }]),
    );
    vi.spyOn(orchestrator, 'executePlan').mockResolvedValue({
      summary: 'status ok',
      results: [{ action: 'check_status', summary: 'status ok', details: [] }],
    });

    const result = await orchestrator.resumeActiveRun({
      interactionMode: 'guide',
      resolveBoundary: vi.fn().mockResolvedValue({ kind: 'redirect', request: 'show status' }),
    });

    expect(result.lastRequest).toBe('show status');
    expect(proposeSpy).toHaveBeenCalledWith('show status', expect.any(Object));
  });
});
