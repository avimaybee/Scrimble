import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import {
  getActiveChunk,
  getCompletionStats,
  loadPlanState,
  loadProjectState,
} from '../lib/local/index.js';
import {
  formatCloudError,
  getGenerationStatus,
  getReplanStatus,
  listProjectEvents,
  resolveCloudClientConfig,
} from '../lib/api/index.js';
import { detectStaleness } from '../lib/staleness.js';

export default class Status extends Command {
  static override description = 'Show project status and progress';

  static override examples = [
    '<%= config.bin %> status',
    '<%= config.bin %> status --no-cloud',
  ];

  static override flags = {
    cloud: Flags.boolean({
      description: 'Include cloud observability (run diagnostics and recent cloud events)',
      default: true,
      allowNo: true,
    }),
    'cloud-events-limit': Flags.integer({
      description: 'Maximum recent cloud events to show',
      default: 5,
      min: 1,
      max: 20,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);
    const project = await loadProjectState();
    const plan = await loadPlanState();
    const stats = getCompletionStats(plan);
    const activeChunk = getActiveChunk(plan);
    const staleIssues = await detectStaleness(plan);
    const projectName = typeof project['name'] === 'string' ? project['name'] : 'Unknown';
    const projectGoal = typeof project['goal'] === 'string' ? project['goal'] : null;
    const initialized = typeof project['initialized'] === 'string' ? project['initialized'] : null;

    this.log('');
    this.log(chalk.bold(`📊 Project Status: ${projectName}`));
    this.log('');

    if (projectGoal) {
      this.log(chalk.dim(`Goal: ${projectGoal}`));
      this.log('');
    }

    if (initialized) {
      this.log(chalk.dim(`Initialized: ${new Date(initialized).toLocaleDateString()}`));
      this.log('');
    }

    if (plan.chunks.length === 0) {
      this.log(chalk.yellow('\n  No execution plan generated yet.'));
      this.log(chalk.dim('  Run `scrimble import --goal "<goal>"` or start a cloud generation run.\n'));
      return;
    }

    this.log('');
    this.log(chalk.bold('Progress:'));
    const barWidth = 30;
    const progress = stats.total === 0 ? 0 : Math.round((stats.completed / stats.total) * barWidth);
    const bar = chalk.green('█'.repeat(progress)) + chalk.dim('░'.repeat(barWidth - progress));
    this.log(`  [${bar}] ${stats.completed}/${stats.total} chunks complete`);
    if (stats.skipped > 0) {
      this.log(chalk.yellow(`  ${stats.skipped} chunk(s) skipped`));
    }

    this.log('');

    if (activeChunk) {
      this.log(chalk.bold('Current:'));
      this.log(chalk.cyan(`  → ${activeChunk.title}`));
    } else if (stats.completed + stats.skipped === stats.total) {
      this.log(chalk.green('  ✓ All chunks completed!'));
    }

    this.log('');

    if (staleIssues.length > 0) {
      this.log(chalk.bold('Integrity alerts:'));
      for (const issue of staleIssues) {
        const color = issue.severity === 'error' ? chalk.red : chalk.yellow;
        this.log(color(`  - ${issue.message}`));
      }
      this.log('');
    }

    this.log(chalk.bold('Chunks:'));
    for (const chunk of plan.chunks) {
      const icon = chunk.status === 'completed' ? chalk.green('✓') :
                   chunk.status === 'skipped' ? chalk.yellow('○') :
                   chunk.status === 'active' ? chalk.cyan('→') :
                     chalk.dim('·');
      const title = chunk.status === 'active' ? chalk.bold(chunk.title) : chunk.title;
      this.log(`  ${icon} ${title}`);
    }

    if (flags.cloud) {
      this.log('');
      this.log(chalk.bold('Cloud observability:'));
      try {
        const cloud = await resolveCloudClientConfig();
        const [generationStatus, replanStatus, events] = await Promise.all([
          getGenerationStatus(cloud, cloud.projectId),
          getReplanStatus(cloud, cloud.projectId),
          listProjectEvents(cloud, { limit: flags['cloud-events-limit'] }),
        ]);

        this.log(chalk.dim(`  Project: ${cloud.projectId}`));
        this.log(`  Generation: ${String(generationStatus['status'] ?? 'unknown')}`);
        if (generationStatus['diagnostics']) {
          const diagnostics = generationStatus['diagnostics'] as {
            retryCount?: number;
            failedStepCount?: number;
          };
          this.log(chalk.dim(`    retries=${diagnostics.retryCount ?? 0}, failedSteps=${diagnostics.failedStepCount ?? 0}`));
        }

        this.log(`  Replan: ${String(replanStatus['status'] ?? 'unknown')}`);
        if (replanStatus['diagnostics']) {
          const diagnostics = replanStatus['diagnostics'] as {
            retryCount?: number;
            failedStepCount?: number;
          };
          this.log(chalk.dim(`    retries=${diagnostics.retryCount ?? 0}, failedSteps=${diagnostics.failedStepCount ?? 0}`));
        }

        if (events.length === 0) {
          this.log(chalk.dim('  Recent events: none'));
        } else {
          this.log(chalk.dim('  Recent events:'));
          const orderedEvents = [...events].reverse();
          for (const event of orderedEvents) {
            this.log(chalk.dim(`    - ${new Date(event.createdAt).toLocaleTimeString()} ${event.type}`));
          }
        }
      } catch (error) {
        this.log(chalk.yellow(`  Cloud status unavailable: ${formatCloudError(error)}`));
      }
    }
    this.log('');
  }
}
