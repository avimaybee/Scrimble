import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleProjectGenerationQueue } from './functions/server/generation-pipeline';
import { ProjectGeneratorDO } from './functions/server/project-generator-do';
import { GenerationWorkflow } from './functions/server/generation-workflow';
import { WORKFLOW_EVENT_TYPE_ARCHITECTURE_APPROVED } from './functions/server/generation-dispatch';
import type { Bindings, GenerationWorkflowPayload, WorkflowApprovalPayload } from './functions/server/types';

export class WorkflowService extends WorkerEntrypoint<Bindings> {
  async fetch() {
    return new Response(null, { status: 404 });
  }

  async createGeneration(payload: GenerationWorkflowPayload): Promise<{ instanceId: string }> {
    const instance = await this.env.GENERATION_WORKFLOW.create({
      id: payload.runId,
      params: payload,
    });
    return { instanceId: instance.id };
  }

  async sendApproval(instanceId: string, approvalPayload: WorkflowApprovalPayload): Promise<void> {
    const instance = await this.env.GENERATION_WORKFLOW.get(instanceId);
    await instance.sendEvent({
      type: WORKFLOW_EVENT_TYPE_ARCHITECTURE_APPROVED,
      payload: approvalPayload,
    });
  }

  async cancelGeneration(instanceId: string): Promise<void> {
    const instance = await this.env.GENERATION_WORKFLOW.get(instanceId);
    await instance.terminate();
  }

  async getStatus(instanceId: string): Promise<{ status: string; output: unknown }> {
    const instance = await this.env.GENERATION_WORKFLOW.get(instanceId);
    const status = await instance.status();
    return {
      status: status.status,
      output: status.output,
    };
  }
}

export { ProjectGeneratorDO, GenerationWorkflow };

export default {
  async queue(batch: any, env: any, ctx: any) {
    return await handleProjectGenerationQueue(batch, env, ctx);
  },
};
