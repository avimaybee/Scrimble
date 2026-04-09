import type { LedgerTask } from '@scrimble/shared';
import {
  isGlobPattern,
  normalizeWorkspacePath,
  pathMatchesAnyGlobs,
} from '../path-glob.js';

export interface OwnershipScopeViolation {
  valid: boolean;
  outOfScopeFiles: string[];
}

export function hasExplicitOwnership(task: LedgerTask): boolean {
  return task.ownedFiles.length > 0;
}

export function detectOutOfScopeEdits(task: LedgerTask, touchedFiles: string[]): OwnershipScopeViolation {
  if (touchedFiles.length === 0) {
    return { valid: true, outOfScopeFiles: [] };
  }

  const allowedPaths = new Set(
    task.ownedFiles
      .filter((entry) => !isGlobPattern(entry))
      .map(normalizeWorkspacePath),
  );
  const allowedGlobs = task.ownedFiles.filter((entry) => isGlobPattern(entry));

  const outOfScope = touchedFiles.filter((filePath) => {
    const normalized = normalizeWorkspacePath(filePath);
    if (allowedPaths.has(normalized)) {
      return false;
    }
    return !pathMatchesAnyGlobs(normalized, allowedGlobs);
  });

  return {
    valid: outOfScope.length === 0,
    outOfScopeFiles: outOfScope,
  };
}

// Backward-compatible alias while consumers migrate naming.
export function detectOutOfLeaseEdits(task: LedgerTask, touchedFiles: string[]): OwnershipScopeViolation {
  return detectOutOfScopeEdits(task, touchedFiles);
}

