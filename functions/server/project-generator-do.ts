import { processProjectGeneration } from './generation-pipeline';
import type { Bindings, DurableObjectStateLike, QueueMessageBody } from './types';

type ProjectGeneratorRequestBody = QueueMessageBody & {
  kind?: string;
  previousStatus?: string | null;
  targetStatus?: string;
};

function isProjectGeneratorRequestBody(value: unknown): value is ProjectGeneratorRequestBody {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === 'generate_project'
    && typeof candidate.projectId === 'string'
    && candidate.projectId.trim().length > 0
    && typeof candidate.userId === 'string'
    && candidate.userId.trim().length > 0
    && typeof candidate.runId === 'string'
    && candidate.runId.trim().length > 0
    && (candidate.providerId === undefined || typeof candidate.providerId === 'string')
  );
}

export class ProjectGeneratorDO {
  private pipelineChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: Bindings,
  ) {}

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/state') {
      return Response.json({ scheduled: true });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed.' }, { status: 405 });
    }

    if (!['/start', '/resume', '/approve', '/nudge'].includes(url.pathname)) {
      return Response.json({ error: 'Not found.' }, { status: 404 });
    }

    const parsedBody = await request.json().catch(() => null);
    if (!isProjectGeneratorRequestBody(parsedBody)) {
      return Response.json({ error: 'Invalid project generator payload.' }, { status: 400 });
    }

    const message: QueueMessageBody = {
      type: 'generate_project',
      projectId: parsedBody.projectId,
      userId: parsedBody.userId,
      providerId: parsedBody.providerId,
      runId: parsedBody.runId,
    };

    this.enqueuePipelineRun(message, url.pathname);

    return Response.json({
      success: true,
      scheduled: true,
      action: url.pathname.slice(1),
      project_id: message.projectId,
      run_id: message.runId,
    }, { status: 202 });
  }

  private enqueuePipelineRun(message: QueueMessageBody, action: string) {
    const nextRun = this.pipelineChain
      .catch(() => undefined)
      .then(async () => {
        console.log('[PROJECT_GENERATOR_DO] Starting scheduled pipeline run.', {
          action,
          projectId: message.projectId,
          runId: message.runId,
        });
        await processProjectGeneration(this.env, message, {
          continuationMode: 'inline',
        });
      })
      .catch((error) => {
        console.error('[PROJECT_GENERATOR_DO] Pipeline run failed.', {
          action,
          projectId: message.projectId,
          runId: message.runId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });

    this.pipelineChain = nextRun;
    this.state.waitUntil(nextRun);
  }
}
