import type { ProviderType } from './types';

type StreamCallbacks = {
  onReasoningDelta?: (delta: string) => void;
};

export function extractJSON(raw: string): string {
  // 1. Try to find markdown code blocks first
  const codeBlockMatches = Array.from(raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g));
  if (codeBlockMatches.length > 0) {
    // Return the last one, as models often correct themselves
    const candidate = codeBlockMatches[codeBlockMatches.length - 1][1].trim();
    if (candidate.startsWith('{') || candidate.startsWith('[')) {
      return candidate;
    }
  }

  // 2. Find the first '{' or '[' and find the largest balanced object starting from there
  // We prefer '{' as all our current schemas are objects.
  const firstBrace = raw.indexOf('{');
  const firstBracket = raw.indexOf('[');
  
  let startIndex = -1;
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
  }

  if (startIndex === -1) {
    return raw.trim();
  }

  // Find the largest balanced structure
  const opener = raw[startIndex];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let isEscaped = false;
  let lastValidEnd = -1;

  for (let i = startIndex; i < raw.length; i++) {
    const char = raw[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === '\\') {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === opener) {
        depth++;
      } else if (char === closer) {
        depth--;
        if (depth === 0) {
          lastValidEnd = i;
          // Keep going to find the absolute largest block (in case there are multiple top-level objects)
        }
      }
    }
  }

  if (lastValidEnd !== -1) {
    return raw.slice(startIndex, lastValidEnd + 1).trim();
  }

  // 3. Absolute fallback: the simple slice if we couldn't balance it
  const lastBrace = raw.lastIndexOf('}');
  const lastBracket = raw.lastIndexOf(']');
  const endIdx = Math.max(lastBrace, lastBracket);

  if (startIndex !== -1 && endIdx !== -1 && endIdx > startIndex) {
    return raw.slice(startIndex, endIdx + 1).trim();
  }

  return raw.trim();
}

export function containsStreamTransportMarkers(raw: string) {
  return (
    raw.includes('"object":"chat.completion.chunk"') ||
    raw.includes('"reasoning_content"') ||
    raw.includes('"reasoning"') ||
    raw.includes('"thinking"') ||
    (raw.includes('"choices":[') && raw.includes('"delta":'))
  );
}

export function containsReasoningMarkers(raw: string) {
  return (
    raw.includes('"reasoning_content"') ||
    raw.includes('"reasoning"') ||
    raw.includes('"thinking"')
  );
}

