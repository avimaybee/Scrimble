import { WorkerEntrypoint } from 'cloudflare:workers';
import { GenerationWorkflow } from './functions/server/generation-workflow';
import { WORKFLOW_EVENT_TYPE_ARCHITECTURE_APPROVED } from './functions/server/generation-dispatch';
import type {
  Bindings,
  GenerationWorkflowPayload,
  WorkflowApprovalPayload,
} from './functions/server/types';

export { GenerationWorkflow };

export default class WorkflowService extends WorkerEntrypoint<Bindings> {
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
    try {
      const instance = await this.env.GENERATION_WORKFLOW.get(instanceId);
      await instance.terminate();
    } catch {
      // Workflow instances can complete/terminate before cancellation arrives.
    }
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
