import { handleProjectGenerationQueue } from './functions/server/generation-pipeline';

export default {
  async queue(batch: any, env: any, ctx: any) {
    console.log('[CONSUMER_ENTRY] Queue handler invoked. Batch size:', batch.messages?.length, 'Has ENCRYPTION_KEY:', !!env.ENCRYPTION_KEY, 'Has DB:', !!env.DB, 'Has AGENT_QUEUE:', !!env.AGENT_QUEUE);
    console.log('[CONSUMER_ENTRY] env keys:', Object.keys(env));
    try {
      return await handleProjectGenerationQueue(batch, env, ctx);
    } catch (err) {
      console.error('[CONSUMER_ENTRY] UNCAUGHT ERROR:', err instanceof Error ? err.message : String(err));
      throw err;
    }
  },
};
