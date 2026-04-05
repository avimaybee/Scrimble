import * as fs from 'node:fs/promises';

export async function writeSecureJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (process.platform !== 'win32') {
    await fs.chmod(filePath, 0o600);
  }
}

export function redactSecrets(value: string): string {
  return value
    .replace(/(token|key|secret|password)=([^\s]+)/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]');
}
