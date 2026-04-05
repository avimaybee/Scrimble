import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ensureScrimbleDirectories, getScrimblePaths } from './local/index.js';

export interface TelemetryEntry {
  event: string;
  level?: 'info' | 'warn' | 'error';
  payload?: Record<string, unknown>;
}

export async function recordTelemetry(entry: TelemetryEntry, cwd = process.cwd()): Promise<void> {
  await ensureScrimbleDirectories(cwd);
  const paths = getScrimblePaths(cwd);
  const record = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    event: entry.event,
    level: entry.level ?? 'info',
    payload: entry.payload ?? {},
  };
  await fs.appendFile(paths.telemetry, `${JSON.stringify(record)}\n`, 'utf8');
}
