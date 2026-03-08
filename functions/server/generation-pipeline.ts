import type { ZodType } from 'zod';
import {
  Batch1ResearchStackSchema,
  Batch2FetchAndReadSchema,
  Batch3ArchitectSchema,
  Batch4PlanBuildSchema,
  Batch5EnrichStepsSchema,
  Batch6GenerateFilesSchema,
  SKILL_FILE_NAMES,
  type Batch1ResearchStack,
  type Batch2FetchAndRead,
  type Batch3Architect,
  type Batch4PlanBuild,
  type Batch5EnrichSteps,
  type Batch6GenerateFiles,
  schemaDescriptions,
} from './generation-schemas';
import {
  GENERATION_BATCHES,
  PREFERRED_IDES,
  type Bindings,
  type GenerationBatchName,
  type PreferredIde,
  type ProjectGenerationStatus,
  type ProviderType,
  type QueueExecutionContext,
  type QueueMessageBatch,
  type QueueMessageBody,
} from './types';
import { getBatchStartLabel, persistGenerationStreamEvent } from './generation-events';
import { callAIText, defaultModelForProvider } from './ai';
import { decrypt } from '../utils/crypto';
import { fetchAndParse, type GitHubResearchResult, type ResearchResult } from '../utils/fetch-url';

type ProviderConfig = {
  providerId: string;
  providerType: ProviderType;
  model: string;
  baseUrl: string | null;
  apiKey: string;
};

type ProjectRecord = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  project_type: string | null;
  stack: string | null;
  generation_status: string | null;
};

type AgentRunRecord = {
  id: string;
  input: string | null;
  output: string | null;
};

type ActivityKind = 'architecture' | 'complete' | 'fetch' | 'github' | 'system' | 'warning' | 'writing';

export type ArchitectureReviewStackCard = {
  technology: string;
  package_name: string;
  version: string;
  reason: string;
  gotcha_issue?: string;
  gotcha_mitigation?: string;
};

export type ArchitectureReviewDataModelTable = {
  table: string;
  columns: string[];
};

export type ArchitectureReviewPayload = {
  project_id: string;
  project_name: string;
  project_type: string;
  recommended_stack: Batch3Architect['recommended_stack'];
  stack_cards: ArchitectureReviewStackCard[];
  data_model: ArchitectureReviewDataModelTable[];
  preferred_ide: PreferredIde;
  review_feedback: string;
  review_feedback_provided: boolean;
};

type ArchitectureReviewContext = {
  runId: string;
  input: Record<string, unknown>;
  adr: Batch3Architect;
  reviewFeedback: string;
  reviewFeedbackProvided: boolean;
  preferredIde: PreferredIde;
  providerId?: string;
};

type PlanStepEnrichment = Batch5EnrichSteps['enrichments'][number];

type EnrichedPlanStep = Batch4PlanBuild['stages'][number]['steps'][number] & {
  ai_output: string;
  prompts: PlanStepEnrichment['prompts'];
};

type EnrichedPlanStage = Omit<Batch4PlanBuild['stages'][number], 'steps'> & {
  steps: EnrichedPlanStep[];
};

type EnrichedPlan = Omit<Batch4PlanBuild, 'stages'> & {
  stages: EnrichedPlanStage[];
};

type ActiveStepSummary = {
  id: string;
  title: string;
  objective: string;
  done_when: string;
  stage_title: string;
  order_index: number;
};

class GenerationPipelineError extends Error {
  constructor(message: string, readonly alreadyPersisted = false) {
    super(message);
    this.name = 'GenerationPipelineError';
  }
}

const batchCompletionMessages: Record<GenerationBatchName, string> = {
  batch_1_research_stack: 'Mapped the implied stack and source URLs.',
  batch_2_fetch_and_read: 'Fetched docs, readmes, and recent change notes.',
  batch_3_architect: 'Turned the research corpus into an architecture decision record.',
  batch_4_plan_build: 'Generated the full staged build plan.',
  batch_5_enrich_steps: 'Prepared AI guidance and prompts for every step.',
  batch_6_generate_files: 'Created the downloadable skill files.',
};

const batchSequenceIndexes = Object.fromEntries(
  GENERATION_BATCHES.map((batchName, index) => [batchName, index + 1]),
) as Record<GenerationBatchName, number>;

export function getBatchCompletionMessage(batchName: GenerationBatchName) {
  return batchCompletionMessages[batchName];
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function serializeJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return typeof value === 'string' ? value : JSON.stringify(value);
}

function normalizePreferredIde(value: unknown): PreferredIde {
  return typeof value === 'string' && PREFERRED_IDES.includes(value as PreferredIde)
    ? (value as PreferredIde)
    : 'cursor';
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function formatResearchFailure(result: ResearchResult) {
  if (result.kind !== 'error') {
    return '';
  }

  const statusSuffix = result.status !== undefined ? ` (${result.status})` : '';
  return `Failed to fetch ${result.url}${statusSuffix}${result.message ? `: ${result.message}` : '.'}`;
}

function formatGitHubBreakingChanges(result: GitHubResearchResult) {
  const sections: string[] = [];

  if (result.releases.length > 0) {
    sections.push(
      result.releases
        .map((release) => `Release ${release.tag_name} (${release.published_at}): ${release.body}`)
        .join('\n\n'),
    );
  }

  if (result.recent_issues.length > 0) {
    sections.push(
      result.recent_issues
        .map((issue) => `Open issue (${issue.created_at}) ${issue.title}: ${issue.body}`)
        .join('\n\n'),
    );
  }

  if (result.partial_errors.length > 0) {
    sections.push(
      result.partial_errors
        .map((error) => `GitHub fetch failed for ${error.url}${error.status ? ` (${error.status})` : ''}.`)
        .join('\n'),
    );
  }

  return sections.join('\n\n');
}

function formatCompactNumber(value: number) {
  if (value >= 1_000_000) {
    return `${Math.round((value / 1_000_000) * 10) / 10}m`;
  }

  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }

  return `${value}`;
}

function formatRelativeAge(dateString: string) {
  const timestamp = Date.parse(dateString);
  if (Number.isNaN(timestamp)) {
    return 'recently';
  }

  const diffMs = Math.max(Date.now() - timestamp, 0);
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays > 0) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }

  if (diffHours > 0) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  }

  if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  }

  return 'just now';
}

function buildMatchTokens(...values: Array<string | null | undefined>) {
  const tokens = new Set<string>();

  values.forEach((value) => {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) {
      return;
    }

    tokens.add(normalized);
    tokens.add(normalized.replace(/^@/, ''));

    normalized
      .split(/[\/\s\-_]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1)
      .forEach((token) => {
        tokens.add(token);
        tokens.add(token.replace(/^@/, ''));
      });
  });

  return Array.from(tokens).filter((token) => token.length > 1);
}

function findMatchingGotcha(
  adr: Batch3Architect,
  integration: Batch3Architect['integrations'][number],
) {
  const integrationTokens = buildMatchTokens(integration.service, integration.package_name);

  return adr.gotchas.find((gotcha) => {
    const technologyTokens = buildMatchTokens(gotcha.technology);
    return integrationTokens.some((integrationToken) =>
      technologyTokens.some(
        (technologyToken) =>
          integrationToken.includes(technologyToken) || technologyToken.includes(integrationToken),
      ),
    );
  });
}

