import { Command } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SCRIMBLE_DIR, SESSION_FILE } from '@scrimble/shared';

export default class Logout extends Command {
  static override description = 'Log out and clear local session';

  static override examples = [
    '<%= config.bin %> logout',
  ];

  async run(): Promise<void> {
    const cwd = process.cwd();
    const sessionPath = path.join(cwd, SCRIMBLE_DIR, SESSION_FILE);

    try {
      await fs.unlink(sessionPath);
      this.log(chalk.green('\n✓ Logged out successfully.\n'));
    } catch {
      this.log(chalk.dim('\nNo active session found.\n'));
    }
  }
}
