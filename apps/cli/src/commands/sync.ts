import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  appendActivity,
  computePlanHash,
  ensureScrimbleDirectories,
  loadPlanState,
  savePlanState,
  type LocalPlanState,
} from '../lib/local/index.js';
import { listArtifacts, readArtifact, resolveCloudClientConfig, uploadArtifact } from '../lib/api/index.js';
import { recordTelemetry } from '../lib/telemetry.js';

type ConflictStrategy = 'manual' | 'local' | 'cloud';

interface PlanSnapshotPayload {
  planHash: string;
  syncedAt: string;
  plan: LocalPlanState;
}

/**
 * Detects hash-based conflict using Last-Write-Wins with Hash Latch.
 * Conflict occurs when:
 * 1. Remote hash exists
 * 2. We have a last known remote hash (from our previous sync)
 * 3. Remote hash has changed since our last sync (someone else synced)
 * 4. Our local plan is different from the remote (we have local changes)
 */
function hasConflict(
  localPlanHash: string,
  remotePlanHash: string | undefined,
  lastKnownRemoteHash: string | undefined,
): boolean {
  if (!remotePlanHash) return false;
  if (!lastKnownRemoteHash) return false;
  return remotePlanHash !== lastKnownRemoteHash && localPlanHash !== remotePlanHash;
}

export default class Sync extends Command {
  static override description = 'Sync local plan state to cloud using hash-based Last-Write-Wins';

  static override examples = [
    '<%= config.bin %> sync',
    '<%= config.bin %> sync --on-conflict local',
    '<%= config.bin %> sync --dry-run',
  ];

  static override flags = {
    'on-conflict': Flags.string({
      description: 'Conflict resolution strategy',
      options: ['manual', 'local', 'cloud'],
      default: 'manual',
    }),
    'dry-run': Flags.boolean({
      description: 'Preview sync without uploading',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Sync);
    const conflictStrategy = flags['on-conflict'] as ConflictStrategy;
    const plan = await loadPlanState();
    const localPlanHash = computePlanHash(plan);

    let cloudConfig;
    try {
      cloudConfig = await resolveCloudClientConfig();
    } catch {
      this.log(chalk.red('\nCloud configuration is missing. Run `scrimble init` and `scrimble login` first.\n'));
      this.exit(1);
      return;
    }

    // Fetch remote snapshot to check for conflicts
    const snapshots = await listArtifacts(cloudConfig, 'plan-snapshot', 1);
    let remoteSnapshot: PlanSnapshotPayload | undefined;
    if (snapshots.length > 0) {
      const latestSnapshot = snapshots[0];
      if (latestSnapshot) {
        remoteSnapshot = await readArtifact<PlanSnapshotPayload>(cloudConfig, latestSnapshot.key);
      }
    }

    const remotePlanHash = remoteSnapshot?.planHash;
    const localLastRemote = plan.sync?.lastRemotePlanHash;
    const conflictDetected = hasConflict(localPlanHash, remotePlanHash, localLastRemote);

    // If local plan hash matches remote, nothing to sync
    if (!conflictDetected && remotePlanHash === localPlanHash) {
      this.log(chalk.dim('\nLocal plan is already in sync with cloud.\n'));
      return;
    }

    let planToSync = plan;
    if (conflictDetected) {
      if (conflictStrategy === 'manual') {
        const paths = await ensureScrimbleDirectories();
        const conflictPath = path.join(paths.conflictsDir, `sync-conflict-${Date.now()}.json`);
        await fs.writeFile(
          conflictPath,
          `${JSON.stringify(
            {
              detectedAt: new Date().toISOString(),
              localPlanHash,
              remotePlanHash,
              lastKnownRemoteHash: localLastRemote,
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
        this.log(chalk.red('\nSync conflict detected. Remote plan changed since your last sync.'));
        this.log(chalk.red(`Conflict details saved to: ${conflictPath}`));
        this.log(chalk.red('Re-run with --on-conflict local (keep yours) or --on-conflict cloud (take theirs).\n'));
        this.exit(1);
        return;
      }

      if (conflictStrategy === 'cloud' && remoteSnapshot?.plan) {
        // Take remote plan as source of truth
        planToSync = {
          ...remoteSnapshot.plan,
          sync: remoteSnapshot.plan.sync ?? {},
        };
      }
      // conflictStrategy === 'local' means we keep our local plan (planToSync stays as plan)
    }

    if (flags['dry-run']) {
      this.log('');
      this.log(chalk.bold('Sync dry run summary'));
      this.log(chalk.dim(`Local plan hash: ${localPlanHash}`));
      this.log(chalk.dim(`Remote plan hash: ${remotePlanHash ?? 'none'}`));
      this.log(chalk.dim(`Last known remote hash: ${localLastRemote ?? 'none'}`));
      this.log(chalk.dim(`Conflict detected: ${conflictDetected ? 'yes' : 'no'}`));
      this.log('');
      return;
    }

    const syncedAt = new Date().toISOString();
    const nextPlanHash = computePlanHash(planToSync);

    // Upload plan snapshot with new hash
    await uploadArtifact(cloudConfig, 'plan-snapshot', {
      planHash: nextPlanHash,
      syncedAt,
      plan: planToSync,
    });

    // Update local sync state with new hashes (remove lastSyncError on success)
    const syncState = {
      ...(planToSync.sync ?? {}),
      lastSyncedAt: syncedAt,
      lastSyncedHash: nextPlanHash,
      lastRemotePlanHash: nextPlanHash,
    };
    delete syncState.lastSyncError;

    const savedPlan: LocalPlanState = {
      ...planToSync,
      sync: syncState,
    };

    await savePlanState(savedPlan);
    await appendActivity('state_synced', {
      conflictStrategy,
      conflictDetected,
      planHash: nextPlanHash,
    });
    await recordTelemetry({
      event: 'state_synced',
      payload: {
        conflictDetected,
        conflictStrategy,
      },
    });

    this.log('');
    this.log(chalk.green('✓ Sync complete.'));
    this.log(chalk.dim(`Plan hash: ${nextPlanHash.slice(0, 12)}...`));
    this.log('');
  }
}
