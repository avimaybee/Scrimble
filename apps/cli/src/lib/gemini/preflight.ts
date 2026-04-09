/**
 * Gemini CLI preflight detection.
 * Checks for Gemini CLI availability, headless auth, and folder trust.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type {
  GeminiStatus,
  HeadlessAuthStatus,
  FolderTrustStatus,
  PreflightResult,
} from '@scrimble/shared';

/** Execute a command and capture output. */
async function execCapture(
  command: string,
  args: string[],
  timeoutMs = 10000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      shell: true,
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

/** Detect Gemini CLI path and version. */
export async function detectGemini(): Promise<GeminiStatus> {
  // Try common gemini commands
  const commands = ['gemini', 'gemini-cli'];

  for (const cmd of commands) {
    const result = await execCapture(cmd, ['--version']);
    if (result.exitCode === 0 && result.stdout.trim()) {
      const versionMatch = result.stdout.match(/(\d+\.\d+\.\d+)/);
      const version = versionMatch ? versionMatch[1] : result.stdout.trim();
      return {
        available: true,
        path: cmd,
        ...(version ? { version } : {}),
      };
    }
  }

  return {
    available: false,
    error: 'Gemini CLI not found. Install with: npm install -g @google/gemini-cli',
  };
}

/** Detect headless auth availability by checking for cached credentials. */
export async function detectHeadlessAuth(): Promise<HeadlessAuthStatus> {
  const geminiApiKey = process.env['GEMINI_API_KEY']?.trim();
  const googleApiKey = process.env['GOOGLE_API_KEY']?.trim();
  if (geminiApiKey || googleApiKey) {
    return { available: true };
  }

  // Check for Gemini auth config in common locations
  const homeDir = os.homedir();
  const configPaths = [
    path.join(homeDir, '.gemini', 'auth.json'),
    path.join(homeDir, '.config', 'gemini', 'auth.json'),
  ];

  for (const configPath of configPaths) {
    try {
      await fs.access(configPath);
      return { available: true };
    } catch {
      // Continue checking
    }
  }

  // Try running gemini auth status
  const result = await execCapture('gemini', ['auth', 'status']);
  const authOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (
    result.exitCode === 0 &&
    (authOutput.includes('authenticated') || authOutput.includes('logged in') || authOutput.includes('authorized'))
  ) {
    return { available: true };
  }

  return {
    available: false,
    error:
      'Headless auth not configured. Run `gemini` and sign in, or set GEMINI_API_KEY/GOOGLE_API_KEY.',
  };
}

/** Detect folder trust configuration. */
export async function detectFolderTrust(workspacePath: string): Promise<FolderTrustStatus> {
  // Check Gemini settings for folder trust
  const homeDir = os.homedir();
  const settingsPaths = [
    path.join(homeDir, '.gemini', 'settings.json'),
    path.join(homeDir, '.config', 'gemini', 'settings.json'),
  ];

  let settingsFound = false;
  let folderTrustEnabled = false;
  let trustedFolders: string[] = [];

  for (const settingsPath of settingsPaths) {
    try {
      const content = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(content) as {
        folderTrust?: { enabled?: boolean; trustedFolders?: string[] };
      };
      settingsFound = true;

      if (settings.folderTrust) {
        folderTrustEnabled = settings.folderTrust.enabled !== false;
        trustedFolders = settings.folderTrust.trustedFolders ?? [];
      }
      break;
    } catch {
      // Continue checking
    }
  }

  if (!settingsFound) {
    // Default assumption: folder trust is enabled but workspace not explicitly trusted
    return {
      enabled: true,
      workspaceTrusted: false,
      error: 'Gemini settings not found. Workspace may require trust approval on first run.',
    };
  }

  // Check if workspace is in trusted folders
  const normalizedWorkspace = path.resolve(workspacePath).toLowerCase();
  const isTrusted = trustedFolders.some((folder) => {
    const normalizedFolder = path.resolve(folder).toLowerCase();
    return normalizedWorkspace === normalizedFolder || normalizedWorkspace.startsWith(normalizedFolder + path.sep);
  });

  return {
    enabled: folderTrustEnabled,
    workspaceTrusted: isTrusted || !folderTrustEnabled,
  };
}

/** Run complete preflight checks. */
export async function runPreflight(workspacePath: string = process.cwd()): Promise<PreflightResult> {
  const [gemini, headlessAuth, folderTrust] = await Promise.all([
    detectGemini(),
    detectHeadlessAuth(),
    detectFolderTrust(workspacePath),
  ]);

  const errors: string[] = [];
  const warnings: string[] = [];

  // Critical errors
  if (!gemini.available) {
    errors.push(gemini.error ?? 'Gemini CLI not available');
  }

  if (!headlessAuth.available) {
    errors.push(headlessAuth.error ?? 'Headless auth not configured');
  }

  // Warnings
  if (folderTrust.enabled && !folderTrust.workspaceTrusted) {
    warnings.push('Workspace not in trusted folders. Gemini may prompt for trust approval.');
  }

  const canProceed = errors.length === 0;

  return {
    gemini,
    headlessAuth,
    folderTrust,
    canProceed,
    warnings,
    errors,
  };
}

/** Format preflight result for terminal display. */
export function formatPreflightResult(result: PreflightResult): string {
  const lines: string[] = ['Gemini Preflight Check', ''];

  // Gemini CLI
  if (result.gemini.available) {
    lines.push(`✓ Gemini CLI: v${result.gemini.version ?? 'unknown'} (${result.gemini.path})`);
  } else {
    lines.push(`✗ Gemini CLI: ${result.gemini.error}`);
  }

  // Headless Auth
  if (result.headlessAuth.available) {
    lines.push('✓ Headless Auth: configured');
  } else {
    lines.push(`✗ Headless Auth: ${result.headlessAuth.error}`);
  }

  // Folder Trust
  if (result.folderTrust.workspaceTrusted) {
    lines.push('✓ Folder Trust: workspace trusted');
  } else if (!result.folderTrust.enabled) {
    lines.push('✓ Folder Trust: disabled (all folders trusted)');
  } else {
    lines.push('⚠ Folder Trust: workspace not trusted');
  }

  // Summary
  lines.push('');
  if (result.canProceed) {
    lines.push('Ready to proceed with local Gemini execution.');
  } else {
    lines.push('Cannot proceed. Please resolve the errors above.');
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of result.warnings) {
      lines.push(`  • ${warning}`);
    }
  }

  return lines.join('\n');
}