function fallbackStackCardsFromRecommendedStack(adr: Batch3Architect): ArchitectureReviewStackCard[] {
  return Object.entries(adr.recommended_stack).map(([category, selection]) => {
    const versionMatch = selection.match(/\bv?\d+(?:\.\d+)+(?:[-\w.]*)?/i);
    const version = versionMatch?.[0] || 'See ADR';
    const packageName = selection.replace(versionMatch?.[0] || '', '').replace(/[()]/g, '').trim() || selection;

    return {
      technology: category.replace(/^\w/, (character) => character.toUpperCase()),
      package_name: packageName,
      version,
      reason: `Recommended ${category} choice for this architecture.`,
    };
  });
}

function buildArchitectureReviewPayload(
  projectId: string,
  adr: Batch3Architect,
  input: Record<string, unknown>,
): ArchitectureReviewPayload {
  const seen = new Set<string>();
  const stackCards = adr.integrations.reduce<ArchitectureReviewStackCard[]>((cards, integration) => {
    const key = `${integration.service}::${integration.package_name}::${integration.version}`.toLowerCase();
    if (seen.has(key)) {
      return cards;
    }

    seen.add(key);
    const gotcha = findMatchingGotcha(adr, integration);
    cards.push({
      technology: integration.service,
      package_name: integration.package_name,
      version: integration.version,
      reason: integration.purpose,
      gotcha_issue: gotcha?.issue,
      gotcha_mitigation: gotcha?.mitigation,
    });

    return cards;
  }, []);

  const reviewFeedback = optionalText(input.review_feedback) || '';
  const reviewFeedbackProvided = toBoolean(input.review_feedback_provided) || reviewFeedback.length > 0;
  const preferredIde = normalizePreferredIde(input.preferred_ide);

  return {
    project_id: projectId,
    project_name: adr.project_name,
    project_type: adr.project_type,
    recommended_stack: adr.recommended_stack,
    stack_cards: stackCards.length > 0 ? stackCards : fallbackStackCardsFromRecommendedStack(adr),
    data_model: adr.data_model.map((table) => ({
      table: table.table,
      columns: table.columns.map((column) => `${column.name} (${column.type})`),
    })),
    preferred_ide: preferredIde,
    review_feedback: reviewFeedback,
    review_feedback_provided: reviewFeedbackProvided,
  };
}

function countPlanSteps(plan: Batch4PlanBuild) {
  return plan.stages.reduce((total, stage) => total + stage.steps.length, 0);
}

function formatPreferredIdeLabel(preferredIde: PreferredIde) {
  switch (preferredIde) {
    case 'windsurf':
      return 'Windsurf';
    case 'vscode':
      return 'VS Code / GitHub Copilot';
    case 'claude_desktop':
      return 'Claude Desktop';
    case 'cursor':
    default:
      return 'Cursor';
  }
}

function mergePlanWithEnrichments(plan: Batch4PlanBuild, enrichments: Batch5EnrichSteps['enrichments']): EnrichedPlan {
  const enrichmentMap = new Map(enrichments.map((enrichment) => [enrichment.step_id, enrichment]));

  return {
    ...plan,
    stages: plan.stages.map((stage) => ({
      ...stage,
      steps: stage.steps.map((step) => {
        const enrichment = enrichmentMap.get(step.id);

        return {
          ...step,
          ai_output: enrichment?.ai_output || '',
          prompts: enrichment?.prompts || [],
        };
      }),
    })),
  };
}

function inferGateFlag(source: {
  title?: string | null;
  objective?: string | null;
  why_it_matters?: string | null;
  category?: string | null;
  done_when?: string | null;
}): boolean {
  const haystack = [source.title, source.objective, source.why_it_matters, source.category, source.done_when]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return [
    'security',
    'auth',
    'authentication',
    'deploy',
    'deployment',
    'production',
    'billing',
    'payment',
    'secret',
    'permission',
    'database change',
    'database migration',
    'environment variable',
  ].some((keyword) => haystack.includes(keyword));
}

async function runStatementsInChunks(db: Bindings['DB'], statements: Array<any>, chunkSize = 50) {
  for (let index = 0; index < statements.length; index += chunkSize) {
    await db.batch(statements.slice(index, index + chunkSize));
  }
}

async function getProjectById(env: Bindings, projectId: string) {
  return env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first() as ProjectRecord;
}

async function updateProjectGenerationStatus(
  env: Bindings,
  projectId: string,
  generationStatus: ProjectGenerationStatus,
  options: {
    generationError?: string | null;
    markStarted?: boolean;
    markCompleted?: boolean;
  } = {},
) {
  const generationError = options.generationError ?? null;
  await env.DB.prepare(`
    UPDATE projects
    SET generation_status = ?,
        generation_error = ?,
        generation_started_at = CASE
          WHEN ? = 1 AND generation_started_at IS NULL THEN datetime("now")
          ELSE generation_started_at
        END,
        generation_completed_at = CASE
          WHEN ? = 1 THEN datetime("now")
          ELSE generation_completed_at
        END,
        updated_at = datetime("now")
    WHERE id = ?
  `)
    .bind(
      generationStatus,
      generationError,
      options.markStarted ? 1 : 0,
      options.markCompleted ? 1 : 0,
      projectId,
    )
    .run();
}

