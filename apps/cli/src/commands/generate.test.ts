import { beforeEach, describe, expect, it, vi } from 'vitest';

const localMocks = vi.hoisted(() => ({
  appendActivity: vi.fn(),
  loadPlanState: vi.fn(),
  savePlanState: vi.fn(),
  writeCurrentChunkFromPlan: vi.fn(),
}));

const apiMocks = vi.hoisted(() => {
  class MockCloudApiError extends Error {
    constructor(
      public status: number,
      public body: string,
    ) {
      super(`Cloud API request failed (${status})`);
      this.name = 'CloudApiError';
    }

    parseBody<T>(): T | undefined {
      try {
        return JSON.parse(this.body) as T;
      } catch {
        return undefined;
      }
    }
  }

  return {
    CloudApiError: MockCloudApiError,
    formatCloudError: (error: unknown) => {
      if (error instanceof MockCloudApiError) {
        const parsed = error.parseBody<{
          error?: unknown;
          message?: unknown;
          issues?: Array<{ message?: unknown }>;
        }>();
        if (parsed) {
          const errorMessage = typeof parsed.error === 'string' ? parsed.error : undefined;
          const message = typeof parsed.message === 'string' ? parsed.message : undefined;
          const details = Array.isArray(parsed.issues)
            ? parsed.issues
                .map((issue) => (typeof issue.message === 'string' ? issue.message : undefined))
                .filter((value): value is string => Boolean(value))
            : [];
          if (errorMessage && details.length > 0) {
            return `${errorMessage} ${details.join(' ')}`;
          }
          if (errorMessage && message && !message.includes(errorMessage)) {
            return `${errorMessage}: ${message}`;
          }
          if (errorMessage) {
            return errorMessage;
          }
          if (message) {
            return message;
          }
        }
      }
      return error instanceof Error ? error.message : String(error);
    },
    getGenerationStatus: vi.fn(),
    resolveCloudClientConfig: vi.fn(),
    startGeneration: vi.fn(),
  };
});

const configMocks = vi.hoisted(() => ({
  loadScrimbleConfig: vi.fn(),
}));

const telemetryMocks = vi.hoisted(() => ({
  recordTelemetry: vi.fn(),
}));

vi.mock('../lib/local/index.js', () => localMocks);
vi.mock('../lib/api/index.js', () => apiMocks);
vi.mock('../lib/config/load-config.js', () => configMocks);
vi.mock('../lib/telemetry.js', () => telemetryMocks);

import Generate from './generate.js';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function makePlanState() {
  return {
    version: 1,
    chunks: [],
    metadata: {},
  };
}

describe('generate command cloud flow', () => {
  beforeEach(() => {
    localMocks.loadPlanState.mockResolvedValue(makePlanState());
    localMocks.savePlanState.mockResolvedValue(undefined);
    localMocks.writeCurrentChunkFromPlan.mockResolvedValue(undefined);
    localMocks.appendActivity.mockResolvedValue(undefined);

    apiMocks.resolveCloudClientConfig.mockResolvedValue({
      baseUrl: 'https://api.scrimble.dev',
      projectId: 'project-1',
    });
    apiMocks.startGeneration.mockResolvedValue({
      instanceId: 'project-1',
      runId: 'run-1',
      status: 'queued',
    });
    apiMocks.getGenerationStatus.mockResolvedValue({
      status: 'completed',
      output: {
        architectureSummary: 'Cloud architecture',
        chunks: [
          {
            sequence: 1,
            title: 'Build API',
            prompt: 'Implement API',
            doneCondition: 'API is implemented',
            verificationHints: ['pnpm run test'],
          },
        ],
      },
    });

    configMocks.loadScrimbleConfig.mockResolvedValue({
      ai: {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'secret-key',
        baseUrl: 'https://api.openai.com/v1',
      },
    });

    telemetryMocks.recordTelemetry.mockResolvedValue(undefined);
  });

  it('prints parsed cloud generation start validation errors', async () => {
    apiMocks.startGeneration.mockRejectedValue(
      new apiMocks.CloudApiError(
        400,
        JSON.stringify({
          error: 'Invalid generation start payload.',
          issues: [{ message: 'aiConfig.apiKey is required for cloud planning runs.' }],
        }),
      ),
    );

    const logs: string[] = [];
    await expect(Generate.prototype.run.call({
      parse: vi.fn().mockResolvedValue({
        flags: { goal: 'Ship runtime', wait: false, apply: true },
      }),
      log: (message = '') => {
        logs.push(String(message));
      },
      exit: (code?: number) => {
        throw new Error(`EXIT_${String(code ?? 0)}`);
      },
    } as unknown as Generate)).rejects.toThrow('EXIT_1');

    const normalizedLogs = logs.map(stripAnsi).join('\n');
    expect(normalizedLogs).toContain('Cloud generation start failed: Invalid generation start payload. aiConfig.apiKey is required for cloud planning runs.');
  });

  it('applies completed cloud generation output to local plan when waiting', async () => {
    const logs: string[] = [];
    await Generate.prototype.run.call({
      parse: vi.fn().mockResolvedValue({
        flags: { goal: 'Ship runtime', wait: true, apply: true },
      }),
      log: (message = '') => {
        logs.push(String(message));
      },
      exit: (code?: number) => {
        throw new Error(`EXIT_${String(code ?? 0)}`);
      },
    } as unknown as Generate);

    expect(localMocks.savePlanState).toHaveBeenCalledWith(
      expect.objectContaining({
        architecture: expect.objectContaining({
          summary: 'Cloud architecture',
        }),
        chunks: [
          expect.objectContaining({
            title: 'Build API',
            status: 'active',
            doneWhen: 'API is implemented',
          }),
        ],
      }),
    );
    expect(localMocks.writeCurrentChunkFromPlan).toHaveBeenCalledTimes(1);
    expect(localMocks.appendActivity).toHaveBeenCalledWith(
      'plan_generated',
      expect.objectContaining({
        cloudRunId: 'run-1',
        waited: true,
        finalStatus: 'completed',
        applied: true,
      }),
    );

    const normalizedLogs = logs.map(stripAnsi).join('\n');
    expect(normalizedLogs).toContain('Plan generated from cloud output and applied locally.');
  });
});
