import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { getTaskProvider } from '../lib/tasks/index.js';

export default class Skip extends Command {
  static override description = 'Skip active task/chunk with explicit reason and risk acknowledgement';

  static override examples = [
    '<%= config.bin %> skip --reason "Blocked by external API outage" --ack-risk',
  ];

  static override flags = {
    reason: Flags.string({
      description: 'Reason for skipping this task/chunk',
      required: true,
    }),
    'ack-risk': Flags.boolean({
      description: 'Acknowledge that skipping may introduce project risk',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Skip);
    if (!flags['ack-risk']) {
      this.log(chalk.red('\nSkipping requires explicit risk acknowledgement: add --ack-risk.\n'));
      this.exit(1);
      return;
    }

    const provider = await getTaskProvider();
    const result = await provider.skipTask(flags.reason);
    if (!result) {
      this.log(chalk.yellow('\nNo active task found to skip.\n'));
      return;
    }

    this.log('');
    this.log(chalk.yellow(`⚠ Skipped: ${result.skippedTask.title}`));
    if (result.nextTask) {
      this.log(chalk.cyan(`Activated next: ${result.nextTask.title}`));
    } else {
      this.log(chalk.dim('No further pending tasks were available to activate.'));
    }
    this.log('');
  }
}
