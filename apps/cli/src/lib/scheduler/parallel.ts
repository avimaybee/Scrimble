import type { FileLease, LedgerTask } from '@scrimble/shared';
import {
  isGlobPattern,
  normalizeWorkspacePath,
  ownershipOverlaps,
  pathMatchesAnyGlobs,
} from '../path-glob.js';

export interface ParallelDispatchCheck {
  allowed: boolean;
  reason?: string;
  conflicts: string[];
}

export interface LeaseViolation {
  valid: boolean;
  outOfLeaseFiles: string[];
}

function overlapWithLease(task: LedgerTask, lease: FileLease): boolean {
  const taskPaths = task.ownedFiles.filter((entry) => !isGlobPattern(entry));
  const taskGlobs = task.ownedFiles.filter((entry) => isGlobPattern(entry));
  return ownershipOverlaps(
    { paths: taskPaths, globs: taskGlobs },
    { paths: lease.paths, globs: lease.globs },
  );
}

export function hasExplicitOwnership(task: LedgerTask): boolean {
  return task.ownedFiles.length > 0;
}

export function checkParallelDispatch(
  task: LedgerTask,
  activeTasks: LedgerTask[],
  activeLeases: FileLease[],
): ParallelDispatchCheck {
  if (!hasExplicitOwnership(task)) {
    return {
      allowed: false,
      reason: 'Task has no explicit file ownership',
      conflicts: [],
    };
  }

  const conflicts = activeLeases
    .filter((lease) => overlapWithLease(task, lease))
    .map((lease) => lease.taskId);

  if (conflicts.length > 0) {
    return {
      allowed: false,
      reason: 'Task file ownership overlaps active leases',
      conflicts,
    };
  }

  const ambiguousActive = activeTasks
    .filter((activeTask) => activeTask.status === 'running' || activeTask.status === 'leased')
    .find((activeTask) => !hasExplicitOwnership(activeTask));

  if (ambiguousActive) {
    return {
      allowed: false,
      reason: `Active task ${ambiguousActive.id} has vague ownership`,
      conflicts: [ambiguousActive.id],
    };
  }

  return { allowed: true, conflicts: [] };
}

export function validateParallelBatch(tasks: LedgerTask[]): ParallelDispatchCheck {
  for (const task of tasks) {
    if (!hasExplicitOwnership(task)) {
      return {
        allowed: false,
        reason: `Task ${task.id} has no explicit ownership`,
        conflicts: [task.id],
      };
    }
  }

  for (let i = 0; i < tasks.length; i += 1) {
    const left = tasks[i];
    if (!left) {
      continue;
    }
    const leftPaths = left.ownedFiles.filter((entry) => !isGlobPattern(entry));
    const leftGlobs = left.ownedFiles.filter((entry) => isGlobPattern(entry));
    for (let j = i + 1; j < tasks.length; j += 1) {
      const right = tasks[j];
      if (!right) {
        continue;
      }
      const rightPaths = right.ownedFiles.filter((entry) => !isGlobPattern(entry));
      const rightGlobs = right.ownedFiles.filter((entry) => isGlobPattern(entry));
      if (ownershipOverlaps({ paths: leftPaths, globs: leftGlobs }, { paths: rightPaths, globs: rightGlobs })) {
        return {
          allowed: false,
          reason: `Batch overlap between ${left.id} and ${right.id}`,
          conflicts: [left.id, right.id],
        };
      }
    }
  }

  return { allowed: true, conflicts: [] };
}

export function detectOutOfLeaseEdits(task: LedgerTask, touchedFiles: string[]): LeaseViolation {
  if (touchedFiles.length === 0) {
    return { valid: true, outOfLeaseFiles: [] };
  }

  const allowedPaths = new Set(task.ownedFiles.filter((entry) => !isGlobPattern(entry)).map(normalizeWorkspacePath));
  const allowedGlobs = task.ownedFiles.filter((entry) => isGlobPattern(entry));

  const outOfLease = touchedFiles.filter((filePath) => {
    const normalized = normalizeWorkspacePath(filePath);
    if (allowedPaths.has(normalized)) {
      return false;
    }
    return !pathMatchesAnyGlobs(normalized, allowedGlobs);
  });

  return {
    valid: outOfLease.length === 0,
    outOfLeaseFiles: outOfLease,
  };
}

