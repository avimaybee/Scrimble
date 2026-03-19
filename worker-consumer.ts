import { handleProjectGenerationQueue } from './functions/server/generation-pipeline';
import { ProjectGeneratorDO } from './functions/server/project-generator-do';
import { GenerationWorkflow } from './functions/server/generation-workflow';

export { ProjectGeneratorDO, GenerationWorkflow };

export default {
  async queue(batch: any, env: any, ctx: any) {
    return await handleProjectGenerationQueue(batch, env, ctx);
  },
};
