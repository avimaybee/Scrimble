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
} from '../lib/local/index.js';
import { getAIConfigurationStatus, getAuthStatus } from '../lib/onboarding.js';
import { detectStaleness } from '../lib/staleness.js';
import { getTaskProvider } from '../lib/tasks/index.js';

export default class Root extends Command {
  static override description = 'Run smart onboarding checks, then show current task and project status';
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

    const onboardingComplete = await ensureOnboarding(cwd, this.log.bind(this), this.config.runCommand.bind(this.config));
    if (!onboardingComplete) {
      return;
    }

    let provider = await getTaskProvider(cwd);
    if (provider.kind === 'legacy') {
      const plan = await loadPlanState(cwd);
      if (plan.chunks.length === 0) {
        this.log(chalk.yellow('\n🧭 No execution plan found. Starting `scrimble generate`...\n'));
        await this.config.runCommand('generate');
        provider = await getTaskProvider(cwd);
      }
    }

    if (flags.ink && provider.kind === 'legacy') {
      await renderLegacyInk(cwd);
      return;
    }

    const project = await loadProjectState(cwd);
    const projectName = typeof project['name'] === 'string' ? project['name'] : 'Unknown Project';
    const projectGoal = typeof project['goal'] === 'string' ? project['goal'] : null;
    const summary = await provider.getSummary();

    this.log('');
    this.log(chalk.bold(`📦 ${projectName}`));
    if (projectGoal) {
      this.log(chalk.dim(`   ${projectGoal}`));
    }
    this.log(chalk.dim(`   ${summary.statusLabel}`));
    if (summary.progressLabel) {
      this.log(chalk.dim(`   ${summary.progressLabel}`));
    }
    this.log('');

    if (summary.activeTask) {
      this.log(chalk.bold('📋 Current Task'));
      this.log(chalk.cyan(`  ${summary.activeTask.title} (${summary.activeTask.id})`));
      if (flags.verbose) {
        this.log(chalk.dim(summary.activeTask.prompt));
      } else if (summary.activeTask.doneWhen) {
        this.log(chalk.dim(`  Done when: ${summary.activeTask.doneWhen}`));
      }
      this.log('');
    } else if (summary.nextTask) {
      this.log(chalk.green('  ✓ No active task right now.'));
      this.log(chalk.cyan(`  Next available: ${summary.nextTask.title}`));
      this.log('');
    } else {
      this.log(chalk.yellow('  No active or pending tasks are currently available.'));
      this.log('');
    }

    if (summary.warnings.length > 0) {
      this.log(chalk.yellow('⚠ Notes:'));
      for (const warning of summary.warnings) {
        this.log(chalk.yellow(`  - ${warning}`));
      }
      this.log('');
    }

    this.log(chalk.bold('Quick Actions:'));
    for (const action of summary.quickActions) {
      this.log(chalk.dim(`  ${action}`));
    }
    this.log('');

    this.log(chalk.bold('Next Action:'));
    this.log(chalk.cyan(`  ${summary.nextAction}`));
    this.log('');
  }
}

async function ensureOnboarding(
  cwd: string,
  log: (message?: string) => void,
  runCommand: (id: string) => Promise<unknown>,
): Promise<boolean> {
  let authStatus = await getAuthStatus(cwd);
  if (!authStatus.isAuthenticated) {
    log(chalk.yellow('\n🔐 Authentication required. Starting `scrimble login`...\n'));
    await runCommand('login');
    authStatus = await getAuthStatus(cwd);
    if (!authStatus.isAuthenticated) {
      log(chalk.red('\nLogin did not produce a valid session.\n'));
      return false;
    }
  }

  let projectInitialized = await isProjectInitialized(cwd);
  if (!projectInitialized) {
    log(chalk.yellow('\n🚀 Project initialization required. Starting `scrimble init`...\n'));
    await runCommand('init');
    projectInitialized = await isProjectInitialized(cwd);
    if (!projectInitialized) {
      log(chalk.red('\nProject is still not initialized after `scrimble init`.\n'));
      return false;
    }
  }

  let aiStatus = await getAIConfigurationStatus(cwd);
  if (!aiStatus.isValid) {
    log(chalk.yellow('\n🤖 AI configuration is incomplete. Starting `scrimble config set-ai`...\n'));
    await runCommand('config:set-ai');
    aiStatus = await getAIConfigurationStatus(cwd);
    if (!aiStatus.isValid) {
      log(chalk.red('\nAI configuration is still incomplete after setup.\n'));
      return false;
    }
  }

  return true;
}

async function renderLegacyInk(cwd: string): Promise<void> {
  const plan = await loadPlanState(cwd);
  const project = await loadProjectState(cwd);
  const activeChunk = getActiveChunk(plan);
  const nextChunk = getNextPendingChunk(plan);
  const stats = getCompletionStats(plan);
  const staleIssues = await detectStaleness(plan);
  const projectName = typeof project['name'] === 'string' ? project['name'] : 'Unknown Project';
  const projectGoal = typeof project['goal'] === 'string' ? project['goal'] : null;

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
}
