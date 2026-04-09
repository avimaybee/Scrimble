import type { LedgerDocument, TaskStatus } from '@scrimble/shared';
import type {
  RankedFailureCategory,
  ValidationFailure,
  ValidationScenarioDefinition,
  ValidationScenarioReport,
  ValidationTaskQualitySignals,
  ValidationFoundationSummary,
  ValidationLedgerSnapshot,
} from './types.js';

const TASK_STATUSES: TaskStatus[] = ['pending', 'ready', 'in_progress', 'completed', 'blocked', 'failed'];

function severityRank(severity: 'low' | 'medium' | 'high'): number {
  if (severity === 'high') {
    return 3;
  }
  if (severity === 'medium') {
    return 2;
  }
  return 1;
}

function higherSeverity(
  left: 'low' | 'medium' | 'high',
  right: 'low' | 'medium' | 'high',
): 'low' | 'medium' | 'high' {
  return severityRank(left) >= severityRank(right) ? left : right;
}

function detectConsistencyIssue(ledger: LedgerDocument): string | undefined {
  const activeExecution = ledger.runtime.activeExecution;
  const activeRun = ledger.orchestration.activeRun;
  const inProgressTasks = ledger.tasks.tasks.filter((task) => task.status === 'in_progress');
  if (activeExecution) {
    const activeTask = ledger.tasks.tasks.find((task) => task.id === activeExecution.taskId);
    if (!activeTask) {
      return `Runtime active execution references missing task "${activeExecution.taskId}".`;
    }
    if (activeTask.status !== 'in_progress') {
      return `Runtime active execution task "${activeTask.id}" is ${activeTask.status}.`;
    }
    if (!activeRun) {
      return 'Runtime active execution exists with no active orchestration run.';
    }
    if (activeRun.pendingBoundary) {
      return 'Active execution exists while orchestration is paused for approval.';
    }
  }
  if (!activeExecution && inProgressTasks.length > 0) {
    return `Found ${inProgressTasks.length} in_progress task(s) with no active runtime execution.`;
  }
  return undefined;
}

export function summarizeFoundation(ledger: LedgerDocument): ValidationFoundationSummary {
  const discovery = ledger.intent.discovery;
  const intent = ledger.intent.intent;
  return {
    status: discovery.status,
    ...(discovery.mode ? { mode: discovery.mode } : {}),
    ...(intent?.projectName ? { projectName: intent.projectName } : {}),
    ...(intent?.goal ? { goal: intent.goal } : {}),
    ...(intent?.targetUsers ? { targetUsers: intent.targetUsers } : {}),
    ...(intent?.qualityPreference ? { qualityPreference: intent.qualityPreference } : {}),
    ...(intent?.timeline ? { timeline: intent.timeline } : {}),
    successCriteriaCount: intent?.successCriteria.length ?? 0,
    nonGoalsCount: intent?.nonGoals.length ?? 0,
  };
}

export function summarizeTaskQuality(ledger: LedgerDocument): ValidationTaskQualitySignals {
  const tasks = ledger.tasks.tasks;
  const taskStatusCounts = TASK_STATUSES.reduce<Record<TaskStatus, number>>((accumulator, status) => {
    accumulator[status] = tasks.filter((task) => task.status === status).length;
    return accumulator;
  }, {
    pending: 0,
    ready: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
    failed: 0,
  });

  const totalTasks = tasks.length;
  const owned = tasks.filter((task) => task.ownedFiles.length > 0).length;
  const verified = tasks.filter((task) => task.verificationCommands.length > 0).length;
  const lowOwnershipCount = tasks.filter((task) =>
    task.ownedFiles.length === 0 ||
    task.ownershipConfidence === 'low' ||
    task.ownedFiles.some((ownedFile) => ownedFile.includes('**/*'))
  ).length;
  const missingVerificationCount = tasks.filter((task) => task.verificationCommands.length === 0).length;
  const planningWarningCount = tasks.reduce((sum, task) => sum + (task.planningWarnings?.length ?? 0), 0);

  return {
    totalTasks,
    taskStatusCounts,
    ownershipCoverage: totalTasks === 0 ? 0 : owned / totalTasks,
    verificationCoverage: totalTasks === 0 ? 0 : verified / totalTasks,
    lowOwnershipCount,
    missingVerificationCount,
    planningWarningCount,
  };
}

