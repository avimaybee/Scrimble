import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import {
  getActiveChunk,
  getCompletionStats,
  getNextPendingChunk,
  loadPlanState,
  loadProjectState,
  renderChunkMarkdown,
} from '../lib/local/index.js';
import { detectStaleness } from '../lib/staleness.js';

export default class Root extends Command {
  static override description = 'Show current chunk and project status (default command)';
  static override hidden = true;

  static override examples = [
    '<%= config.bin %>',
    '<%= config.bin %> --verbose',
  ];

  static override flags = {
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed information',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Root);
    const plan = await loadPlanState();
    const project = await loadProjectState();
    const activeChunk = getActiveChunk(plan);
    const nextChunk = getNextPendingChunk(plan);
    const stats = getCompletionStats(plan);
    const projectName = typeof project['name'] === 'string' ? project['name'] : 'Unknown Project';
    const projectGoal = typeof project['goal'] === 'string' ? project['goal'] : null;
    const staleIssues = await detectStaleness(plan);

    this.log('');
    this.log(chalk.bold(`📦 ${projectName}`));
    if (projectGoal) {
      this.log(chalk.dim(`   ${projectGoal}`));
    }
    this.log(chalk.dim(`   Progress: ${stats.completed}/${stats.total} complete (${stats.skipped} skipped)`));
    this.log('');

    if (plan.chunks.length === 0) {
      this.log(chalk.yellow('  No execution plan yet.'));
      this.log('');
      this.log(chalk.bold('  To get started:'));
      this.log(chalk.dim('  1. Configure your AI provider in .scrimble/config.json'));
      this.log(chalk.dim('  2. Set your API key environment variable'));
      this.log(chalk.dim('  3. Run `scrimble import --goal "<goal>"` or your generation workflow'));
      this.log('');
      return;
    }

    if (plan.architecture?.approved === false) {
      this.log(chalk.yellow('  Architecture is not approved.'));
      this.log(chalk.dim('  Run `scrimble approve` or `scrimble replan --request "<change>"`.'));
      this.log('');
      return;
    }

    if (!activeChunk) {
      this.log(chalk.green('  ✓ No active chunk right now.'));
      if (nextChunk) {
        this.log(chalk.cyan(`  Next available: ${nextChunk.title}`));
        this.log(chalk.dim('  Run `scrimble next --activate` to continue.'));
      } else {
        this.log(chalk.green('  All chunks are complete or intentionally skipped.'));
      }
      this.log('');
      return;
    }

    this.log(chalk.bold('📋 Current Chunk'));
    this.log('');
    if (flags.verbose) {
      this.log(renderChunkMarkdown(activeChunk));
    } else {
      this.log(chalk.cyan(`  ${activeChunk.title} (${activeChunk.id})`));
      this.log(chalk.dim(`  Done when: ${activeChunk.doneWhen ?? 'See prompt details'}`));
      this.log('');
      this.log(chalk.bold('Prompt:'));
      this.log(activeChunk.prompt);
      if (activeChunk.doNotTouch) {
        this.log('');
        this.log(chalk.bold('Do not touch:'));
        this.log(chalk.dim(activeChunk.doNotTouch));
      }
      if (activeChunk.verificationSignals && activeChunk.verificationSignals.length > 0) {
        this.log('');
        this.log(chalk.bold('Verification signals:'));
        for (const signal of activeChunk.verificationSignals) {
          this.log(chalk.dim(`  - ${signal}`));
        }
      }
    }
    this.log('');

    if (staleIssues.length > 0) {
      this.log(chalk.yellow('⚠ Integrity notes:'));
      for (const issue of staleIssues) {
        this.log(chalk.yellow(`  - ${issue.message}`));
      }
      this.log('');
    }

    this.log(chalk.bold('Quick Actions:'));
    this.log(chalk.dim('  scrimble prompt    - Copy prompt for your AI coding agent'));
    this.log(chalk.dim('  scrimble verify    - Check if chunk is complete'));
    this.log(chalk.dim('  scrimble done      - Mark chunk as complete'));
    this.log(chalk.dim('  scrimble skip      - Skip this chunk (with reason)'));
    this.log(chalk.dim('  scrimble next      - Preview next chunk'));
    this.log(chalk.dim('  scrimble sync      - Reconcile local and cloud state'));
    this.log('');
  }
}
