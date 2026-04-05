import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import {
  appendActivity,
  getActiveChunk,
  loadPlanState,
  savePlanState,
  writeCurrentChunkFromPlan,
} from '../lib/local/index.js';
import { recordTelemetry } from '../lib/telemetry.js';

export default class Skip extends Command {
  static override description = 'Skip current chunk with explicit reason and risk acknowledgement';

  static override examples = [
    '<%= config.bin %> skip --reason "Blocked by external API outage" --ack-risk',
  ];

  static override flags = {
    reason: Flags.string({
      description: 'Reason for skipping this chunk',
      required: true,
    }),
    'ack-risk': Flags.boolean({
      description: 'Acknowledge that skipping may introduce project risk',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Skip);
    if (!flags['ack-risk']) {
      this.log(chalk.red('\nSkipping requires explicit risk acknowledgement: add --ack-risk.\n'));
      this.exit(1);
    }

    const plan = await loadPlanState();
    const activeChunk = getActiveChunk(plan);
    if (!activeChunk) {
      this.log(chalk.yellow('\nNo active chunk found to skip.\n'));
      return;
    }

    const timestamp = new Date().toISOString();
    let activatedNextId: string | undefined;
    const updatedChunks = plan.chunks.map((chunk) => {
      if (chunk.id === activeChunk.id) {
        return {
          ...chunk,
          status: 'skipped' as const,
          skipReason: flags.reason,
          skippedAt: timestamp,
          updatedAt: timestamp,
        };
      }
      return chunk;
    });

    const firstPendingIndex = updatedChunks.findIndex((chunk) => chunk.status === 'pending');
    if (firstPendingIndex !== -1) {
      const pendingChunk = updatedChunks[firstPendingIndex];
      if (!pendingChunk) {
        throw new Error('Pending chunk lookup failed during skip flow.');
      }
      activatedNextId = pendingChunk.id;
      updatedChunks[firstPendingIndex] = {
        ...pendingChunk,
        status: 'active',
        updatedAt: timestamp,
      };
    }

    const nextPlan = { ...plan, chunks: updatedChunks };

    await savePlanState(nextPlan);
    await writeCurrentChunkFromPlan(nextPlan);
    await appendActivity('chunk_skipped', {
      chunkId: activeChunk.id,
      reason: flags.reason,
      activatedNextId: activatedNextId ?? null,
    });
    await recordTelemetry({
      event: 'chunk_skipped',
      level: 'warn',
      payload: {
        chunkId: activeChunk.id,
        reason: flags.reason,
      },
    });

    this.log('');
    this.log(chalk.yellow(`⚠ Skipped chunk: ${activeChunk.title}`));
    if (activatedNextId) {
      const activated = nextPlan.chunks.find((chunk) => chunk.id === activatedNextId);
      this.log(chalk.cyan(`Activated next chunk: ${activated?.title ?? activatedNextId}`));
    } else {
      this.log(chalk.dim('No further pending chunks were available to activate.'));
    }
    this.log('');
  }
}
