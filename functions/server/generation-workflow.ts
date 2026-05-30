import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import {
  runGenerationWorkflowLogic,
  type GenerationWorkflowPayload
} from '@scrimble/core';
import { saveToR2, loadFromR2 } from './workflow-storage';
import type { Bindings } from '@scrimble/core';

export class GenerationWorkflow extends WorkflowEntrypoint<Bindings, GenerationWorkflowPayload> {
  async run(event: WorkflowEvent<GenerationWorkflowPayload>, step: WorkflowStep) {
    return runGenerationWorkflowLogic(
      this.env,
      event.payload,
      step as any,
      saveToR2,
      loadFromR2
    );
  }
}
