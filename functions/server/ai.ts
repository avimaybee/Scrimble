import type { ProviderType } from './types';

type StreamCallbacks = {
  onReasoningDelta?: (delta: string) => void;
};

export function extractJSON(raw: string): string {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : raw.trim();
}

export function containsStreamTransportMarkers(raw: string) {
  return (
    raw.includes('"object":"chat.completion.chunk"') ||
    raw.includes('"reasoning_content"') ||
    (raw.includes('"choices":[') && raw.includes('"delta":'))
  );
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

export async function streamToText(
  stream: ReadableStream<Uint8Array>,
  callbacks?: {
    onReasoningDelta?: (delta: string) => void;
  },
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let contentBuffer = '';
  let leftover = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = leftover + decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');
    leftover = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let jsonStr: string;
      if (trimmed.startsWith('data:')) {
        jsonStr = trimmed.slice(5).trim();
      } else {
        const jsonStart = trimmed.indexOf('{');
        if (jsonStart === -1) continue;
        jsonStr = trimmed.slice(jsonStart);
      }

      if (!jsonStr || jsonStr === '[DONE]') continue;

      try {
        const parsed = JSON.parse(jsonStr);
        const delta = parsed?.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.reasoning_content) {
          callbacks?.onReasoningDelta?.(delta.reasoning_content);
        }

        if (typeof delta.content === 'string' && delta.content) {
          contentBuffer += delta.content;
        }
      } catch {
        // malformed chunk — skip silently
      }
    }
  }

  const remaining = leftover + decoder.decode();
  if (remaining.trim()) {
    const jsonStart = remaining.indexOf('{');
    if (jsonStart !== -1) {
      try {
        const parsed = JSON.parse(remaining.slice(jsonStart));
        const delta = parsed?.choices?.[0]?.delta;
        if (delta?.content) contentBuffer += delta.content;
      } catch {}
    }
  }

  return contentBuffer;
}

function extractTextParts(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (part && typeof part === 'object' && 'text' in part) {
        return extractString((part as { text?: unknown }).text);
      }

      return '';
    })
    .filter(Boolean)
    .join('');
}

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
      message?: { content?: unknown };
      text?: string;
    }>;
    content?: Array<{ text?: string; type?: string; thinking?: string }>;
    delta?: { text?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    output_text?: string;
    text?: string;
  };

  if (value.output_text) {
    return value.output_text;
  }

  if (value.text) {
    return value.text;
  }

  if (value.choices?.[0]?.delta?.content) {
    return value.choices[0].delta.content;
  }

  const messageContent = value.choices?.[0]?.message?.content;
  if (typeof messageContent === 'string') {
    return messageContent;
  }

  if (messageContent) {
    return extractTextParts(messageContent);
  }

  if (value.choices?.[0]?.text) {
    return value.choices[0].text;
  }

  if (value.content?.length) {
    const textBlocks = value.content
      .filter((block) => block.type !== 'thinking')
      .map((block) => extractString(block.text))
      .filter(Boolean)
      .join('');

    if (textBlocks) {
      return textBlocks;
    }
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

async function streamStructuredProviderText(
  stream: ReadableStream<Uint8Array>,
  callbacks?: StreamCallbacks,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let contentBuffer = '';
  let leftover = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const chunk = leftover + decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');
    leftover = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) {
        continue;
      }
      if (!trimmed.startsWith('data:')) {
        continue;
      }

      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') {
        continue;
      }

      try {
        const parsed = JSON.parse(data) as unknown;
        const reasoningDelta = extractReasoningFromProviderChunk(parsed);
        if (reasoningDelta) {
          callbacks?.onReasoningDelta?.(reasoningDelta);
        }

        const contentDelta = extractTextFromProviderChunk(parsed);
        if (contentDelta) {
          contentBuffer += contentDelta;
        }
      } catch {
        // malformed chunk — skip silently
      }
    }
  }

  const remaining = leftover + decoder.decode();
  if (remaining.trim()) {
    const trimmed = remaining.trim();
    if (trimmed.startsWith('data:')) {
      const data = trimmed.slice(5).trim();
      if (data && data !== '[DONE]') {
        try {
          const parsed = JSON.parse(data) as unknown;
          const contentDelta = extractTextFromProviderChunk(parsed);
          if (contentDelta) {
            contentBuffer += contentDelta;
          }
        } catch {}
      }
    }
  }

  return contentBuffer;
}

export async function streamProviderText(
  providerType: ProviderType,
  stream: ReadableStream<Uint8Array>,
  callbacks?: StreamCallbacks,
): Promise<string> {
  if (providerType === 'custom' || providerType === 'openai') {
    return streamToText(stream, callbacks);
  }

  return streamStructuredProviderText(stream, callbacks);
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
        clearTimeout(timeoutId);
        return Response.json(
          {
            error: 'rate_limited',
            message: 'Your AI provider is rate limited. Wait a moment and try again.',
          },
          { status: 429 },
        );
      }

      if (response.status === 401) {
        clearTimeout(timeoutId);
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

      clearTimeout(timeoutId);
      return Response.json(
        {
          error: 'provider_unavailable',
          message: "Your AI provider isn't responding. Try again shortly.",
        },
        { status: 503 },
      );
    } catch {
      clearTimeout(timeoutId);

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

function getAIErrorMessage(status: number) {
  switch (status) {
    case 401:
      return 'Your AI key was rejected. Check it in Settings.';
    case 429:
      return 'Your AI provider is rate limited. Wait a moment and try again.';
    case 503:
      return "Your AI provider isn't responding. Try again shortly.";
    default:
      return 'AI call failed.';
  }
}

export async function callAIText(payload: {
  providerType: ProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string | null;
  system?: string | null;
  prompt: string;
  onReasoningDelta?: (delta: string) => void;
}) {
  const response = await callAIWithRetry(payload);
  if (!response.ok) {
    throw new Error(getAIErrorMessage(response.status));
  }

  if (!response.body) {
    throw new Error('AI provider did not return a response body.');
  }

  const text = await streamProviderText(payload.providerType, response.body, {
    onReasoningDelta: payload.onReasoningDelta,
  });

  return { response, text };
}
