import type { Bindings } from './types';
import { warn } from './logger';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDuplicateColumnError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes('duplicate column name');
}

export function isMissingGenerationRunSkipColumnsError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes('no such column: skip_target_requested')
    || message.includes('no such column: skip_target_name');
}

async function addColumnIfMissing(env: Bindings, sql: string) {
  try {
    await env.DB.prepare(sql).run();
    return true;
  } catch (error) {
    if (isDuplicateColumnError(error)) {
      return false;
    }
    throw error;
  }
}

export async function ensureGenerationRunSkipColumns(
  env: Bindings,
  context: Record<string, unknown> = {},
): Promise<boolean> {
  try {
    const addedFlagColumn = await addColumnIfMissing(
      env,
      'ALTER TABLE generation_runs ADD COLUMN skip_target_requested INTEGER NOT NULL DEFAULT 0',
    );
    const addedNameColumn = await addColumnIfMissing(
      env,
      'ALTER TABLE generation_runs ADD COLUMN skip_target_name TEXT',
    );

    if (addedFlagColumn || addedNameColumn) {
      warn(
        'generation-skip-schema',
        'Auto-healed missing generation_runs skip columns at runtime.',
        context,
      );
    }

    return true;
  } catch (error) {
    warn('generation-skip-schema', 'Failed runtime skip-column auto-heal.', {
      ...context,
      errorMessage: errorMessage(error),
    });
    return false;
  }
}
