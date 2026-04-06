import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  SCRIMBLE_DIR,
  SESSION_FILE,
  authSessionSchema,
} from '@scrimble/shared';
import { loadScrimbleConfig } from './config/load-config.js';

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export interface AuthStatus {
  isAuthenticated: boolean;
  reason: 'ok' | 'missing_session' | 'invalid_session' | 'expired_session';
}

export async function getAuthStatus(cwd = process.cwd()): Promise<AuthStatus> {
  const sessionPath = path.join(cwd, SCRIMBLE_DIR, SESSION_FILE);
  try {
    const raw = await fs.readFile(sessionPath, 'utf8');
    const parsed = authSessionSchema.parse(JSON.parse(raw) as unknown);
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) {
      return { isAuthenticated: false, reason: 'expired_session' };
    }
    return { isAuthenticated: true, reason: 'ok' };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { isAuthenticated: false, reason: 'missing_session' };
    }
    return { isAuthenticated: false, reason: 'invalid_session' };
  }
}

export interface AIConfigurationStatus {
  isValid: boolean;
  reason: 'ok' | 'missing_config' | 'invalid_config' | 'missing_api_key';
}

export async function getAIConfigurationStatus(cwd = process.cwd()): Promise<AIConfigurationStatus> {
  try {
    const config = await loadScrimbleConfig(cwd);
    const apiKey = config.ai.apiKey?.trim();
    if (!apiKey) {
      return { isValid: false, reason: 'missing_api_key' };
    }
    return { isValid: true, reason: 'ok' };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { isValid: false, reason: 'missing_config' };
    }
    return { isValid: false, reason: 'invalid_config' };
  }
}
