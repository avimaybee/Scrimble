import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  CONFIG_FILE,
  SCRIMBLE_DIR,
  legacyScrimbleConfigSchema,
  scrimbleConfigSchema,
} from '@scrimble/shared';
import {
  migrateLegacyScrimbleConfig,
  normalizeScrimbleConfig,
} from '../ai/profiles.js';
import { writeSecureJson } from '../security.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isLegacyConfig(value: unknown): boolean {
  return isRecord(value) && 'ai' in value && !('profiles' in value);
}

function normalizeConfigObject(value: unknown) {
  if (isLegacyConfig(value)) {
    const legacy = legacyScrimbleConfigSchema.parse(value);
    return migrateLegacyScrimbleConfig(legacy);
  }

  const parsed = scrimbleConfigSchema.parse(value);
  return normalizeScrimbleConfig(parsed);
}

export async function loadScrimbleConfig(cwd = process.cwd()) {
  const configPath = path.join(cwd, SCRIMBLE_DIR, CONFIG_FILE);
  const rawConfig = await fs.readFile(configPath, 'utf8');
  const parsed = JSON.parse(rawConfig) as unknown;
  const normalized = normalizeConfigObject(parsed);
  if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
    await writeSecureJson(configPath, normalized);
  }
  return normalized;
}
