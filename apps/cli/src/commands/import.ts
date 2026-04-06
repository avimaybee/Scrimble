import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { aiProviderSchema } from '@scrimble/shared';

export default class Import extends Command {
  static override description = 'Compatibility alias for `scrimble init`';

  static override examples = [
    '<%= config.bin %> import',
    '<%= config.bin %> import --goal "Ship stable runtime"',
    '<%= config.bin %> import --from-cloud --project-id my-project',
  ];

  static override flags = {
    goal: Flags.string({
      char: 'g',
      description: 'Project goal description',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing .scrimble directory',
      default: false,
    }),
    'ai-provider': Flags.string({
      description: 'AI provider to configure',
      options: [...aiProviderSchema.options],
    }),
    'ai-model': Flags.string({
      description: 'AI model (defaults to provider-specific recommended model)',
    }),
    'from-cloud': Flags.boolean({
      description: 'Bootstrap from authenticated cloud project and canonical plan registry',
      default: true,
      allowNo: true,
    }),
    'project-id': Flags.string({
      description: 'Cloud project id to bootstrap (defaults to repo slug)',
    }),
    'skip-preflight': Flags.boolean({
      description: 'Skip Gemini/Conductor preflight checks',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Import);

    const initArgs: string[] = [];
    if (flags.goal) {
      initArgs.push('--goal', flags.goal);
    }
    if (flags.force) {
      initArgs.push('--force');
    }
    if (flags['ai-provider']) {
      initArgs.push('--ai-provider', flags['ai-provider']);
    }
    if (flags['ai-model']) {
      initArgs.push('--ai-model', flags['ai-model']);
    }
    if (flags['project-id']) {
      initArgs.push('--project-id', flags['project-id']);
    }
    if (flags['skip-preflight']) {
      initArgs.push('--skip-preflight');
    }
    if (flags['from-cloud']) {
      initArgs.push('--from-cloud');
    } else {
      initArgs.push('--no-from-cloud');
    }

    this.log('');
    this.log(chalk.yellow('`scrimble import` is now an alias for `scrimble init`.'));
    this.log(chalk.dim('Running `scrimble init` with forwarded flags...'));
    this.log('');

    await this.config.runCommand('init', initArgs);
  }
}
