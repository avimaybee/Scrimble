import * as fs from 'node:fs/promises';
import {
  computePlanHash,
  getActiveChunk,
  getScrimblePaths,
  type LocalPlanState,
  type LocalSyncState,
} from './local/index.js';

export interface StalenessIssue {
  code: 'verification_missing' | 'verification_stale' | 'plan_changed_since_sync';
  severity: 'warn' | 'error';
  message: string;
}

function getSyncState(plan: LocalPlanState): LocalSyncState {
  return plan.sync ?? {};
}

export async function detectStaleness(
  plan: LocalPlanState,
  cwd = process.cwd(),
): Promise<StalenessIssue[]> {
  const issues: StalenessIssue[] = [];
  const activeChunk = getActiveChunk(plan);
  const paths = getScrimblePaths(cwd);
  const sync = getSyncState(plan);
  const now = Date.now();

  if (activeChunk) {
    try {
      const verificationStat = await fs.stat(paths.verificationLatest);
      const ageMs = now - verificationStat.mtimeMs;
      if (ageMs > 1000 * 60 * 60 * 24) {
        issues.push({
          code: 'verification_stale',
          severity: 'warn',
          message: 'Verification evidence is older than 24 hours for the active chunk.',
        });
      }
    } catch {
      issues.push({
        code: 'verification_missing',
        severity: 'warn',
        message: 'No verification evidence found for the active chunk.',
      });
    }
  }

  // Detect plan drift: local plan changed since last sync
  if (sync.lastSyncedHash) {
    const currentHash = computePlanHash(plan);
    if (currentHash !== sync.lastSyncedHash) {
      issues.push({
        code: 'plan_changed_since_sync',
        severity: 'warn',
        message: 'Local plan changed since the last sync snapshot.',
      });
    }
  }

  return issues;
}
