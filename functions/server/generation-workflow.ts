import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import {
  Batch1ResearchStackSchema,
  Batch2FetchAndReadSchema,
  Batch3ArchitectSchema,
  Batch4PlanBuildSchema,
  Batch5EnrichStepsSchema,
} from './generation-schemas';
import { persistGenerationStreamEvent } from './generation-events';
import {
  executeBatch1,
  executeBatch2,
  executeBatch3,
  executeBatch4,
  executeBatch5,
  executeBatch6,
  finalizeProjectGeneration,
  hasApprovedArchitectureReview,
  loadBatchOutput,
  pauseForArchitectureReview,
  resolvePipelineStatusToRun,
  saveArchitectureReviewApproval,
  type ProviderConfig,
} from './generation-pipeline';
import { loadProjectBriefContext } from './project-briefs';
import { loadBuilderProfileContext } from './user-tools';
import { saveToR2, loadFromR2 } from './workflow-storage';
import { WORKFLOW_EVENT_TYPE_ARCHITECTURE_APPROVED } from './generation-dispatch';
import type {
  Bindings,
  GenerationBatchName,
  ProjectGenerationStatus,
  ResolvedGenerationProviderConfig,
} from './types';

const DEVELOPER_TOOLS = new Set([
  'vs code',
  'vscode',
  'cursor',
  'windsurf',
  'zed',
  'claude code',
  'chatgpt',
  'claude',
  'gemini',
  'grok',
  'copilot',
  'bolt',
  'v0',
  'intellij',
  'webstorm',
  'sublime',
  'vim',
  'neovim',
  'emacs',
]);

const MAX_BATCH2_WORKFLOW_STEPS = 128;
const MAX_BATCH5_WORKFLOW_STEPS = 256;
const WORKFLOW_BATCH2_CHECKPOINT_INTERVAL = 1;
const WORKFLOW_BATCH5_CHECKPOINT_INTERVAL = 5;

type GenerationPayload = {
  projectId: string;
  userId: string;
  runId: string;
  description: string;
  intakeAnswers: Record<string, string>;
  fastProvider: ResolvedGenerationProviderConfig;
  deepProvider: ResolvedGenerationProviderConfig;
  stackTechnologies: Array<{ name: string; docsUrl?: string; githubRepo?: string }>;
};

type ReviewApprovalEventPayload = {
  feedback: string;
  preferredIde: string;
  approved: boolean;
};

type ProjectGenerationRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  intake_answers: string | null;
  project_type: string | null;
  stack: string | null;
  generation_status: string | null;
  generation_run_id: string | null;
  generation_provider_id: string | null;
  generation_heartbeat_at: string | null;
};

type Batch2LoopOutcome =
  | { done: true; batch2Key: string }
  | { done: false };

type Batch5LoopOutcome =
  | { done: true; enrichmentsKey: string }
  | { done: false };

class WorkflowRunStoppedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowRunStoppedError';
  }
}

function isDeveloperTool(name: string): boolean {
  return DEVELOPER_TOOLS.has(name.toLowerCase());
}

function toProviderConfig(provider: ResolvedGenerationProviderConfig): ProviderConfig {
  return {
    providerId: provider.providerId,
    providerName: provider.providerName,
    providerType: provider.providerType,
    model: provider.model,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
  };
}

function normalizeStepName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'step';
}

function normalizeProjectStatus(value: unknown): ProjectGenerationStatus {
  const candidate = typeof value === 'string' ? value : 'queued';
  switch (candidate) {
    case 'intake':
    case 'queued':
    case 'batch_1_research_stack':
    case 'batch_2_fetch_and_read':
    case 'batch_3_architect':
    case 'batch_4_plan_build':
    case 'batch_5_enrich_steps':
    case 'batch_6_generate_files':
    case 'awaiting_review':
    case 'approved':
    case 'complete':
    case 'failed':
    case 'cancelled':
      return candidate;
    default:
      return 'queued';
  }
}

async function getProjectRow(env: Bindings, projectId: string): Promise<ProjectGenerationRow | null> {
  return env.DB.prepare(`
    SELECT
      id,
      user_id,
      name,
      description,
      intake_answers,
      project_type,
      stack,
      generation_status,
      generation_run_id,
      generation_provider_id,
      generation_heartbeat_at
    FROM projects
    WHERE id = ?
    LIMIT 1
  `)
    .bind(projectId)
    .first() as Promise<ProjectGenerationRow | null>;
}

