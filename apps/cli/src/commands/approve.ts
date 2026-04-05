import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import {
  appendActivity,
  getScrimblePaths,
  loadPlanState,
  savePlanState,
  type LocalArchitectureState,
  type LocalPlanState,
  writeCurrentChunkFromPlan,
} from '../lib/local/index.js';
import { recordTelemetry } from '../lib/telemetry.js';

export default class Approve extends Command {
  static override description = 'Approve or reject generated architecture before execution begins';

  static override examples = [
    '<%= config.bin %> approve',
    '<%= config.bin %> approve --notes "Looks good, keep API boundary narrow."',
    '<%= config.bin %> approve --reject --notes "Need simpler data model before coding chunks."',
  ];

  static override flags = {
    reject: Flags.boolean({
      description: 'Reject architecture instead of approving it',
      default: false,
    }),
    notes: Flags.string({
      description: 'Approval or rejection notes',
    }),
    'activate-first': Flags.boolean({
      description: 'Activate the first pending chunk after approval',
      default: true,
      allowNo: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Approve);
    const plan = await loadPlanState();

    const architectureSummary = plan.architecture?.summary ?? (await this.readArchitectureFile());
    if (!architectureSummary) {
      this.log(chalk.red('\nNo architecture artifact found. Generate architecture before approval.\n'));
      this.exit(1);
    }

    const now = new Date().toISOString();
    const architectureState: LocalArchitectureState = {
      ...(plan.architecture ?? {}),
      summary: architectureSummary,
      approved: !flags.reject,
      ...(flags.reject ? { rejectedAt: now } : { approvedAt: now }),
      ...(flags.notes ? { notes: flags.notes } : {}),
    };
    const nextPlan: LocalPlanState = {
      ...plan,
      architecture: architectureState,
    };

    if (!flags.reject && flags['activate-first'] && !nextPlan.chunks.some((chunk) => chunk.status === 'active')) {
      const firstPendingIndex = nextPlan.chunks.findIndex((chunk) => chunk.status === 'pending');
      if (firstPendingIndex !== -1) {
        const pendingChunk = nextPlan.chunks[firstPendingIndex];
        if (!pendingChunk) {
          throw new Error('Pending chunk lookup failed during activation.');
        }
        nextPlan.chunks[firstPendingIndex] = {
          ...pendingChunk,
          status: 'active',
          updatedAt: now,
        };
      }
    }

    const eventType = flags.reject ? 'architecture_rejected' : 'architecture_approved';
    await savePlanState(nextPlan);
    await writeCurrentChunkFromPlan(nextPlan);
    await appendActivity(eventType, {
      approved: !flags.reject,
      notes: flags.notes ?? null,
    });
    await recordTelemetry({
      event: eventType,
      payload: {
        chunkCount: nextPlan.chunks.length,
      },
    });

    this.log('');
    if (flags.reject) {
      this.log(chalk.yellow('⚠ Architecture marked as rejected.'));
      this.log(chalk.dim('Run `scrimble replan --request "<change>"` to regenerate from feedback.'));
    } else {
      this.log(chalk.green('✓ Architecture approved.'));
      const activeChunk = nextPlan.chunks.find((chunk) => chunk.status === 'active');
      if (activeChunk) {
        this.log(chalk.cyan(`Active chunk: ${activeChunk.title}`));
      } else {
        this.log(chalk.yellow('No pending chunks available to activate.'));
      }
    }
    this.log('');
  }

  private async readArchitectureFile(): Promise<string | undefined> {
    try {
      const architecturePath = getScrimblePaths().architecture;
      const value = await fs.readFile(architecturePath, 'utf8');
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    } catch {
      return undefined;
    }
  }
}
