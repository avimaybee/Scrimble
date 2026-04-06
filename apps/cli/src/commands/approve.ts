import { Command, Flags, Args } from '@oclif/core';
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
import { loadConductorWorkspace } from '../lib/conductor/index.js';
import { approveTrack, isTrackApproved, revokeTrackApproval, loadApprovals } from '../lib/conductor/runtime.js';

export default class Approve extends Command {
  static override description = 'Approve a Conductor track for autonomous execution, or approve architecture';

  static override examples = [
    '<%= config.bin %> approve',
    '<%= config.bin %> approve auth-flow',
    '<%= config.bin %> approve --list',
    '<%= config.bin %> approve auth-flow --revoke',
    '<%= config.bin %> approve --notes "Looks good, keep API boundary narrow."',
    '<%= config.bin %> approve --reject --notes "Need simpler data model before coding chunks."',
  ];

  static override args = {
    track: Args.string({
      description: 'Track ID to approve for autonomous execution',
      required: false,
    }),
  };

  static override flags = {
    reject: Flags.boolean({
      description: 'Reject architecture instead of approving it (legacy mode)',
      default: false,
    }),
    revoke: Flags.boolean({
      description: 'Revoke approval for a track',
      default: false,
    }),
    list: Flags.boolean({
      description: 'List all track approvals',
      default: false,
    }),
    notes: Flags.string({
      description: 'Approval or rejection notes',
    }),
    'activate-first': Flags.boolean({
      description: 'Activate the first pending chunk after approval (legacy mode)',
      default: true,
      allowNo: true,
    }),
    scope: Flags.string({
      description: 'Approval scope for track',
      options: ['full', 'current_phase'],
      default: 'full',
    }),
  };

  async run(): Promise<void> {
    const { flags, args } = await this.parse(Approve);

    // Check for Conductor workspace
    const conductorWorkspace = await loadConductorWorkspace();

    // Handle --list flag
    if (flags.list) {
      const approvals = await loadApprovals();
      this.log('');
      this.log(chalk.bold('Track Approvals:'));
      if (approvals.approvals.length === 0) {
        this.log(chalk.dim('  No tracks approved yet.'));
      } else {
        for (const approval of approvals.approvals) {
          this.log(`  ${chalk.green('✓')} ${approval.trackId} (${approval.scope}) - ${new Date(approval.approvedAt).toLocaleString()}`);
        }
      }
      this.log('');
      return;
    }

    // If track argument provided, handle Conductor track approval
    if (args.track || conductorWorkspace.exists) {
      await this.handleTrackApproval(args.track, flags, conductorWorkspace);
      return;
    }

    // Legacy: architecture approval
    await this.handleArchitectureApproval(flags);
  }

  private async handleTrackApproval(
    trackArg: string | undefined,
    flags: { revoke: boolean; scope: string; notes: string | undefined },
    conductorWorkspace: Awaited<ReturnType<typeof loadConductorWorkspace>>,
  ): Promise<void> {
    if (!conductorWorkspace.exists) {
      this.log(chalk.red('\nNo Conductor workspace found. Run `scrimble init` first.\n'));
      this.exit(1);
    }

    // If no track specified, show available tracks
    if (!trackArg) {
      this.log('');
      this.log(chalk.bold('Available Tracks:'));
      for (const track of conductorWorkspace.tracks) {
        const approved = await isTrackApproved(track.id);
        const icon = approved ? chalk.green('✓') : chalk.dim('·');
        this.log(`  ${icon} ${track.id} - ${track.title} (${track.status})`);
      }
      this.log('');
      this.log(chalk.dim('Run `scrimble approve <track-id>` to approve a track.'));
      this.log('');
      return;
    }

    // Find the track
    const track = conductorWorkspace.tracks.find((t) => t.id === trackArg);
    if (!track) {
      this.log(chalk.red(`\nTrack not found: ${trackArg}`));
      this.log(chalk.dim('Available tracks:'));
      for (const t of conductorWorkspace.tracks) {
        this.log(chalk.dim(`  - ${t.id}`));
      }
      this.log('');
      this.exit(1);
    }

    // Handle revoke
    if (flags.revoke) {
      await revokeTrackApproval(track.id);
      this.log('');
      this.log(chalk.yellow(`✗ Revoked approval for track: ${track.title}`));
      this.log('');
      await recordTelemetry({ event: 'track_approval_revoked', payload: { trackId: track.id } });
      return;
    }

    // Approve the track
    const scope = flags.scope as 'full' | 'current_phase';
    await approveTrack(track.id, { scope });

    this.log('');
    this.log(chalk.green(`✓ Track approved for autonomous execution: ${track.title}`));
    this.log(chalk.dim(`  Scope: ${scope}`));
    if (flags.notes) {
      this.log(chalk.dim(`  Notes: ${flags.notes}`));
    }
    this.log('');
    this.log(chalk.dim('Run `scrimble run` to start autonomous execution.'));
    this.log('');

    await recordTelemetry({ event: 'track_approved', payload: { trackId: track.id, scope } });
  }

  private async handleArchitectureApproval(
    flags: { reject: boolean; notes: string | undefined; 'activate-first': boolean },
  ): Promise<void> {
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
