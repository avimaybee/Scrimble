import { Command } from '@oclif/core';
import chalk from 'chalk';

const LOCAL_FIRST_MESSAGE =
  'Scrimble is local-first. There is no Scrimble sync. Run `scrimble status` to inspect local state.';

export default class Sync extends Command {
  static override description = 'Compatibility shim: local-first mode has no Scrimble sync workflow';

  static override examples = ['<%= config.bin %> sync'];

  async run(): Promise<void> {
    this.log('');
    this.log(chalk.yellow(LOCAL_FIRST_MESSAGE));
    this.log('');
  }
}

