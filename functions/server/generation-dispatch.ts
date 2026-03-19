import { getProvider } from './ai';
import type {
  Bindings,
  ProjectGenerationBackend,
  ProjectGenerationStatus,
  QueueMessageBody,
  ResolvedGenerationProviderConfig,
} from './types';

export type GenerationDispatchKind =
  | 'intake_confirm'
  | 'direct_create'
  | 'architecture_approval'
  | 'resume'
  | 'continuation';

export const WORKFLOW_EVENT_TYPE_ARCHITECTURE_APPROVED = 'architecture-approved';

type DispatchPayload = {
  projectId: string;
  userId: string;
  providerId?: string;
  runId: string;
  workflowInstanceId?: string;
  kind: GenerationDispatchKind;
  previousStatus?: string | null;
  targetStatus: ProjectGenerationStatus;
  delaySeconds?: number;
  reviewFeedback?: string;
  preferredIde?: string;
};

type ProjectDispatchContext = {
  id: string;
  user_id: string;
  description: string | null;
  intake_answers: string | null;
  workflow_instance_id: string | null;
};

type StoredIntakeAnswerEntry = {
  question: string;
  answer: string;
};

type StoredIntakeAnswersPayload = {
  answers: StoredIntakeAnswerEntry[];
};

type WorkflowGenerationPayload = {
  projectId: string;
  userId: string;
  runId: string;
  description: string;
  intakeAnswers: Record<string, string>;
  fastProvider: ResolvedGenerationProviderConfig;
  deepProvider: ResolvedGenerationProviderConfig;
  stackTechnologies: Array<{ name: string; docsUrl?: string; githubRepo?: string }>;
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

export function workflowInstanceIdFor(projectId: string, runId: string) {
  void projectId;
  return runId;
}

function normalizeProviderForWorkflow(provider: {
  providerId: string;
  providerName: string;
  providerType: string;
  model: string;
  baseUrl: string | null;
  apiKey: string;
}): ResolvedGenerationProviderConfig {
  return {
    providerId: provider.providerId,
    providerName: provider.providerName,
    providerType: provider.providerType as ResolvedGenerationProviderConfig['providerType'],
    model: provider.model,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
  };
}

function parseStoredIntakeAnswers(value: string | null | undefined): StoredIntakeAnswersPayload | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const payload = parsed as { answers?: unknown };
    const answers = Array.isArray(payload.answers)
      ? payload.answers
          .map((entry) => ({
            question:
              entry && typeof entry === 'object' && !Array.isArray(entry) && typeof (entry as { question?: unknown }).question === 'string'
                ? (entry as { question: string }).question.trim()
                : '',
            answer:
              entry && typeof entry === 'object' && !Array.isArray(entry) && typeof (entry as { answer?: unknown }).answer === 'string'
                ? (entry as { answer: string }).answer.trim()
                : '',
          }))
          .filter((entry: StoredIntakeAnswerEntry) => entry.question && entry.answer)
      : [];

    if (answers.length === 0) {
      return null;
    }

    return { answers };
  } catch {
    return null;
  }
}

function toIntakeAnswerMap(value: string | null | undefined) {
  const parsed = parseStoredIntakeAnswers(value);
  if (!parsed) {
    return {};
  }

  return parsed.answers.reduce<Record<string, string>>((acc, entry) => {
    acc[entry.question] = entry.answer;
    return acc;
  }, {});
}

async function loadProjectDispatchContext(
  env: Bindings,
  projectId: string,
  userId: string,
): Promise<ProjectDispatchContext> {
  const record = await env.DB.prepare(`
    SELECT id, user_id, description, intake_answers, workflow_instance_id
    FROM projects
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `)
    .bind(projectId, userId)
    .first() as ProjectDispatchContext | null;

  if (!record) {
    throw new Error('Project not found for generation dispatch.');
  }

  return record;
}

async function resolveProvidersForWorkflow(
  env: Bindings,
  userId: string,
  providerId?: string,
) {
  const [fastProvider, deepProvider] = await Promise.all([
    getProvider(env, userId, { providerId, role: 'fast' }),
    getProvider(env, userId, { providerId, role: 'deep' }),
  ]);

  if (!fastProvider) {
    throw new Error('No model configured for role: fast. Please set your models in Settings.');
  }

  if (!deepProvider) {
    throw new Error('No model configured for role: deep. Please set your models in Settings.');
  }

  return {
    fastProvider: normalizeProviderForWorkflow(fastProvider),
    deepProvider: normalizeProviderForWorkflow(deepProvider),
  };
}

