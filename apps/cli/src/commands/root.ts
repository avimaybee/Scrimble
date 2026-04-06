import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import React from 'react';
import { render } from 'ink';
import { RootDashboard } from '../components/index.js';
import {
  getActiveChunk,
  getCompletionStats,
  getNextPendingChunk,
  isProjectInitialized,
  loadPlanState,
  loadProjectState,
  renderChunkMarkdown,
} from '../lib/local/index.js';
import { getAIConfigurationStatus, getAuthStatus } from '../lib/onboarding.js';
import { detectStaleness } from '../lib/staleness.js';

export default class Root extends Command {
  static override description = 'Run smart onboarding checks, then show current chunk and project status';
  static override hidden = true;

  static override examples = [
    '<%= config.bin %>',
    '<%= config.bin %> --verbose',
    '<%= config.bin %> --ink',
  ];

  static override flags = {
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show detailed information',
      default: false,
    }),
    ink: Flags.boolean({
      description: 'Render project status using Ink components',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Root);

    const cwd = process.cwd();

    let authStatus = await getAuthStatus(cwd);
    if (!authStatus.isAuthenticated) {
      this.log(chalk.yellow('\n🔐 Authentication required. Starting `scrimble login`...\n'));
      await this.config.runCommand('login');
      authStatus = await getAuthStatus(cwd);
      if (!authStatus.isAuthenticated) {
        this.log(chalk.red('\nLogin did not produce a valid session.\n'));
        return;
      }
    }

    let projectInitialized = await isProjectInitialized(cwd);
    if (!projectInitialized) {
      this.log(chalk.yellow('\n🚀 Project initialization required. Starting `scrimble init`...\n'));
      await this.config.runCommand('init');
      projectInitialized = await isProjectInitialized(cwd);
      if (!projectInitialized) {
        this.log(chalk.red('\nProject is still not initialized after `scrimble init`.\n'));
        return;
      }
    }

    let aiStatus = await getAIConfigurationStatus(cwd);
    if (!aiStatus.isValid) {
      this.log(chalk.yellow('\n🤖 AI configuration is incomplete. Starting `scrimble config set-ai`...\n'));
      await this.config.runCommand('config:set-ai');
      aiStatus = await getAIConfigurationStatus(cwd);
      if (!aiStatus.isValid) {
        this.log(chalk.red('\nAI configuration is still incomplete after setup.\n'));
        return;
      }
    }

    let plan = await loadPlanState(cwd);
    if (plan.chunks.length === 0) {
      this.log(chalk.yellow('\n🧭 No execution plan found. Starting `scrimble generate`...\n'));
      await this.config.runCommand('generate');
      plan = await loadPlanState(cwd);
      if (plan.chunks.length === 0) {
        this.log(chalk.yellow('\nNo execution plan is available yet. Complete generation and run `scrimble` again.\n'));
        return;
      }
    }

    const project = await loadProjectState(cwd);
    const activeChunk = getActiveChunk(plan);
    const nextChunk = getNextPendingChunk(plan);
    const stats = getCompletionStats(plan);
    const projectName = typeof project['name'] === 'string' ? project['name'] : 'Unknown Project';
    const projectGoal = typeof project['goal'] === 'string' ? project['goal'] : null;
    const staleIssues = await detectStaleness(plan);

    if (flags.ink) {
      await render(
        React.createElement(RootDashboard, {
          projectName,
          projectGoal,
          progress: {
            completed: stats.completed,
            total: stats.total,
            skipped: stats.skipped,
          },
          ...(activeChunk
            ? {
              activeChunk: {
                title: activeChunk.title,
                prompt: activeChunk.prompt,
                ...(activeChunk.doneWhen ? { doneWhen: activeChunk.doneWhen } : {}),
                ...(activeChunk.doNotTouch ? { doNotTouch: activeChunk.doNotTouch } : {}),
              },
            }
            : {}),
          ...(nextChunk ? { nextChunkTitle: nextChunk.title } : {}),
          staleMessages: staleIssues.map((issue) => issue.message),
        }),
      ).waitUntilExit();
      return;
    }

    this.log('');
    this.log(chalk.bold(`📦 ${projectName}`));
    if (projectGoal) {
      this.log(chalk.dim(`   ${projectGoal}`));
    }
    this.log(chalk.dim(`   Progress: ${stats.completed}/${stats.total} complete (${stats.skipped} skipped)`));
    this.log('');

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