export function summarizeLedgerSnapshot(ledger: LedgerDocument): ValidationLedgerSnapshot {
  const consistencyIssue = detectConsistencyIssue(ledger);
  return {
    taskCount: ledger.tasks.tasks.length,
    ...(ledger.runtime.activeExecution?.taskId ? { activeExecutionTaskId: ledger.runtime.activeExecution.taskId } : {}),
    ...(ledger.runtime.activeExecution?.phase ? { activeExecutionPhase: ledger.runtime.activeExecution.phase } : {}),
    ...(ledger.orchestration.lastRunOutcome?.status ? { lastRunStatus: ledger.orchestration.lastRunOutcome.status } : {}),
    ...(ledger.orchestration.lastRunOutcome?.summary ? { lastRunSummary: ledger.orchestration.lastRunOutcome.summary } : {}),
    ...(consistencyIssue ? { consistencyIssue } : {}),
  };
}

function hasRepeatedActionLoop(report: ValidationScenarioReport): boolean {
  let previousAction = '';
  let streak = 0;
  for (const event of report.timeline) {
    if (event.type !== 'step_started' || !event.action) {
      continue;
    }
    if (event.action === previousAction) {
      streak += 1;
    } else {
      previousAction = event.action;
      streak = 1;
    }
    if (streak >= 3) {
      return true;
    }
  }
  return report.outcomes.some((outcome) => outcome.reason === 'repeated_action_signature');
}

function buildFailure(
  category: ValidationFailure['category'],
  severity: ValidationFailure['severity'],
  message: string,
  evidence: string[],
): ValidationFailure {
  return {
    category,
    severity,
    message,
    evidence,
  };
}

