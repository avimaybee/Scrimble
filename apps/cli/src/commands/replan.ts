import { Command, Flags } from '@oclif/core';

export default class Replan extends Command {
  static override description = 'Local alias for `scrimble generate --replan`';

  static override examples = [
    '<%= config.bin %> replan --request "Scope now includes multi-tenant auth"',
  ];

  static override flags = {
    request: Flags.string({
      description: 'Replan request describing what changed',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Replan);
    await this.config.runCommand('generate', ['--goal', flags.request, '--replan']);
  }
}

