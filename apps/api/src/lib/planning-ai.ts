import { aiConfigSchema } from '@scrimble/shared';
import { z } from 'zod';
import type { PersistedPlanChunk } from './persistence.js';

type ParsedAIConfig = z.infer<typeof aiConfigSchema>;

const chunkSchema = z.object({
  sequence: z.number().int().positive(),
  title: z.string().min(1),
  prompt: z.string().min(1),
  doneCondition: z.string().min(1),
  doNotTouch: z.string().optional(),
  verificationHints: z.array(z.string()).optional(),
});

const initialPlanSchema = z.object({
  architectureSummary: z.string().min(1),
  chunks: z.array(chunkSchema).min(1),
});

const replanSchema = z.object({
  revisedPlanSummary: z.string().min(1),
  chunks: z.array(chunkSchema).min(1),
});

interface InitialPlanInput {
  goal: string;
  repoSnapshot?: string;
  aiConfig?: unknown;
}

interface ReplanInput {
  updateRequest: string;
  currentPlanSummary?: string;
  aiConfig?: unknown;
}

interface OpenAICompatibleChoice {
  message?: { content?: string | null };
}

interface OpenAICompatibleResponse {
  choices?: OpenAICompatibleChoice[];
}

interface AnthropicContentBlock {
  type?: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
}

interface GeminiPart {
  text?: string;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

function defaultBaseUrl(provider: ParsedAIConfig['provider']): string | undefined {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'github-copilot':
      return 'https://api.githubcopilot.com';
    case 'groq':
      return 'https://api.groq.com/openai/v1';
    case 'together':
      return 'https://api.together.xyz/v1';
    case 'anthropic':
      return 'https://api.anthropic.com/v1';
    case 'google':
      return 'https://generativelanguage.googleapis.com/v1beta';
    case 'azure':
      return undefined;
    default:
      return undefined;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function extractJsonValue(text: string): unknown {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  if (!candidate) {
    throw new Error('Model response was empty.');
  }

  const trimmed = candidate.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('Model response did not contain parseable JSON.');
    }
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  }
}

function buildInitialPrompt(input: { goal: string; repoSnapshot?: string }): string {
  return [
    'You are Scrimble cloud planner. Produce implementation planning output as strict JSON.',
    '',
    'Output JSON schema:',
    '{',
    '  "architectureSummary": "string",',
    '  "chunks": [',
    '    {',
    '      "sequence": 1,',
    '      "title": "string",',
    '      "prompt": "string",',
    '      "doneCondition": "string",',
    '      "doNotTouch": "string (optional)",',
    '      "verificationHints": ["string"]',
    '    }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Cloudflare backend boundary (Workers + D1 + R2 + Durable Objects).',
    '- CLI-first execution model with one active chunk at a time.',
    '- Generate 3 to 7 concrete chunks with sequence starting at 1.',
    '- Chunks must be implementation-ready and verifiable.',
    '- Return JSON only, no prose outside JSON.',
    '',
    `Project goal: ${input.goal}`,
    input.repoSnapshot ? `Repository snapshot:\n${input.repoSnapshot}` : 'Repository snapshot: not supplied.',
  ].join('\n');
}

function buildReplanPrompt(input: { updateRequest: string; currentPlanSummary?: string }): string {
  return [
    'You are Scrimble cloud replanner. Produce revised remaining plan as strict JSON.',
    '',
    'Output JSON schema:',
    '{',
    '  "revisedPlanSummary": "string",',
    '  "chunks": [',
    '    {',
    '      "sequence": 1,',
    '      "title": "string",',
    '      "prompt": "string",',
    '      "doneCondition": "string",',
    '      "doNotTouch": "string (optional)",',
    '      "verificationHints": ["string"]',
    '    }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Preserve completed work and revise only remaining direction.',
    '- Keep Cloudflare backend boundary and CLI-first execution.',
    '- Generate 2 to 6 revised chunks with sequence starting at 1.',
    '- Return JSON only, no prose outside JSON.',
    '',
    `Replan request: ${input.updateRequest}`,
    input.currentPlanSummary ? `Current plan summary:\n${input.currentPlanSummary}` : 'Current plan summary: not supplied.',
  ].join('\n');
}

function getProviderTextFromResponse(provider: ParsedAIConfig['provider'], response: unknown): string {
  if (provider === 'anthropic') {
    const typed = response as AnthropicResponse;
    const first = typed.content?.find((block) => block.type === 'text' && typeof block.text === 'string');
    if (!first?.text) {
      throw new Error('Anthropic response did not include text content.');
    }
    return first.text;
  }

  if (provider === 'google') {
    const typed = response as GeminiResponse;
    const first = typed.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string');
    if (!first?.text) {
      throw new Error('Google response did not include text content.');
    }
    return first.text;
  }

  const typed = response as OpenAICompatibleResponse;
  const content = typed.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI-compatible response did not include message content.');
  }
  return content;
}

