import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import {
  appendActivity,
  getActiveChunk,
  loadPlanState,
  savePlanState,
  writeCurrentChunkFromPlan,
  type LocalChunk,
} from '../lib/local/index.js';
import { getReplanStatus, resolveCloudClientConfig, startReplan } from '../lib/api/index.js';
import { loadScrimbleConfig } from '../lib/config/load-config.js';
import { recordTelemetry } from '../lib/telemetry.js';

function summarizePlan(plan: Awaited<ReturnType<typeof loadPlanState>>): string {
  const completed = plan.chunks.filter((chunk) => chunk.status === 'completed').length;
  const pending = plan.chunks.filter((chunk) => chunk.status === 'pending').length;
  const active = plan.chunks.filter((chunk) => chunk.status === 'active').length;
  return `completed=${completed}, active=${active}, pending=${pending}`;
}

function buildReplannedPendingChunks(request: string, startSequence: number): LocalChunk[] {
  const createdAt = new Date().toISOString();
  return [
    {
      id: `replan-${String(startSequence).padStart(3, '0')}`,
      sequence: startSequence,
      title: 'Apply replan scope changes',
      prompt: `Adjust implementation plan based on request:\n${request}`,
      status: 'pending',
      doneWhen: 'Requested change is reflected in implementation and plan metadata.',
      verificationSignals: ['scrimble verify', 'scrimble status'],
      createdAt,
    },
    {
      id: `replan-${String(startSequence + 1).padStart(3, '0')}`,
      sequence: startSequence + 1,
      title: 'Validate replanned trajectory',
      prompt: 'Confirm revised plan still preserves completed work and keeps next chunk actionable.',
      status: 'pending',
      doneWhen: 'Replanned chunk sequence is coherent and verified.',
      verificationSignals: ['scrimble verify', 'scrimble sync --dry-run'],
      createdAt,
    },
  ];
}

export default class Replan extends Command {
  static override description = 'Regenerate remaining plan while preserving completed work';

  static override examples = [
    '<%= config.bin %> replan --request "Scope now includes multi-tenant auth"',
    '<%= config.bin %> replan --request "Tighten deadlines" --wait',
  ];

  static override flags = {
    request: Flags.string({
      description: 'Replan request describing why plan must change',
      required: true,
    }),
    wait: Flags.boolean({
      description: 'Wait for cloud replan run completion',
      default: false,
    }),
    cloud: Flags.boolean({
      description: 'Trigger cloud replan run in addition to local replan',
      default: true,
      allowNo: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Replan);
    const plan = await loadPlanState();
    const now = new Date().toISOString();

    const completedOrSkipped = plan.chunks.filter(
      (chunk) => chunk.status === 'completed' || chunk.status === 'skipped',
    );
    const activeChunk = getActiveChunk(plan);
    const preserved = activeChunk ? [...completedOrSkipped, activeChunk] : completedOrSkipped;
    const replannedPending = buildReplannedPendingChunks(flags.request, preserved.length + 1);

    const nextPlan = {
      ...plan,
      chunks: [...preserved, ...replannedPending],
      metadata: {
        ...(plan.metadata ?? {}),
        lastReplanRequest: flags.request,
        lastReplannedAt: now,
      },
    };
    await savePlanState(nextPlan);
    await writeCurrentChunkFromPlan(nextPlan);

    let cloudRunId: string | undefined;
    if (flags.cloud) {
      try {
        const cloud = await resolveCloudClientConfig();
        const config = await loadScrimbleConfig();
        const aiConfigPayload: Record<string, unknown> = {
          provider: config.ai.provider,
          model: config.ai.model,
          ...(config.ai.apiKey ? { apiKey: config.ai.apiKey } : {}),
          ...(config.ai.baseUrl ? { baseUrl: config.ai.baseUrl } : {}),
          ...(config.ai.options ? { options: config.ai.options } : {}),
        };
        const started = await startReplan(cloud, {
          updateRequest: flags.request,
          currentPlanSummary: summarizePlan(plan),
          aiConfig: aiConfigPayload,
        });
        cloudRunId = started.instanceId;
      } catch (error) {
        await recordTelemetry({
          event: 'replan_cloud_start_failed',
          level: 'warn',
          payload: { message: error instanceof Error ? error.message : String(error) },
        });
      }
    }

    if (flags.wait && cloudRunId) {
      try {
        const cloud = await resolveCloudClientConfig();
        for (let attempt = 0; attempt < 15; attempt += 1) {
          const status = await getReplanStatus(cloud, cloudRunId);
          const statusValue = String(status['status'] ?? '');
          if (statusValue === 'complete' || statusValue === 'completed' || statusValue === 'errored' || statusValue === 'failed') {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        await recordTelemetry({
          event: 'replan_cloud_wait_failed',
          level: 'warn',
          payload: { message: error instanceof Error ? error.message : String(error) },
        });
      }
    }

    await appendActivity('plan_replanned', {
      request: flags.request,
      cloudRunId: cloudRunId ?? null,
    });
    await recordTelemetry({
      event: 'plan_replanned',
      payload: {
        cloudRunId: cloudRunId ?? null,
        preservedCount: preserved.length,
        generatedPendingCount: replannedPending.length,
      },
    });

    this.log('');
    this.log(chalk.green('✓ Plan replanned while preserving completed work.'));
    if (cloudRunId) {
      this.log(chalk.dim(`Cloud replan run: ${cloudRunId}`));
    }
    this.log('');
  }
}
