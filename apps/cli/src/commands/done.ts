import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { getTaskProvider } from '../lib/tasks/index.js';

export default class Done extends Command {
  static override description = 'Complete the active task/chunk through the active task provider';

  static override examples = [
    '<%= config.bin %> done',
    '<%= config.bin %> done --force --reason "manual verification completed"',
    '<%= config.bin %> done --verify-command "pnpm run build"',
  ];

  static override flags = {
    force: Flags.boolean({
      description: 'Allow completion even if verification fails',
      default: false,
    }),
    reason: Flags.string({
      description: 'Required when --force is used and verification fails',
    }),
    'no-verify': Flags.boolean({
      description: 'Skip verification check',
      default: false,
    }),
    'verify-command': Flags.string({
      description: 'Additional verification command (repeatable)',
      multiple: true,
    }),
    cloud: Flags.boolean({
      description: 'Emit completion to cloud history when supported by provider',
      default: true,
      allowNo: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Done);
    const provider = await getTaskProvider();

    try {
      const completeOptions = {
        force: flags.force,
        skipVerification: flags['no-verify'],
        cloud: flags.cloud,
        ...(flags.reason ? { reason: flags.reason } : {}),
        ...(flags['verify-command'] && flags['verify-command'].length > 0
          ? { verifyCommands: flags['verify-command'] }
          : {}),
      };

      const result = await provider.completeTask(completeOptions);

      if (!result) {
        this.log(chalk.yellow('\nNo active task available to complete.\n'));
        return;
      }

      this.log('');
      this.log(chalk.green('✓ Task completion recorded.'));
      this.log(chalk.dim(`Completed: ${result.completedTask.title}`));
      if (flags.cloud && result.cloudRecorded) {
        this.log(chalk.dim('Cloud history updated.'));
      } else if (flags.cloud && result.cloudError) {
        this.log(chalk.yellow(`⚠ Cloud history update failed: ${result.cloudError}`));
      }
      if (result.nextTask) {
        this.log(chalk.cyan(`Next active: ${result.nextTask.title}`));
      } else {
        this.log(chalk.green('No pending tasks remain.'));
      }
      this.log('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(chalk.red(`\n${message}\n`));
      this.exit(1);
    }
  }
}
