import { loadConductorWorkspace } from '../conductor/index.js';
import { loadTasksState } from '../ledger/storage.js';
import { ConductorTaskProvider } from './conductor-provider.js';
import { LedgerTaskProvider } from './ledger-provider.js';
import { LegacyTaskProvider } from './legacy-provider.js';
import type { TaskProvider } from './types.js';

export async function getTaskProvider(cwd: string = process.cwd()): Promise<TaskProvider> {
  const tasksState = await loadTasksState(cwd);
  if (tasksState.tasks.length > 0) {
    return new LedgerTaskProvider(cwd);
  }

  const conductorWorkspace = await loadConductorWorkspace(cwd);
  if (conductorWorkspace.exists) {
    return new ConductorTaskProvider(cwd);
  }
  return new LegacyTaskProvider(cwd);
}
