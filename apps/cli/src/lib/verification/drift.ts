import type { LedgerTask } from '@scrimble/shared';
import { detectOutOfScopeEdits } from '../scheduler/parallel.js';

export type DriftFindingType = 'out_of_scope' | 'stale_verification' | 'dependency_invalidated';
export type DriftSeverity = 'warn' | 'error';

export interface DriftFinding {
  type: DriftFindingType;
  severity: DriftSeverity;
  message: string;
  files?: string[];
  taskIds?: string[];
}

export interface DriftAnalysisResult {
  valid: boolean;
  findings: DriftFinding[];
}

export interface DriftAnalysisInput {
  task: LedgerTask;
  touchedFiles: string[];
  verificationTimestamp?: string;
  lastCodeChangeTimestamp?: string;
  dependencyStatuses?: Array<{ taskId: string; status: LedgerTask['status'] }>;
}

export function detectVerificationStaleness(
  verificationTimestamp?: string,
  lastCodeChangeTimestamp?: string,
): boolean {
  if (!verificationTimestamp || !lastCodeChangeTimestamp) {
    return false;
  }
  return new Date(lastCodeChangeTimestamp).getTime() > new Date(verificationTimestamp).getTime();
}

export function detectDependencyInvalidation(
  dependencies: string[],
  statuses: Array<{ taskId: string; status: LedgerTask['status'] }> = [],
): string[] {
  if (dependencies.length === 0) {
    return [];
  }

  const statusMap = new Map(statuses.map((entry) => [entry.taskId, entry.status]));
  return dependencies.filter((dependency) => statusMap.get(dependency) !== 'completed');
}

export function analyzeTaskDrift(input: DriftAnalysisInput): DriftAnalysisResult {
  const findings: DriftFinding[] = [];

  const scopeValidation = detectOutOfScopeEdits(input.task, input.touchedFiles);
  if (!scopeValidation.valid) {
    findings.push({
      type: 'out_of_scope',
      severity: 'error',
      message: 'Worker touched files outside owned scope.',
      files: scopeValidation.outOfScopeFiles,
    });
  }

  if (detectVerificationStaleness(input.verificationTimestamp, input.lastCodeChangeTimestamp)) {
    findings.push({
      type: 'stale_verification',
      severity: 'warn',
      message: 'Verification results are stale after newer code changes.',
    });
  }

  const invalidDependencies = detectDependencyInvalidation(input.task.dependencies, input.dependencyStatuses);
  if (invalidDependencies.length > 0) {
    findings.push({
      type: 'dependency_invalidated',
      severity: 'error',
      message: 'One or more dependencies are incomplete.',
      taskIds: invalidDependencies,
    });
  }

  return {
    valid: findings.every((finding) => finding.severity !== 'error'),
    findings,
  };
}

