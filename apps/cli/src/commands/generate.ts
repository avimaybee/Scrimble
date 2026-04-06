import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import {
  appendActivity,
  getScrimblePaths,
  loadPlanState,
  savePlanState,
  writeCurrentChunkFromPlan,
  type LocalChunk,
  type LocalPlanState,
} from '../lib/local/index.js';
import { formatCloudError, getGenerationStatus, resolveCloudClientConfig, startGeneration } from '../lib/api/index.js';
import { loadScrimbleConfig } from '../lib/config/load-config.js';
import { recordTelemetry } from '../lib/telemetry.js';

async function promptForGoal(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Generation goal is required. Provide --goal when running non-interactively.');
  }

  const rl = createInterface({ input, output });
  try {
    const goal = (await rl.question('What should Scrimble generate a plan for? ')).trim();
    if (!goal) {
      throw new Error('Generation goal is required.');
    }
    return goal;
  } finally {
    rl.close();
  }
}

function normalizeGeneratedChunks(value: unknown): LocalChunk[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const createdAt = new Date().toISOString();
  const chunks: LocalChunk[] = [];

  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const chunk = entry as Record<string, unknown>;
    const sequence = typeof chunk['sequence'] === 'number' && Number.isFinite(chunk['sequence'])
      ? Math.max(1, Math.trunc(chunk['sequence']))
      : index + 1;
    const title = typeof chunk['title'] === 'string' ? chunk['title'].trim() : '';
    const prompt = typeof chunk['prompt'] === 'string' ? chunk['prompt'].trim() : '';
    const doneCondition = typeof chunk['doneCondition'] === 'string' ? chunk['doneCondition'].trim() : '';
    const doNotTouch = typeof chunk['doNotTouch'] === 'string' ? chunk['doNotTouch'].trim() : '';
    const verificationHints = Array.isArray(chunk['verificationHints'])
      ? chunk['verificationHints']
          .filter((hint): hint is string => typeof hint === 'string')
          .map((hint) => hint.trim())
          .filter((hint) => hint.length > 0)
      : [];

    if (!title || !prompt || !doneCondition) {
      continue;
    }

    chunks.push({
      id: `chunk-${String(sequence).padStart(3, '0')}`,
      sequence,
      title,
      prompt,
      status: 'pending',
      doneWhen: doneCondition,
      ...(doNotTouch ? { doNotTouch } : {}),
      ...(verificationHints.length > 0 ? { verificationSignals: verificationHints } : {}),
      createdAt,
    });
  }

  chunks.sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  for (const [index, chunk] of chunks.entries()) {
    chunk.status = index === 0 ? 'active' : 'pending';
  }
  return chunks;
}

function buildGeneratedPlan(
  currentPlan: LocalPlanState,
  output: Record<string, unknown>,
  runId: string,
): { plan: LocalPlanState; researchSummary?: string } | null {
  const architectureSummary = typeof output['architectureSummary'] === 'string'
    ? output['architectureSummary'].trim()
    : '';
  const researchSummary = typeof output['researchSummary'] === 'string'
    ? output['researchSummary'].trim()
    : undefined;
  const chunks = normalizeGeneratedChunks(output['chunks']);
  if (!architectureSummary || chunks.length === 0) {
    return null;
  }

  const syncState = { ...(currentPlan.sync ?? {}) };
  delete syncState.lastSyncError;

  return {
    plan: {
      version: (typeof currentPlan.version === 'number' ? currentPlan.version : 1) + 1,
      architecture: {
        summary: architectureSummary,
        approved: false,
        notes: `Generated from cloud run ${runId}.`,
      },
      chunks,
      sync: syncState,
      metadata: {
        ...(currentPlan.metadata ?? {}),
        generationSource: 'cloud',
        lastGenerationRunId: runId,
        lastGeneratedAt: new Date().toISOString(),
        ...(researchSummary ? { lastResearchSummary: researchSummary } : {}),
      },
    },
    ...(researchSummary ? { researchSummary } : {}),
  };
}

export default class Generate extends Command {
  static override description = 'Start a cloud generation run and optionally wait/apply output locally';

  static override examples = [
    '<%= config.bin %> generate --goal "Ship stable runtime"',
    '<%= config.bin %> generate --goal "Ship stable runtime" --wait',
    '<%= config.bin %> generate --goal "Ship stable runtime" --wait --no-apply',
  ];

