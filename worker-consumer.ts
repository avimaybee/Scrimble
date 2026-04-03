import { WorkerEntrypoint } from 'cloudflare:workers';
import { GenerationWorkflow } from './functions/server/generation-workflow';
import {
  WORKFLOW_EVENT_TYPE_ARCHITECTURE_APPROVED,
  WORKFLOW_EVENT_TYPE_VERIFICATION_APPROVED,
} from './functions/server/generation-dispatch';
import { assertWorkflowProtocolVersion } from './functions/server/workflow-protocol';
import type {
  Bindings,
  GenerationWorkflowPayload,
  WorkflowApprovalPayload,
} from './functions/server/types';

export { GenerationWorkflow };

// Compatibility shim: keep exporting this class so Cloudflare can continue
// serving previously created DO metadata while workflow-only runtime is active.
export class ProjectGeneratorDO {
  constructor(
    private readonly _state: unknown,
    private readonly _env: Bindings,
  ) {}

  fetch() {
    return new Response(null, { status: 404 });
  }
}

export default class WorkflowService extends WorkerEntrypoint<Bindings> {
  async createGeneration(payload: GenerationWorkflowPayload): Promise<{ instanceId: string }> {
    assertWorkflowProtocolVersion(payload.protocolVersion);
    const instance = await this.env.GENERATION_WORKFLOW.create({
      id: payload.runId,
      params: payload,
    });
    return { instanceId: instance.id };
  }

  async sendApproval(instanceId: string, approvalPayload: WorkflowApprovalPayload): Promise<void> {
    const instance = await this.env.GENERATION_WORKFLOW.get(instanceId);
    await instance.sendEvent({
      type: approvalPayload.approvalType === 'verification'
        ? WORKFLOW_EVENT_TYPE_VERIFICATION_APPROVED
        : WORKFLOW_EVENT_TYPE_ARCHITECTURE_APPROVED,
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

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      if (url.pathname === '/generation/create') {
        const body = await request.json().catch(() => ({})) as { payload?: GenerationWorkflowPayload };
        if (!body.payload) {
          return new Response(JSON.stringify({ error: 'Missing generation payload' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const result = await this.createGeneration(body.payload);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/generation/approve') {
        const body = await request.json().catch(() => ({})) as {
          instanceId?: string;
          approvalPayload?: WorkflowApprovalPayload;
        };
        if (!body.instanceId || !body.approvalPayload) {
          return new Response(JSON.stringify({ error: 'Missing approval payload' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        await this.sendApproval(body.instanceId, body.approvalPayload);
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/generation/cancel') {
        const body = await request.json().catch(() => ({})) as { instanceId?: string };
        if (!body.instanceId) {
          return new Response(JSON.stringify({ error: 'Missing instanceId' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        await this.cancelGeneration(body.instanceId);
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workflow service request failed';
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
