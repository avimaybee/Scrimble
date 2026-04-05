import { beforeEach, describe, expect, it, vi } from 'vitest';

const localMocks = vi.hoisted(() => ({
  appendActivity: vi.fn(),
  getActiveChunk: vi.fn(),
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
    getReplanStatus: vi.fn(),
    resolveCloudClientConfig: vi.fn(),
    startReplan: vi.fn(),
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

import Replan from './replan.js';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function makePlanState() {
  return {
    version: 1,
    architecture: 'test architecture',
    chunks: [
      {
        id: 'chunk-001',
        sequence: 1,
        title: 'Existing chunk',
        prompt: 'Existing prompt',
        status: 'completed',
        doneWhen: 'done',
        createdAt: new Date().toISOString(),
      },
    ],
    metadata: {},
  };
}

describe('replan command cloud error messaging', () => {
  beforeEach(() => {
    localMocks.loadPlanState.mockResolvedValue(makePlanState());
    localMocks.getActiveChunk.mockReturnValue(undefined);
    localMocks.savePlanState.mockResolvedValue(undefined);
    localMocks.writeCurrentChunkFromPlan.mockResolvedValue(undefined);
    localMocks.appendActivity.mockResolvedValue(undefined);

    apiMocks.resolveCloudClientConfig.mockResolvedValue({
      baseUrl: 'https://api.scrimble.dev',
      projectId: 'project-1',
    });
    apiMocks.startReplan.mockResolvedValue({ instanceId: 'project-1', status: 'queued' });
    apiMocks.getReplanStatus.mockResolvedValue({ status: 'completed' });

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

  it('prints parsed cloud start validation error details', async () => {
    apiMocks.startReplan.mockRejectedValue(
      new apiMocks.CloudApiError(
        400,
        JSON.stringify({
          error: 'Invalid replan start payload.',
          issues: [{ message: 'aiConfig.apiKey is required for cloud planning runs.' }],
        }),
      ),
    );

    const logs: string[] = [];
    await Replan.prototype.run.call({
      parse: vi.fn().mockResolvedValue({
        flags: { request: 'Update scope', cloud: true, wait: false },
      }),
      log: (message = '') => {
        logs.push(String(message));
      },
    } as unknown as Replan);

    const normalizedLogs = logs.map(stripAnsi).join('\n');
    expect(normalizedLogs).toContain('Cloud replan start failed: Invalid replan start payload. aiConfig.apiKey is required for cloud planning runs.');
  });

  it('prints parsed cloud wait error message when --wait status polling fails', async () => {
    apiMocks.getReplanStatus.mockRejectedValue(
      new apiMocks.CloudApiError(
        503,
        JSON.stringify({
          message: 'status endpoint unavailable',
        }),
      ),
    );

    const logs: string[] = [];
    await Replan.prototype.run.call({
      parse: vi.fn().mockResolvedValue({
        flags: { request: 'Update scope', cloud: true, wait: true },
      }),
      log: (message = '') => {
        logs.push(String(message));
      },
    } as unknown as Replan);

    const normalizedLogs = logs.map(stripAnsi).join('\n');
    expect(normalizedLogs).toContain('Cloud replan wait failed: status endpoint unavailable');
  });
});
