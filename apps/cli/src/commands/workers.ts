import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import type { WorkerKind } from '@scrimble/shared';
import { getWorkerDriver } from '../lib/workers/index.js';

export default class Workers extends Command {
  static override description = 'Show Gemini/Copilot worker health and capabilities';

  static override examples = ['<%= config.bin %> workers', '<%= config.bin %> workers --json'];

  static override flags = {
    json: Flags.boolean({
      description: 'Print worker status as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Workers);
    const workers: WorkerKind[] = ['gemini', 'copilot'];
    const results = await Promise.all(
      workers.map(async (worker) => {
        const driver = getWorkerDriver(worker);
        const preflight = await driver.preflight();
        return {
          worker,
          preflight,
          capabilities: driver.capabilities(),
        };
      }),
    );

    if (flags.json) {
      this.log(JSON.stringify(results, null, 2));
      return;
    }

    this.log('');
    this.log(chalk.bold('Worker Status'));
    for (const result of results) {
      const status = result.preflight.available ? chalk.green('available') : chalk.red('unavailable');
      this.log(`${chalk.cyan(result.worker)}: ${status}`);
      if (result.preflight.version) {
        this.log(chalk.dim(`  version: ${result.preflight.version}`));
      }
      if (result.preflight.warnings.length > 0) {
        for (const warning of result.preflight.warnings) {
          this.log(chalk.yellow(`  warning: ${warning}`));
        }
      }
      if (result.preflight.errors.length > 0) {
        for (const error of result.preflight.errors) {
          this.log(chalk.red(`  error: ${error}`));
        }
      }
      this.log(chalk.dim(`  task types: ${result.capabilities.supportedTaskTypes.join(', ')}`));
      this.log(chalk.dim(`  checkpointing: ${result.capabilities.supportsCheckpointing ? 'yes' : 'no'}`));
    }
    this.log('');
  }
}

