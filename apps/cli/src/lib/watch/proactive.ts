import type { VerificationResult } from '@scrimble/shared';
import type { LocalPlanState } from '../local/index.js';
import type { RepoWatchEvent } from './watcher.js';

export interface ProactiveSignal {
  type:
    | 'completion-ready'
    | 'verification-drift'
    | 'dependency-drift'
    | 'plan-divergence'
    | 'no-active-chunk'
    | 'execution-signal';
  severity: 'info' | 'warn';
  message: string;
  suggestedCommand: string;
  confidence: number;
}

function containsDependencySignal(events: RepoWatchEvent[]): boolean {
  const dependencyFiles = new Set([
    'package.json',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'go.mod',
    'Cargo.toml',
    'requirements.txt',
    'pyproject.toml',
  ]);
  return events.some((event) => dependencyFiles.has(event.relativePath.split('/').at(-1) ?? ''));
}

/**
 * Passive system event detection: test runner exits, build completions, etc.
 * Instead of heuristic filename matching, we watch for actual execution artifacts.
 */
function containsExecutionSignal(events: RepoWatchEvent[]): boolean {
  const executionOutputPatterns = [
    'test-results',
    'coverage',
    'junit.xml',
    '.nyc_output',
    '__snapshots__',
    'dist/',
    '.tsbuildinfo',
    '.next/',
    'build/',
  ];
  return events.some((event) => {
    const pathLower = event.relativePath.toLowerCase();
    return executionOutputPatterns.some((pattern) => pathLower.includes(pattern));
  });
}

export function evaluateProactiveSignals(input: {
  events: RepoWatchEvent[];
  plan: LocalPlanState;
  verificationResult?: VerificationResult | null;
}): ProactiveSignal[] {
  const { events, plan, verificationResult } = input;
  const activeChunk = plan.chunks.find((chunk) => chunk.status === 'active');
  const signals: ProactiveSignal[] = [];

  if (!activeChunk) {
    signals.push({
      type: 'no-active-chunk',
      severity: 'info',
      message: 'No active chunk is selected. Activate the next chunk to keep momentum.',
      suggestedCommand: 'scrimble next --activate',
      confidence: 0.95,
    });
    return signals;
  }

  const executionSignalDetected = containsExecutionSignal(events);
  if (executionSignalDetected) {
    signals.push({
      type: 'execution-signal',
      severity: 'info',
      message: 'Execution artifacts detected (tests/build). Consider re-verifying this active chunk.',
      suggestedCommand: 'scrimble verify',
      confidence: 0.82,
    });
  }

  if (verificationResult?.status === 'pass' && (executionSignalDetected || events.length >= 3)) {
    signals.push({
      type: 'completion-ready',
      severity: 'info',
      message: 'Verification is passing after recent changes; this chunk may be ready to complete.',
      suggestedCommand: 'scrimble done',
      confidence: 0.88,
    });
  }

  if (verificationResult && verificationResult.status !== 'pass' && events.length > 0) {
    signals.push({
      type: 'verification-drift',
      severity: 'warn',
      message: `Verification status is ${verificationResult.status}; review drift before marking chunk done.`,
      suggestedCommand: 'scrimble verify',
      confidence: 0.83,
    });
  }

  if (containsDependencySignal(events)) {
    signals.push({
      type: 'dependency-drift',
      severity: 'warn',
      message: 'Dependency-related files changed; future chunks may need updates.',
      suggestedCommand: 'scrimble update --request "Dependencies changed"',
      confidence: 0.78,
    });
  }

  if (events.length >= 25) {
    signals.push({
      type: 'plan-divergence',
      severity: 'warn',
      message: 'Large change burst detected; plan may have diverged from code reality.',
      suggestedCommand: 'scrimble replan --request "Major code divergence detected"',
      confidence: 0.72,
    });
  }

  return signals;
}
