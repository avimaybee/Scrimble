import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { getTask, releaseTask } from '../lib/ledger/operations.js';

export default class Retry extends Command {
  static override description = 'Reset a failed/blocked task back to pending for another attempt';

  static override examples = ['<%= config.bin %> retry --task task-id'];

  static override flags = {
    task: Flags.string({
      description: 'Task ID to retry',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Retry);
    const task = await getTask(flags.task);
    if (!task) {
      this.log(chalk.red(`\nTask not found: ${flags.task}\n`));
      this.exit(1);
      return;
    }

    if (task.status !== 'failed' && task.status !== 'blocked') {
      this.log(chalk.yellow(`\nTask ${task.id} is ${task.status}; retry is only for failed/blocked tasks.\n`));
      return;
    }

    await releaseTask(task.id, { toStatus: 'pending' });

    this.log('');
    this.log(chalk.green(`✓ Task reset to pending: ${task.title}`));
    this.log(chalk.dim(`Task ID: ${task.id}`));
    this.log('');
  }
}