async function buildWorkflowPayload(
  env: Bindings,
  payload: DispatchPayload,
): Promise<WorkflowGenerationPayload> {
  const project = await loadProjectDispatchContext(env, payload.projectId, payload.userId);
  const providers = await resolveProvidersForWorkflow(env, payload.userId, payload.providerId);
  return {
    projectId: payload.projectId,
    userId: payload.userId,
    runId: payload.runId,
    description: (project.description || '').trim(),
    intakeAnswers: toIntakeAnswerMap(project.intake_answers),
    fastProvider: providers.fastProvider,
    deepProvider: providers.deepProvider,
    stackTechnologies: [],
  };
}

export function normalizeProjectGenerationBackend(value: unknown): ProjectGenerationBackend {
  if (typeof value !== 'string') {
    return 'workflow';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'workflow' || normalized === 'workflows' || normalized === 'wf') {
    return 'workflow';
  }

  if (normalized === 'durable_object' || normalized === 'durable-object' || normalized === 'do') {
    return 'durable_object';
  }

  return 'queue';
}

export function resolveProjectGenerationBackend(request: Request, env: Pick<Bindings, 'PROJECT_GENERATION_RUNTIME'>) {
  const params = new URL(request.url).searchParams;

  const workflowOverride = params.get('useWorkflow');
  if (workflowOverride === '1' || workflowOverride === 'true') {
    return 'workflow' as const;
  }

  const queueOverride = params.get('useQueue');
  if (queueOverride === '1' || queueOverride === 'true') {
    return 'queue' as const;
  }

  const doOverride = params.get('useDO');
  if (doOverride === '1' || doOverride === 'true') {
    return 'durable_object' as const;
  }

  if (doOverride === '0' || doOverride === 'false') {
    return 'workflow' as const;
  }

  return normalizeProjectGenerationBackend(env.PROJECT_GENERATION_RUNTIME);
}

export function hasProjectGenerationBackendBinding(
  env: Pick<Bindings, 'AGENT_QUEUE' | 'PROJECT_GENERATOR' | 'GENERATION_WORKFLOW'>,
  backend: ProjectGenerationBackend,
) {
  if (backend === 'durable_object') {
    return !!env.PROJECT_GENERATOR;
  }

  if (backend === 'workflow') {
    return !!env.GENERATION_WORKFLOW;
  }

  return !!env.AGENT_QUEUE;
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

export async function sendWorkflowDispatchEvent(
  env: Pick<Bindings, 'GENERATION_WORKFLOW'>,
  payload: {
    projectId?: string;
    runId?: string;
    workflowInstanceId?: string;
    eventType: string;
    eventPayload?: unknown;
  },
) {
  if (!env.GENERATION_WORKFLOW) {
    throw new Error('Project generation workflow is not configured.');
  }

  const instanceId = payload.workflowInstanceId?.trim()
    || (payload.runId ? workflowInstanceIdFor(payload.projectId || '', payload.runId) : '');
  if (!instanceId) {
    throw new Error('Workflow instance ID is required to send workflow events.');
  }

  const instance = await env.GENERATION_WORKFLOW.get(instanceId);
  await instance.sendEvent({
    type: payload.eventType,
    payload: payload.eventPayload,
  });
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
    if (backend === 'workflow') {
      if (!env.GENERATION_WORKFLOW) {
        throw new Error('Project generation workflow is not configured.');
      }

      if (payload.kind === 'architecture_approval') {
        await sendWorkflowDispatchEvent(
          env,
          {
            projectId: payload.projectId,
            runId: payload.runId,
            workflowInstanceId: payload.workflowInstanceId,
            eventType: WORKFLOW_EVENT_TYPE_ARCHITECTURE_APPROVED,
            eventPayload: {
              approved: true,
              feedback: payload.reviewFeedback || '',
              preferredIde: payload.preferredIde || '',
            },
          },
        );
      } else {
        const workflowPayload = await buildWorkflowPayload(env, payload);
        const workflowCreateId = payload.workflowInstanceId?.trim() || workflowInstanceIdFor(payload.projectId, payload.runId);
        const instance = await env.GENERATION_WORKFLOW.create({
          id: workflowCreateId,
          params: workflowPayload,
        });
        await env.DB.prepare(`
          UPDATE projects
          SET workflow_instance_id = ?,
              updated_at = datetime("now")
          WHERE id = ?
        `)
          .bind(instance.id, payload.projectId)
          .run();
      }
    } else if (backend === 'durable_object') {
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