export function evaluateScenarioFailures(
  report: ValidationScenarioReport,
  scenario: ValidationScenarioDefinition,
): { failures: ValidationFailure[]; warnings: string[] } {
  const failures: ValidationFailure[] = [];
  const warnings: string[] = [];

  if (report.foundation.status !== scenario.expected.foundationStatus) {
    failures.push(
      buildFailure(
        'weak_foundation_capture',
        'high',
        `Foundation status is ${report.foundation.status} but expected ${scenario.expected.foundationStatus}.`,
        [`flow=${report.flow}`],
      ),
    );
  } else if (
    !report.foundation.projectName ||
    !report.foundation.goal ||
    !report.foundation.targetUsers ||
    report.foundation.successCriteriaCount === 0
  ) {
    failures.push(
      buildFailure(
        'weak_foundation_capture',
        'medium',
        'Foundation is approved but missing core fields required for grounded planning.',
        [
          `projectName=${report.foundation.projectName ?? 'missing'}`,
          `goal=${report.foundation.goal ?? 'missing'}`,
          `targetUsers=${report.foundation.targetUsers ?? 'missing'}`,
          `successCriteriaCount=${report.foundation.successCriteriaCount}`,
        ],
      ),
    );
  }

  if (report.qualitySignals.totalTasks < scenario.expected.minTaskCount) {
    failures.push(
      buildFailure(
        'low_quality_task_graph',
        'high',
        `Generated only ${report.qualitySignals.totalTasks} tasks (expected at least ${scenario.expected.minTaskCount}).`,
        [`flow=${report.flow}`],
      ),
    );
  }

  if (report.qualitySignals.ownershipCoverage < scenario.expected.minOwnershipCoverage) {
    failures.push(
      buildFailure(
        'bad_ownership_inference',
        'high',
        `Ownership coverage ${report.qualitySignals.ownershipCoverage.toFixed(2)} is below expectation ${scenario.expected.minOwnershipCoverage.toFixed(2)}.`,
        [`lowOwnershipCount=${report.qualitySignals.lowOwnershipCount}`],
      ),
    );
  } else if (report.qualitySignals.lowOwnershipCount > 0) {
    warnings.push(`Low-confidence ownership inferred for ${report.qualitySignals.lowOwnershipCount} task(s).`);
  }

  if (report.qualitySignals.verificationCoverage < scenario.expected.minVerificationCoverage) {
    failures.push(
      buildFailure(
        'missing_verification_inference',
        'high',
        `Verification coverage ${report.qualitySignals.verificationCoverage.toFixed(2)} is below expectation ${scenario.expected.minVerificationCoverage.toFixed(2)}.`,
        [`missingVerificationCount=${report.qualitySignals.missingVerificationCount}`],
      ),
    );
  } else if (report.qualitySignals.missingVerificationCount > 0) {
    warnings.push(`Missing verification commands on ${report.qualitySignals.missingVerificationCount} task(s).`);
  }

  if (
    report.flow === 'plaintext_oneshot' &&
    scenario.oneShotFlow.autoConfirmExecution &&
    report.outcomes.some((outcome) => outcome.status === 'paused' && outcome.recoveryKind === 'pending_approval')
  ) {
    failures.push(
      buildFailure(
        'inappropriate_approval_pause',
        'medium',
        'One-shot auto-confirm flow paused on approval boundary unexpectedly.',
        report.outcomes.map((outcome) => `${outcome.status}:${outcome.recoveryKind ?? '-'}`),
      ),
    );
  }

  if (scenario.expected.requireResumePath && report.flow === 'shell_adjacent') {
    const pausedDecision = report.boundaryDecisions.find((decision) => decision.decision === 'pause');
    const pauseAction = pausedDecision?.action;
    const proceedAfterPause = pauseAction
      ? report.boundaryDecisions.some((decision) => decision.action === pauseAction && decision.decision === 'proceed')
      : false;
    const proceedCountForPauseAction = pauseAction
      ? report.boundaryDecisions.filter((decision) => decision.action === pauseAction && decision.decision === 'proceed').length
      : 0;
    const resumedOutcome = report.outcomes
      .slice(pausedDecision ? 1 : 0)
      .some((outcome) => outcome.status === 'completed' || outcome.status === 'blocked');
    if (!pausedDecision || !proceedAfterPause || !resumedOutcome || proceedCountForPauseAction > 1) {
      failures.push(
        buildFailure(
          'failed_resume_recovery',
          'medium',
          'Scenario expected a deterministic pause/resume path, but boundary progression evidence was incomplete.',
          [
            `pausedDecision=${Boolean(pausedDecision)}`,
            `proceedAfterPause=${proceedAfterPause}`,
            `proceedCountForPauseAction=${proceedCountForPauseAction}`,
            `resumedOutcome=${resumedOutcome}`,
          ],
        ),
      );
    }
  }

  if (scenario.expected.requireRecoveryPath) {
    const hasRecoveryEvent = report.recoveryEvents.length > 0;
    const hasRecoveryOutcome = report.outcomes.some((outcome) =>
      outcome.recoveryKind === 'state_inconsistent' || outcome.recoveryKind === 'retry_task'
    );
    if (!hasRecoveryEvent || !hasRecoveryOutcome) {
      failures.push(
        buildFailure(
          'failed_resume_recovery',
          'high',
          'Scenario expected explicit recovery behavior but did not surface clear recovery evidence.',
          [`recoveryEvents=${report.recoveryEvents.length}`, `recoveryOutcomes=${hasRecoveryOutcome}`],
        ),
      );
    }
  }

  const firstBlockingIndex = report.outcomes.findIndex((outcome) => outcome.status === 'blocked' || outcome.status === 'failed');
  const hasBlockingOutcome = firstBlockingIndex >= 0;
  const postBlockingOutcomes = hasBlockingOutcome ? report.outcomes.slice(firstBlockingIndex + 1) : [];
  const hasCompletionAfterBlock = postBlockingOutcomes.some((outcome) => outcome.status === 'completed');
  const attemptedRecoveryAfterBlock = report.timeline.some((event) =>
    event.type === 'step_started' &&
    (
      event.action === 'recover_failed_tasks' ||
      event.action === 'repair_state' ||
      event.action === 'generate_or_update_tasks'
    )
  );
  if (hasBlockingOutcome && !hasCompletionAfterBlock) {
    if (!attemptedRecoveryAfterBlock || postBlockingOutcomes.length === 0) {
      failures.push(
        buildFailure(
          'failed_resume_recovery',
          'high',
          'Execution reached blocked/failed state without a deterministic recovery follow-up attempt.',
          report.outcomes.map((outcome) => `${outcome.status}:${outcome.summary}`),
        ),
      );
    } else {
      warnings.push('Recovery was attempted after a blocked/failed outcome but completion was not reached yet.');
    }
  }

  if (report.ledgerSnapshot.consistencyIssue) {
    failures.push(
      buildFailure(
        'stale_runtime_state',
        'high',
        'Final ledger state is inconsistent between runtime/orchestration/task graph.',
        [report.ledgerSnapshot.consistencyIssue],
      ),
    );
  }

  if (hasRepeatedActionLoop(report)) {
    failures.push(
      buildFailure(
        'repetitive_next_actions',
        'medium',
        'Operator repeated low-value actions without forward progress.',
        report.timeline
          .filter((event) => event.type === 'step_started')
          .map((event) => `${event.action ?? 'unknown'}:${event.message}`),
      ),
    );
  }

  const providerExpectation = scenario.expected.provider;
  if (providerExpectation) {
    if (providerExpectation.requireUsableProfile === true && !report.provider.usableNow) {
      failures.push(
        buildFailure(
          'unusable_active_profile_not_caught_early',
          'high',
          'Scenario expected a usable active profile, but provider validation marked it unusable.',
          [
            `provider=${report.provider.provider ?? 'none'}`,
            `authStatus=${report.provider.authStatus ?? 'unknown'}`,
            `modelAvailability=${report.provider.modelAvailability ?? 'unknown'}`,
          ],
        ),
      );
    }

    if (providerExpectation.requireFreshValidation && report.provider.validationFreshness === 'stale') {
      failures.push(
        buildFailure(
          'stale_provider_capability_data',
          'medium',
          'Scenario expected fresh provider capability validation, but only stale data was available.',
          [
            `capabilitySource=${report.provider.capabilitySource ?? 'unknown'}`,
            `validationFreshness=${report.provider.validationFreshness ?? 'unknown'}`,
          ],
        ),
      );
    }

    if (providerExpectation.expectedAuthSource && report.provider.authSource !== providerExpectation.expectedAuthSource) {
      failures.push(
        buildFailure(
          'invalid_auth_source_detection',
          'high',
          'Resolved auth source did not match expected credential precedence path.',
          [
            `expected=${providerExpectation.expectedAuthSource}`,
            `actual=${report.provider.authSource ?? 'none'}`,
          ],
        ),
      );
    }

    if (providerExpectation.expectEarlyGate && !report.provider.usableNow) {
      const firstOutcome = report.outcomes[0];
      const gatedEarly = Boolean(
        firstOutcome && (
          firstOutcome.status === 'paused'
          || firstOutcome.status === 'blocked'
          || firstOutcome.status === 'failed'
          || firstOutcome.reason === 'setup_required'
        ),
      );
      if (!gatedEarly) {
        failures.push(
          buildFailure(
            'unusable_active_profile_not_caught_early',
            'high',
            'Profile was unusable but execution was not gated early with a setup/repair outcome.',
            report.outcomes.map((outcome) => `${outcome.status}:${outcome.reason ?? '-'}:${outcome.summary}`),
          ),
        );
      }

      const setupGuidanceSeen =
        report.outcomes.some((outcome) => {
          const summary = `${outcome.summary} ${outcome.nextSuggestedAction ?? ''}`.toLowerCase();
          return summary.includes('setup') || summary.includes('config') || summary.includes('provider');
        }) ||
        report.timeline.some((event) => {
          const message = `${event.message} ${event.reason ?? ''}`.toLowerCase();
          return message.includes('setup') || message.includes('config') || message.includes('provider');
        });

      if (!setupGuidanceSeen) {
        failures.push(
          buildFailure(
            'misleading_setup_recommendation',
            'medium',
            'Profile was unusable but flow did not surface clear provider/setup remediation guidance.',
            report.outcomes.map((outcome) => `${outcome.status}:${outcome.summary}`),
          ),
        );
      }

      const setupActionStarts = report.timeline.filter(
        (event) => event.type === 'step_started' && event.action === 'configure_ai',
      ).length;
      if (setupActionStarts > 1) {
        failures.push(
          buildFailure(
            'repetitive_next_actions',
            'medium',
            'Unusable profile scenario retried provider setup multiple times without state change.',
            [`configureAiStepStarts=${setupActionStarts}`],
          ),
        );
      }
    }
  }

  const finalOutcome = report.outcomes[report.outcomes.length - 1];
  if (finalOutcome?.reason === 'no_next_action') {
    failures.push(
      buildFailure(
        'repetitive_next_actions',
        'medium',
        'Operator paused with no_next_action after scenario execution, indicating low-value follow-up guidance.',
        report.outcomes.map((outcome) => `${outcome.status}:${outcome.reason ?? '-'}`),
      ),
    );
  }

  if (report.qualitySignals.planningWarningCount > 0) {
    warnings.push(`Planning warnings detected across tasks: ${report.qualitySignals.planningWarningCount}.`);
  }

  return { failures, warnings };
}

export function rankFailures(reports: ValidationScenarioReport[]): RankedFailureCategory[] {
  const ranking = new Map<ValidationFailure['category'], RankedFailureCategory>();
  for (const report of reports) {
    for (const failure of report.failures) {
      const existing = ranking.get(failure.category);
      if (!existing) {
        ranking.set(failure.category, {
          category: failure.category,
          count: 1,
          highestSeverity: failure.severity,
          scenarios: [report.scenario],
        });
        continue;
      }
      existing.count += 1;
      existing.highestSeverity = higherSeverity(existing.highestSeverity, failure.severity);
      if (!existing.scenarios.includes(report.scenario)) {
        existing.scenarios.push(report.scenario);
      }
    }
  }

  return [...ranking.values()].sort((left, right) => {
    const severityDiff = severityRank(right.highestSeverity) - severityRank(left.highestSeverity);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return right.count - left.count;
  });
}
