import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { loadScrimbleConfig } from '../lib/config/load-config.js';
import { refreshProfileHealth } from '../lib/ai/provider.js';
import { describeProfileModel, getActiveProfile } from '../lib/ai/profiles.js';
import { getWorkerDriver } from '../lib/workers/factory.js';

export default class Doctor extends Command {
  static override description = 'Check local-first Scrimble health and worker readiness';

  static override examples = [
    '<%= config.bin %> doctor',
    '<%= config.bin %> doctor --verbose',
  ];

  static override flags = {
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed diagnostic information',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Doctor);
    const checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; message: string }> = [];

    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0] ?? '0', 10);
    if (majorVersion >= 20) {
      checks.push({ name: 'Node.js version', status: 'pass', message: `${nodeVersion} ✓` });
    } else {
      checks.push({ name: 'Node.js version', status: 'fail', message: `${nodeVersion} (requires >= 20)` });
    }

    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const scrimbleDir = path.join(process.cwd(), '.scrimble');
    try {
      await fs.access(scrimbleDir);
      checks.push({ name: '.scrimble directory', status: 'pass', message: 'Found ✓' });
    } catch {
      checks.push({ name: '.scrimble directory', status: 'warn', message: 'Not found (run `scrimble init`)' });
    }

    try {
      const config = await loadScrimbleConfig(process.cwd());
      const activeProfile = getActiveProfile(config);
      if (!activeProfile) {
        checks.push({
          name: 'config.json',
          status: 'fail',
          message: 'Found, but no active profile is configured (run `scrimble config set-ai`).',
        });
      } else {
        const health = await refreshProfileHealth(activeProfile, { cwd: process.cwd() });
        checks.push({
          name: 'config.json',
          status: health.usableNow ? 'pass' : health.issues.length > 0 ? 'fail' : 'warn',
          message: `Active profile=${activeProfile.name} (${activeProfile.provider}/${describeProfileModel(activeProfile)}) [capabilities=${health.capabilitySource}, model=${health.modelAvailability}]`,
        });
        checks.push({
          name: 'profile auth',
          status: health.status === 'ready' ? 'pass' : health.status === 'invalid' ? 'fail' : 'warn',
          message: health.status === 'ready'
            ? `Configured=${health.authStrategy}, using=${health.resolvedAuthStrategy}${health.authSource ? ` (${health.authSource})` : ''}`
            : health.usabilityIssues[0] ?? health.issues[0] ?? 'Profile auth could not be resolved.',
        });
        checks.push({
          name: 'validation freshness',
          status: health.validationFreshness === 'fresh' ? 'pass' : 'warn',
          message: `${health.validationFreshness} (validated ${health.validatedAt})`,
        });
        for (const issue of [...health.issues.slice(1), ...health.usabilityIssues.slice(1)]) {
          checks.push({
            name: 'profile issue',
            status: 'warn',
            message: issue,
          });
        }
      }
    } catch {
      checks.push({ name: 'config.json', status: 'warn', message: 'Missing/invalid (run `scrimble init` then `scrimble config set-ai`)' });
    }

    for (const workerKind of ['gemini', 'copilot'] as const) {
      const driver = getWorkerDriver(workerKind);
      const preflight = await driver.preflight();
      if (preflight.available) {
        checks.push({
          name: `${workerKind} worker`,
          status: 'pass',
          message: `Ready ✓${preflight.version ? ` (${preflight.version})` : ''}${preflight.authSource ? ` [auth=${preflight.authSource}]` : ''}`,
        });
      } else if (preflight.errors.length > 0) {
        checks.push({
          name: `${workerKind} worker`,
          status: 'warn',
          message: preflight.errors[0] ?? 'Unavailable',
        });
      } else {
        checks.push({
          name: `${workerKind} worker`,
          status: 'warn',
          message: 'Unavailable',
        });
      }

      if (flags.verbose) {
        for (const warning of preflight.warnings) {
          checks.push({
            name: `${workerKind} warning`,
            status: 'warn',
            message: warning,
          });
        }
      }
    }

    this.log(chalk.bold('\n🔍 Scrimble Doctor\n'));
    for (const check of checks) {
      const icon = check.status === 'pass' ? chalk.green('✓') :
        check.status === 'warn' ? chalk.yellow('⚠') :
          chalk.red('✗');
      const statusColor = check.status === 'pass' ? chalk.green :
        check.status === 'warn' ? chalk.yellow :
          chalk.red;
      this.log(`  ${icon} ${chalk.bold(check.name)}: ${statusColor(check.message)}`);
    }

    const failCount = checks.filter((check) => check.status === 'fail').length;
    const warnCount = checks.filter((check) => check.status === 'warn').length;
    this.log('');
    if (failCount > 0) {
      this.log(chalk.red(`  ${failCount} check(s) failed. Please fix the issues above.`));
      this.exit(1);
    } else if (warnCount > 0) {
      this.log(chalk.yellow(`  ${warnCount} warning(s). Scrimble can still run locally.`));
    } else {
      this.log(chalk.green('  All checks passed! Scrimble is ready.'));
    }
    this.log('');
  }
}