async function callProvider(config: ParsedAIConfig, prompt: string): Promise<string> {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error(`AI config for provider "${config.provider}" is missing apiKey.`);
  }

  const baseUrl = config.baseUrl ?? defaultBaseUrl(config.provider);
  if (!baseUrl) {
    throw new Error(`AI config for provider "${config.provider}" requires baseUrl.`);
  }
  const safeBase = normalizeBaseUrl(baseUrl);

  if (config.provider === 'anthropic') {
    const response = await fetch(`${safeBase}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.options?.maxTokens ?? 4096,
        temperature: config.options?.temperature ?? 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      throw new Error(`Anthropic request failed (${response.status}): ${await response.text()}`);
    }
    return getProviderTextFromResponse(config.provider, (await response.json()) as unknown);
  }

  if (config.provider === 'google') {
    const modelPath = config.model.startsWith('models/') ? config.model : `models/${config.model}`;
    const response = await fetch(`${safeBase}/${modelPath}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: config.options?.temperature ?? 0.2,
          maxOutputTokens: config.options?.maxTokens ?? 4096,
          topP: config.options?.topP,
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Google request failed (${response.status}): ${await response.text()}`);
    }
    return getProviderTextFromResponse(config.provider, (await response.json()) as unknown);
  }

  const response = await fetch(`${safeBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.options?.temperature ?? 0.2,
      max_tokens: config.options?.maxTokens ?? 4096,
      top_p: config.options?.topP,
      messages: [
        {
          role: 'system',
          content: 'Return strictly valid JSON matching the requested schema.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI-compatible request failed (${response.status}): ${await response.text()}`);
  }
  return getProviderTextFromResponse(config.provider, (await response.json()) as unknown);
}

function deterministicInitialPlan(input: { goal: string; repoSnapshot?: string }): {
  architectureSummary: string;
  chunks: PersistedPlanChunk[];
} {
  return {
    architectureSummary: [
      `Goal: ${input.goal}`,
      'CLI-first execution with one active chunk at a time.',
      'Cloudflare Workers + D1 + R2 backend boundary.',
      input.repoSnapshot ? `Repo snapshot: ${input.repoSnapshot}` : 'Repo snapshot: not supplied.',
    ].join('\n'),
    chunks: [
      {
        sequence: 1,
        title: 'Foundation hardening',
        prompt: 'Stabilize CLI and API foundations before adding higher-order orchestration complexity.',
        doneCondition: 'CLI/API runtime validations pass and baseline project health is documented.',
        verificationHints: ['pnpm run lint', 'pnpm run build', 'pnpm test'],
      },
    ],
  };
}

function deterministicReplan(input: { updateRequest: string; currentPlanSummary?: string }): {
  revisedPlanSummary: string;
  chunks: PersistedPlanChunk[];
} {
  return {
    revisedPlanSummary: [
      `Replan request: ${input.updateRequest}`,
      input.currentPlanSummary
        ? `Current plan summary: ${input.currentPlanSummary}`
        : 'Current plan summary: not supplied.',
      'Preserve completed chunks and adjust only future pending chunks.',
    ].join('\n'),
    chunks: [
      {
        sequence: 1,
        title: 'Apply replan changes',
        prompt: `Apply requested plan update: ${input.updateRequest}`,
        doneCondition: 'Requested update is reflected in implementation and validated.',
        verificationHints: ['scrimble verify', 'scrimble status'],
      },
    ],
  };
}

function toPersistedChunks(chunks: z.infer<typeof chunkSchema>[]): PersistedPlanChunk[] {
  return chunks.map((chunk) => ({
    sequence: chunk.sequence,
    title: chunk.title,
    prompt: chunk.prompt,
    doneCondition: chunk.doneCondition,
    ...(chunk.doNotTouch ? { doNotTouch: chunk.doNotTouch } : {}),
    ...(chunk.verificationHints ? { verificationHints: chunk.verificationHints } : {}),
  }));
}

export async function generateInitialPlan(input: InitialPlanInput): Promise<{
  architectureSummary: string;
  chunks: PersistedPlanChunk[];
}> {
  if (!input.aiConfig) {
    return deterministicInitialPlan(input);
  }

  const validated = aiConfigSchema.parse(input.aiConfig);
  const prompt = buildInitialPrompt({
    goal: input.goal,
    ...(input.repoSnapshot ? { repoSnapshot: input.repoSnapshot } : {}),
  });
  const responseText = await callProvider(validated, prompt);
  const parsed = initialPlanSchema.parse(extractJsonValue(responseText));
  return {
    architectureSummary: parsed.architectureSummary,
    chunks: toPersistedChunks(parsed.chunks),
  };
}

export async function generateReplan(input: ReplanInput): Promise<{
  revisedPlanSummary: string;
  chunks: PersistedPlanChunk[];
}> {
  if (!input.aiConfig) {
    return deterministicReplan(input);
  }

  const validated = aiConfigSchema.parse(input.aiConfig);
  const prompt = buildReplanPrompt({
    updateRequest: input.updateRequest,
    ...(input.currentPlanSummary ? { currentPlanSummary: input.currentPlanSummary } : {}),
  });
  const responseText = await callProvider(validated, prompt);
  const parsed = replanSchema.parse(extractJsonValue(responseText));
  return {
    revisedPlanSummary: parsed.revisedPlanSummary,
    chunks: toPersistedChunks(parsed.chunks),
  };
}
