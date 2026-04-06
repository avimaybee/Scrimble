import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const telemetryMocks = vi.hoisted(() => ({
  recordTelemetry: vi.fn(),
}));

vi.mock('../lib/telemetry.js', () => telemetryMocks);

import ImportCommand from './import.js';

function makeCommand(flags: { goal: string; force: boolean }, logs: string[]): ImportCommand {
  const command = Object.create(ImportCommand.prototype) as ImportCommand & {
    parse: ReturnType<typeof vi.fn>;
    log: (message?: string) => void;
    exit: (code?: number) => never;
  };
  command.parse = vi.fn().mockResolvedValue({ flags });
  command.log = (message = '') => {
    logs.push(String(message));
  };
  command.exit = (code?: number) => {
    throw new Error(`EXIT_${String(code ?? 0)}`);
  };
  return command as ImportCommand;
}

describe('import command artifacts', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scrimble-import-test-'));
    process.chdir(tempDir);

    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'test-repo',
        version: '1.0.0',
        dependencies: {
          react: '^18.0.0',
        },
      }),
      'utf8',
    );

    telemetryMocks.recordTelemetry.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('writes research summary and planning prompt artifacts', async () => {
    const logs: string[] = [];
    const command = makeCommand({ goal: 'Ship smart onboarding', force: false }, logs);

    await command.run();

    const research = await fs.readFile(path.join(tempDir, '.scrimble', 'research-summary.md'), 'utf8');
    const architecturePrompt = await fs.readFile(
      path.join(tempDir, '.scrimble', 'prompts', 'architecture-planning.md'),
      'utf8',
    );
    const chunkPrompt = await fs.readFile(
      path.join(tempDir, '.scrimble', 'prompts', 'chunk-planning.md'),
      'utf8',
    );

    expect(research).toContain('# Research Summary');
    expect(architecturePrompt).toContain('## Product Goal');
    expect(chunkPrompt).toContain('## Output Format');
    expect(logs.join('\n')).toContain('Planning prompts written');
  });
});
