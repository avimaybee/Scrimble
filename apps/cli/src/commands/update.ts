import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import {
  appendActivity,
  loadPlanState,
  savePlanState,
  type LocalChunk,
} from '../lib/local/index.js';
import { recordTelemetry } from '../lib/telemetry.js';

function makeUpdateChunk(input: { request: string; sequence: number }): LocalChunk {
  return {
    id: `update-${String(input.sequence).padStart(3, '0')}`,
    sequence: input.sequence,
    title: `Plan update: ${input.request.slice(0, 60)}`,
    prompt: `Apply this targeted plan update while preserving completed chunks:\n${input.request}`,
    status: 'pending',
    doneWhen: 'Requested change is reflected in code and plan with verification evidence.',
    verificationSignals: ['scrimble verify', 'scrimble status'],
    createdAt: new Date().toISOString(),
  };
}

export default class Update extends Command {
  static override description = 'Apply targeted plain-language updates to the current plan';

  static override examples = [
    '<%= config.bin %> update --request "Add pagination to project listing"',
  ];

  static override flags = {
    request: Flags.string({
      description: 'Targeted update request in plain language',
      required: true,
    }),
    urgent: Flags.boolean({
      description: 'Insert update chunk as the next active priority',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Update);
    const plan = await loadPlanState();
    const sequence = plan.chunks.length + 1;
    const newChunk = makeUpdateChunk({ request: flags.request, sequence });

    const chunks = [...plan.chunks];
    if (flags.urgent) {
      const firstPendingIndex = chunks.findIndex((chunk) => chunk.status === 'pending');
      if (firstPendingIndex === -1) {
        chunks.push(newChunk);
      } else {
        chunks.splice(firstPendingIndex, 0, newChunk);
      }
    } else {
      chunks.push(newChunk);
    }

    const nextPlan = {
      ...plan,
      chunks: chunks.map((chunk, index) => ({ ...chunk, sequence: index + 1 })),
      metadata: {
        ...(plan.metadata ?? {}),
        lastUpdateRequest: flags.request,
        lastUpdatedAt: new Date().toISOString(),
      },
    };

    await savePlanState(nextPlan);
    await appendActivity('plan_updated', {
      request: flags.request,
      urgent: flags.urgent,
      chunkId: newChunk.id,
    });
    await recordTelemetry({
      event: 'plan_updated',
      payload: {
        urgent: flags.urgent,
        chunkId: newChunk.id,
      },
    });

    this.log('');
    this.log(chalk.green(`✓ Plan updated with new chunk: ${newChunk.title}`));
    this.log(chalk.dim('Run `scrimble next` to preview placement, or `scrimble replan` for broader restructuring.'));
    this.log('');
  }
}
