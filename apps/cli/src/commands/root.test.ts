import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const orchestratorMocks = vi.hoisted(() => ({
  runRequest: vi.fn(),
  resumeActiveRun: vi.fn(),
  loadSessionState: vi.fn(),
}));

const shellMocks = vi.hoisted(() => ({
  runOperatorShell: vi.fn(),
}));

const configMocks = vi.hoisted(() => ({
  loadScrimbleConfig: vi.fn(),
}));

const discoveryMocks = vi.hoisted(() => ({
  ensureDiscoveryFoundation: vi.fn(),
}));

vi.mock('../lib/agent/orchestrator.js', () => ({
  ConversationalOrchestrator: class {
    runRequest = orchestratorMocks.runRequest;
    resumeActiveRun = orchestratorMocks.resumeActiveRun;
    loadSessionState = orchestratorMocks.loadSessionState;
  },
}));
vi.mock('../lib/shell/run-operator-shell.js', () => shellMocks);
vi.mock('../lib/config/load-config.js', () => configMocks);
vi.mock('../lib/discovery/plaintext.js', () => discoveryMocks);

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

function validConfig(mode: 'guide' | 'balanced' | 'operator' = 'guide') {
  return {
    schemaVersion: 2,
    activeProfileId: 'profile-openai',
    profiles: [
      {
        id: 'profile-openai',
        name: 'OpenAI profile',
        provider: 'openai',
        modelStrategy: 'explicit',
        model: 'gpt-4o',
        auth: {
          strategy: 'api_key',
          apiKey: 'sk-test',
        },
      },
    ],
    interactionMode: mode,
  };
}

describe('root conversational command', () => {
  const stdinTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const stdoutTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

  beforeEach(() => {
    orchestratorMocks.runRequest.mockReset();
    orchestratorMocks.resumeActiveRun.mockReset();
    orchestratorMocks.loadSessionState.mockReset();
    shellMocks.runOperatorShell.mockReset();
    configMocks.loadScrimbleConfig.mockReset();
    discoveryMocks.ensureDiscoveryFoundation.mockReset();
    orchestratorMocks.loadSessionState.mockResolvedValue(null);
    orchestratorMocks.resumeActiveRun.mockResolvedValue(completedResult('resumed'));
    configMocks.loadScrimbleConfig.mockResolvedValue(validConfig());
    discoveryMocks.ensureDiscoveryFoundation.mockResolvedValue(true);
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
    expect(discoveryMocks.ensureDiscoveryFoundation).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'show status',
    }));
    expect(shellMocks.runOperatorShell).not.toHaveBeenCalled();
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

  it('exits when one-shot discovery cannot continue', async () => {
    discoveryMocks.ensureDiscoveryFoundation.mockResolvedValue(false);

    const logs: string[] = [];
    const command = makeCommand(
      {
        flags: { prompt: 'run tasks', yes: false, verbose: false },
        argv: [],
      },
      logs,
    );

    await expect(command.run()).rejects.toThrow('EXIT_1');
    expect(orchestratorMocks.runRequest).not.toHaveBeenCalled();
  });

  it('launches the operator shell in interactive mode without prompt', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    configMocks.loadScrimbleConfig.mockResolvedValue({
      ...validConfig('balanced'),
      profiles: [
        {
          id: 'profile-openai',
          name: 'OpenAI profile',
          provider: 'openai',
          modelStrategy: 'explicit',
          model: 'gpt-5',
          auth: {
            strategy: 'api_key',
            apiKey: 'sk-test',
          },
        },
      ],
    });
    shellMocks.runOperatorShell.mockResolvedValue(undefined);

    const logs: string[] = [];
    const command = makeCommand(
      {
        flags: { prompt: undefined, yes: false, verbose: true },
        argv: [],
      },
      logs,
    );

    await command.run();

    expect(shellMocks.runOperatorShell).toHaveBeenCalledWith(expect.objectContaining({
      interactionMode: 'balanced',
      config: expect.objectContaining({
        activeProfileId: 'profile-openai',
      }),
      verbose: true,
    }));
    expect(orchestratorMocks.runRequest).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('does not launch shell in one-shot prompt mode even when interactive', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    orchestratorMocks.runRequest.mockResolvedValue(completedResult('Prompt completed'));

    const logs: string[] = [];
    const command = makeCommand(
      {
        flags: { prompt: 'summarize', yes: false, verbose: false },
        argv: [],
      },
      logs,
    );

    await command.run();

    expect(orchestratorMocks.runRequest).toHaveBeenCalledTimes(1);
    expect(shellMocks.runOperatorShell).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Prompt completed');
  });

  it('requires --prompt in non-interactive mode', async () => {
    const logs: string[] = [];
    const command = makeCommand(
      {
        flags: { prompt: undefined, yes: false, verbose: false },
        argv: [],
      },
      logs,
    );

    await expect(command.run()).rejects.toThrow('EXIT_1');
    expect(logs.join('\n')).toContain('Provide a request with `scrimble --prompt');
    expect(shellMocks.runOperatorShell).not.toHaveBeenCalled();
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