  static override flags = {
    goal: Flags.string({
      description: 'Generation goal describing the plan to produce',
    }),
    wait: Flags.boolean({
      description: 'Wait for cloud generation run completion',
      default: false,
    }),
    apply: Flags.boolean({
      description: 'Apply completed generation output to local plan.json',
      default: true,
      allowNo: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Generate);
    const plan = await loadPlanState();
    let goal = flags.goal?.trim() ?? '';
    if (!goal) {
      goal = await promptForGoal();
    }

    let cloudConfig: Awaited<ReturnType<typeof resolveCloudClientConfig>>;
    let config: Awaited<ReturnType<typeof loadScrimbleConfig>>;
    try {
      cloudConfig = await resolveCloudClientConfig();
      config = await loadScrimbleConfig();
    } catch {
      this.log(chalk.red('\nCloud configuration is missing. Run `scrimble init` and `scrimble login` first.\n'));
      this.exit(1);
      return;
    }

    const aiConfigPayload: Record<string, unknown> = {
      provider: config.ai.provider,
      model: config.ai.model,
      ...(config.ai.apiKey ? { apiKey: config.ai.apiKey } : {}),
      ...(config.ai.baseUrl ? { baseUrl: config.ai.baseUrl } : {}),
      ...(config.ai.options ? { options: config.ai.options } : {}),
    };

    let started: { instanceId: string; runId: string; status: string };
    try {
      started = await startGeneration(cloudConfig, {
        goal,
        aiConfig: aiConfigPayload,
      });
    } catch (error) {
      const message = formatCloudError(error);
      await recordTelemetry({
        event: 'generation_cloud_start_failed',
        level: 'warn',
        payload: { message },
      });
      this.log(chalk.red(`\nCloud generation start failed: ${message}\n`));
      this.exit(1);
      return;
    }

    this.log('');
    this.log(chalk.green('✓ Cloud generation run started.'));
    this.log(chalk.dim(`Run id: ${started.runId}`));
    this.log(chalk.dim(`Project id: ${started.instanceId}`));

    let finalStatus: Record<string, unknown> | undefined;
    if (flags.wait) {
      try {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const status = await getGenerationStatus(cloudConfig, started.instanceId);
          const statusValue = String(status['status'] ?? '');
          finalStatus = status;
          if (statusValue === 'completed' || statusValue === 'failed') {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        const message = formatCloudError(error);
        await recordTelemetry({
          event: 'generation_cloud_wait_failed',
          level: 'warn',
          payload: { message },
        });
        this.log(chalk.yellow(`⚠ Cloud generation wait failed: ${message}`));
      }
    }

    let applied = false;
    const finalStatusValue = finalStatus ? String(finalStatus['status'] ?? '') : '';
    if (!flags.wait) {
      this.log(chalk.dim('Run with --wait to watch completion and optionally apply output locally.'));
    } else if (finalStatusValue === 'completed' && flags.apply) {
      const output = finalStatus?.['output'];
      if (output && typeof output === 'object') {
        const generatedPlan = buildGeneratedPlan(plan, output as Record<string, unknown>, started.runId);
        if (generatedPlan) {
          await savePlanState(generatedPlan.plan);
          await writeCurrentChunkFromPlan(generatedPlan.plan);
          if (generatedPlan.researchSummary) {
            const paths = getScrimblePaths();
            await fs.writeFile(paths.research, `${generatedPlan.researchSummary}\n`, 'utf8');
          }
          applied = true;
        }
      }

      if (applied) {
        this.log(chalk.green('✓ Plan generated from cloud output and applied locally.'));
      } else {
        this.log(chalk.yellow('⚠ Cloud generation completed but output could not be applied locally.'));
      }
    } else if (finalStatusValue === 'failed') {
      const errorMessage = typeof finalStatus?.['error'] === 'string'
        ? finalStatus['error']
        : 'Cloud generation run failed.';
      this.log(chalk.red(`✗ ${errorMessage}`));
    } else if (flags.wait) {
      this.log(chalk.yellow('⚠ Cloud generation is still running.'));
    }

    await appendActivity('plan_generated', {
      goal,
      cloudRunId: started.runId,
      waited: flags.wait,
      finalStatus: finalStatusValue || null,
      applied,
    });
    await recordTelemetry({
      event: 'plan_generated',
      payload: {
        cloudRunId: started.runId,
        waited: flags.wait,
        finalStatus: finalStatusValue || null,
        applied,
      },
    });

    if (finalStatusValue === 'failed') {
      this.log('');
      this.exit(1);
      return;
    }

    this.log('');
  }
}
