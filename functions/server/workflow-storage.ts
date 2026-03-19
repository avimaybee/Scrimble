import type { Bindings } from './types';

export async function saveToR2(
  env: Pick<Bindings, 'SCRIMBLE_BUCKET' | 'CHECKPOINT_BUCKET'>,
  projectId: string,
  runId: string,
  key: string,
  data: unknown,
): Promise<string> {
  const bucket = env.SCRIMBLE_BUCKET || env.CHECKPOINT_BUCKET;
  if (!bucket) {
    throw new Error('R2 storage is not configured.');
  }

  const r2Key = `workflows/${projectId}/${runId}/${key}.json`;
  await bucket.put(r2Key, JSON.stringify(data));
  return r2Key;
}

export async function loadFromR2<T>(
  env: Pick<Bindings, 'SCRIMBLE_BUCKET' | 'CHECKPOINT_BUCKET'>,
  r2Key: string,
): Promise<T> {
  const bucket = env.SCRIMBLE_BUCKET || env.CHECKPOINT_BUCKET;
  if (!bucket) {
    throw new Error('R2 storage is not configured.');
  }

  const obj = await bucket.get(r2Key);
  if (!obj) {
    throw new Error(`R2 object not found: ${r2Key}`);
  }

  return JSON.parse(await obj.text()) as T;
}
