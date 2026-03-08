import type { ProviderType } from './types';

function extractTextFromProviderChunk(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') {
    return '';
  }

  const value = parsed as {
    choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
    content?: Array<{ text?: string }>;
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

export async function streamToText(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) {
        continue;
      }

      const candidate = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
      if (!candidate || candidate === '[DONE]') {
        continue;
      }

      try {
        const parsed = JSON.parse(candidate) as unknown;
        fullContent += extractTextFromProviderChunk(parsed);
      } catch {
        if (!trimmed.startsWith('data: ')) {
          fullContent += candidate;
        }
      }
    }
  }

  return fullContent;
}

export async function callProvider(payload: {
  providerType: ProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string | null;
  system?: string | null;
  prompt: string;
}) {
  if (payload.providerType === 'anthropic') {
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': payload.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: payload.model,
        system: payload.system || undefined,
        messages: [{ role: 'user', content: payload.prompt }],
        stream: true,
      }),
    });
  }

  if (payload.providerType === 'gemini') {
    const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${payload.model}:streamGenerateContent?key=${payload.apiKey}`;
    return fetch(googleUrl, {
      method: 'POST',
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
    method: 'POST',
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
    try {
      const response = await callProvider(payload);

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
}) {
  const response = await callAIWithRetry(payload);
  if (!response.ok) {
    const errorData = await response.clone().json().catch(() => ({ message: 'AI call failed.' })) as { message?: string };
    throw new Error(errorData.message || 'AI call failed.');
  }

  if (!response.body) {
    throw new Error('AI provider did not return a response body.');
  }

  const text = await streamToText(response.body);
  return { response, text };
}
