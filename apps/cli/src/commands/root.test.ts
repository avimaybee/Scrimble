import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const orchestratorMocks = vi.hoisted(() => ({
  runRequest: vi.fn(),
  resumeActiveRun: vi.fn(),
  loadSessionState: vi.fn(),
}));

const readlineMocks = vi.hoisted(() => ({
  createInterface: vi.fn(),
}));

const configMocks = vi.hoisted(() => ({
  loadScrimbleConfig: vi.fn(),
}));

vi.mock('../lib/agent/orchestrator.js', () => ({
  ConversationalOrchestrator: class {
    runRequest = orchestratorMocks.runRequest;
    resumeActiveRun = orchestratorMocks.resumeActiveRun;
    loadSessionState = orchestratorMocks.loadSessionState;
  },
}));
vi.mock('node:readline/promises', () => readlineMocks);
vi.mock('../lib/config/load-config.js', () => configMocks);

import Root from './root.js';

function makeCommand(parseResult: { flags: Record<string, unknown>; argv: string[] }, logs: string[]): Root {
  const command = Object.create(Root.prototype) as Root & {
    parse: ReturnType<typeof vi.fn>;
    log: (message?: string) => void;
    exit: (code?: number) => never;
  };
  command.parse = vi.fn().mockResolvedValue(parseResult);
  command.log = (message = '') => {
    logs.push(String(message));
  };
  command.exit = (code?: number) => {
    throw new Error(`EXIT_${String(code ?? 0)}`);
  };
  return command as Root;
}

function completedResult(summary = 'Completed.'): {
  status: 'completed';
  summary: string;
  lastRequest: string;
  nextSuggestedAction: string;
  results: never[];
} {
  return {
    status: 'completed',
    summary,
    lastRequest: 'request',
    nextSuggestedAction: 'next',
    results: [],
  };
}

