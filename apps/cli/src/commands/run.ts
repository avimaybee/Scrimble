import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import type { WorkerKind } from '@scrimble/shared';
import { LedgerSupervisor } from '../lib/scheduler/supervisor.js';

type WorkerSelection = 'auto' | WorkerKind;

export default class Run extends Command {
  static override description = 'Run local ledger tasks through Gemini/Copilot worker drivers';

  static override examples = [
    '<%= config.bin %> run',
    '<%= config.bin %> run --worker gemini',
    '<%= config.bin %> run --worker auto --parallel 2',
  ];

  static override flags = {
    worker: Flags.string({
      description: 'Worker selection mode',
      options: ['auto', 'gemini', 'copilot'],
      default: 'auto',
    }),
    parallel: Flags.integer({
      description: 'Maximum tasks to dispatch in parallel',
      default: 1,
      min: 1,
    }),
    timeout: Flags.integer({
      description: 'Timeout per task in seconds',
      default: 300,
      min: 10,
    }),
    'max-tasks': Flags.integer({
      description: 'Maximum tasks to process in this run (0 = no limit)',
      default: 0,
      min: 0,
    }),
    json: Flags.boolean({
      description: 'Emit summary as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Run);
    const supervisor = new LedgerSupervisor();
    let result;
    try {
      result = await supervisor.run({
        worker: flags.worker as WorkerSelection,
        parallel: flags.parallel,
        timeoutMs: flags.timeout * 1000,
        ...(flags['max-tasks'] > 0 ? { maxTasks: flags['max-tasks'] } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log('');
      this.log(chalk.red(message));
      this.log('');
      this.exit(1);
      return;
    }

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2));
      return;
    }

    this.log('');
    this.log(chalk.bold('Run Summary'));
    this.log(chalk.dim(`  completed: ${result.completedTaskIds.length}`));
    this.log(chalk.dim(`  failed: ${result.failedTaskIds.length}`));
    this.log(chalk.dim(`  conflicted: ${result.conflictedTaskIds.length}`));
    this.log(chalk.dim(`  retried: ${result.retriedTaskIds.length}`));
    this.log(chalk.dim(`  skipped: ${result.skippedTaskIds.length}`));

    if (result.failedTaskIds.length > 0 || result.conflictedTaskIds.length > 0) {
      this.log('');
      if (result.failedTaskIds.length > 0) {
        this.log(chalk.red(`Failed tasks: ${result.failedTaskIds.join(', ')}`));
      }
      if (result.conflictedTaskIds.length > 0) {
        this.log(chalk.red(`Conflicted tasks: ${result.conflictedTaskIds.join(', ')}`));
      }
      this.log(chalk.dim('Use `scrimble retry <task-id>` or `scrimble conflicts` to recover.'));
      this.log('');
      this.exit(1);
      return;
    }

    this.log('');
  }
}

