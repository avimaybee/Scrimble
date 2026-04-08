import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { loadScrimbleConfig } from '../lib/config/load-config.js';
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
      checks.push({
        name: 'config.json',
        status: 'pass',
        message: `Found ✓ (provider=${config.ai.provider}, model=${config.ai.model})`,
      });
    } catch {
      checks.push({ name: 'config.json', status: 'warn', message: 'Missing/invalid (run `scrimble init`)' });
    }

    for (const workerKind of ['gemini', 'copilot'] as const) {
      const driver = getWorkerDriver(workerKind);
      const preflight = await driver.preflight();
      if (preflight.available) {
        checks.push({
          name: `${workerKind} worker`,
          status: 'pass',
          message: `Ready ✓${preflight.version ? ` (${preflight.version})` : ''}`,
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

