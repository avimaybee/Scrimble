import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SCRIMBLE_DIR, VERIFICATION_DIR } from '@scrimble/shared';
import { runVerification, type VerificationPatternCheck } from '../lib/verify/index.js';
import { recordTelemetry } from '../lib/telemetry.js';

function parsePatternChecks(values: string[]): VerificationPatternCheck[] {
  return values.map((rawValue) => {
    const separatorIndex = rawValue.indexOf('::');
    if (separatorIndex === -1) {
      throw new Error(`Invalid pattern format: "${rawValue}". Expected "file::regex".`);
    }

    const file = rawValue.slice(0, separatorIndex).trim();
    const pattern = rawValue.slice(separatorIndex + 2).trim();
    if (!file || !pattern) {
      throw new Error(`Invalid pattern format: "${rawValue}". File and regex are required.`);
    }

    return { file, pattern };
  });
}

export default class Verify extends Command {
  static override description = 'Run local verification checks';

  static override examples = [
    '<%= config.bin %> verify',
    '<%= config.bin %> verify --file README.md --pattern "README.md::Scrimble"',
    '<%= config.bin %> verify --command "pnpm run build"',
  ];

  static override flags = {
    file: Flags.string({
      description: 'Required file path to verify exists (repeatable)',
      multiple: true,
    }),
    pattern: Flags.string({
      description: 'Pattern verification in format "file::regex" (repeatable)',
      multiple: true,
    }),
    command: Flags.string({
      description: 'Command to run as verification check (repeatable)',
      multiple: true,
    }),
    json: Flags.boolean({
      description: 'Print raw JSON verification result',
      default: false,
    }),
    'no-save': Flags.boolean({
      description: 'Do not write verification/latest.json',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Verify);

    const patternChecks = parsePatternChecks(flags.pattern ?? []);
    const verificationInput = {
      ...(flags.file && flags.file.length > 0 ? { expectedFiles: flags.file } : {}),
      ...(patternChecks.length > 0 ? { expectedPatterns: patternChecks } : {}),
      ...(flags.command && flags.command.length > 0 ? { commands: flags.command } : {}),
    };
    const result = await runVerification(verificationInput);
    await recordTelemetry({
      event: 'verification_run',
      payload: {
        status: result.status,
        confidence: result.confidence,
        checkCount: result.checks.length,
      },
    });

    if (!flags['no-save']) {
      const verificationDir = path.join(process.cwd(), SCRIMBLE_DIR, VERIFICATION_DIR);
      await fs.mkdir(verificationDir, { recursive: true });
      await fs.writeFile(
        path.join(verificationDir, 'latest.json'),
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8',
      );
    }

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2));
    } else {
      const statusColor =
        result.status === 'pass'
          ? chalk.green
          : result.status === 'fail'
            ? chalk.red
            : chalk.yellow;

      this.log('');
      this.log(statusColor(`Verification: ${result.status.toUpperCase()}`));
      this.log(chalk.dim(`Confidence: ${Math.round(result.confidence * 100)}%`));
      this.log('');

      for (const check of result.checks) {
        const icon =
          check.status === 'pass'
            ? chalk.green('✓')
            : check.status === 'fail'
              ? chalk.red('✗')
              : chalk.yellow('•');
        const color =
          check.status === 'pass'
            ? chalk.green
            : check.status === 'fail'
              ? chalk.red
              : chalk.yellow;

        this.log(`  ${icon} ${color(check.name)}`);
        if (check.message) {
          this.log(chalk.dim(`    ${check.message}`));
        }
      }

      this.log('');
      this.log(chalk.dim(`Result saved to .scrimble/${VERIFICATION_DIR}/latest.json`));
      this.log('');
    }

    if (result.status === 'fail') {
      this.exit(1);
    }
  }
}
