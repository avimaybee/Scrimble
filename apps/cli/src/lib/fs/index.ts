import * as fs from 'node:fs/promises';

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readTextIfExists(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) {
    return undefined;
  }
  try {
    const value = await fs.readFile(filePath, 'utf8');
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}
