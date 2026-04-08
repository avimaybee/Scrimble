import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  CONFIG_FILE,
  SCRIMBLE_DIR,
  scrimbleConfigSchema,
} from '@scrimble/shared';

function sanitizeLegacyCloudFields(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const record = { ...(value as Record<string, unknown>) };
  delete record['auth'];
  delete record['cloudEndpoint'];
  delete record['projectId'];
  return record;
}

function interpolateEnv(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, envName: string) => process.env[envName] ?? '');
  }

  if (Array.isArray(value)) {
    return value.map((entry) => interpolateEnv(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, interpolateEnv(entry)]),
    );
  }

  return value;
}

export async function loadScrimbleConfig(cwd = process.cwd()) {
  const configPath = path.join(cwd, SCRIMBLE_DIR, CONFIG_FILE);
  const rawConfig = await fs.readFile(configPath, 'utf8');
  const parsed = sanitizeLegacyCloudFields(JSON.parse(rawConfig) as unknown);
  const withEnvInterpolation = interpolateEnv(parsed);
  return scrimbleConfigSchema.parse(withEnvInterpolation);
}
