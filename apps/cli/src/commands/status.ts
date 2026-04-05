import { Command } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SCRIMBLE_DIR, PLAN_FILE } from '@scrimble/shared';

export default class Status extends Command {
  static override description = 'Show project status and progress';

  static override examples = [
    '<%= config.bin %> status',
  ];

  async run(): Promise<void> {
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

    // Load project and plan
    let project: { name?: string; goal?: string; initialized?: string } = {};
    let plan: { chunks?: Array<{ title: string; status: string }> } | null = null;

    try {
      const projectContent = await fs.readFile(path.join(scrimbleDir, 'project.json'), 'utf-8');
      project = JSON.parse(projectContent);
    } catch {
      // Ignore
    }

    try {
      const planContent = await fs.readFile(path.join(scrimbleDir, PLAN_FILE), 'utf-8');
      plan = JSON.parse(planContent);
    } catch {
      // No plan
    }

    this.log('');
    this.log(chalk.bold(`📊 Project Status: ${project.name ?? 'Unknown'}`));
    this.log('');

    if (project.goal) {
      this.log(chalk.dim(`Goal: ${project.goal}`));
      this.log('');
    }

    if (project.initialized) {
      this.log(chalk.dim(`Initialized: ${new Date(project.initialized).toLocaleDateString()}`));
    }

    if (!plan?.chunks) {
      this.log(chalk.yellow('\n  No execution plan generated yet.'));
      this.log(chalk.dim('  Run your AI provider to generate a plan.\n'));
      return;
    }

    // Show chunk progress
    const total = plan.chunks.length;
    const completed = plan.chunks.filter(c => c.status === 'completed').length;
    const skipped = plan.chunks.filter(c => c.status === 'skipped').length;
    const active = plan.chunks.find(c => c.status === 'active');

    this.log('');
    this.log(chalk.bold('Progress:'));
    
    // Progress bar
    const barWidth = 30;
    const progress = Math.round((completed / total) * barWidth);
    const bar = chalk.green('█'.repeat(progress)) + chalk.dim('░'.repeat(barWidth - progress));
    this.log(`  [${bar}] ${completed}/${total} chunks`);
    
    if (skipped > 0) {
      this.log(chalk.yellow(`  ${skipped} chunk(s) skipped`));
    }

    this.log('');

    if (active) {
      this.log(chalk.bold('Current:'));
      this.log(chalk.cyan(`  → ${active.title}`));
    } else if (completed === total) {
      this.log(chalk.green('  ✓ All chunks completed!'));
    }

    this.log('');

    // List all chunks
    this.log(chalk.bold('Chunks:'));
    for (const chunk of plan.chunks) {
      const icon = chunk.status === 'completed' ? chalk.green('✓') :
                   chunk.status === 'skipped' ? chalk.yellow('○') :
                   chunk.status === 'active' ? chalk.cyan('→') :
                   chalk.dim('·');
      const title = chunk.status === 'active' ? chalk.bold(chunk.title) : chunk.title;
      this.log(`  ${icon} ${title}`);
    }
    this.log('');
  }
}
