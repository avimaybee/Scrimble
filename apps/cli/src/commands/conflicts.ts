import { Command } from '@oclif/core';
import chalk from 'chalk';
import { loadAssignmentsState, loadFileLeasesState, loadTasksState } from '../lib/ledger/storage.js';

export default class Conflicts extends Command {
  static override description = 'List blocked/conflicted ledger tasks and current lease conflicts';

  static override examples = ['<%= config.bin %> conflicts'];

  async run(): Promise<void> {
    const [tasksState, assignmentsState, leasesState] = await Promise.all([
      loadTasksState(),
      loadAssignmentsState(),
      loadFileLeasesState(),
    ]);

    const conflictedAssignments = new Set(
      assignmentsState.assignments
        .filter((assignment) => assignment.status === 'conflicted')
        .map((assignment) => assignment.taskId),
    );

    const blockedTasks = tasksState.tasks.filter(
      (task) => task.status === 'blocked' || task.status === 'failed' || conflictedAssignments.has(task.id),
    );

    this.log('');
    if (blockedTasks.length === 0) {
      this.log(chalk.green('✓ No conflicts detected.'));
      this.log('');
      return;
    }

    this.log(chalk.bold.red('Conflicts'));
    for (const task of blockedTasks) {
      const lease = leasesState.leases.find((entry) => entry.taskId === task.id);
      this.log(chalk.yellow(`- ${task.id}: ${task.title} [${task.status}]`));
      if (task.error) {
        this.log(chalk.dim(`  error: ${task.error}`));
      }
      if (lease) {
        this.log(chalk.dim(`  lease worker: ${lease.worker}`));
        this.log(chalk.dim(`  lease paths: ${lease.paths.join(', ')}`));
      }
    }
    this.log('');
  }
}

