import { handleProjectGenerationQueue } from './functions/server/generation-pipeline';
import { ProjectGeneratorDO } from './functions/server/project-generator-do';

export { ProjectGeneratorDO };

export default {
  async queue(batch: any, env: any, ctx: any) {
    return await handleProjectGenerationQueue(batch, env, ctx);
  },
};
