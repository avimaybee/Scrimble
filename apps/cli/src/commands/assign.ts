import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import type { WorkerKind } from '@scrimble/shared';
import { acquireFileLease, getTask, leaseTask } from '../lib/ledger/operations.js';

export default class Assign extends Command {
  static override description = 'Manually assign a pending ledger task to a worker';

  static override examples = [
    '<%= config.bin %> assign --task task-id --worker gemini',
    '<%= config.bin %> assign --task task-id --worker copilot --force',
  ];

  static override flags = {
    task: Flags.string({
      description: 'Task ID to assign',
      required: true,
    }),
    worker: Flags.string({
      description: 'Worker to assign',
      options: ['gemini', 'copilot'],
      required: true,
    }),
    force: Flags.boolean({
      description: 'Force assignment even if task is not pending',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Assign);
    const worker = flags.worker as WorkerKind;

    const task = await getTask(flags.task);
    if (!task) {
      this.log(chalk.red(`\nTask not found: ${flags.task}\n`));
      this.exit(1);
      return;
    }

    if (task.ownedFiles.length === 0) {
      this.log(chalk.red('\nTask has no explicit owned files. Cannot assign safely.\n'));
      this.exit(1);
      return;
    }

    await leaseTask(task.id, worker, { force: flags.force });
    await acquireFileLease(task.id, worker, {
      paths: task.ownedFiles,
      globs: task.ownedFiles.filter((entry) => entry.includes('*') || entry.includes('?')),
    });

    this.log('');
    this.log(chalk.green(`✓ Assigned ${task.title} to ${worker}`));
    this.log(chalk.dim(`Task ID: ${task.id}`));
    this.log(chalk.dim(`Owned files: ${task.ownedFiles.join(', ')}`));
    this.log('');
  }
}

