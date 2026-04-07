import type { LedgerTask, WorkerDriver, WorkerKind } from '@scrimble/shared';
import { CopilotDriver } from './copilot-driver.js';
import { GeminiDriver } from './gemini-driver.js';

export interface WorkerFactoryOptions {
  cwd?: string;
}

export function getWorkerDriver(
  kind: WorkerKind,
  options: WorkerFactoryOptions = {},
): WorkerDriver {
  if (kind === 'gemini') {
    return new GeminiDriver({
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
  }
  return new CopilotDriver({
    ...(options.cwd ? { cwd: options.cwd } : {}),
  });
}

export async function getAvailableWorkers(
  options: WorkerFactoryOptions = {},
): Promise<WorkerKind[]> {
  const candidates: WorkerKind[] = ['gemini', 'copilot'];
  const checks = await Promise.all(
    candidates.map(async (kind) => {
      const driver = getWorkerDriver(kind, options);
      const preflight = await driver.preflight();
      return preflight.available ? kind : null;
    }),
  );

  return checks.filter((candidate): candidate is WorkerKind => candidate !== null);
}

export function getPreferredWorker(task: LedgerTask): WorkerKind {
  if (task.preferredWorker) {
    return task.preferredWorker;
  }
  if (task.fallbackWorker) {
    return task.fallbackWorker;
  }
  if (task.riskScore >= 8) {
    return 'gemini';
  }
  return 'copilot';
}