async function insertAgentRun(
  env: Bindings,
  payload: {
    projectId: string;
    runType: GenerationBatchName;
    status: 'complete' | 'failed';
    input?: string | null;
    output?: string | null;
    provider?: string | null;
    model?: string | null;
    sequenceIndex: number;
    attemptCount: number;
  },
) {
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO agent_runs (
      id, project_id, run_type, status, input, output, provider, model, sequence_index, attempt_count, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))
  `)
    .bind(
      id,
      payload.projectId,
      payload.runType,
      payload.status,
      payload.input || null,
      payload.output || null,
      payload.provider || null,
      payload.model || null,
      payload.sequenceIndex,
      payload.attemptCount,
    )
    .run();

  return id;
}

type LegacyPipelineEventType =
  | 'activity'
  | 'batch_completed'
  | 'fetch_attempt'
  | 'review_required'
  | 'generation_complete'
  | 'generation_failed';

function activityIconForKind(kind: ActivityKind) {
  switch (kind) {
    case 'fetch':
      return '🔍';
    case 'github':
      return '📦';
    case 'warning':
      return '⚠️';
    case 'architecture':
      return '🏗️';
    case 'complete':
      return '✅';
    case 'writing':
      return '📝';
    case 'system':
    default:
      return '✦';
  }
}

async function emitBatchStart(env: Bindings, projectId: string, batchName: GenerationBatchName) {
  await persistGenerationStreamEvent(env, {
    projectId,
    batchName,
    event: {
      type: 'batch_start',
      batch: batchName,
      label: getBatchStartLabel(batchName),
    },
  });
}

async function insertGenerationEvent(
  env: Bindings,
  payload: {
    projectId: string;
    eventType: LegacyPipelineEventType;
    batchName?: GenerationBatchName;
    body: Record<string, unknown>;
  },
) {
  switch (payload.eventType) {
    case 'activity':
      await persistGenerationStreamEvent(env, {
        projectId: payload.projectId,
        batchName: payload.batchName,
        event: {
          type: 'activity',
          icon: activityIconForKind((payload.body.kind as ActivityKind | undefined) || 'system'),
          message: asText(payload.body.message),
          timestamp: asText(payload.body.timestamp, new Date().toISOString()),
        },
      });
      return;
    case 'fetch_attempt': {
      const source = asText(payload.body.source, 'fetch');
      const technology = optionalText(payload.body.technology);
      const url = asText(payload.body.url);
      const durationMs = Number(payload.body.duration_ms) || 0;
      const status = payload.body.status;
      const target = technology || url;

      await persistGenerationStreamEvent(env, {
        projectId: payload.projectId,
        batchName: payload.batchName,
        event: {
          type: 'activity',
          icon: source === 'github' ? '📦' : '🔍',
          message: `${source === 'github' ? 'Checking' : 'Reading'} ${target}${status ? ` — ${status}` : ''}${durationMs ? ` (${durationMs}ms)` : ''}`,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }
    case 'batch_completed':
      await persistGenerationStreamEvent(env, {
        projectId: payload.projectId,
        batchName: payload.batchName,
        event: {
          type: 'batch_complete',
          batch: asText(payload.body.batch || payload.batchName) as GenerationBatchName,
          duration_ms: Number(payload.body.duration_ms) || 0,
        },
      });
      return;
    case 'review_required':
      if (payload.body.adr) {
        await persistGenerationStreamEvent(env, {
          projectId: payload.projectId,
          batchName: payload.batchName,
          event: {
            type: 'checkpoint',
            adr: payload.body.adr as Batch3Architect,
          },
        });
      }
      return;
    case 'generation_complete':
      await persistGenerationStreamEvent(env, {
        projectId: payload.projectId,
        batchName: payload.batchName,
        event: {
          type: 'pipeline_complete',
          project_id: asText(payload.body.project_id, payload.projectId),
        },
      });
      return;
    case 'generation_failed':
      await persistGenerationStreamEvent(env, {
        projectId: payload.projectId,
        batchName: payload.batchName,
        event: {
          type: 'pipeline_failed',
          error: asText(payload.body.error, 'Project generation failed.'),
        },
      });
      return;
  }
}

async function logActivity(
  env: Bindings,
  payload: {
    projectId: string;
    batchName: GenerationBatchName;
    kind: ActivityKind;
    message: string;
  },
) {
  await insertGenerationEvent(env, {
    projectId: payload.projectId,
    eventType: 'activity',
    batchName: payload.batchName,
    body: {
      batch: payload.batchName,
      kind: payload.kind,
      message: payload.message,
      timestamp: new Date().toISOString(),
    },
  });
}

async function loadBatchRunRecord(env: Bindings, projectId: string, runType: GenerationBatchName) {
  const record = await env.DB.prepare(`
    SELECT id, input, output
    FROM agent_runs
    WHERE project_id = ? AND run_type = ? AND status = 'complete'
    ORDER BY sequence_index DESC, completed_at DESC
    LIMIT 1
  `)
    .bind(projectId, runType)
    .first();

  return record as AgentRunRecord | null;
}

async function loadBatchOutput<T>(
  env: Bindings,
  projectId: string,
  runType: GenerationBatchName,
  schema: ZodType<T>,
) {
  const typedRecord = await loadBatchRunRecord(env, projectId, runType);

  if (!typedRecord?.output) {
    throw new GenerationPipelineError(`Missing output for ${runType}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(typedRecord.output);
  } catch {
    throw new GenerationPipelineError(`Stored output for ${runType} is not valid JSON.`);
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    throw new GenerationPipelineError(`Stored output for ${runType} failed validation.`);
  }

  return validated.data;
}

async function loadArchitectureReviewContext(env: Bindings, projectId: string): Promise<ArchitectureReviewContext> {
  const architectRun = await loadBatchRunRecord(env, projectId, 'batch_3_architect');

  if (!architectRun?.id || !architectRun.output) {
    throw new GenerationPipelineError('Architecture review is not ready yet.');
  }

  let parsedOutput: unknown;
  try {
    parsedOutput = JSON.parse(architectRun.output);
  } catch {
    throw new GenerationPipelineError('Stored architecture output is not valid JSON.');
  }

  const validatedAdr = Batch3ArchitectSchema.safeParse(parsedOutput);
  if (!validatedAdr.success) {
    throw new GenerationPipelineError('Stored architecture output failed validation.');
  }

  const parsedInput = parseJsonObject(architectRun.input);
  const reviewFeedback = optionalText(parsedInput.review_feedback) || '';

  return {
    runId: architectRun.id,
    input: parsedInput,
    adr: validatedAdr.data,
    reviewFeedback,
    reviewFeedbackProvided: toBoolean(parsedInput.review_feedback_provided) || reviewFeedback.length > 0,
    preferredIde: normalizePreferredIde(parsedInput.preferred_ide),
    providerId: optionalText(parsedInput.provider_id) || undefined,
  };
}

export async function getArchitectureReviewPayload(env: Bindings, projectId: string) {
  const context = await loadArchitectureReviewContext(env, projectId);
  return buildArchitectureReviewPayload(projectId, context.adr, context.input);
}

export async function saveArchitectureReviewApproval(
  env: Bindings,
  projectId: string,
  feedback: string,
  preferredIde: PreferredIde,
) {
  const context = await loadArchitectureReviewContext(env, projectId);
  const trimmedFeedback = feedback.trim();
  const nextInput = {
    ...context.input,
    preferred_ide: preferredIde,
    review_feedback: trimmedFeedback,
    review_feedback_provided: trimmedFeedback.length > 0,
    review_feedback_updated_at: new Date().toISOString(),
  };

  await env.DB.prepare('UPDATE agent_runs SET input = ? WHERE id = ?')
    .bind(JSON.stringify(nextInput), context.runId)
    .run();

  await updateProjectGenerationStatus(env, projectId, 'approved', {
    generationError: null,
    markStarted: true,
  });

  return {
    feedback: trimmedFeedback,
    feedbackProvided: trimmedFeedback.length > 0,
    preferredIde,
    providerId: context.providerId,
  };
}

async function resolveProviderConfiguration(
  env: Bindings,
  userId: string,
  providerId?: string,
): Promise<ProviderConfig> {
  const providerRecord = providerId
    ? await env.DB.prepare('SELECT * FROM ai_providers WHERE id = ? AND user_id = ?').bind(providerId, userId).first()
    : await env.DB.prepare(
        'SELECT * FROM ai_providers WHERE user_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1',
      )
        .bind(userId)
        .first();

  const typedProviderRecord = providerRecord as Record<string, unknown> | null;

  if (!typedProviderRecord) {
    throw new GenerationPipelineError('No AI provider is configured yet. Add one in Settings first.');
  }

  const apiKey = await decrypt(asText(typedProviderRecord.api_key_enc), env.ENCRYPTION_KEY);
  const providerType = asText(typedProviderRecord.provider) as ProviderType;

  return {
    providerId: asText(typedProviderRecord.id),
    providerType,
    model: optionalText(typedProviderRecord.model) || defaultModelForProvider(providerType),
    baseUrl: optionalText(typedProviderRecord.base_url),
    apiKey,
  };
}

