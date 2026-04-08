import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { readLedgerEvents } from '../lib/ledger/records.js';
import { loadLedgerState } from '../lib/ledger/storage.js';

function formatCount(label: string, count: number): string {
  return `${label}: ${count}`;
}

export default class Status extends Command {
  static override description = 'Show local intent, ledger progress, worker health, and leases';

  static override examples = [
    '<%= config.bin %> status',
    '<%= config.bin %> status --events 10',
  ];

  static override flags = {
    events: Flags.integer({
      description: 'Maximum recent runtime events to display',
      default: 5,
      min: 0,
      max: 50,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);
    const ledger = await loadLedgerState();
    const tasks = ledger.tasks.tasks;
    const assignments = ledger.assignments.assignments;
    const leases = ledger.fileLeases.leases;
    const workers = ledger.workers.workers;
    const intent = ledger.intent.intent;
    const approval = ledger.approval;

    const completed = tasks.filter((task) => task.status === 'completed').length;
    const running = tasks.filter((task) => task.status === 'running' || task.status === 'leased').length;
    const blocked = tasks.filter((task) => task.status === 'blocked').length;
    const failed = tasks.filter((task) => task.status === 'failed').length;
    const pending = tasks.filter((task) => task.status === 'pending').length;

    this.log('');
    this.log(chalk.bold('Scrimble Local Status'));
    if (intent) {
      this.log(chalk.dim(`Intent: ${intent.goal}`));
    } else {
      this.log(chalk.dim('Intent: not captured yet'));
    }
    this.log('');

    this.log(chalk.bold('Task Graph'));
    this.log(chalk.dim(`  ${formatCount('total', tasks.length)}`));
    this.log(chalk.dim(`  ${formatCount('completed', completed)}`));
    this.log(chalk.dim(`  ${formatCount('running', running)}`));
    this.log(chalk.dim(`  ${formatCount('pending', pending)}`));
    this.log(chalk.dim(`  ${formatCount('blocked', blocked)}`));
    this.log(chalk.dim(`  ${formatCount('failed', failed)}`));
    this.log('');

    this.log(chalk.bold('Assignments'));
    if (assignments.length === 0) {
      this.log(chalk.dim('  none'));
    } else {
      for (const assignment of assignments) {
        this.log(chalk.dim(`  ${assignment.taskId} -> ${assignment.worker} (${assignment.status})`));
      }
    }
    this.log('');

    this.log(chalk.bold('Run Approval'));
    if (approval.approved) {
      this.log(chalk.green(`  approved${approval.approvedAt ? ` at ${new Date(approval.approvedAt).toLocaleString()}` : ''}`));
    } else {
      this.log(chalk.yellow('  not approved (run `scrimble approve`)'));
    }
    this.log('');

    this.log(chalk.bold('File Leases'));
    if (leases.length === 0) {
      this.log(chalk.dim('  none'));
    } else {
      for (const lease of leases) {
        const scope = [...lease.paths, ...lease.globs].join(', ') || '(empty scope)';
        this.log(chalk.dim(`  ${lease.taskId} (${lease.worker}): ${scope}`));
      }
    }
    this.log('');

    this.log(chalk.bold('Workers'));
    if (workers.length === 0) {
      this.log(chalk.dim('  no worker state recorded yet'));
    } else {
      for (const worker of workers) {
        const status = worker.available ? chalk.green('available') : chalk.red('unavailable');
        this.log(
          `${chalk.cyan(`  ${worker.kind}`)} ${status} ${chalk.dim(
            `(done=${worker.tasksCompleted}, failed=${worker.tasksFailed})`,
          )}`,
        );
      }
    }

    if (flags.events > 0) {
      const events = await readLedgerEvents({ limit: flags.events });
      this.log('');
      this.log(chalk.bold('Recent Events'));
      if (events.length === 0) {
        this.log(chalk.dim('  none'));
      } else {
        for (const event of [...events].reverse()) {
          this.log(chalk.dim(`  ${new Date(event.timestamp).toLocaleTimeString()} ${event.type}`));
        }
      }
    }

    this.log('');
  }
}

