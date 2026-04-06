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
import {
  formatCloudError,
  getPlanRegistryState,
  resolveCloudClientConfig,
  syncPlanRegistry,
} from '../lib/api/index.js';
import { recordTelemetry } from '../lib/telemetry.js';

type ConflictStrategy = 'manual' | 'local' | 'cloud';

function isLocalPlanState(value: unknown): value is LocalPlanState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { version?: unknown; chunks?: unknown };
  return typeof candidate.version === 'number' && Array.isArray(candidate.chunks);
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
  static override description = 'Sync local plan state with canonical cloud registry using hash-based Last-Write-Wins';

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

  private async exitCloudSyncFailure(plan: LocalPlanState, error: unknown): Promise<never> {
    const message = formatCloudError(error);
    const nextPlan: LocalPlanState = {
      ...plan,
      sync: {
        ...(plan.sync ?? {}),
        lastSyncError: message,
      },
    };
    await savePlanState(nextPlan);
    await recordTelemetry({
      event: 'state_sync_failed',
      level: 'warn',
      payload: { message },
    });
    this.log(chalk.red(`\nCloud sync failed: ${message}\n`));
    this.exit(1);
  }

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

    // Fetch canonical remote registry state to check for conflicts
    let remoteRegistry: { projectId: string; latest: { planHash: string; syncedAt: string; plan: unknown } | null };
    try {
      remoteRegistry = await getPlanRegistryState(cloudConfig);
    } catch (error) {
      await this.exitCloudSyncFailure(plan, error);
      return;
    }
    const remoteLatest = remoteRegistry.latest;
    const remotePlanHash = remoteLatest?.planHash;
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

      if (conflictStrategy === 'cloud') {
        const remotePlan = remoteLatest?.plan;
        if (!isLocalPlanState(remotePlan)) {
          await this.exitCloudSyncFailure(plan, new Error('Remote registry response did not include a valid plan payload.'));
          return;
        }
        // Take remote plan as source of truth
        planToSync = {
          ...remotePlan,
          sync: remotePlan.sync ?? {},
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

    let canonicalPlan = planToSync;
    let canonicalPlanHash = computePlanHash(planToSync);
    let syncedAt = new Date().toISOString();

    const cloudWasSource = conflictDetected && conflictStrategy === 'cloud';
    if (cloudWasSource && remoteLatest) {
      canonicalPlanHash = remoteLatest.planHash;
      syncedAt = remoteLatest.syncedAt;
    } else {
      try {
        const syncResult = await syncPlanRegistry(cloudConfig, {
          planHash: canonicalPlanHash,
          plan: canonicalPlan,
          ...(remotePlanHash ? { expectedRemoteHash: remotePlanHash } : {}),
        });
        if (isLocalPlanState(syncResult.latest.plan)) {
          canonicalPlan = syncResult.latest.plan;
        }
        canonicalPlanHash = syncResult.latest.planHash;
        syncedAt = syncResult.latest.syncedAt;
      } catch (error) {
        await this.exitCloudSyncFailure(plan, error);
      }
    }

    // Update local sync state with new hashes (remove lastSyncError on success)
    const syncState = {
      ...(canonicalPlan.sync ?? {}),
      lastSyncedAt: syncedAt,
      lastSyncedHash: canonicalPlanHash,
      lastRemotePlanHash: canonicalPlanHash,
    };
    delete syncState.lastSyncError;

    const savedPlan: LocalPlanState = {
      ...canonicalPlan,
      sync: syncState,
    };

    await savePlanState(savedPlan);
    await appendActivity('state_synced', {
      conflictStrategy,
      conflictDetected,
      planHash: canonicalPlanHash,
      source: cloudWasSource ? 'cloud' : 'local',
    });
    await recordTelemetry({
      event: 'state_synced',
      payload: {
        conflictDetected,
        conflictStrategy,
        source: cloudWasSource ? 'cloud' : 'local',
      },
    });

    this.log('');
    this.log(chalk.green('✓ Sync complete.'));
    this.log(chalk.dim(`Plan hash: ${canonicalPlanHash.slice(0, 12)}...`));
    this.log('');
  }
}