async function getCompletedGenerationBatches(env: Bindings, projectId: string) {
  const rows = await env.DB.prepare(`
    SELECT run_type
    FROM agent_runs
    WHERE project_id = ?
      AND status = 'complete'
      AND run_type IN ('batch_1_research_stack', 'batch_2_fetch_and_read', 'batch_3_architect', 'batch_4_plan_build', 'batch_5_enrich_steps', 'batch_6_generate_files')
    ORDER BY created_at ASC
  `)
    .bind(projectId)
    .all();

  return (rows.results as Array<{ run_type: string }>).map((row) => row.run_type);
}

async function resolveCurrentStatusToRun(env: Bindings, projectId: string) {
  const project = await getProjectRow(env, projectId);
  if (!project) {
    throw new Error('Project not found.');
  }

  const completedBatches = await getCompletedGenerationBatches(env, projectId);
  const currentStatus = normalizeProjectStatus(project.generation_status);
  const statusToRun = await resolvePipelineStatusToRun(env, projectId, currentStatus, completedBatches);
  return { project, completedBatches, currentStatus, statusToRun };
}

async function assertActiveRun(env: Bindings, projectId: string, runId: string) {
  const project = await getProjectRow(env, projectId);
  if (!project) {
    throw new WorkflowRunStoppedError('Project no longer exists.');
  }

  if (normalizeProjectStatus(project.generation_status) === 'cancelled') {
    throw new WorkflowRunStoppedError('Project generation was cancelled.');
  }

  if (project.generation_run_id && project.generation_run_id !== runId) {
    throw new WorkflowRunStoppedError(
      `Run ${runId} is stale; active run is ${project.generation_run_id}.`,
    );
  }

  return project;
}

async function markProjectApproved(
  env: Bindings,
  projectId: string,
  runId: string,
  providerId: string | null,
) {
  await env.DB.prepare(`
    UPDATE projects
    SET generation_status = 'approved',
        generation_error = NULL,
        generation_provider_id = ?,
        generation_heartbeat_at = datetime("now"),
        generation_completed_at = NULL,
        updated_at = datetime("now")
    WHERE id = ?
      AND generation_status IN ('awaiting_review', 'approved')
      AND (generation_run_id IS NULL OR generation_run_id = ?)
  `)
    .bind(providerId, projectId, runId)
    .run();
}

async function markProjectCancelled(
  env: Bindings,
  projectId: string,
  runId: string,
  reason: string,
) {
  await env.DB.prepare(`
    UPDATE projects
    SET generation_status = 'cancelled',
        generation_error = ?,
        generation_heartbeat_at = datetime("now"),
        generation_completed_at = datetime("now"),
        updated_at = datetime("now")
    WHERE id = ?
      AND (generation_run_id IS NULL OR generation_run_id = ?)
  `)
    .bind(reason, projectId, runId)
    .run();

  await persistGenerationStreamEvent(env, {
    projectId,
    event: {
      type: 'pipeline_failed',
      error: reason,
    },
  });
}

async function markProjectFailed(
  env: Bindings,
  projectId: string,
  runId: string,
  reason: string,
) {
  await env.DB.prepare(`
    UPDATE projects
    SET generation_status = 'failed',
        generation_error = ?,
        generation_heartbeat_at = datetime("now"),
        generation_completed_at = datetime("now"),
        updated_at = datetime("now")
    WHERE id = ?
      AND (generation_run_id IS NULL OR generation_run_id = ?)
  `)
    .bind(reason, projectId, runId)
    .run();

  await persistGenerationStreamEvent(env, {
    projectId,
    event: {
      type: 'pipeline_failed',
      error: reason,
    },
  });
}

async function saveBatchOutputSnapshot<T>(
  env: Bindings,
  projectId: string,
  runId: string,
  key: string,
  runType: GenerationBatchName,
  schema: Parameters<typeof loadBatchOutput<T>>[3],
) {
  const output = await loadBatchOutput<T>(env, projectId, runType, schema);
  const r2Key = await saveToR2(env, projectId, runId, key, output);
  return { output, r2Key };
}

