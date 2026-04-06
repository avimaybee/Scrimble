import { Command } from '@oclif/core';
import chalk from 'chalk';
import { getTaskProvider } from '../lib/tasks/index.js';

export default class Prompt extends Command {
  static override description = 'Show the active task prompt/context';

  static override examples = ['<%= config.bin %> prompt'];

  async run(): Promise<void> {
    const provider = await getTaskProvider();
    const payload = await provider.getPromptPayload();
    if (!payload) {
      this.log(chalk.yellow('\nNo active task context available.\n'));
      return;
    }

    this.log('');
    this.log(chalk.cyan('Current task prompt:'));
    this.log(chalk.dim(payload.prompt));
    this.log('');
  }
}
