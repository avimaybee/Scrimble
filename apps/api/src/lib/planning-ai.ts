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
  aiConfig: unknown;
}

interface ReplanInput {
  updateRequest: string;
  currentPlanSummary?: string;
  aiConfig: unknown;
}

interface OpenAICompatibleChoice {
  message?: { content?: string | null };
}

interface OpenAICompatibleResponse {
  choices?: OpenAICompatibleChoice[];
}

interface NormalizedOpenAICompatibleConfig {
  provider: ParsedAIConfig['provider'];
  model: string;
  apiKey: string;
  baseUrl: string;
  options?: ParsedAIConfig['options'];
}

const OPENAI_COMPATIBLE_PROVIDERS = new Set<ParsedAIConfig['provider']>([
  'openai',
  'openrouter',
  'github-copilot',
  'groq',
  'together',
  'azure',
]);

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
    case 'azure':
      return undefined;
    default:
      return undefined;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function parseRawJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Model response was empty.');
  }
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new Error('Model response must be a raw JSON object with no markdown or prose.');
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    throw new Error(
      `Model response JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
    );
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
    '- Return only one raw JSON object (no markdown fences, no prose, no commentary).',
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
    '- Return only one raw JSON object (no markdown fences, no prose, no commentary).',
    '',
    `Replan request: ${input.updateRequest}`,
    input.currentPlanSummary ? `Current plan summary:\n${input.currentPlanSummary}` : 'Current plan summary: not supplied.',
  ].join('\n');
}

function getOpenAICompatibleText(response: unknown): string {
  const typed = response as OpenAICompatibleResponse;
  const content = typed.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI-compatible response did not include message content.');
  }
  return content;
}

function normalizeOpenAICompatibleConfig(config: ParsedAIConfig): NormalizedOpenAICompatibleConfig {
  if (!OPENAI_COMPATIBLE_PROVIDERS.has(config.provider)) {
    throw new Error(
      `Provider "${config.provider}" is not supported for cloud planning MVP. Use an OpenAI-compatible provider.`,
    );
  }

  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error(`AI config for provider "${config.provider}" is missing apiKey.`);
  }
  const baseUrl = config.baseUrl ?? defaultBaseUrl(config.provider);
  if (!baseUrl) {
    throw new Error(`AI config for provider "${config.provider}" requires baseUrl.`);
  }

  return {
    provider: config.provider,
    model: config.model,
    apiKey,
    baseUrl: normalizeBaseUrl(baseUrl),
    ...(config.options ? { options: config.options } : {}),
  };
}

async function callOpenAICompatible(config: NormalizedOpenAICompatibleConfig, prompt: string): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.options?.temperature ?? 0.2,
      max_tokens: config.options?.maxTokens ?? 4096,
      top_p: config.options?.topP,
      messages: [
        {
          role: 'system',
          content: 'Return strictly one raw JSON object matching the requested schema.',
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
  return getOpenAICompatibleText((await response.json()) as unknown);
}

export async function generateInitialPlan(input: InitialPlanInput): Promise<{
  architectureSummary: string;
  chunks: PersistedPlanChunk[];
}> {
  if (!input.aiConfig) {
    throw new Error('aiConfig is required for cloud planning.');
  }
  const validated = aiConfigSchema.parse(input.aiConfig);
  const config = normalizeOpenAICompatibleConfig(validated);
  const prompt = buildInitialPrompt({
    goal: input.goal,
    ...(input.repoSnapshot ? { repoSnapshot: input.repoSnapshot } : {}),
  });
  const responseText = await callOpenAICompatible(config, prompt);
  const parsed = initialPlanSchema.parse(parseRawJsonObject(responseText));
  return {
    architectureSummary: parsed.architectureSummary,
    chunks: parsed.chunks,
  };
}

export async function generateReplan(input: ReplanInput): Promise<{
  revisedPlanSummary: string;
  chunks: PersistedPlanChunk[];
}> {
  if (!input.aiConfig) {
    throw new Error('aiConfig is required for cloud replanning.');
  }
  const validated = aiConfigSchema.parse(input.aiConfig);
  const config = normalizeOpenAICompatibleConfig(validated);
  const prompt = buildReplanPrompt({
    updateRequest: input.updateRequest,
    ...(input.currentPlanSummary ? { currentPlanSummary: input.currentPlanSummary } : {}),
  });
  const responseText = await callOpenAICompatible(config, prompt);
  const parsed = replanSchema.parse(parseRawJsonObject(responseText));
  return {
    revisedPlanSummary: parsed.revisedPlanSummary,
    chunks: parsed.chunks,
  };
}