function formatValidationRetryPrompt(basePrompt: string, previousResponse: string, schemaDescription: string) {
  return `${basePrompt}

your previous response failed validation — here is what you returned and here is the schema you must follow

Previous response:
${previousResponse}

Required schema:
${schemaDescription}`;
}

async function callValidatedBatch<T>(
  provider: ProviderConfig,
  options: {
    runType: GenerationBatchName;
    systemPrompt: string;
    prompt: string;
    schema: ZodType<T>;
    schemaDescription: string;
  },
) {
  let prompt = options.prompt;
  let lastError = 'The AI response was empty.';

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { text } = await callAIText({
      providerType: provider.providerType,
      apiKey: provider.apiKey,
      model: provider.model,
      baseUrl: provider.baseUrl,
      system: options.systemPrompt,
      prompt,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      lastError = `The AI response for ${options.runType} was not valid JSON.`;
      if (attempt === 1) {
        prompt = formatValidationRetryPrompt(options.prompt, text, options.schemaDescription);
        continue;
      }

      throw new GenerationPipelineError(`${lastError}\nRaw response: ${text}`);
    }

    const validated = options.schema.safeParse(parsed);
    if (validated.success) {
      return {
        data: validated.data,
        rawResponse: JSON.stringify(validated.data),
        attemptCount: attempt,
      };
    }

    lastError = `Validation failed for ${options.runType}: ${validated.error.message}`;
    if (attempt === 1) {
      prompt = formatValidationRetryPrompt(options.prompt, text, options.schemaDescription);
      continue;
    }

    throw new GenerationPipelineError(`${lastError}\nRaw response: ${text}`);
  }

  throw new GenerationPipelineError(lastError);
}

async function failBatch(
  env: Bindings,
  projectId: string,
  provider: ProviderConfig,
  runType: GenerationBatchName,
  input: unknown,
  message: string,
  attemptCount: number,
) {
  await insertAgentRun(env, {
    projectId,
    runType,
    status: 'failed',
    input: serializeJson(input),
    output: message,
    provider: provider.providerType,
    model: provider.model,
    sequenceIndex: batchSequenceIndexes[runType],
    attemptCount,
  });

  await updateProjectGenerationStatus(env, projectId, 'failed', {
    generationError: message,
    markStarted: true,
    markCompleted: true,
  });

  await insertGenerationEvent(env, {
    projectId,
    eventType: 'generation_failed',
    batchName: runType,
    body: {
      batch: runType,
      error: message,
      message: `Failed during ${runType}.`,
      status: 'failed',
    },
  });

  throw new GenerationPipelineError(message, true);
}

async function completeBatch<T>(
  env: Bindings,
  projectId: string,
  provider: ProviderConfig,
  runType: GenerationBatchName,
  input: unknown,
  data: T,
  attemptCount: number,
  storedOutput: unknown = data,
  durationMs = 0,
) {
  await insertAgentRun(env, {
    projectId,
    runType,
    status: 'complete',
    input: serializeJson(input),
    output: JSON.stringify(storedOutput),
    provider: provider.providerType,
    model: provider.model,
    sequenceIndex: batchSequenceIndexes[runType],
    attemptCount,
  });

  await updateProjectGenerationStatus(env, projectId, runType, {
    generationError: null,
    markStarted: true,
  });

  await insertGenerationEvent(env, {
    projectId,
    eventType: 'batch_completed',
    batchName: runType,
    body: {
      batch: runType,
      duration_ms: durationMs,
    },
  });
}

