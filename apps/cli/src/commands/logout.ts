import { Command } from '@oclif/core';
import chalk from 'chalk';

const LOCAL_FIRST_MESSAGE =
  'Scrimble is local-first. There is no Scrimble logout. Run `scrimble init` or `scrimble doctor`.';

export default class Logout extends Command {
  static override description = 'Compatibility shim: local-first mode has no Scrimble logout';

  static override examples = ['<%= config.bin %> logout'];

  async run(): Promise<void> {
    this.log('');
    this.log(chalk.yellow(LOCAL_FIRST_MESSAGE));
    this.log('');
  }
}

