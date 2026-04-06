import { loadConductorWorkspace } from '../conductor/index.js';
import { ConductorTaskProvider } from './conductor-provider.js';
import { LegacyTaskProvider } from './legacy-provider.js';
import type { TaskProvider } from './types.js';

export async function getTaskProvider(cwd: string = process.cwd()): Promise<TaskProvider> {
  const conductorWorkspace = await loadConductorWorkspace(cwd);
  if (conductorWorkspace.exists) {
    return new ConductorTaskProvider(cwd);
  }
  return new LegacyTaskProvider(cwd);
}
