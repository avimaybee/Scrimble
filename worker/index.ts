import { app } from '../functions/server/app';
import { handleProjectGenerationQueue } from '../functions/server/generation-pipeline';
import type { Bindings, QueueExecutionContext, QueueMessageBatch } from '../functions/server/types';

type WorkerContext = QueueExecutionContext & {
  passThroughOnException?: () => void;
};

const worker = {
  async fetch(request: Request, env: Bindings, ctx: WorkerContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api')) {
      return app.fetch(request, env, ctx as any);
    }

    if (!env.ASSETS) {
      return new Response('Static assets binding is not configured.', { status: 500 });
    }

    return env.ASSETS.fetch(request);
  },

  async queue(batch: QueueMessageBatch, env: Bindings, ctx: QueueExecutionContext): Promise<void> {
    await handleProjectGenerationQueue(batch, env, ctx);
  },
};

export default worker;