describe('root conversational command', () => {
  const stdinTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const stdoutTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

  beforeEach(() => {
    orchestratorMocks.runRequest.mockReset();
    orchestratorMocks.resumeActiveRun.mockReset();
    orchestratorMocks.loadSessionState.mockReset();
    readlineMocks.createInterface.mockReset();
    configMocks.loadScrimbleConfig.mockReset();
    orchestratorMocks.loadSessionState.mockResolvedValue(null);
    orchestratorMocks.resumeActiveRun.mockResolvedValue(completedResult('resumed'));
    configMocks.loadScrimbleConfig.mockRejectedValue(new Error('missing config'));
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  });

  afterEach(() => {
    if (stdinTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', stdinTTYDescriptor);
    }
    if (stdoutTTYDescriptor) {
      Object.defineProperty(process.stdout, 'isTTY', stdoutTTYDescriptor);
    }
  });

  it('runs one-shot requests through orchestrator runRequest', async () => {
    orchestratorMocks.runRequest.mockResolvedValue(completedResult('Read local status.'));

    const logs: string[] = [];
    const command = makeCommand(
      {
        flags: { prompt: 'show status', yes: false, verbose: false },
        argv: [],
      },
      logs,
    );

    await command.run();

    expect(orchestratorMocks.runRequest).toHaveBeenCalledWith(
      'show status',
      expect.objectContaining({
        interactionMode: 'guide',
        autoConfirm: false,
      }),
    );
    expect(logs.join('\n')).toContain('Report');
    expect(logs.join('\n')).toContain('Read local status.');
  });

  it('fails one-shot mode when operator result is failed', async () => {
    orchestratorMocks.runRequest.mockResolvedValue({
      status: 'failed',
      summary: 'Execution failed: worker crashed',
      lastRequest: 'run tasks',
      nextSuggestedAction: 'retry',
      reason: 'worker crashed',
      results: [],
    });

    const logs: string[] = [];
    const command = makeCommand(
      {
        flags: { prompt: 'run tasks', yes: false, verbose: false },
        argv: [],
      },
      logs,
    );

    await expect(command.run()).rejects.toThrow('EXIT_1');
    expect(logs.join('\n')).toContain('Execution failed: worker crashed');
  });

  it('captures interaction mode during first interactive turn when config is missing', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    orchestratorMocks.runRequest.mockResolvedValue(completedResult('status ok'));
    const question = vi.fn()
      .mockResolvedValueOnce('summarize progress')
      .mockResolvedValueOnce('2')
      .mockResolvedValueOnce('exit');
    readlineMocks.createInterface.mockReturnValue({
      question,
      close: vi.fn(),
    });

    const logs: string[] = [];
    const command = makeCommand(
      {
        flags: { prompt: undefined, yes: false, verbose: false },
        argv: [],
      },
      logs,
    );

    await command.run();
    expect(logs.join('\n')).toContain('How hands-on should I be by default?');
    expect(logs.join('\n')).toContain("I'll default to balanced");
    expect(orchestratorMocks.runRequest).toHaveBeenCalledWith(
      'summarize progress',
      expect.objectContaining({
        interactionMode: 'balanced',
      }),
    );
  });

  it('shows active-run resume hints in interactive mode', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    configMocks.loadScrimbleConfig.mockResolvedValue({ interactionMode: 'guide' });
    orchestratorMocks.loadSessionState.mockResolvedValue({
      version: 1,
      sessionId: 'session-42',
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
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    readlineMocks.createInterface.mockReturnValue({
      question: vi.fn()
        .mockResolvedValueOnce('n')
        .mockResolvedValueOnce('exit'),
      close: vi.fn(),
    });

    const logs: string[] = [];
    const command = makeCommand(
      {
        flags: { prompt: undefined, yes: false, verbose: false },
        argv: [],
      },
      logs,
    );

    await command.run();
    expect(logs.join('\n')).toContain('In-progress request: finish migration');
    expect(logs.join('\n')).toContain('Waiting on approval');
  });

  it('resumes active runs without requiring the user to restate the request', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    configMocks.loadScrimbleConfig.mockResolvedValue({ interactionMode: 'balanced' });
    orchestratorMocks.loadSessionState.mockResolvedValue({
      version: 1,
      sessionId: 'session-42',
      activeRun: {
        request: 'finish migration',
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        stepCount: 2,
        completedSteps: [],
        lastPauseReason: 'Waiting for approval.',
      },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    orchestratorMocks.resumeActiveRun.mockResolvedValue(completedResult('resumed work'));
    const question = vi.fn()
      .mockResolvedValueOnce('y')
      .mockResolvedValueOnce('exit');
    readlineMocks.createInterface.mockReturnValue({
      question,
      close: vi.fn(),
    });

    const logs: string[] = [];
    const command = makeCommand(
      {
        flags: { prompt: undefined, yes: false, verbose: false },
        argv: [],
      },
      logs,
    );

    await command.run();
    expect(orchestratorMocks.resumeActiveRun).toHaveBeenCalledTimes(1);
    expect(orchestratorMocks.runRequest).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('resumed work');
  });

  it('resolves configure boundary and collects setup interactively', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    configMocks.loadScrimbleConfig.mockResolvedValue({ interactionMode: 'guide' });

    let capturedSetup: Record<string, unknown> | undefined;
    let capturedDecision: unknown;
    orchestratorMocks.runRequest.mockImplementation(async (_request: string, options: Record<string, unknown>) => {
      const boundary = {
        id: 'boundary-config',
        action: 'configure_ai',
        actionSummary: 'Set up your model configuration.',
        reason: 'Model configuration changes require explicit confirmation.',
        scope: { parallel: 1, maxTasks: 1, args: {} },
        choices: ['proceed', 'pause', 'redirect'],
      };
      capturedDecision = await (options['resolveBoundary'] as (boundary: unknown) => Promise<unknown>)(boundary);
      capturedSetup = options['setup'] as Record<string, unknown>;
      return completedResult('configured');
    });

    const question = vi.fn()
      .mockResolvedValueOnce('configure model')
      .mockResolvedValueOnce('y')
      .mockResolvedValueOnce('openai')
      .mockResolvedValueOnce('gpt-4o')
      .mockResolvedValueOnce('${OPENAI_API_KEY}')
      .mockResolvedValueOnce('exit');
    readlineMocks.createInterface.mockReturnValue({
      question,
      close: vi.fn(),
    });

    const logs: string[] = [];
    const command = makeCommand(
      {
        flags: { prompt: undefined, yes: false, verbose: false },
        argv: [],
      },
      logs,
    );

    await command.run();
    expect(capturedDecision).toEqual({ kind: 'proceed' });
    expect(capturedSetup).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: '${OPENAI_API_KEY}',
    });
  });

  it('returns redirect decisions from boundary prompts', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    configMocks.loadScrimbleConfig.mockResolvedValue({ interactionMode: 'guide' });

    let capturedDecision: unknown;
    orchestratorMocks.runRequest.mockImplementation(async (_request: string, options: Record<string, unknown>) => {
      const boundary = {
        id: 'boundary-exec',
        action: 'execute_tasks',
        actionSummary: 'Start working through the planned tasks.',
        reason: 'Execution requires confirmation.',
        scope: { parallel: 1, maxTasks: 1, args: {} },
        choices: ['proceed', 'pause', 'redirect'],
      };
      capturedDecision = await (options['resolveBoundary'] as (boundary: unknown) => Promise<unknown>)(boundary);
      return completedResult('redirected');
    });

    const question = vi.fn()
      .mockResolvedValueOnce('implement auth')
      .mockResolvedValueOnce('show status instead')
      .mockResolvedValueOnce('exit');
    readlineMocks.createInterface.mockReturnValue({
      question,
      close: vi.fn(),
    });

    const logs: string[] = [];
    const command = makeCommand(
      {
        flags: { prompt: undefined, yes: false, verbose: false },
        argv: [],
      },
      logs,
    );

    await command.run();
    expect(capturedDecision).toEqual({ kind: 'redirect', request: 'show status instead' });
  });

  it('pauses boundary resolution in non-interactive one-shot mode without --yes', async () => {
    let capturedDecision: unknown;
    orchestratorMocks.runRequest.mockImplementation(async (_request: string, options: Record<string, unknown>) => {
      const boundary = {
        id: 'boundary-pause',
        action: 'execute_tasks',
        actionSummary: 'Start working through the planned tasks.',
        reason: 'Execution requires confirmation.',
        scope: { parallel: 1, maxTasks: 1, args: {} },
        choices: ['proceed', 'pause', 'redirect'],
      };
      capturedDecision = await (options['resolveBoundary'] as (boundary: unknown) => Promise<unknown>)(boundary);
      return {
        status: 'paused',
        summary: 'Paused: Execution requires confirmation.',
        lastRequest: 'run tasks',
        nextSuggestedAction: 'confirm',
        results: [],
      };
    });

    const logs: string[] = [];
    const command = makeCommand(
      {
        flags: { prompt: 'run tasks', yes: false, verbose: false },
        argv: [],
      },
      logs,
    );

    await command.run();
    expect(capturedDecision).toEqual({ kind: 'pause' });
    expect(logs.join('\n')).toContain('Paused: Execution requires confirmation.');
  });
});
