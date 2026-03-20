import { getProvider } from './ai';
import type {
  Bindings,
  GenerationWorkflowPayload,
  ProjectGenerationStatus,
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
  previousStatus?: ProjectGenerationStatus | null;
  targetStatus: ProjectGenerationStatus;
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
): Promise<GenerationWorkflowPayload> {
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

export async function sendWorkflowDispatchEvent(
  env: Pick<Bindings, 'WORKFLOW_SERVICE'>,
  payload: {
    projectId?: string;
    runId?: string;
    workflowInstanceId?: string;
    eventType: string;
    eventPayload?: unknown;
  },
) {
  if (!env.WORKFLOW_SERVICE) {
    throw new Error('Project generation workflow is not configured.');
  }

  const instanceId = payload.workflowInstanceId?.trim()
    || (payload.runId ? workflowInstanceIdFor(payload.projectId || '', payload.runId) : '');
  if (!instanceId) {
    throw new Error('Workflow instance ID is required to send workflow events.');
  }

  if (payload.eventType !== WORKFLOW_EVENT_TYPE_ARCHITECTURE_APPROVED) {
    throw new Error(`Unsupported workflow event type: ${payload.eventType}`);
  }

  const approvalPayload = (payload.eventPayload || {}) as {
    feedback?: string;
    preferredIde?: string;
    approved?: boolean;
  };

  await env.WORKFLOW_SERVICE.sendApproval(instanceId, {
    feedback: approvalPayload.feedback || '',
    preferredIde: approvalPayload.preferredIde || '',
    approved: approvalPayload.approved ?? true,
  });
}

export async function sendGenerationDispatch(
  env: Bindings,
  payload: DispatchPayload,
) {
  if (!env.WORKFLOW_SERVICE) {
    throw new Error('Project generation workflow is not configured.');
  }

  if (payload.kind === 'architecture_approval') {
    await sendWorkflowDispatchEvent(env, {
      projectId: payload.projectId,
      runId: payload.runId,
      workflowInstanceId: payload.workflowInstanceId,
      eventType: WORKFLOW_EVENT_TYPE_ARCHITECTURE_APPROVED,
      eventPayload: {
        approved: true,
        feedback: payload.reviewFeedback || '',
        preferredIde: payload.preferredIde || '',
      },
    });
    return payload.workflowInstanceId || workflowInstanceIdFor(payload.projectId, payload.runId);
  }

  const workflowPayload = await buildWorkflowPayload(env, payload);
  const instance = await env.WORKFLOW_SERVICE.createGeneration(workflowPayload);

  await env.DB.prepare(`
    UPDATE projects
    SET workflow_instance_id = ?,
        updated_at = datetime("now")
    WHERE id = ?
  `)
    .bind(instance.instanceId, payload.projectId)
    .run();

  return instance.instanceId;
}
