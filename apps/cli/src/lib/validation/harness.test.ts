import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ExecutionResult, WorkerDriver, WorkerKind } from '@scrimble/shared';

const factoryMocks = vi.hoisted(() => ({
  getWorkerDriver: vi.fn(),
}));

vi.mock('../workers/factory.js', () => factoryMocks);

import { runCanonicalValidationScenarios, writeValidationReport } from './harness.js';
import { CANONICAL_VALIDATION_SCENARIOS } from './fixtures.js';

function detectScenarioName(cwd: string): string {
  const lower = cwd.toLowerCase();
  if (lower.includes('brownfield_repair')) {
    return 'brownfield_repair';
  }
  if (lower.includes('brownfield_feature')) {
    return 'brownfield_feature';
  }
  return 'greenfield_build';
}

function toSuccessResult(touchedFiles: string[]): ExecutionResult {
  return {
    success: true,
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
    touchedFiles,
    parsedOutput: null,
    timedOut: false,
    killed: false,
    durationMs: 5,
  };
}

function createValidationDriver(kind: WorkerKind, cwd: string): WorkerDriver {
  let lastPrompt = '';

  return {
    kind,
    async preflight() {
      return {
        worker: kind,
        available: true,
        authConfigured: true,
        capabilities: this.capabilities(),
        warnings: [],
        errors: [],
      };
    },
    async discoverContextArtifacts() {
      return [];
    },
    buildPrompt(task) {
      const scope = task.ownedFiles[0] ?? '**/*';
      return `task=${task.id};scope=${scope}`;
    },
    async startExecution(prompt) {
      lastPrompt = prompt;
      return {
        sessionId: `${kind}-validation-session`,
        worker: kind,
        startedAt: new Date().toISOString(),
        kill: () => undefined,
        isRunning: () => false,
      };
    },
    async waitForCompletion() {
      const scenario = detectScenarioName(cwd);
      if (scenario === 'brownfield_repair') {
        return toSuccessResult(['outside/out-of-scope.ts']);
      }
      const touched = 'src/validation-output.ts';
      const absolute = path.join(cwd, touched);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, `export const worker = '${kind}';\n`, 'utf8');
      return toSuccessResult([touched]);
    },
    parseOutput() {
      return null;
    },
    classifyFailure() {
      return {
        kind: 'unknown',
        message: `Validation worker ${kind} failure.`,
        retryable: false,
      };
    },
    async continueExecution() {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'continuation not implemented',
        touchedFiles: [],
        parsedOutput: null,
        failureReason: 'continuation not implemented',
        timedOut: false,
        killed: false,
        durationMs: 1,
      };
    },
    extractTouchedFiles(result) {
      return result.touchedFiles;
    },
    capabilities() {
      return {
        supportedTaskTypes: ['code_modification'],
        maxParallelTasks: 1,
        supportsCheckpointing: true,
        supportsContinuation: true,
        supportsJsonOutput: true,
      };
    },
  };
}

describe('validation harness', () => {
  afterEach(() => {
    factoryMocks.getWorkerDriver.mockReset();
  });

  it('runs canonical scenarios and emits ranked failure evidence', async () => {
    factoryMocks.getWorkerDriver.mockImplementation((kind: WorkerKind, options?: { cwd?: string }) =>
      createValidationDriver(kind, options?.cwd ?? process.cwd()),
    );

    const report = await runCanonicalValidationScenarios();
    expect(report.reportVersion).toBe(1);
    expect(report.scenarioReports).toHaveLength(CANONICAL_VALIDATION_SCENARIOS.length * 2);

    const scenarioFlowKeys = report.scenarioReports.map((entry) => `${entry.scenario}:${entry.flow}`);
    const expectedFlowKeys = CANONICAL_VALIDATION_SCENARIOS.flatMap((scenario) => [
      `${scenario.name}:shell_adjacent`,
      `${scenario.name}:plaintext_oneshot`,
    ]);
    expect(scenarioFlowKeys).toEqual(expect.arrayContaining(expectedFlowKeys));

    const rankedByCategory = new Map(report.rankedFailures.map((entry) => [entry.category, entry]));
    expect(rankedByCategory.has('missing_verification_inference')).toBe(false);
    expect(rankedByCategory.has('repetitive_next_actions')).toBe(false);
    expect(rankedByCategory.has('failed_resume_recovery')).toBe(false);
    expect(rankedByCategory.has('stale_provider_capability_data')).toBe(false);
    expect(rankedByCategory.has('invalid_auth_source_detection')).toBe(false);

    const providerNoProfileReports = report.scenarioReports.filter(
      (entry) => entry.scenario === 'provider_no_active_profile',
    );
    expect(providerNoProfileReports).toHaveLength(2);
    for (const providerReport of providerNoProfileReports) {
      const configureSteps = providerReport.timeline.filter(
        (event) => event.type === 'step_started' && event.action === 'configure_ai',
      );
      expect(configureSteps.length).toBeLessThanOrEqual(1);
      const finalOutcome = providerReport.outcomes[providerReport.outcomes.length - 1];
      expect(finalOutcome?.reason).toBe('setup_required');
      expect(finalOutcome?.nextSuggestedAction?.toLowerCase()).toContain('setup');
    }

    const brownfieldShellReport = report.scenarioReports.find(
      (entry) => entry.scenario === 'brownfield_feature' && entry.flow === 'shell_adjacent',
    );
    expect(brownfieldShellReport).toBeDefined();
    if (!brownfieldShellReport) {
      throw new Error('Expected brownfield_feature shell_adjacent report.');
    }
    const pauseDecisions = brownfieldShellReport.boundaryDecisions.filter(
      (decision) => decision.action === 'configure_ai' && decision.decision === 'pause',
    );
    const proceedDecisions = brownfieldShellReport.boundaryDecisions.filter(
      (decision) => decision.action === 'configure_ai' && decision.decision === 'proceed',
    );
    expect(pauseDecisions).toHaveLength(1);
    expect(proceedDecisions).toHaveLength(1);
    expect(brownfieldShellReport.outcomes[0]?.status).toBe('paused');
    expect(
      brownfieldShellReport.outcomes.slice(1).some((outcome) => outcome.status === 'completed' || outcome.status === 'blocked'),
    ).toBe(true);

    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scrimble-validation-report-'));
    try {
      const written = await writeValidationReport(report, outputDir);
      const json = JSON.parse(await fs.readFile(written.jsonPath, 'utf8')) as { reportVersion: number; scenarioReports: unknown[] };
      const markdown = await fs.readFile(written.markdownPath, 'utf8');
      expect(json.reportVersion).toBe(1);
      expect(Array.isArray(json.scenarioReports)).toBe(true);
      expect(markdown).toContain('Ranked Failures');
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  }, 60_000);
});
