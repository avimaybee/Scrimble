import type { ProviderType } from './types';

type StreamCallbacks = {
  onReasoningDelta?: (delta: string) => Promise<void> | void;
};

function extractString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => extractString(item))
      .filter(Boolean)
      .join('');
  }

  return '';
}

function extractTextFromProviderChunk(parsed: unknown): string {
  if (Array.isArray(parsed)) {
    return parsed.map((item) => extractTextFromProviderChunk(item)).join('');
  }

  if (!parsed || typeof parsed !== 'object') {
    return '';
  }

  const value = parsed as {
    choices?: Array<{
      delta?: { content?: string };
      message?: { content?: string };
    }>;
    content?: Array<{ text?: string; type?: string; thinking?: string }>;
    delta?: { text?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  if (value.choices?.[0]?.delta?.content) {
    return value.choices[0].delta.content;
  }

  if (value.choices?.[0]?.message?.content) {
    return value.choices[0].message.content;
  }

  if (value.content?.[0]?.text) {
    return value.content[0].text;
  }

  if (value.delta?.text) {
    return value.delta.text;
  }

  if (value.candidates?.[0]?.content?.parts?.[0]?.text) {
    return value.candidates[0].content.parts[0].text;
  }

  return '';
}

function extractReasoningFromProviderChunk(parsed: unknown): string {
  if (Array.isArray(parsed)) {
    return parsed.map((item) => extractReasoningFromProviderChunk(item)).join('');
  }

  if (!parsed || typeof parsed !== 'object') {
    return '';
  }

  const value = parsed as {
    choices?: Array<{
      delta?: {
        reasoning_content?: string | string[];
        reasoning?: string | string[];
      };
    }>;
    content?: Array<{ type?: string; thinking?: string; text?: string }>;
    delta?: { thinking?: string; text?: string };
  };

  const openAiReasoning =
    extractString(value.choices?.[0]?.delta?.reasoning_content) ||
    extractString(value.choices?.[0]?.delta?.reasoning);

  if (openAiReasoning) {
    return openAiReasoning;
  }

  const anthropicThinking =
    value.content
      ?.filter((block) => block.type === 'thinking')
      .map((block) => extractString(block.thinking || block.text))
      .join('') || '';

  if (anthropicThinking) {
    return anthropicThinking;
  }

  return extractString(value.delta?.thinking);
}

type RecoveredProviderEvent =
  | { kind: 'reasoning'; value: string }
  | { kind: 'content'; value: string };

function recoverProviderEventsFromFragment(fragment: string) {
  const events: RecoveredProviderEvent[] = [];
  let finishReason: string | null = null;
  const fieldPattern = /"(reasoning_content|reasoning|content|finish_reason)":("(?:(?:\\.|[^"\\])*)"|null)/g;

  for (const match of fragment.matchAll(fieldPattern)) {
    const field = match[1];
    const rawValue = match[2];
    if (!rawValue || rawValue === 'null') {
      continue;
    }

    let value = '';
    try {
      const parsedValue = JSON.parse(rawValue) as unknown;
      value = typeof parsedValue === 'string' ? parsedValue : '';
    } catch {
      value = rawValue.replace(/^"|"$/g, '');
    }

    if (!value) {
      continue;
    }

    if (field === 'finish_reason') {
      finishReason = value;
      continue;
    }

    events.push({
      kind: field === 'content' ? 'content' : 'reasoning',
      value,
    });
  }

  return {
    events,
    finishReason,
  };
}

export function extractJSON(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  return raw.trim();
}

export function defaultModelForProvider(provider: ProviderType): string {
  switch (provider) {
    case 'anthropic':
      return 'claude-3-5-sonnet-latest';
    case 'gemini':
      return 'gemini-2.0-flash';
    case 'custom':
      return 'gpt-4o-mini';
    case 'openai':
    default:
      return 'gpt-4o-mini';
  }
}

async function processStreamLine(
  line: string,
  fullContent: { value: string },
  callbacks?: StreamCallbacks,
) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:')) {
    return false;
  }

  const candidate = trimmed.startsWith('data:') ? trimmed.slice(5).trimStart() : trimmed;
  if (!candidate) {
    return false;
  }

  if (candidate === '[DONE]') {
    return true;
  }

  try {
    const parsed = JSON.parse(candidate) as unknown;
    const reasoningDelta = extractReasoningFromProviderChunk(parsed);
    if (reasoningDelta) {
      await callbacks?.onReasoningDelta?.(reasoningDelta);
    }

    const contentDelta = extractTextFromProviderChunk(parsed);
    if (contentDelta) {
      fullContent.value += contentDelta;
    }

    const finishReason = (parsed as { choices?: Array<{ finish_reason?: string | null }> }).choices?.[0]?.finish_reason;
    return finishReason === 'stop';
  } catch {
    const recovered = recoverProviderEventsFromFragment(candidate);
    if (recovered.events.length > 0 || recovered.finishReason) {
      for (const event of recovered.events) {
        if (event.kind === 'reasoning') {
          await callbacks?.onReasoningDelta?.(event.value);
        } else {
          fullContent.value += event.value;
        }
      }

      return recovered.finishReason === 'stop';
    }

    const looksLikeProviderChunk =
      candidate.includes('"object":"chat.completion.chunk"') ||
      candidate.includes('"choices":[') ||
      candidate.includes('"candidates":[');

    if (looksLikeProviderChunk) {
      return false;
    }

    if (!trimmed.startsWith('data:')) {
      fullContent.value += candidate;
    }

    return false;
  }
}

