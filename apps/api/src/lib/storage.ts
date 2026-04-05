export interface StoreJsonArtifactInput {
  projectId: string;
  type: string;
  payload: unknown;
  metadata?: Record<string, string>;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-_.]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildArtifactKey(projectId: string, type: string): string {
  const safeProject = slug(projectId);
  const safeType = slug(type);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const randomSuffix = crypto.randomUUID().slice(0, 8);
  return `${safeProject}/${safeType}/${timestamp}-${randomSuffix}.json`;
}

export async function storeJsonArtifact(
  bucket: R2Bucket,
  input: StoreJsonArtifactInput,
): Promise<{ key: string; contentLength: number }> {
  const key = buildArtifactKey(input.projectId, input.type);
  const body = JSON.stringify(
    {
      projectId: input.projectId,
      type: input.type,
      createdAt: new Date().toISOString(),
      payload: input.payload,
    },
    null,
    2,
  );

  await bucket.put(key, body, {
    httpMetadata: {
      contentType: 'application/json',
    },
    ...(input.metadata ? { customMetadata: input.metadata } : {}),
  });

  return { key, contentLength: body.length };
}

export async function readArtifact(bucket: R2Bucket, key: string): Promise<unknown | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  return object.json<unknown>();
}

export async function listArtifacts(
  bucket: R2Bucket,
  options: { prefix?: string; limit?: number } = {},
): Promise<Array<{ key: string; size: number; uploaded: string }>> {
  const listed = await bucket.list({
    ...(options.prefix ? { prefix: options.prefix } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });

  return listed.objects.map((object) => ({
    key: object.key,
    size: object.size,
    uploaded: object.uploaded.toISOString(),
  }));
}
