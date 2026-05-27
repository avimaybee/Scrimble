import type { Bindings } from './types';

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
    return {
      inlineText: serialized,
      r2Key: null,
      sizeBytes: serialized.length,
    };
  }

  // Generate SHA-256 hash of the content
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(serialized)
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Use a global namespace to enable cross-user deduplication
  const r2Key = `objects/${hashHex}.json`;
  await env.CHECKPOINT_BUCKET.put(r2Key, serialized);

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
    console.error('[checkpoint-payload-parse-failed]', {
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
  // Now handles deletion asynchronously via deferred cleanup, no-op here if called.
}

export async function cleanupOrphanedStorage(env: Bindings): Promise<{ deletedCount: number, errors: number }> {
  if (!env.CHECKPOINT_BUCKET) {
    return { deletedCount: 0, errors: 0 };
  }

  const prefixes = ['agent-runs/', 'generation-checkpoints/', 'objects/'];
  let deletedCount = 0;
  let errors = 0;

  try {
    for (const prefix of prefixes) {
      let cursor: string | undefined = undefined;

      do {
        const listed = await env.CHECKPOINT_BUCKET.list({ prefix, cursor });
        
        for (const object of listed.objects) {
          const r2Key = object.key;
          let isReferenced = false;

          // Check both tables since any prefix can now theoretically be in either
          const agentRunRecord = await env.DB.prepare(
            'SELECT 1 FROM agent_runs WHERE output_r2_key = ? LIMIT 1'
          ).bind(r2Key).first();
          
          if (agentRunRecord) {
            isReferenced = true;
          } else {
            const checkpointRecord = await env.DB.prepare(
              'SELECT 1 FROM generation_checkpoints WHERE payload_r2_key = ? LIMIT 1'
            ).bind(r2Key).first();
            isReferenced = !!checkpointRecord;
          }

          if (!isReferenced) {
            await env.CHECKPOINT_BUCKET.delete(r2Key);
            deletedCount++;
          }
        }

        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
    }
  } catch (error) {
    console.error('[cleanup-orphaned-storage-error]', error);
    errors++;
  }

  return { deletedCount, errors };
}
