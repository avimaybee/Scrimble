import type {
  Bindings,
  ProjectGenerationBackend,
  ProjectGenerationStatus,
  QueueMessageBody,
} from './types';

export type GenerationDispatchKind =
  | 'intake_confirm'
  | 'direct_create'
  | 'architecture_approval'
  | 'resume'
  | 'continuation';

type DispatchPayload = {
  projectId: string;
  userId: string;
  providerId?: string;
  runId: string;
  kind: GenerationDispatchKind;
  previousStatus?: string | null;
  targetStatus: ProjectGenerationStatus;
  delaySeconds?: number;
};

function durableObjectDispatchPathForKind(kind: GenerationDispatchKind) {
  switch (kind) {
    case 'direct_create':
    case 'intake_confirm':
      return '/start';
    case 'architecture_approval':
      return '/approve';
    case 'resume':
      return '/resume';
    case 'continuation':
      return '/nudge';
  }
}

export function normalizeProjectGenerationBackend(value: unknown): ProjectGenerationBackend {
  if (typeof value !== 'string') {
    return 'queue';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'durable_object' || normalized === 'durable-object' || normalized === 'do') {
    return 'durable_object';
  }

  return 'queue';
}

export function resolveProjectGenerationBackend(request: Request, env: Pick<Bindings, 'PROJECT_GENERATION_RUNTIME'>) {
  const override = new URL(request.url).searchParams.get('useDO');
  if (override === '1' || override === 'true') {
    return 'durable_object' as const;
  }

  if (override === '0' || override === 'false') {
    return 'queue' as const;
  }

  return normalizeProjectGenerationBackend(env.PROJECT_GENERATION_RUNTIME);
}

export function hasProjectGenerationBackendBinding(
  env: Pick<Bindings, 'AGENT_QUEUE' | 'PROJECT_GENERATOR'>,
  backend: ProjectGenerationBackend,
) {
  return backend === 'durable_object' ? !!env.PROJECT_GENERATOR : !!env.AGENT_QUEUE;
}

async function readDurableObjectDispatchError(response: Response) {
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {
    // Fall through to the generic message.
  }

  return 'Failed to start project generation.';
}

export async function sendGenerationDispatch(
  env: Bindings,
  payload: DispatchPayload,
  options?: {
    backend?: ProjectGenerationBackend;
  },
) {
  const backend = options?.backend || 'queue';

  const dispatchId = crypto.randomUUID();
  const queueBody: QueueMessageBody = {
    type: 'generate_project' as const,
    projectId: payload.projectId,
    userId: payload.userId,
    providerId: payload.providerId,
    runId: payload.runId,
  };

  await env.DB.prepare(`
    INSERT INTO generation_dispatches (
      id, project_id, run_id, dispatch_kind, previous_status, target_status, queue_body, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `)
    .bind(
      dispatchId,
      payload.projectId,
      payload.runId,
      payload.kind,
      payload.previousStatus || null,
      payload.targetStatus,
      JSON.stringify(queueBody),
    )
    .run();

  try {
    if (backend === 'durable_object') {
      if (!env.PROJECT_GENERATOR) {
        throw new Error('Project generation durable object is not configured.');
      }

      const objectId = env.PROJECT_GENERATOR.idFromName(payload.projectId);
      const stub = env.PROJECT_GENERATOR.get(objectId);
      const response = await stub.fetch(`https://project-generator${durableObjectDispatchPathForKind(payload.kind)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...queueBody,
          kind: payload.kind,
          previousStatus: payload.previousStatus || null,
          targetStatus: payload.targetStatus,
        }),
      });

      if (!response.ok) {
        throw new Error(await readDurableObjectDispatchError(response));
      }
    } else {
      if (!env.AGENT_QUEUE) {
        throw new Error('Project generation queue is not configured.');
      }

      await env.AGENT_QUEUE.send(
        queueBody,
        payload.delaySeconds ? { delaySeconds: payload.delaySeconds } : undefined,
      );
    }

    await env.DB.prepare(`
      UPDATE generation_dispatches
      SET status = 'sent',
          updated_at = datetime("now")
      WHERE id = ?
    `)
      .bind(dispatchId)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to enqueue project generation.';

    await env.DB.prepare(`
      UPDATE generation_dispatches
      SET status = 'failed',
          last_error = ?,
          updated_at = datetime("now")
      WHERE id = ?
    `)
      .bind(message, dispatchId)
      .run();

    throw error;
  }

  return dispatchId;
}
