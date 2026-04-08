import { loadScrimbleConfig } from './config/load-config.js';

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
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