async function materializePlanStructure(env: Bindings, projectId: string, plan: Batch4PlanBuild) {
  const statements: Array<any> = [
    env.DB.prepare('DELETE FROM checklist_items WHERE step_id IN (SELECT id FROM steps WHERE project_id = ?)').bind(projectId),
    env.DB.prepare('DELETE FROM edges WHERE project_id = ?').bind(projectId),
    env.DB.prepare('DELETE FROM steps WHERE project_id = ?').bind(projectId),
    env.DB.prepare('DELETE FROM stages WHERE project_id = ?').bind(projectId),
    env.DB.prepare('DELETE FROM plans WHERE project_id = ?').bind(projectId),
    env.DB.prepare('INSERT INTO plans (id, project_id, version, canvas_state) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), projectId, 1, JSON.stringify({ x: 0, y: 0, zoom: 1 })),
  ];

  let globalOrderIndex = 0;

  for (const stage of plan.stages) {
    statements.push(
      env.DB.prepare('INSERT INTO stages (id, project_id, title, type, order_index, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(stage.id, projectId, stage.title, stage.type, stage.order_index, stage.order_index === 0 ? 'active' : 'locked'),
    );

    stage.steps.forEach((step, stepIndex) => {
      const isGate = step.is_gate || inferGateFlag({
        title: step.title,
        objective: step.objective,
        why_it_matters: step.why_it_matters,
        category: step.category || stage.type,
        done_when: step.done_when,
      });

      statements.push(
        env.DB.prepare(`
          INSERT INTO steps (
            id, project_id, stage_id, title, type, category, position_x, position_y, status,
            is_gate, risk_level, order_index, objective, why_it_matters, suggested_tools, done_when,
            ai_output, prompts, is_ai_enriched
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          step.id,
          projectId,
          stage.id,
          step.title,
          step.type || 'task',
          step.category || stage.type,
          stepIndex * 250,
          stage.order_index * 400 + 100,
          stage.order_index === 0 && stepIndex === 0 ? 'active' : 'locked',
          isGate ? 1 : 0,
          step.risk_level || 'low',
          globalOrderIndex,
          step.objective || '',
          step.why_it_matters || '',
          JSON.stringify(step.suggested_tools || []),
          step.done_when || '',
          null,
          JSON.stringify([]),
          0,
        ),
      );

      step.checklist.forEach((item, checklistIndex) => {
        statements.push(
          env.DB.prepare(`
            INSERT INTO checklist_items (id, step_id, label, is_required, is_completed, order_index)
            VALUES (?, ?, ?, ?, 0, ?)
          `).bind(item.id, step.id, item.label, item.is_required ? 1 : 0, checklistIndex),
        );
      });

      globalOrderIndex += 1;
    });
  }

  for (const edge of plan.edges || []) {
    statements.push(
      env.DB.prepare(`
        INSERT INTO edges (id, project_id, source_step_id, target_step_id, edge_type)
        VALUES (?, ?, ?, ?, ?)
      `).bind(edge.id, projectId, edge.source_step_id, edge.target_step_id, edge.edge_type || 'default'),
    );
  }

  await runStatementsInChunks(env.DB, statements);
}

async function applyStepEnrichments(env: Bindings, projectId: string, enrichments: Batch5EnrichSteps['enrichments']) {
  const statements = enrichments.map((enrichment) =>
    env.DB.prepare(`
      UPDATE steps
      SET ai_output = ?,
          prompts = ?,
          is_ai_enriched = 1,
          status = CASE
            WHEN is_gate = 1 AND status = 'active' THEN 'needs_review'
            ELSE status
          END,
          updated_at = datetime("now")
      WHERE project_id = ? AND id = ?
    `).bind(
      enrichment.ai_output,
      JSON.stringify(enrichment.prompts),
      projectId,
      enrichment.step_id,
    ),
  );

  await runStatementsInChunks(env.DB, statements);
}

async function persistGeneratedFiles(env: Bindings, projectId: string, files: Batch6GenerateFiles['files']) {
  const statements: Array<any> = [env.DB.prepare('DELETE FROM project_files WHERE project_id = ?').bind(projectId)];

  const orderedFiles = [...files].sort(
    (left, right) => SKILL_FILE_NAMES.indexOf(left.filename) - SKILL_FILE_NAMES.indexOf(right.filename),
  );

  for (const file of orderedFiles) {
    statements.push(
      env.DB.prepare(`
        INSERT INTO project_files (id, project_id, filename, content)
        VALUES (?, ?, ?, ?)
      `).bind(crypto.randomUUID(), projectId, file.filename, file.content),
    );
  }

  await runStatementsInChunks(env.DB, statements);
}

async function loadCurrentActiveStep(env: Bindings, projectId: string): Promise<ActiveStepSummary | null> {
  const activeStep = await env.DB.prepare(`
    SELECT
      steps.id,
      steps.title,
      steps.objective,
      steps.done_when,
      steps.order_index,
      stages.title AS stage_title
    FROM steps
    INNER JOIN stages ON stages.id = steps.stage_id
    WHERE steps.project_id = ? AND steps.status = 'active'
    ORDER BY steps.order_index ASC
    LIMIT 1
  `)
    .bind(projectId)
    .first();

  if (activeStep) {
    return {
      id: asText(activeStep.id),
      title: asText(activeStep.title),
      objective: asText(activeStep.objective),
      done_when: asText(activeStep.done_when),
      stage_title: asText(activeStep.stage_title),
      order_index: Number(activeStep.order_index) || 0,
    };
  }

  const fallbackStep = await env.DB.prepare(`
    SELECT
      steps.id,
      steps.title,
      steps.objective,
      steps.done_when,
      steps.order_index,
      stages.title AS stage_title
    FROM steps
    INNER JOIN stages ON stages.id = steps.stage_id
    WHERE steps.project_id = ?
    ORDER BY steps.order_index ASC
    LIMIT 1
  `)
    .bind(projectId)
    .first();

  if (!fallbackStep) {
    return null;
  }

  return {
    id: asText(fallbackStep.id),
    title: asText(fallbackStep.title),
    objective: asText(fallbackStep.objective),
    done_when: asText(fallbackStep.done_when),
    stage_title: asText(fallbackStep.stage_title),
    order_index: Number(fallbackStep.order_index) || 0,
  };
}

async function updateProjectMetadataFromAdr(env: Bindings, projectId: string, adr: Batch3Architect) {
  await env.DB.prepare(`
    UPDATE projects
    SET name = ?, project_type = ?, stack = ?, updated_at = datetime("now")
    WHERE id = ?
  `)
    .bind(
      adr.project_name,
      adr.project_type,
      JSON.stringify(adr.recommended_stack),
      projectId,
    )
    .run();
}

async function executeBatch1(env: Bindings, project: ProjectRecord, provider: ProviderConfig) {
  const startedAt = Date.now();
  const input = {
    description: project.description || '',
  };

  await emitBatchStart(env, project.id, 'batch_1_research_stack');
  await logActivity(env, {
    projectId: project.id,
    batchName: 'batch_1_research_stack',
    kind: 'fetch',
    message: 'Scanning your brief for technologies, services, and infrastructure choices...',
  });

  const systemPrompt =
    'You are Scrimble’s stack research scout. Infer every technology, library, framework, hosted service, and infrastructure tool implied by the project description. Return only valid JSON.';
  const prompt = `Project description:
${project.description || 'No description provided.'}

Identify the stack implied by the idea. For each technology, provide:
- name
- official docs URL
- GitHub repository URL
- changelog or releases URL

Only include technologies that matter to implementation.`;

  try {
    const result = await callValidatedBatch(provider, {
      runType: 'batch_1_research_stack',
      systemPrompt,
      prompt,
      schema: Batch1ResearchStackSchema,
      schemaDescription: schemaDescriptions.batch_1_research_stack,
    });

    await completeBatch(
      env,
      project.id,
      provider,
      'batch_1_research_stack',
      input,
      result.data,
      result.attemptCount,
      result.data,
      Date.now() - startedAt,
    );
    await logActivity(env, {
      projectId: project.id,
      batchName: 'batch_1_research_stack',
      kind: 'complete',
      message: `Stack candidates identified — ${result.data.technologies.length} technologies queued for research.`,
    });
  } catch (error) {
    await failBatch(
      env,
      project.id,
      provider,
      'batch_1_research_stack',
      input,
      error instanceof Error ? error.message : 'Batch 1 failed.',
      2,
    );
  }
}

async function executeBatch2(env: Bindings, projectId: string, provider: ProviderConfig) {
  const startedAt = Date.now();
  const batch1 = await loadBatchOutput(env, projectId, 'batch_1_research_stack', Batch1ResearchStackSchema);
  const fetchedSources = [];

  await emitBatchStart(env, projectId, 'batch_2_fetch_and_read');
  await logActivity(env, {
    projectId,
    batchName: 'batch_2_fetch_and_read',
    kind: 'fetch',
    message: `Reading the docs for ${batch1.technologies.length} technolog${batch1.technologies.length === 1 ? 'y' : 'ies'}...`,
  });

  for (const technology of batch1.technologies) {
    const logFetchAttempt = (attempt: {
      url: string;
      source: string;
      status: string | number;
      duration_ms: number;
    }) =>
      insertGenerationEvent(env, {
        projectId,
        eventType: 'fetch_attempt',
        batchName: 'batch_2_fetch_and_read',
        body: {
          ...attempt,
          batch: 'batch_2_fetch_and_read',
          technology: technology.name,
        },
      });

    await logActivity(env, {
      projectId,
      batchName: 'batch_2_fetch_and_read',
      kind: 'fetch',
      message: `Reading ${technology.name} documentation...`,
    });

    const docsResult = await fetchAndParse(technology.docs_url, {
      githubToken: env.GITHUB_TOKEN || null,
      onLog: logFetchAttempt,
    });
    if (docsResult.kind === 'error') {
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        kind: 'warning',
        message: `Could not read ${technology.name} documentation — continuing with the rest of the research.`,
      });
    }

    const changelogResult = await fetchAndParse(technology.changelog_url, {
      githubToken: env.GITHUB_TOKEN || null,
      onLog: logFetchAttempt,
    });
    if (changelogResult.kind === 'error') {
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        kind: 'warning',
        message: `Could not read ${technology.name} release notes — keeping the fetch moving.`,
      });
    }

    const githubResult = await fetchAndParse(technology.github_url, {
      githubToken: env.GITHUB_TOKEN || null,
      onLog: logFetchAttempt,
    });

    if (githubResult.kind === 'github_repo') {
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        kind: 'github',
        message: `Checking ${githubResult.repo.owner}/${githubResult.repo.repo} on GitHub — ${formatCompactNumber(githubResult.metadata.stars)} stars, updated ${formatRelativeAge(githubResult.metadata.last_push_date)}`,
      });

      if (githubResult.latest_version !== 'Unknown') {
        await logActivity(env, {
          projectId,
          batchName: 'batch_2_fetch_and_read',
          kind: 'github',
          message: `Checking ${githubResult.repo.owner}/${githubResult.repo.repo} — latest release ${githubResult.latest_version}`,
        });
      }

      if (githubResult.recent_issues.length > 0) {
        await logActivity(env, {
          projectId,
          batchName: 'batch_2_fetch_and_read',
          kind: 'warning',
          message: `${githubResult.recent_issues.length} recent bug or breaking-change issue${githubResult.recent_issues.length === 1 ? '' : 's'} surfaced for ${githubResult.repo.owner}/${githubResult.repo.repo}.`,
        });
      }
    } else {
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        kind: 'warning',
        message: `Could not inspect ${technology.name} on GitHub — continuing with the rest of the sources.`,
      });
    }

    const docsContent = docsResult.kind === 'document' ? docsResult.text : formatResearchFailure(docsResult);
    const changelogContent =
      changelogResult.kind === 'document' ? changelogResult.text : formatResearchFailure(changelogResult);

    fetchedSources.push({
      technology: technology.name,
      docs_url: technology.docs_url,
      github_url: technology.github_url,
      changelog_url: technology.changelog_url,
      docs_content: docsContent,
      changelog_content: changelogContent,
      github_readme: githubResult.kind === 'github_repo' ? githubResult.readme : formatResearchFailure(githubResult),
      latest_version: githubResult.kind === 'github_repo' ? githubResult.latest_version : 'Unknown',
      last_commit_date: githubResult.kind === 'github_repo' ? githubResult.metadata.last_push_date : 'Unknown',
      open_issues_count: githubResult.kind === 'github_repo' ? githubResult.metadata.open_issues_count : 0,
      recent_breaking_changes:
        githubResult.kind === 'github_repo'
          ? [changelogContent, formatGitHubBreakingChanges(githubResult)].filter(Boolean).join('\n\n')
          : [changelogContent, formatResearchFailure(githubResult)].filter(Boolean).join('\n\n'),
    });
  }

  const input = {
    technologies: batch1.technologies,
    fetched_sources: fetchedSources,
  };

  const systemPrompt =
    'You are Scrimble’s technical research analyst. Turn fetched docs, readmes, metadata, and changelog snippets into a structured research corpus. Keep the important technical details concrete. Return only valid JSON.';
  const prompt = `Research the following fetched technology materials and convert them into a structured corpus.

${JSON.stringify(fetchedSources, null, 2)}

For each technology, return:
- technology
- docs_content
- github_readme
- latest_version
- last_commit_date
- open_issues_count
- recent_breaking_changes

Preserve specific version and compatibility details.`;

  try {
    const result = await callValidatedBatch(provider, {
      runType: 'batch_2_fetch_and_read',
      systemPrompt,
      prompt,
      schema: Batch2FetchAndReadSchema,
      schemaDescription: schemaDescriptions.batch_2_fetch_and_read,
    });

    await completeBatch(
      env,
      projectId,
      provider,
      'batch_2_fetch_and_read',
      input,
      result.data,
      result.attemptCount,
      result.data,
      Date.now() - startedAt,
    );
    await logActivity(env, {
      projectId,
      batchName: 'batch_2_fetch_and_read',
      kind: 'complete',
      message: `Stack research complete — ${result.data.research.length} technologies analysed.`,
    });
  } catch (error) {
    await failBatch(
      env,
      projectId,
      provider,
      'batch_2_fetch_and_read',
      input,
      error instanceof Error ? error.message : 'Batch 2 failed.',
      2,
    );
  }
}

async function executeBatch3(env: Bindings, projectId: string, provider: ProviderConfig, project: ProjectRecord) {
  const startedAt = Date.now();
  const batch2 = await loadBatchOutput(env, projectId, 'batch_2_fetch_and_read', Batch2FetchAndReadSchema);
  const input = {
    project_description: project.description || '',
    provider_id: provider.providerId,
    preferred_ide: 'cursor',
    research: batch2.research,
    review_feedback: '',
    review_feedback_provided: false,
  };

  await emitBatchStart(env, projectId, 'batch_3_architect');
  await logActivity(env, {
    projectId,
    batchName: 'batch_3_architect',
    kind: 'architecture',
    message: 'Designing your data model...',
  });

  const systemPrompt =
    'You are Scrimble’s staff engineer architect. Use the research corpus to produce a clear architecture decision record with explicit package and service choices. Return only valid JSON.';
  const prompt = `Project description:
${project.description || 'No description provided.'}

Research corpus:
${JSON.stringify(batch2.research, null, 2)}

Produce:
- project_name
- project_type
- recommended_stack
- data_model
- integrations with package_name and version
- security_surface
- gotchas with mitigations

Base every recommendation on the provided research corpus.`;

  try {
    const result = await callValidatedBatch(provider, {
      runType: 'batch_3_architect',
      systemPrompt,
      prompt,
      schema: Batch3ArchitectSchema,
      schemaDescription: schemaDescriptions.batch_3_architect,
    });

    await completeBatch(
      env,
      projectId,
      provider,
      'batch_3_architect',
      input,
      result.data,
      result.attemptCount,
      result.data,
      Date.now() - startedAt,
    );
    await updateProjectMetadataFromAdr(env, projectId, result.data);
    for (const gotcha of result.data.gotchas.slice(0, 3)) {
      await logActivity(env, {
        projectId,
        batchName: 'batch_3_architect',
        kind: 'warning',
        message: `Found: ${gotcha.issue} — ${gotcha.mitigation}`,
      });
    }
    await logActivity(env, {
      projectId,
      batchName: 'batch_3_architect',
      kind: 'complete',
      message: `Architecture locked in — ${result.data.data_model.length} tables, ${result.data.integrations.length} integrations.`,
    });
  } catch (error) {
    await failBatch(
      env,
      projectId,
      provider,
      'batch_3_architect',
      input,
      error instanceof Error ? error.message : 'Batch 3 failed.',
      2,
    );
  }
}

async function executeBatch4(env: Bindings, projectId: string, provider: ProviderConfig) {
  const startedAt = Date.now();
  const reviewContext = await loadArchitectureReviewContext(env, projectId);
  const input = {
    architecture: reviewContext.adr,
    review_feedback: reviewContext.reviewFeedback,
    review_feedback_provided: reviewContext.reviewFeedbackProvided,
  };

  await emitBatchStart(env, projectId, 'batch_4_plan_build');
  await logActivity(env, {
    projectId,
    batchName: 'batch_4_plan_build',
    kind: 'architecture',
    message: 'Building your execution plan...',
  });

  const systemPrompt =
    'You are Scrimble’s build planner. Generate the full staged implementation plan in JSON. Every step must reference the exact packages, services, and versions from the approved architecture context, including any human-reviewed changes. Return only valid JSON.';
  const prompt = `Architecture decision record:
${JSON.stringify(reviewContext.adr, null, 2)}

Human review feedback:
${reviewContext.reviewFeedbackProvided ? reviewContext.reviewFeedback : 'No changes requested. Continue with the approved architecture as written.'}

Generate the full build plan in the existing Scrimble shape with stages, steps, and edges.

Rules:
- if human feedback asks to swap, remove, or add technologies, you must honour it everywhere it applies
- when feedback overrides the ADR, treat the feedback as the approved source of truth for those decisions
- suggested_tools must reference specific packages and versions from the approved architecture context
- objective must reference the actual implementation approach, not generic advice
- why_it_matters must explain the real risk of getting the chosen technology wrong
- ids must be stable strings
- include checklist items where they improve execution`;

  try {
    const result = await callValidatedBatch(provider, {
      runType: 'batch_4_plan_build',
      systemPrompt,
      prompt,
      schema: Batch4PlanBuildSchema,
      schemaDescription: schemaDescriptions.batch_4_plan_build,
    });

    await completeBatch(
      env,
      projectId,
      provider,
      'batch_4_plan_build',
      input,
      result.data,
      result.attemptCount,
      result.data,
      Date.now() - startedAt,
    );
    await materializePlanStructure(env, projectId, result.data);
    await logActivity(env, {
      projectId,
      batchName: 'batch_4_plan_build',
      kind: 'complete',
      message: `Plan ready — ${result.data.stages.length} stages, ${countPlanSteps(result.data)} steps.`,
    });
  } catch (error) {
    await failBatch(
      env,
      projectId,
      provider,
      'batch_4_plan_build',
      input,
      error instanceof Error ? error.message : 'Batch 4 failed.',
      2,
    );
  }
}

async function executeBatch5(env: Bindings, projectId: string, provider: ProviderConfig) {
  const startedAt = Date.now();
  const plan = await loadBatchOutput(env, projectId, 'batch_4_plan_build', Batch4PlanBuildSchema);
  const research = await loadBatchOutput(env, projectId, 'batch_2_fetch_and_read', Batch2FetchAndReadSchema);
  const input = {
    plan,
    research,
  };

  await emitBatchStart(env, projectId, 'batch_5_enrich_steps');
  await logActivity(env, {
    projectId,
    batchName: 'batch_5_enrich_steps',
    kind: 'writing',
    message: 'Writing step details for every part of the plan...',
  });

  const systemPrompt =
    'You are Scrimble’s step enrichment agent. Enrich every step in one pass with concrete AI output and copy-paste prompts. Reference the exact technologies, services, and versions from the plan and research. Return only valid JSON.';
  const prompt = `Plan:
${JSON.stringify(plan, null, 2)}

Research:
${JSON.stringify(research.research, null, 2)}

For every step, generate:
- step_id
- ai_output
- prompts: [{ label, content }]

The ai_output should read like a senior engineer’s first pass at the work, not vague suggestions.`;

  try {
    const result = await callValidatedBatch(provider, {
      runType: 'batch_5_enrich_steps',
      systemPrompt,
      prompt,
      schema: Batch5EnrichStepsSchema,
      schemaDescription: schemaDescriptions.batch_5_enrich_steps,
    });

    await completeBatch(
      env,
      projectId,
      provider,
      'batch_5_enrich_steps',
      input,
      result.data,
      result.attemptCount,
      result.data,
      Date.now() - startedAt,
    );
    await applyStepEnrichments(env, projectId, result.data.enrichments);
    await logActivity(env, {
      projectId,
      batchName: 'batch_5_enrich_steps',
      kind: 'complete',
      message: `Step details complete — ${result.data.enrichments.length} steps enriched.`,
    });
  } catch (error) {
    await failBatch(
      env,
      projectId,
      provider,
      'batch_5_enrich_steps',
      input,
      error instanceof Error ? error.message : 'Batch 5 failed.',
      2,
    );
  }
}

async function executeBatch6(env: Bindings, projectId: string, provider: ProviderConfig) {
  const startedAt = Date.now();
  const reviewContext = await loadArchitectureReviewContext(env, projectId);
  const plan = await loadBatchOutput(env, projectId, 'batch_4_plan_build', Batch4PlanBuildSchema);
  const enrichments = await loadBatchOutput(env, projectId, 'batch_5_enrich_steps', Batch5EnrichStepsSchema);
  const enrichedPlan = mergePlanWithEnrichments(plan, enrichments.enrichments);
  const currentActiveStep = await loadCurrentActiveStep(env, projectId);
  const input = {
    architecture: reviewContext.adr,
    enriched_plan: enrichedPlan,
    review_feedback: reviewContext.reviewFeedback,
    review_feedback_provided: reviewContext.reviewFeedbackProvided,
    preferred_ide: reviewContext.preferredIde,
    current_step: currentActiveStep,
  };

  await emitBatchStart(env, projectId, 'batch_6_generate_files');
  await logActivity(env, {
    projectId,
    batchName: 'batch_6_generate_files',
    kind: 'writing',
    message: 'Preparing your downloadable files...',
  });

  const systemPrompt =
    'You are Scrimble’s file generator. Produce every downloadable AI context file from the approved architecture and enriched plan. Return only valid JSON with the exact required filenames and complete file contents.';
  const prompt = `Architecture:
${JSON.stringify(reviewContext.adr, null, 2)}

Complete enriched plan:
${JSON.stringify(enrichedPlan, null, 2)}

Human review feedback:
${reviewContext.reviewFeedbackProvided ? reviewContext.reviewFeedback : 'No review adjustments were requested.'}

Preferred IDE for MCP configuration:
${formatPreferredIdeLabel(reviewContext.preferredIde)} (${reviewContext.preferredIde})

Current active step:
${currentActiveStep ? JSON.stringify(currentActiveStep, null, 2) : 'No active step found. Use the first step in the plan order.'}

Generate exactly these six files and no others:
1. .cursor/rules/scrimble-project.mdc
   - Cursor MDC format
   - Sections in this order: description, stack, data-model, conventions, never-do, current-step
   - description: one-paragraph project overview
   - stack: every technology with exact version and import convention
   - data-model: each table as a code block showing column names and types
   - conventions: coding patterns derived from the chosen libraries
   - never-do: anti-patterns and deprecated approaches found during research, with the correct alternative
   - current-step: the first active step from the plan and what the user is building right now
2. CLAUDE.md
   - Markdown for Claude Projects / claude.md
   - Include project name and one-line description
   - Include full stack with versions
   - Include data model as markdown tables
   - Include all architecture decisions with reasoning
   - Include the complete plan as a numbered list of stages and steps using step title + one-line objective only
   - Include key constraints and conventions
   - Include the gotchas list with mitigations
3. .github/copilot-instructions.md
   - Concise GitHub Copilot instructions format
   - Include stack, conventions, data model summary, and never-do list
   - Keep it under 400 lines
4. .windsurfrules
   - Plain markdown rules format
   - Same project guidance as the Cursor file, adapted for Windsurf
5. scrimble-context.md
   - The most comprehensive universal context file
   - Include full project context
   - Include the full data model with relationships
   - Include all integration details with package names, versions, and required environment variable names
   - Include the security surface area with specific mitigations
   - Include the full enriched plan with every step's ai_output and prompts
6. scrimble-mcp.json
   - JSONC-style MCP configuration with a top comment block that explains what each server does and where to get API keys
   - Tailor the config and paste instructions to ${formatPreferredIdeLabel(reviewContext.preferredIde)}
   - Include the servers Scrimble used during research: fetch and github
   - Include brave-search only if the research context explicitly indicates it was used

Rules:
- return { "files": [{ "filename": string, "content": string }] }
- filenames must exactly match these values: ${SKILL_FILE_NAMES.join(', ')}
- do not wrap file content in markdown code fences
- use exact package names and versions from the approved architecture context, applying any human review changes everywhere they matter
- if the approved feedback changes a package choice, the generated files must reflect the approved choice, not the original ADR wording
- use ${currentActiveStep ? `"${currentActiveStep.title}" in stage "${currentActiveStep.stage_title}"` : 'the first step in the plan order'} as the current-step context
- the scrimble-mcp.json file should stay valid JSONC-style text and use the configuration shape expected by the selected IDE`;

  try {
    const result = await callValidatedBatch(provider, {
      runType: 'batch_6_generate_files',
      systemPrompt,
      prompt,
      schema: Batch6GenerateFilesSchema,
      schemaDescription: schemaDescriptions.batch_6_generate_files,
    });

    await completeBatch(
      env,
      projectId,
      provider,
      'batch_6_generate_files',
      input,
      result.data,
      result.attemptCount,
      result.data.files,
      Date.now() - startedAt,
    );
    await persistGeneratedFiles(env, projectId, result.data.files);
    await logActivity(env, {
      projectId,
      batchName: 'batch_6_generate_files',
      kind: 'complete',
      message: `Files prepared — ${result.data.files.length} downloadable artifact${result.data.files.length === 1 ? '' : 's'} ready.`,
    });
  } catch (error) {
    await failBatch(
      env,
      projectId,
      provider,
      'batch_6_generate_files',
      input,
      error instanceof Error ? error.message : 'Batch 6 failed.',
      2,
    );
  }
}

async function pauseForArchitectureReview(env: Bindings, projectId: string) {
  const reviewContext = await loadArchitectureReviewContext(env, projectId);

  await updateProjectGenerationStatus(env, projectId, 'awaiting_review', {
    generationError: null,
    markStarted: true,
  });
  await logActivity(env, {
    projectId,
    batchName: 'batch_3_architect',
    kind: 'system',
    message: "Here's what I found — review the architecture before I build the plan.",
  });
  await insertGenerationEvent(env, {
    projectId,
    eventType: 'review_required',
    batchName: 'batch_3_architect',
    body: {
      adr: reviewContext.adr,
    },
  });
}

async function finalizeProjectGeneration(env: Bindings, projectId: string) {
  await updateProjectGenerationStatus(env, projectId, 'complete', {
    generationError: null,
    markStarted: true,
    markCompleted: true,
  });
  await logActivity(env, {
    projectId,
    batchName: 'batch_6_generate_files',
    kind: 'complete',
    message: 'Everything is ready — opening your canvas.',
  });
  await insertGenerationEvent(env, {
    projectId,
    eventType: 'generation_complete',
    body: {
      generation_status: 'complete',
      message: 'Project generation completed.',
      project_id: projectId,
    },
  });
}

export async function processProjectGeneration(env: Bindings, message: QueueMessageBody) {
  const project = await getProjectById(env, message.projectId);
  if (!project) {
    throw new GenerationPipelineError('The queued project no longer exists.');
  }

  const currentStatus = (project.generation_status || 'queued') as ProjectGenerationStatus;
  if (currentStatus === 'complete' || currentStatus === 'failed' || currentStatus === 'awaiting_review') {
    return;
  }

  const provider = await resolveProviderConfiguration(env, message.userId, message.providerId);

  try {
    if (currentStatus === 'queued') {
      await updateProjectGenerationStatus(env, project.id, 'queued', {
        generationError: null,
        markStarted: true,
      });
      await logActivity(env, {
        projectId: project.id,
        batchName: 'batch_1_research_stack',
        kind: 'system',
        message: 'Agent picked up your brief and is starting the research sequence.',
      });
    }

    switch (currentStatus) {
      case 'queued':
        await executeBatch1(env, project, provider);
      // fall through
      case 'batch_1_research_stack':
        await executeBatch2(env, project.id, provider);
      // fall through
      case 'batch_2_fetch_and_read':
        await executeBatch3(env, project.id, provider, project);
      // fall through
      case 'batch_3_architect':
        await pauseForArchitectureReview(env, project.id);
        return;
      case 'approved':
        await executeBatch4(env, project.id, provider);
      // fall through
      case 'batch_4_plan_build':
        await executeBatch5(env, project.id, provider);
      // fall through
      case 'batch_5_enrich_steps':
        await executeBatch6(env, project.id, provider);
      // fall through
      case 'batch_6_generate_files':
        await finalizeProjectGeneration(env, project.id);
        return;
      default:
        return;
    }
  } catch (error) {
    if (error instanceof GenerationPipelineError && error.alreadyPersisted) {
      throw error;
    }

    const messageText =
      error instanceof Error ? error.message : 'Project generation failed before the pipeline could finish.';

    await updateProjectGenerationStatus(env, project.id, 'failed', {
      generationError: messageText,
      markStarted: true,
      markCompleted: true,
    });
    await insertGenerationEvent(env, {
      projectId: project.id,
      eventType: 'generation_failed',
      body: {
        error: messageText,
        generation_status: 'failed',
        project_id: project.id,
      },
    });

    throw new GenerationPipelineError(messageText, true);
  }
}

export async function handleProjectGenerationQueue(
  batch: QueueMessageBatch,
  env: Bindings,
  ctx: QueueExecutionContext,
) {
  for (const message of batch.messages) {
    if (message.body?.type !== 'generate_project') {
      message.ack();
      continue;
    }

    try {
      const job = processProjectGeneration(env, message.body);
      ctx.waitUntil(job);
      await job;
      message.ack();
    } catch (error) {
      const projectId = message.body.projectId;
      const fallbackMessage =
        error instanceof Error ? error.message : 'Project generation failed unexpectedly.';

      if (projectId) {
        await updateProjectGenerationStatus(env, projectId, 'failed', {
          generationError: fallbackMessage,
          markStarted: true,
          markCompleted: true,
        });
      }

      message.ack();
    }
  }
}
