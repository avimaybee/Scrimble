import { handleProjectGenerationQueue } from './functions/server/generation-pipeline';

export default {
  async queue(batch: any, env: any, ctx: any) {
    return handleProjectGenerationQueue(batch, env, ctx);
  },
};
