import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import {
  appendActivity,
  getActiveChunk,
  getNextPendingChunk,
  loadPlanState,
  savePlanState,
  writeCurrentChunkFromPlan,
} from '../lib/local/index.js';
import { runVerification } from '../lib/verify/index.js';
import { recordTelemetry } from '../lib/telemetry.js';

export default class Done extends Command {
  static override description = 'Complete current chunk: verify, sync completion, and activate next chunk';

  static override examples = [
    '<%= config.bin %> done',
    '<%= config.bin %> done --force --reason "manual verification completed"',
    '<%= config.bin %> done --verify-command "pnpm run build"',
  ];

  static override flags = {
    force: Flags.boolean({
      description: 'Allow completion even if verification fails',
      default: false,
    }),
    reason: Flags.string({
      description: 'Required when --force is used and verification fails',
    }),
    'no-verify': Flags.boolean({
      description: 'Skip verification check',
      default: false,
    }),
    'verify-command': Flags.string({
      description: 'Additional verification command (repeatable)',
      multiple: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Done);
    const plan = await loadPlanState();
    const activeChunk = getActiveChunk(plan);
    if (!activeChunk) {
      this.log(chalk.yellow('\nNo active chunk available to complete.\n'));
      return;
    }

    let verificationResult: Awaited<ReturnType<typeof runVerification>> | undefined;
    if (!flags['no-verify']) {
      verificationResult = await runVerification({
        ...(flags['verify-command'] ? { commands: flags['verify-command'] } : {}),
      });

      if (verificationResult.status === 'fail' && !flags.force) {
        this.log(chalk.red('\nVerification failed. Use --force with --reason to override.\n'));
        this.exit(1);
      }
      if (verificationResult.status === 'fail' && flags.force && !flags.reason) {
        this.log(chalk.red('\nOverride requires --reason when verification fails.\n'));
        this.exit(1);
      }
    }

    const now = new Date().toISOString();
    const completedChunks = plan.chunks.map((chunk) =>
      chunk.id === activeChunk.id
        ? { ...chunk, status: 'completed' as const, completedAt: now, updatedAt: now }
        : chunk,
    );
    const nextPending = getNextPendingChunk({ ...plan, chunks: completedChunks });
    const finalChunks = completedChunks.map((chunk) =>
      nextPending && chunk.id === nextPending.id
        ? { ...chunk, status: 'active' as const, updatedAt: now }
        : chunk,
    );

    const completionPayload = {
      chunkId: activeChunk.id,
      chunkTitle: activeChunk.title,
      verificationStatus: verificationResult?.status ?? null,
      forced: flags.force,
      reason: flags.reason ?? null,
      nextChunkId: nextPending?.id ?? null,
    };

    // Remove lastSyncError on successful state update
    const syncState = { ...(plan.sync ?? {}) };
    delete syncState.lastSyncError;

    const nextPlan = {
      ...plan,
      chunks: finalChunks,
      sync: syncState,
    };

    await savePlanState(nextPlan);
    await writeCurrentChunkFromPlan(nextPlan);
    await appendActivity('chunk_done', completionPayload);
    await recordTelemetry({
      event: 'chunk_done',
      payload: completionPayload,
    });

    this.log('');
    this.log(chalk.green('✓ Chunk completion recorded.'));
    this.log(chalk.dim(`Completed: ${activeChunk.title}`));
    if (nextPending) {
      this.log(chalk.cyan(`Next active chunk: ${nextPending.title}`));
    } else {
      this.log(chalk.green('No pending chunks remain.'));
    }
    this.log('');
  }
}