export function defaultModelForProvider(provider: ProviderType): string {
  switch (provider) {
    case 'anthropic':
      return 'claude-3-5-sonnet-latest';
    case 'gemini':
      return 'gemini-2.0-flash';
    case 'openrouter':
      return 'anthropic/claude-3.5-sonnet';
    case 'groq':
      return 'llama-3.3-70b-versatile';
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
  let isDone = false;

  while (!isDone) {
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

      if (!jsonStr) continue;
      if (jsonStr === '[DONE]') {
        isDone = true;
        break;
      }

      try {
        const parsed = JSON.parse(jsonStr) as unknown;
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
    const jsonStart = remaining.indexOf('{');
    if (jsonStart !== -1) {
      try {
        const parsed = JSON.parse(remaining.slice(jsonStart)) as unknown;
        const contentDelta = extractTextFromProviderChunk(parsed);
        if (contentDelta) {
          contentBuffer += contentDelta;
        }
      } catch {}
    }
  }

  if (!contentBuffer && leftover.trim()) {
    console.warn('Stream ended with no content but leftover reasoning/chunks.');
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

type StructuredTransportParseResult = {
  jsonBlocks: string[];
  rest: string;
  sawDone: boolean;
};

function extractBalancedJsonObject(
  source: string,
  startIndex: number,
): { json: string; endIndex: number } | null {
  if (source[startIndex] !== '{') {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (char === '\\') {
        isEscaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          json: source.slice(startIndex, index + 1),
          endIndex: index + 1,
        };
      }
    }
  }

  return null;
}

function skipMetadataLine(source: string, startIndex: number): number | null {
  const newlineIndex = source.indexOf('\n', startIndex);
  if (newlineIndex === -1) {
    return null;
  }

  return newlineIndex + 1;
}

function consumeStructuredTransportBuffer(buffer: string): StructuredTransportParseResult {
  const jsonBlocks: string[] = [];
  let cursor = 0;
  let sawDone = false;

  while (cursor < buffer.length) {
    while (cursor < buffer.length) {
      const char = buffer[cursor];
      if (char === '[' || char === ']' || char === ',' || /\s/.test(char)) {
        cursor += 1;
        continue;
      }
      break;
    }

    if (cursor >= buffer.length) {
      break;
    }

    const slice = buffer.slice(cursor);
    if (
      slice.startsWith(':')
      || slice.startsWith('event:')
      || slice.startsWith('id:')
      || slice.startsWith('retry:')
    ) {
      const nextLine = skipMetadataLine(buffer, cursor);
      if (nextLine === null) {
        break;
      }
      cursor = nextLine;
      continue;
    }

    if (slice.startsWith('data:')) {
      cursor += 5;

      while (cursor < buffer.length && /\s/.test(buffer[cursor])) {
        cursor += 1;
      }

      if (buffer.startsWith('[DONE]', cursor)) {
        sawDone = true;
        cursor += '[DONE]'.length;
        const nextLine = skipMetadataLine(buffer, cursor);
        cursor = nextLine === null ? buffer.length : nextLine;
        continue;
      }

      const dataLineEnd = buffer.indexOf('\n', cursor);
      const jsonStart = buffer.indexOf('{', cursor);
      if (jsonStart === -1 || (dataLineEnd !== -1 && jsonStart > dataLineEnd)) {
        if (dataLineEnd === -1) {
          break;
        }

        cursor = dataLineEnd + 1;
        continue;
      }

      const extracted = extractBalancedJsonObject(buffer, jsonStart);
      if (!extracted) {
        break;
      }

      jsonBlocks.push(extracted.json);
      cursor = extracted.endIndex;
      continue;
    }

    if (buffer.startsWith('[DONE]', cursor)) {
      sawDone = true;
      cursor += '[DONE]'.length;
      continue;
    }

    const jsonStart = buffer.indexOf('{', cursor);
    if (jsonStart === -1) {
      break;
    }

    const nextLineBreak = buffer.indexOf('\n', cursor);
    if (nextLineBreak !== -1 && nextLineBreak < jsonStart) {
      cursor = nextLineBreak + 1;
      continue;
    }

    const extracted = extractBalancedJsonObject(buffer, jsonStart);
    if (!extracted) {
      cursor = jsonStart;
      break;
    }

    jsonBlocks.push(extracted.json);
    cursor = extracted.endIndex;
  }

  return {
    jsonBlocks,
    rest: buffer.slice(cursor),
    sawDone,
  };
}

function appendStructuredChunk(chunk: string, callbacks?: StreamCallbacks): string {
  try {
    const parsed = JSON.parse(chunk) as unknown;
    const reasoningDelta = extractReasoningFromProviderChunk(parsed);
    if (reasoningDelta) {
      callbacks?.onReasoningDelta?.(reasoningDelta);
    }

    return extractTextFromProviderChunk(parsed);
  } catch {
    return '';
  }
}

async function streamStructuredProviderText(
  stream: ReadableStream<Uint8Array>,
  callbacks?: StreamCallbacks,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let contentBuffer = '';
  let transportBuffer = '';
  let isDone = false;

  while (!isDone) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    transportBuffer += decoder.decode(value, { stream: true });
    const parsed = consumeStructuredTransportBuffer(transportBuffer);
    transportBuffer = parsed.rest;

    for (const jsonBlock of parsed.jsonBlocks) {
      const contentDelta = appendStructuredChunk(jsonBlock, callbacks);
      if (contentDelta) {
        contentBuffer += contentDelta;
      }
    }

    if (parsed.sawDone) {
      isDone = true;
    }
  }

  transportBuffer += decoder.decode();
  if (transportBuffer.trim()) {
    const parsed = consumeStructuredTransportBuffer(transportBuffer);
    for (const jsonBlock of parsed.jsonBlocks) {
      const contentDelta = appendStructuredChunk(jsonBlock, callbacks);
      if (contentDelta) {
        contentBuffer += contentDelta;
      }
    }
  }

  return contentBuffer;
}

export async function streamProviderText(
  _providerType: ProviderType,
  stream: ReadableStream<Uint8Array>,
  callbacks?: StreamCallbacks,
): Promise<string> {
  return streamStructuredProviderText(stream, callbacks);
}

const AI_TIMEOUT_MS = 600_000; // 10 minutes
const PROVIDER_UNAVAILABLE_MESSAGE = "Your AI provider isn't responding. Try again shortly.";
const PROVIDER_TIMEOUT_MESSAGE = 'Your AI provider took too long to respond. Retry to continue from the latest checkpoint.';
const PROVIDER_UPSTREAM_MESSAGE = 'Your AI provider had a temporary upstream error. Try again shortly.';
const RUNTIME_BUDGET_MESSAGE =
  'Scrimble hit a Cloudflare runtime limit while researching your project. Resume generation to continue from the latest checkpoint.';
export const PIPELINE_QUOTA_EXCEEDED = 'PIPELINE_QUOTA_EXCEEDED';

export class RetryableAIError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RetryableAIError';
  }
}

