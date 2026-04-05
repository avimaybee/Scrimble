import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig } from '@scrimble/shared';
import { generateInitialPlan, generateReplan } from './planning-ai.js';

describe('planning-ai', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns deterministic initial plan when aiConfig is omitted', async () => {
    const result = await generateInitialPlan({
      goal: 'Ship a robust CLI onboarding flow',
    });

    expect(result.architectureSummary).toContain('Goal: Ship a robust CLI onboarding flow');
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0]?.doneCondition).toBeTruthy();
  });

  it('returns deterministic replan output when aiConfig is omitted', async () => {
    const result = await generateReplan({
      updateRequest: 'Scope now includes OAuth device login hardening',
      currentPlanSummary: '2 completed, 1 active, 3 pending',
    });

    expect(result.revisedPlanSummary).toContain('Replan request: Scope now includes OAuth device login hardening');
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0]?.title).toBeTruthy();
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
            content: [
              '```json',
              '{"architectureSummary":"Cloud-native architecture","chunks":[{"sequence":1,"title":"Chunk A","prompt":"Do A","doneCondition":"A done","verificationHints":["pnpm run lint"]}]}',
              '```',
            ].join('\n'),
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
});
