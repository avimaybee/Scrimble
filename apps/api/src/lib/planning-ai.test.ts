import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig } from '@scrimble/shared';
import { generateInitialPlan, generateReplan } from './planning-ai.js';

describe('planning-ai', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('throws when initial planning aiConfig is omitted', async () => {
    await expect(
      generateInitialPlan({
        goal: 'Ship a robust CLI onboarding flow',
        aiConfig: undefined,
      }),
    ).rejects.toThrow('aiConfig is required for cloud planning');
  });

  it('throws when replan aiConfig is omitted', async () => {
    await expect(
      generateReplan({
        updateRequest: 'Scope now includes OAuth device login hardening',
        currentPlanSummary: '2 completed, 1 active, 3 pending',
        aiConfig: undefined,
      }),
    ).rejects.toThrow('aiConfig is required for cloud replanning');
  });

  it('parses openai-compatible JSON response for initial planning', async () => {
    const aiConfig: AIConfig = {
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
    };

    const responsePayload = {
      choices: [
        {
          message: {
            content:
              '{"architectureSummary":"Cloud-native architecture","chunks":[{"sequence":1,"title":"Chunk A","prompt":"Do A","doneCondition":"A done","verificationHints":["pnpm run lint"]}]}',
          },
        },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
    );

    const result = await generateInitialPlan({
      goal: 'Build cloud planning',
      aiConfig,
    });

    expect(result.architectureSummary).toBe('Cloud-native architecture');
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.title).toBe('Chunk A');
  });

  it('throws when provider returns prose around JSON', async () => {
    const aiConfig: AIConfig = {
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
    };

    const responsePayload = {
      choices: [
        {
          message: {
            content:
              'Here is your result: {"architectureSummary":"Cloud-native architecture","chunks":[{"sequence":1,"title":"Chunk A","prompt":"Do A","doneCondition":"A done"}]}',
          },
        },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
    );

    await expect(
      generateInitialPlan({
        goal: 'Build cloud planning',
        aiConfig,
      }),
    ).rejects.toThrow('raw JSON object');
  });

  it('throws when aiConfig is missing apiKey', async () => {
    const aiConfig: AIConfig = {
      provider: 'openai',
      model: 'gpt-4o',
    };

    await expect(
      generateInitialPlan({
        goal: 'Build cloud planning',
        aiConfig,
      }),
    ).rejects.toThrow('missing apiKey');
  });

  it('throws for unsupported cloud planning provider', async () => {
    const aiConfig: AIConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'test-key',
    };

    await expect(
      generateInitialPlan({
        goal: 'Build cloud planning',
        aiConfig,
      }),
    ).rejects.toThrow('not supported for cloud planning MVP');
  });
});