export class PipelineQuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineQuotaExceededError';
  }
}

function createAIErrorResponse(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status });
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function isRuntimeBudgetError(message: string) {
  const haystack = message.toLowerCase();
  return (
    haystack.includes('subrequest') ||
    haystack.includes('too many requests to origin') ||
    haystack.includes('too many open connections') ||
    haystack.includes('worker exceeded resource limits') ||
    haystack.includes('resource limit') ||
    haystack.includes('runtime limit')
  );
}

async function readAIErrorPayload(response: Response) {
  const clone = response.clone();

  try {
    const parsed = await clone.json() as { error?: string; message?: string };
    return {
      error: parsed.error,
      message: parsed.message,
      rawText: '',
    };
  } catch {
    const rawText = await clone.text().catch(() => '');
    return {
      error: undefined,
      message: undefined,
      rawText,
    };
  }
}

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

  if (payload.providerType === 'openrouter') {
    return fetch('https://openrouter.ai/api/v1/chat/completions', {
      ...commonFetchOptions,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${payload.apiKey}`,
        'HTTP-Referer': 'https://scrimble.build',
        'X-Title': 'Scrimble',
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

  let url = payload.baseUrl?.trim() || 'https://api.openai.com/v1/chat/completions';

  if (payload.providerType === 'groq') {
    url = 'https://api.groq.com/openai/v1/chat/completions';
  }

  if (payload.providerType === 'custom' && payload.baseUrl) {
    const urlObj = new URL(url);
    if (urlObj.pathname.endsWith('/v1')) {
      urlObj.pathname = `${urlObj.pathname}/chat/completions`;
    } else if (!urlObj.pathname.includes('/chat/completions') && !urlObj.pathname.includes('/v1/')) {
      urlObj.pathname = urlObj.pathname.endsWith('/') ? `${urlObj.pathname}v1/chat/completions` : `${urlObj.pathname}/v1/chat/completions`;
    }
    url = urlObj.toString();
  }

  const max_tokens = (payload.providerType === 'openai' || payload.providerType === 'custom' || payload.providerType === 'groq' || payload.providerType === 'openrouter') ? 16384 : 8192;



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
      max_tokens,
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
  const logTag = `[callAIWithRetry] [${payload.providerType}/${payload.model}]`;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      console.log(`${logTag} attempt ${attempt + 1}/${maxRetries + 1} starting...`);
      const response = await callProvider({ ...payload, signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        console.log(`${logTag} attempt ${attempt + 1} succeeded (${response.status})`);
        return response;
      }

      console.error(`${logTag} attempt ${attempt + 1} got HTTP ${response.status}`);

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
        return createAIErrorResponse(401, 'invalid_key', 'Your AI key was rejected. Check it in Settings.');
      }

      const errorPayload = await readAIErrorPayload(response);
      const diagnosticText = `${errorPayload.message || ''}\n${errorPayload.rawText}`.trim();
      console.error(`${logTag} attempt ${attempt + 1} failure detail: HTTP ${response.status}, body: ${diagnosticText.slice(0, 500)}`);

      if (isRuntimeBudgetError(diagnosticText)) {
        return createAIErrorResponse(503, PIPELINE_QUOTA_EXCEEDED, RUNTIME_BUDGET_MESSAGE);
      }

      if (attempt < maxRetries && (response.status >= 500 || response.status === 0 || response.status === 408)) {
        console.warn(`${logTag} retrying after ${backoffs[attempt]}ms (server error ${response.status})...`);
        await new Promise((resolve) => setTimeout(resolve, backoffs[attempt]));
        continue;
      }

      if (response.status === 408 || response.status === 504) {
        return createAIErrorResponse(504, 'provider_timeout', PROVIDER_TIMEOUT_MESSAGE);
      }

      if (response.status >= 500) {
        return createAIErrorResponse(503, 'provider_upstream_error', PROVIDER_UPSTREAM_MESSAGE);
      }

      return createAIErrorResponse(503, 'provider_unavailable', PROVIDER_UNAVAILABLE_MESSAGE);
    } catch (err) {
      clearTimeout(timeoutId);
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`${logTag} attempt ${attempt + 1} EXCEPTION: ${errMsg}`);

      if (isAbortError(err)) {
        return createAIErrorResponse(504, 'provider_timeout', PROVIDER_TIMEOUT_MESSAGE);
      }

      if (isRuntimeBudgetError(errMsg)) {
        return createAIErrorResponse(503, PIPELINE_QUOTA_EXCEEDED, RUNTIME_BUDGET_MESSAGE);
      }

      if (attempt < maxRetries) {
        console.warn(`${logTag} retrying after ${backoffs[attempt]}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffs[attempt]));
        continue;
      }

      console.error(`${logTag} ALL RETRIES EXHAUSTED. Last error: ${errMsg}`);

      const isNetworkError = 
        errMsg.includes('Network connection lost') ||
        errMsg.includes('fetch failed') ||
        errMsg.includes('ECONNREFUSED') ||
        errMsg.includes('ENOTFOUND');
      
      if (isNetworkError) {
        return createAIErrorResponse(503, 'provider_network_error', 'Network connection lost. Please try again.');
      }

      return createAIErrorResponse(503, 'provider_unavailable', PROVIDER_UNAVAILABLE_MESSAGE);
    }
  }

  console.error(`${logTag} UNREACHABLE: fell through retry loop`);

  return createAIErrorResponse(503, 'provider_unavailable', PROVIDER_UNAVAILABLE_MESSAGE);
}


