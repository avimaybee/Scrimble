import type { Bindings } from './types';
import { error as logError } from './logger';

export const MAX_INLINE_JSON_BYTES = 900_000;

export type JsonStoragePointer = {
  inlineText: string | null;
  r2Key: string | null;
  sizeBytes: number;
};

async function deleteR2Object(env: Bindings, r2Key: string | null | undefined) {
  if (!r2Key || !env.CHECKPOINT_BUCKET) {
    return;
  }

  await env.CHECKPOINT_BUCKET.delete(r2Key);
}

export async function storeJsonPayload(
  env: Bindings,
  namespace: string,
  value: unknown,
  existingR2Key?: string | null,
): Promise<JsonStoragePointer> {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);

  if (serialized.length <= MAX_INLINE_JSON_BYTES || !env.CHECKPOINT_BUCKET) {
    if (existingR2Key && env.CHECKPOINT_BUCKET) {
      await deleteR2Object(env, existingR2Key);
    }

    return {
      inlineText: serialized,
      r2Key: null,
      sizeBytes: serialized.length,
    };
  }

  const r2Key = `${namespace}/${crypto.randomUUID()}.json`;
  await env.CHECKPOINT_BUCKET.put(r2Key, serialized);

  if (existingR2Key && existingR2Key !== r2Key) {
    await deleteR2Object(env, existingR2Key);
  }

  return {
    inlineText: null,
    r2Key,
    sizeBytes: serialized.length,
  };
}

export async function loadJsonPayloadText(
  env: Bindings,
  inlineText: string | null | undefined,
  r2Key: string | null | undefined,
): Promise<string | null> {
  if (r2Key) {
    if (!env.CHECKPOINT_BUCKET) {
      throw new Error(`R2 storage is not configured for payload ${r2Key}.`);
    }

    const object = await env.CHECKPOINT_BUCKET.get(r2Key);
    if (!object) {
      throw new Error(`Stored payload ${r2Key} could not be found in R2.`);
    }

    return object.text();
  }

  return inlineText ?? null;
}

export async function loadJsonPayload<T>(
  env: Bindings,
  inlineText: string | null | undefined,
  r2Key: string | null | undefined,
): Promise<T | null> {
  const text = await loadJsonPayloadText(env, inlineText, r2Key);
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    logError('checkpoint-parse', 'Checkpoint payload parse failed', {
      r2Key: r2Key || null,
      inlinePayload: Boolean(inlineText),
      payloadSize: text.length,
      message: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Checkpoint payload ${r2Key || 'inline'} is corrupted and could not be parsed.`,
    );
  }
}

export async function deleteJsonPayload(
  env: Bindings,
  r2Key: string | null | undefined,
) {
  await deleteR2Object(env, r2Key);
}
