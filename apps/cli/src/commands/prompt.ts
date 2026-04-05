import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { getActiveChunk, loadPlanState, renderChunkMarkdown } from '../lib/local/index.js';

export default class Prompt extends Command {
  static override description = 'Print the raw active-chunk prompt for copy/paste automation';

  static override examples = [
    '<%= config.bin %> prompt',
    '<%= config.bin %> prompt --json',
  ];

  static override flags = {
    json: Flags.boolean({
      description: 'Print prompt payload as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Prompt);
    const plan = await loadPlanState();
    const activeChunk = getActiveChunk(plan);

    if (!activeChunk) {
      this.log(chalk.yellow('\nNo active chunk available. Use `scrimble next --activate` first.\n'));
      return;
    }

    if (flags.json) {
      this.log(
        JSON.stringify(
          {
            chunkId: activeChunk.id,
            title: activeChunk.title,
            prompt: renderChunkMarkdown(activeChunk),
          },
          null,
          2,
        ),
      );
      return;
    }

    this.log(renderChunkMarkdown(activeChunk));
  }
}