function getAIErrorMessage(status: number) {
  switch (status) {
    case 401:
      return 'Your AI key was rejected. Check it in Settings.';
    case 429:
      return 'Your AI provider is rate limited. Wait a moment and try again.';
    case 504:
      return PROVIDER_TIMEOUT_MESSAGE;
    case 503:
      return PROVIDER_UNAVAILABLE_MESSAGE;
    default:
      return 'AI call failed.';
  }
}

export async function readAIErrorMessage(response: Response) {
  const payload = await readAIErrorPayload(response);
  return {
    code: payload.error || 'provider_unavailable',
    message: payload.message || getAIErrorMessage(response.status),
  };
}

export async function callAIText(payload: {
  providerType: ProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string | null;
  system?: string | null;
  prompt: string;
  onReasoningDelta?: (delta: string) => void | Promise<void>;
}): Promise<{
  text: string;
  response: Response;
}> {
  const response = await callAIWithRetry(payload);
  if (!response.ok) {
    const { code, message } = await readAIErrorMessage(response);
    if (code === PIPELINE_QUOTA_EXCEEDED) {
      throw new PipelineQuotaExceededError(message);
    }

    if (code === 'provider_timeout' || code === 'provider_upstream_error' || code === 'provider_network_error') {
      throw new RetryableAIError(message, code, response.status);
    }

    throw new Error(message);
  }

  if (!response.body) {
    throw new Error('AI provider did not return a response body.');
  }

  let reasoningReceived = false;
  const text = await streamProviderText(payload.providerType, response.body, {
    onReasoningDelta: (delta) => {
      reasoningReceived = true;
      payload.onReasoningDelta?.(delta);
    },
  });

  // GLM-5/DeepSeek Guard: If we got reasoning but NO content, the model likely 
  // timed out or got stuck in a thought loop. Retry once with a harder nudge.
  if (!text.trim() && reasoningReceived) {
    console.warn('[callAIText] Model returned reasoning but no content. Retrying with explicit JSON instruction...');
    const retryPayload = {
      ...payload,
      system: (payload.system || '') + '\n\nIMPORTANT: You previously only provided reasoning. Please provide the JSON output now. Do not provide extensive reasoning.',
    };
    const retryResponse = await callAIWithRetry(retryPayload);
    if (!retryResponse.ok) {
      const { code, message } = await readAIErrorMessage(retryResponse);
      if (code === PIPELINE_QUOTA_EXCEEDED) {
        throw new PipelineQuotaExceededError(message);
      }

      if (code === 'provider_timeout' || code === 'provider_upstream_error') {
        throw new RetryableAIError(message, code, retryResponse.status);
      }

      throw new Error(message);
    }

    if (retryResponse.body) {
      const retryText = await streamProviderText(payload.providerType, retryResponse.body, {
        onReasoningDelta: payload.onReasoningDelta,
      });
      return { response: retryResponse, text: retryText };
    }
  }

  return { response, text };
}


export function trimToLimit(value: string | null | undefined, maxChars: number): string {
  if (!value) return '';
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars) + '... [TRUNCATED]';
}
