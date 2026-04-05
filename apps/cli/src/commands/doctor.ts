import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';

export default class Doctor extends Command {
  static override description = 'Check Scrimble configuration and health';

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

    this.log(chalk.bold('\n🔍 Scrimble Doctor\n'));

    const checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; message: string }> = [];

    // Check 1: Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0] ?? '0', 10);
    if (majorVersion >= 20) {
      checks.push({ name: 'Node.js version', status: 'pass', message: `${nodeVersion} ✓` });
    } else {
      checks.push({ name: 'Node.js version', status: 'fail', message: `${nodeVersion} (requires >= 20)` });
    }

    // Check 2: .scrimble directory
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const scrimbleDir = path.join(process.cwd(), '.scrimble');
    
    try {
      await fs.access(scrimbleDir);
      checks.push({ name: '.scrimble directory', status: 'pass', message: 'Found ✓' });
      
      // Check 2b: config.json
      try {
        const configPath = path.join(scrimbleDir, 'config.json');
        await fs.access(configPath);
        checks.push({ name: 'config.json', status: 'pass', message: 'Found ✓' });
      } catch {
        checks.push({ name: 'config.json', status: 'warn', message: 'Not found (run `scrimble init`)' });
      }
    } catch {
      checks.push({ name: '.scrimble directory', status: 'warn', message: 'Not found (run `scrimble init`)' });
    }

    // Check 3: Git repository
    const gitDir = path.join(process.cwd(), '.git');
    try {
      await fs.access(gitDir);
      checks.push({ name: 'Git repository', status: 'pass', message: 'Found ✓' });
    } catch {
      checks.push({ name: 'Git repository', status: 'warn', message: 'Not a git repository' });
    }

    // Display results
    for (const check of checks) {
      const icon = check.status === 'pass' ? chalk.green('✓') : 
                   check.status === 'warn' ? chalk.yellow('⚠') : 
                   chalk.red('✗');
      const statusColor = check.status === 'pass' ? chalk.green : 
                          check.status === 'warn' ? chalk.yellow : 
                          chalk.red;
      
      this.log(`  ${icon} ${chalk.bold(check.name)}: ${statusColor(check.message)}`);
    }

    const failCount = checks.filter(c => c.status === 'fail').length;
    const warnCount = checks.filter(c => c.status === 'warn').length;

    this.log('');
    if (failCount > 0) {
      this.log(chalk.red(`  ${failCount} check(s) failed. Please fix the issues above.`));
      this.exit(1);
    } else if (warnCount > 0) {
      this.log(chalk.yellow(`  ${warnCount} warning(s). Consider running 'scrimble init'.`));
    } else {
      this.log(chalk.green('  All checks passed! Scrimble is ready.'));
    }
    this.log('');
  }
}
