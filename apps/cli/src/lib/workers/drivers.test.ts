import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { buildCopilotExecutionArgs, classifyCopilotAuthProbe, CopilotDriver } from './copilot-driver.js';
import { buildGeminiExecutionArgs, GeminiDriver } from './gemini-driver.js';

describe('worker drivers', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `workers-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('parses gemini json output', () => {
    const driver = new GeminiDriver({ cwd: testDir });
    const parsed = driver.parseOutput(
      '{"response":"done","stats":{"tokensIn":10,"tokensOut":20},"tools":[{"name":"edit","count":2}]}\n',
    );

    expect(parsed?.response).toBe('done');
    expect(parsed?.stats?.tokensIn).toBe(10);
    expect(parsed?.tools?.[0]?.name).toBe('edit');
    expect(parsed?.tools?.[0]?.count).toBe(2);
  });

  it('parses copilot jsonl output', () => {
    const driver = new CopilotDriver({ cwd: testDir });
    const parsed = driver.parseOutput(
      '{"type":"tool","tool":"edit"}\n{"type":"final","response":"complete","usage":{"inputTokens":5,"outputTokens":8,"totalTokens":13},"touchedFiles":["src/a.ts"]}',
    );

    expect(parsed?.response).toBe('complete');
    expect(parsed?.stats?.tokensIn).toBe(5);
    expect(parsed?.stats?.totalTokens).toBe(13);
    expect(parsed?.tools?.[0]?.name).toBe('edit');
    expect(parsed?.metadata).toBeDefined();
  });

  it('discovers gemini and copilot context artifacts', async () => {
    await fs.mkdir(path.join(testDir, '.github', 'copilot'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'conductor'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'GEMINI.md'), '# Gemini Context', 'utf8');
    await fs.writeFile(path.join(testDir, 'AGENTS.md'), '# Copilot Context', 'utf8');
    await fs.writeFile(path.join(testDir, '.github', 'copilot', 'settings.json'), '{"model":"gpt"}', 'utf8');
    await fs.writeFile(path.join(testDir, 'conductor', 'tracks.md'), '- [ ] Track', 'utf8');

    const geminiArtifacts = await new GeminiDriver({ cwd: testDir }).discoverContextArtifacts();
    const copilotArtifacts = await new CopilotDriver({ cwd: testDir }).discoverContextArtifacts();

    expect(geminiArtifacts.some((artifact) => artifact.path === 'GEMINI.md')).toBe(true);
    expect(geminiArtifacts.some((artifact) => artifact.path === 'conductor/tracks.md')).toBe(true);
    expect(copilotArtifacts.some((artifact) => artifact.path === 'AGENTS.md')).toBe(true);
    expect(copilotArtifacts.some((artifact) => artifact.path === '.github/copilot/settings.json')).toBe(true);
  });

  it('builds copilot execution args with unattended tool permissions', () => {
    const args = buildCopilotExecutionArgs('fix bug');
    expect(args).toContain('-p');
    expect(args).toContain('fix bug');
    expect(args).toContain('--no-ask-user');
    expect(args).toContain('--autopilot');
    expect(args).toContain('--allow-all-tools');
  });

  it('classifies copilot auth probe outcomes deterministically', () => {
    const missing = classifyCopilotAuthProbe(
      {
        stdout: '',
        stderr: 'Authentication required. Run copilot login.',
        exitCode: 1,
      },
      false,
    );
    expect(missing.authMissing).toBe(true);
    expect(missing.authConfigured).toBe(false);

    const configured = classifyCopilotAuthProbe(
      {
        stdout: '{"type":"final","response":"OK"}',
        stderr: '',
        exitCode: 0,
      },
      false,
    );
    expect(configured.authMissing).toBe(false);
    expect(configured.authConfigured).toBe(true);

    const envConfigured = classifyCopilotAuthProbe(
      {
        stdout: '',
        stderr: 'transient network error',
        exitCode: 1,
      },
      true,
    );
    expect(envConfigured.authMissing).toBe(false);
    expect(envConfigured.authConfigured).toBe(true);
  });

  it('gates gemini checkpointing flag by capability', () => {
    const unsupportedArgs = buildGeminiExecutionArgs(
      'implement',
      { approvalMode: 'yolo', outputFormat: 'json', checkpointing: true },
      false,
    );
    expect(unsupportedArgs).not.toContain('--checkpointing');

    const supportedArgs = buildGeminiExecutionArgs(
      'implement',
      { approvalMode: 'yolo', outputFormat: 'json', checkpointing: true },
      true,
    );
    expect(supportedArgs).toContain('--checkpointing');
  });
});

