import type { Bindings, ProjectGenerationStatus } from './types';

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

export async function sendGenerationDispatch(
  env: Bindings,
  payload: DispatchPayload,
) {
  console.log("[DEBUG] sendGenerationDispatch - Start");
  console.log("[DEBUG] env exists:", !!env);
  console.log("[DEBUG] env keys:", Object.keys(env || {}));
  console.log("[DEBUG] AGENT_QUEUE exists:", !!env?.AGENT_QUEUE);
  
  if (!env.AGENT_QUEUE) {
    console.error("[ERROR] AGENT_QUEUE is undefined in Bindings");
  }

  const dispatchId = crypto.randomUUID();
  const queueBody = {
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
    console.log('[DEBUG_QUEUE] env object keys:', Object.keys(env));
    console.log('[DEBUG_QUEUE] AGENT_QUEUE present?', !!env.AGENT_QUEUE);
    
    if (!env.AGENT_QUEUE) {
      throw new Error('Project generation queue is not configured.');
    }

    await env.AGENT_QUEUE.send(
      queueBody,
      payload.delaySeconds ? { delaySeconds: payload.delaySeconds } : undefined,
    );

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
