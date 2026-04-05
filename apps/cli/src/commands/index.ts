import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SCRIMBLE_DIR, PLAN_FILE, CURRENT_CHUNK_FILE, PROJECT_FILE } from '@scrimble/shared';

export default class Index extends Command {
  static override description = 'Show current chunk and project status (default command)';

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
    const { flags } = await this.parse(Index);

    const cwd = process.cwd();
    const scrimbleDir = path.join(cwd, SCRIMBLE_DIR);

    // Check if initialized
    try {
      await fs.access(scrimbleDir);
    } catch {
      this.log(chalk.yellow('\n⚠ Scrimble not initialized in this directory.'));
      this.log(chalk.dim('  Run `scrimble init` to get started.\n'));
      return;
    }

    // Load project info
    let projectName = 'Unknown Project';
    let projectGoal: string | null = null;
    
    try {
      const projectPath = path.join(scrimbleDir, PROJECT_FILE);
      const projectContent = await fs.readFile(projectPath, 'utf-8');
      const project = JSON.parse(projectContent);
      projectName = project.name ?? projectName;
      projectGoal = project.goal;
    } catch {
      // Project file may not exist yet
    }

    // Check for plan
    let hasPlan = false;
    try {
      await fs.access(path.join(scrimbleDir, PLAN_FILE));
      hasPlan = true;
    } catch {
      // No plan yet
    }

    // Check for current chunk
    let currentChunk: string | null = null;
    try {
      currentChunk = await fs.readFile(path.join(scrimbleDir, CURRENT_CHUNK_FILE), 'utf-8');
    } catch {
      // No current chunk
    }

    // Display status
    this.log('');
    this.log(chalk.bold(`📦 ${projectName}`));
    
    if (projectGoal) {
      this.log(chalk.dim(`   ${projectGoal}`));
    }
    
    this.log('');

    if (!hasPlan) {
      // No plan yet - guide user to generate one
      this.log(chalk.yellow('  No execution plan yet.'));
      this.log('');
      this.log(chalk.bold('  To get started:'));
      this.log(chalk.dim('  1. Configure your AI provider in .scrimble/config.json'));
      this.log(chalk.dim('  2. Set your API key environment variable'));
      this.log(chalk.dim('  3. Run `scrimble plan` to generate your execution plan'));
      this.log('');
      return;
    }

    if (!currentChunk) {
      this.log(chalk.green('  ✓ All chunks completed! Project is done.'));
      this.log('');
      return;
    }

    // Display current chunk
    this.log(chalk.bold('📋 Current Chunk'));
    this.log('');
    this.log(currentChunk);
    this.log('');

    // Quick actions
    this.log(chalk.bold('Quick Actions:'));
    this.log(chalk.dim('  scrimble prompt    - Copy prompt for your AI coding agent'));
    this.log(chalk.dim('  scrimble verify    - Check if chunk is complete'));
    this.log(chalk.dim('  scrimble done      - Mark chunk as complete'));
    this.log(chalk.dim('  scrimble skip      - Skip this chunk (with reason)'));
    this.log(chalk.dim('  scrimble next      - Preview next chunk'));
    this.log('');
  }
}
