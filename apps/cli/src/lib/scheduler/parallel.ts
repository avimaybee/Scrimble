import type { LedgerTask } from '@scrimble/shared';
import type { OwnershipScopeViolation } from './ownership.js';
import { detectOutOfScopeEdits, hasExplicitOwnership } from './ownership.js';

export { detectOutOfScopeEdits, hasExplicitOwnership };

// Backward-compatible alias while consumers migrate naming.
export function detectOutOfLeaseEdits(task: LedgerTask, touchedFiles: string[]): OwnershipScopeViolation {
  return detectOutOfScopeEdits(task, touchedFiles);
}
