import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import {
  appendActivity,
  getNextPendingChunk,
  loadPlanState,
  savePlanState,
  writeCurrentChunkFromPlan,
} from '../lib/local/index.js';
import { recordTelemetry } from '../lib/telemetry.js';

export default class Next extends Command {
  static override description = 'Preview the next pending chunk without activation (or activate it)';

  static override examples = [
    '<%= config.bin %> next',
    '<%= config.bin %> next --activate',
  ];

  static override flags = {
    activate: Flags.boolean({
      description: 'Activate the next pending chunk immediately',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Next);
    const plan = await loadPlanState();
    const nextChunk = getNextPendingChunk(plan);

    if (!nextChunk) {
      this.log(chalk.green('\nNo pending chunks remain.\n'));
      return;
    }

    if (!flags.activate) {
      this.log('');
      this.log(chalk.bold('Next pending chunk:'));
      this.log(chalk.cyan(`- ${nextChunk.title} (${nextChunk.id})`));
      this.log(chalk.dim(`Run \`scrimble next --activate\` to make it active.`));
      this.log('');
      return;
    }

    const nextChunks = plan.chunks.map((chunk) =>
      chunk.id === nextChunk.id
        ? {
            ...chunk,
            status: 'active' as const,
            updatedAt: new Date().toISOString(),
          }
        : chunk.status === 'active'
          ? { ...chunk, status: 'pending' as const, updatedAt: new Date().toISOString() }
          : chunk,
    );

    const activated = { ...plan, chunks: nextChunks };
    await savePlanState(activated);
    await writeCurrentChunkFromPlan(activated);
    await appendActivity('chunk_activated', { chunkId: nextChunk.id });
    await recordTelemetry({
      event: 'chunk_activated',
      payload: { chunkId: nextChunk.id },
    });

    this.log('');
    this.log(chalk.green(`✓ Activated chunk: ${nextChunk.title}`));
    this.log('');
  }
}