async function resolveTechsToResearch(
  env: Bindings,
  projectId: string,
): Promise<Array<{ name: string; docsUrl?: string; githubRepo?: string }>> {
  const batch1 = await loadBatchOutput(env, projectId, 'batch_1_research_stack', Batch1ResearchStackSchema);
  return batch1.technologies
    .map((technology) => ({
      name: technology.name,
      docsUrl: technology.docs_url || undefined,
      githubRepo: technology.github_url || undefined,
    }))
    .filter((technology) => !isDeveloperTool(technology.name.toLowerCase()));
}

export async function resolveBatch1StackTechnologiesForWorkflow(
  env: Bindings,
  projectId: string,
): Promise<Array<{ name: string; docsUrl?: string; githubRepo?: string }>> {
  return resolveTechsToResearch(env, projectId);
}

export class GenerationWorkflow extends WorkflowEntrypoint<Bindings, GenerationPayload> {
  async run(event: WorkflowEvent<GenerationPayload>, step: WorkflowStep) {
    const { payload } = event;
    const projectId = payload.projectId;
    const runId = payload.runId;
    const userId = payload.userId;
    const fastProvider = toProviderConfig(payload.fastProvider);
    const deepProvider = toProviderConfig(payload.deepProvider);

    try {
      const initialProject = await assertActiveRun(this.env, projectId, runId);
      const activeProjectForBatch1 = {
        ...initialProject,
        intake_answers: JSON.stringify({
          answers: Object.entries(payload.intakeAnswers || {}).map(([question, answer]) => ({
            question,
            answer,
          })),
        }),
      };
      const builderProfile = await loadBuilderProfileContext(userId, this.env);
      const projectBrief = await loadProjectBriefContext(this.env, projectId, userId, {
        rawDescription: initialProject.description || payload.description || '',
        projectStack: initialProject.stack,
        existingTools: builderProfile.declaredTools.map((tool) => tool.name),
      });

      let batch1Key: string | null = null;
      let batch2Key: string | null = null;
      let chunkStoreKey: string | null = null;
      let architectureKey: string | null = null;
      let planKey: string | null = null;
      let enrichmentsKey: string | null = null;

      let state = await resolveCurrentStatusToRun(this.env, projectId);

      if (state.statusToRun === 'queued') {
        batch1Key = await step.do('identify-stack', {
          retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
          timeout: '10 minutes',
        }, async () => {
          await assertActiveRun(this.env, projectId, runId);
          await executeBatch1(this.env, activeProjectForBatch1, fastProvider, runId, builderProfile, projectBrief);
          const batch1 = await saveBatchOutputSnapshot(
            this.env,
            projectId,
            runId,
            'batch-1-stack',
            'batch_1_research_stack',
            Batch1ResearchStackSchema,
          );
          return batch1.r2Key;
        });
      } else {
        batch1Key = await step.do('load-identify-stack', async () => {
          const batch1 = await saveBatchOutputSnapshot(
            this.env,
            projectId,
            runId,
            'batch-1-stack',
            'batch_1_research_stack',
            Batch1ResearchStackSchema,
          );
          return batch1.r2Key;
        });
      }

      state = await resolveCurrentStatusToRun(this.env, projectId);

      if (state.statusToRun === 'batch_1_research_stack') {
        let iteration = 0;
        let done = false;
        while (!done) {
          if (iteration >= MAX_BATCH2_WORKFLOW_STEPS) {
            throw new Error('Batch 2 exceeded the maximum workflow step iterations.');
          }

          const outcome = await step.do<Batch2LoopOutcome>(
            `batch2-research-${String(iteration + 1).padStart(3, '0')}`,
            {
              retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' },
              timeout: '15 minutes',
            },
            async () => {
              await assertActiveRun(this.env, projectId, runId);
              const project = await getProjectRow(this.env, projectId);
              if (!project) {
                throw new Error('Project not found.');
              }

              const result = await executeBatch2(
                this.env,
                project,
                fastProvider,
                deepProvider,
                runId,
                builderProfile,
                projectBrief,
                WORKFLOW_BATCH2_CHECKPOINT_INTERVAL,
              );

              if (result === 'checkpointed') {
                return { done: false };
              }

              const batch2 = await saveBatchOutputSnapshot(
                this.env,
                projectId,
                runId,
                'batch-2-research',
                'batch_2_fetch_and_read',
                Batch2FetchAndReadSchema,
              );

              return {
                done: true,
                batch2Key: batch2.r2Key,
              };
            },
          );

          if (outcome.done) {
            batch2Key = outcome.batch2Key;
            done = true;
          } else {
            iteration += 1;
          }
        }
      } else {
        batch2Key = await step.do('load-batch2-output', async () => {
          const batch2 = await saveBatchOutputSnapshot(
            this.env,
            projectId,
            runId,
            'batch-2-research',
            'batch_2_fetch_and_read',
            Batch2FetchAndReadSchema,
          );
          return batch2.r2Key;
        });
      }

      chunkStoreKey = await step.do('build-chunk-store', async () => {
        if (!batch2Key) {
          throw new Error('Batch 2 output key is missing.');
        }

        const batch2 = await loadFromR2<{
          chunk_store: Array<{ content: string; source: string; tool: string; technology: string }>;
        }>(this.env, batch2Key);
        return saveToR2(this.env, projectId, runId, 'chunk-store', batch2.chunk_store || []);
      });

      const techsToResearch = await step.do('resolve-stack-techs', async () => resolveTechsToResearch(this.env, projectId));
      await step.do('announce-stack-techs', async () => {
        const count = techsToResearch.length;
        await persistGenerationStreamEvent(this.env, {
          projectId,
          batchName: 'batch_2_fetch_and_read',
          event: {
            type: 'activity',
            icon: '✦',
            message:
              count > 0
                ? `Workflow research scope locked to ${count} stack technolog${count === 1 ? 'y' : 'ies'} (developer tools excluded).`
                : 'Workflow research scope has no stack technologies to fetch.',
            timestamp: new Date().toISOString(),
          },
        });
        return null;
      });

      state = await resolveCurrentStatusToRun(this.env, projectId);

      if (state.statusToRun === 'batch_2_fetch_and_read') {
        architectureKey = await step.do('generate-architecture', {
          retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' },
          timeout: '20 minutes',
        }, async () => {
          await assertActiveRun(this.env, projectId, runId);
          await executeBatch3(this.env, projectId, runId, deepProvider, initialProject, builderProfile, projectBrief);
          const architecture = await saveBatchOutputSnapshot(
            this.env,
            projectId,
            runId,
            'architecture',
            'batch_3_architect',
            Batch3ArchitectSchema,
          );
          return architecture.r2Key;
        });
      } else {
        architectureKey = await step.do('load-architecture-output', async () => {
          const architecture = await saveBatchOutputSnapshot(
            this.env,
            projectId,
            runId,
            'architecture',
            'batch_3_architect',
            Batch3ArchitectSchema,
          );
          return architecture.r2Key;
        });
      }

      let reviewApproved = await hasApprovedArchitectureReview(this.env, projectId);
      if (!reviewApproved) {
        await step.do('emit-review-checkpoint', async () => {
          await assertActiveRun(this.env, projectId, runId);
          await pauseForArchitectureReview(this.env, projectId, runId);
          return null;
        });

        const reviewEvent = await step.waitForEvent<ReviewApprovalEventPayload>(
          'await-architecture-approval',
          {
            type: WORKFLOW_EVENT_TYPE_ARCHITECTURE_APPROVED,
            timeout: '24 hours',
          },
        );

        if (!reviewEvent.approved) {
          await step.do('cancel-after-review', async () => {
            await markProjectCancelled(
              this.env,
              projectId,
              runId,
              reviewEvent.feedback?.trim() || 'Architecture was not approved by the builder.',
            );
            return null;
          });
          return;
        }

        await step.do('persist-review-feedback', async () => {
          await saveArchitectureReviewApproval(this.env, projectId, reviewEvent.feedback || '');
          await markProjectApproved(this.env, projectId, runId, fastProvider.providerId || null);
          await persistGenerationStreamEvent(this.env, {
            projectId,
            batchName: 'batch_4_plan_build',
            event: {
              type: 'activity',
              icon: '✦',
              message:
                reviewEvent.feedback?.trim()
                  ? 'Architecture approved with your adjustments — reshaping the build plan now.'
                  : 'Architecture approved — resuming plan generation.',
              timestamp: new Date().toISOString(),
            },
          });
          if (reviewEvent.preferredIde?.trim()) {
            await persistGenerationStreamEvent(this.env, {
              projectId,
              batchName: 'batch_4_plan_build',
              event: {
                type: 'activity',
                icon: '🛠️',
                message: `Preferred IDE noted for generation: ${reviewEvent.preferredIde.trim()}.`,
                timestamp: new Date().toISOString(),
              },
            });
          }
          return null;
        });

        reviewApproved = true;
      }

      state = await resolveCurrentStatusToRun(this.env, projectId);

      if (reviewApproved && state.statusToRun === 'approved') {
        planKey = await step.do('generate-plan', {
          retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' },
          timeout: '20 minutes',
        }, async () => {
          await assertActiveRun(this.env, projectId, runId);
          await executeBatch4(this.env, projectId, runId, deepProvider, builderProfile, projectBrief);
          const plan = await saveBatchOutputSnapshot(
            this.env,
            projectId,
            runId,
            'plan',
            'batch_4_plan_build',
            Batch4PlanBuildSchema,
          );
          return plan.r2Key;
        });
      } else {
        planKey = await step.do('load-plan-output', async () => {
          const plan = await saveBatchOutputSnapshot(
            this.env,
            projectId,
            runId,
            'plan',
            'batch_4_plan_build',
            Batch4PlanBuildSchema,
          );
          return plan.r2Key;
        });
      }

      state = await resolveCurrentStatusToRun(this.env, projectId);

      if (state.statusToRun === 'batch_4_plan_build') {
        let iteration = 0;
        let done = false;
        while (!done) {
          if (iteration >= MAX_BATCH5_WORKFLOW_STEPS) {
            throw new Error('Batch 5 exceeded the maximum workflow step iterations.');
          }

          const outcome = await step.do<Batch5LoopOutcome>(
            `batch5-enrich-${String(iteration + 1).padStart(3, '0')}`,
            {
              retries: { limit: 2, delay: '20 seconds', backoff: 'exponential' },
              timeout: '20 minutes',
            },
            async () => {
              await assertActiveRun(this.env, projectId, runId);
              const result = await executeBatch5(
                this.env,
                projectId,
                deepProvider,
                runId,
                builderProfile,
                projectBrief,
                WORKFLOW_BATCH5_CHECKPOINT_INTERVAL,
              );

              if (result === 'checkpointed') {
                return { done: false };
              }

              const enrichments = await saveBatchOutputSnapshot(
                this.env,
                projectId,
                runId,
                'step-enrichments',
                'batch_5_enrich_steps',
                Batch5EnrichStepsSchema,
              );
              return {
                done: true,
                enrichmentsKey: enrichments.r2Key,
              };
            },
          );

          if (outcome.done) {
            enrichmentsKey = outcome.enrichmentsKey;
            done = true;
          } else {
            iteration += 1;
          }
        }
      } else {
        enrichmentsKey = await step.do('load-enrichments-output', async () => {
          const enrichments = await saveBatchOutputSnapshot(
            this.env,
            projectId,
            runId,
            'step-enrichments',
            'batch_5_enrich_steps',
            Batch5EnrichStepsSchema,
          );
          return enrichments.r2Key;
        });
      }

      state = await resolveCurrentStatusToRun(this.env, projectId);

      if (state.statusToRun === 'batch_5_enrich_steps') {
        await step.do('generate-files', {
          retries: { limit: 2, delay: '15 seconds', backoff: 'exponential' },
          timeout: '15 minutes',
        }, async () => {
          await assertActiveRun(this.env, projectId, runId);
          await executeBatch6(this.env, projectId, runId, deepProvider, builderProfile, projectBrief);
          return null;
        });
      }

      state = await resolveCurrentStatusToRun(this.env, projectId);

      if (state.statusToRun === 'batch_6_generate_files') {
        await step.do('finalise', async () => {
          await assertActiveRun(this.env, projectId, runId);
          await finalizeProjectGeneration(this.env, projectId, runId);
          return null;
        });
      }

      return {
        batch1Key,
        batch2Key,
        chunkStoreKey,
        architectureKey,
        planKey,
        enrichmentsKey,
      };
    } catch (error) {
      if (error instanceof WorkflowRunStoppedError) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Generation workflow failed.';
      await markProjectFailed(this.env, projectId, runId, message);
      throw error;
    }
  }
}
