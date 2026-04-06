import { Command } from '@oclif/core';
import chalk from 'chalk';
import { getTaskProvider } from '../lib/tasks/index.js';

export default class Next extends Command {
  static override description = 'Advance to the next pending task/chunk';

  static override examples = ['<%= config.bin %> next'];

  async run(): Promise<void> {
    const provider = await getTaskProvider();
    const result = await provider.activateNextTask();

    if (result.alreadyActiveTask) {
      this.log('');
      this.log(chalk.yellow(`Task already active: ${result.alreadyActiveTask.title}`));
      this.log(chalk.dim(`Task ID: ${result.alreadyActiveTask.id}`));
      this.log('');
      return;
    }

    if (!result.activatedTask) {
      this.log(chalk.yellow('\nNo pending task available to activate.\n'));
      return;
    }

    this.log('');
    this.log(chalk.green(`✓ Activated: ${result.activatedTask.title}`));
    this.log(chalk.dim(`Task ID: ${result.activatedTask.id}`));
    this.log('');
  }
}