export async function streamToText(stream: ReadableStream<Uint8Array>, callbacks?: StreamCallbacks) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const fullContent = { value: '' };
  let buffer = '';
  let shouldStop = false;

  while (!shouldStop) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      shouldStop = await processStreamLine(line, fullContent, callbacks);
      if (shouldStop) {
        break;
      }
    }
  }

  if (!shouldStop) {
    buffer += decoder.decode();
    if (buffer.trim()) {
      await processStreamLine(buffer, fullContent, callbacks);
    }
  }

  return fullContent.value;
}

const AI_TIMEOUT_MS = 600_000; // 10 minutes

export async function callProvider(payload: {
  providerType: ProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string | null;
  system?: string | null;
  prompt: string;
  signal?: AbortSignal;
}) {
  const commonFetchOptions = {
    method: 'POST',
    signal: payload.signal,
  };

  if (payload.providerType === 'anthropic') {
    return fetch('https://api.anthropic.com/v1/messages', {
      ...commonFetchOptions,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': payload.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: payload.model,
        system: payload.system || undefined,
        messages: [{ role: 'user', content: payload.prompt }],
        max_tokens: 8192,
        stream: true,
      }),
    });
  }

  if (payload.providerType === 'gemini') {
    const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${payload.model}:streamGenerateContent?key=${payload.apiKey}`;
    return fetch(googleUrl, {
      ...commonFetchOptions,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: payload.system ? `${payload.system}\n\n${payload.prompt}` : payload.prompt }],
          },
        ],
      }),
    });
  }

  let url = payload.baseUrl?.trim() || 'https://api.openai.com/v1/chat/completions';

  if (payload.providerType === 'custom' && payload.baseUrl) {
    if (url.endsWith('/v1')) {
      url = `${url}/chat/completions`;
    } else if (!url.includes('/chat/completions') && !url.includes('/v1/')) {
      url = url.endsWith('/') ? `${url}v1/chat/completions` : `${url}/v1/chat/completions`;
    }
  }

  return fetch(url, {
    ...commonFetchOptions,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${payload.apiKey}`,
    },
    body: JSON.stringify({
      model: payload.model,
      messages: [
        ...(payload.system ? [{ role: 'system', content: payload.system }] : []),
        { role: 'user', content: payload.prompt },
      ],
      max_tokens: 16384,
      stream: true,
    }),
  });
}

export async function callAIWithRetry(payload: {
  providerType: ProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string | null;
  system?: string | null;
  prompt: string;
}): Promise<Response> {
  const maxRetries = 3;
  const backoffs = [1000, 3000, 7000];

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      const response = await callProvider({ ...payload, signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        return response;
      }

      if (response.status === 429) {
        return Response.json(
          {
            error: 'rate_limited',
            message: 'Your AI provider is rate limited. Wait a moment and try again.',
          },
          { status: 429 },
        );
      }

      if (response.status === 401) {
        return Response.json(
          {
            error: 'invalid_key',
            message: 'Your AI key was rejected. Check it in Settings.',
          },
          { status: 401 },
        );
      }

      if (attempt < maxRetries && (response.status >= 500 || response.status === 0)) {
        await new Promise((resolve) => setTimeout(resolve, backoffs[attempt]));
        continue;
      }

      return Response.json(
        {
          error: 'provider_unavailable',
          message: "Your AI provider isn't responding. Try again shortly.",
        },
        { status: 503 },
      );
    } catch {
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, backoffs[attempt]));
        continue;
      }

      return Response.json(
        {
          error: 'provider_unavailable',
          message: "Your AI provider isn't responding. Try again shortly.",
        },
        { status: 503 },
      );
    }
  }

  return Response.json(
    {
      error: 'provider_unavailable',
      message: "Your AI provider isn't responding. Try again shortly.",
    },
    { status: 503 },
  );
}

export async function callAIText(payload: {
  providerType: ProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string | null;
  system?: string | null;
  prompt: string;
  onReasoningDelta?: (delta: string) => Promise<void> | void;
}) {
  const response = await callAIWithRetry(payload);
  if (!response.ok) {
    const errorData = await response.clone().json().catch(() => ({ message: 'AI call failed.' })) as { message?: string };
    throw new Error(errorData.message || 'AI call failed.');
  }

  if (!response.body) {
    throw new Error('AI provider did not return a response body.');
  }

  const text = await streamToText(response.body, {
    onReasoningDelta: payload.onReasoningDelta,
  });
  return { response, text };
}
