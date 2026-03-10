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
import {
  createThrottledThinkingEmitter,
  emitTransientGenerationStreamEvent,
  getBatchStartLabel,
  isTerminalGenerationEvent,
  persistGenerationStreamEvent,
  resetGenerationThinkingState,
} from './generation-events';
import {
  callAIText,
  containsStreamTransportMarkers,
  defaultModelForProvider,
  extractJSON,
  trimToLimit,
} from './ai';


import { decrypt } from '../utils/crypto';
import { extractGitHubRepository } from '../utils/fetch-url';
import {
  analyzeGithubRepo,
  fetchUrl,
  getLibraryDocs,
  getLibraryIssues,
  searchWeb,
  type Env as ToolEnv,
  type SearchResult,
  type GithubIssue,
  type GithubRepoAnalysis,
} from '../../workers/tools';
import {
  getBuilderProfileDocsTopic,
  getBuilderProfileResearchUrls,
  normalizeBuilderProfileName,
} from '../../src/lib/builder-profile';
import { getConnectedResearchTools } from './mcp-servers';
import { appendProjectBriefSystemPrompt, loadProjectBriefContext } from './project-briefs';
import {
  appendResearchFooter,
  collectStepResearchContext,
  formatStepResearchPrompt,
  type StepResearchContext,
} from './step-research';
import {
  buildSkillFileProfileInstructions,
  loadBuilderProfileContext,
} from './user-tools';

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

export type ArchitectureReviewResearchSource = Batch2FetchAndRead['sources'][number];
export type ArchitectureReviewDataQuality = Batch2FetchAndRead['data_quality'];

export type ArchitectureReviewPayload = {
  project_id: string;
  project_name: string;
  project_type: string;
  recommended_stack: Batch3Architect['recommended_stack'];
  stack_cards: ArchitectureReviewStackCard[];
  data_model: ArchitectureReviewDataModelTable[];
  research_sources: ArchitectureReviewResearchSource[];
  data_quality: ArchitectureReviewDataQuality;
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

type FetchedCommunitySource = {
  title: string;
  url: string;
  description: string;
  content: string;
};

type FetchedTechnologyResearch = {
  technology: string;
  docs_url: string;
  github_url: string;
  changelog_url: string;
  docs_content: string;
  github_readme: string;
  latest_version: string;
  last_commit_date: string;
  open_issues_count: number;
  recent_breaking_changes: string;
  repo_health_summary: string;
  community_sentiment: string;
  bug_report_digest: string;
  source_ledger: Batch2FetchAndRead['sources'];
  community_pages: FetchedCommunitySource[];
};

type LoadedBuilderProfileContext = Awaited<ReturnType<typeof loadBuilderProfileContext>>;
type LoadedProjectBriefContext = Awaited<ReturnType<typeof loadProjectBriefContext>>;

type ResearchTechnologyTarget = {
  name: string;
  docs_url: string;
  github_url: string;
  changelog_url: string;
  docs_topic: string;
  community_search_results: SearchResult[];
  breaking_change_search_results: SearchResult[];
  source: 'brief' | 'profile' | 'inferred';
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

function normalizeToNpmPackage(techName: string): string {
  const name = techName.toLowerCase().trim();

  // If it already looks like a scoped package or simple package and has no spaces, return it
  // This allows the AI to suggest standard packages not in our map
  if (/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name) && !name.includes(' ')) {
    return name;
  }

  const map: Record<string, string> = {
    // Firebase variants
    'firebase': 'firebase',
    'firebase auth': 'firebase',
    'firebase authentication': 'firebase',
    'firebase firestore': 'firebase',
    'firebase storage': 'firebase',
    'firebase hosting': 'firebase',
    'firebase-js-sdk': 'firebase',

    // Cloudflare variants
    'cloudflare workers': 'wrangler',
    'cloudflare pages': 'wrangler',
    'cloudflare d1': 'wrangler',
    'cloudflare kv': 'wrangler',
    'cloudflare queues': 'wrangler',
    'cloudflare r2': 'wrangler',

    // React ecosystem
    'next.js': 'next',
    'nextjs': 'next',
    'react flow': '@xyflow/react',
    'reactflow': '@xyflow/react',
    'tailwind': 'tailwindcss',
    'tailwind css': 'tailwindcss',
    'framer motion': 'framer-motion',

    // Auth
    'clerk': '@clerk/nextjs',
    'next auth': 'next-auth',
    'nextauth': 'next-auth',
    'auth.js': 'next-auth',
    'supabase auth': '@supabase/supabase-js',
    'lucia': 'lucia',
    'better auth': 'better-auth',

    // Database
    'supabase': '@supabase/supabase-js',
    'prisma': '@prisma/client',
    'drizzle': 'drizzle-orm',
    'drizzle orm': 'drizzle-orm',
    'planetscale': '@planetscale/database',
    'neon': '@neondatabase/serverless',
    'turso': '@libsql/client',

    // Payments
    'stripe': 'stripe',
    'lemon squeezy': '@lemonsqueezy/lemonsqueezy.js',
    'lemonsqueezy': '@lemonsqueezy/lemonsqueezy.js',

    // State/UI
    'zustand': 'zustand',
    'tanstack query': '@tanstack/react-query',
    'react query': '@tanstack/react-query',
    'shadcn': 'shadcn-ui',
    'shadcn/ui': 'shadcn-ui',
    'radix ui': '@radix-ui/react-primitive',
  };

  // Direct match
  if (map[name]) return map[name];

  // Partial match — find first key that contains the tech name or vice versa
  for (const [key, pkg] of Object.entries(map)) {
    if (name.includes(key) || key.includes(name)) return pkg;
  }

  // Fallback — clean the name and try to make it npm compatible
  // 1. Remove anything in parentheses (e.g. "React (Library)")
  // 2. Replace spaces with hyphens
  // 3. Remove non-alphabetical/non-versioning characters
  return name.replace(/\(.*\)/g, '').trim().replace(/\s+/g, '-').replace(/[^a-z0-9@/-]/g, '');
}

function emptyGithubRepoAnalysis(owner = '', repo = ''): GithubRepoAnalysis {
  return {
    owner,
    repo,
    stars: 0,
    forks: 0,
    openIssues: 0,
    lastPush: 'Unknown',
    latestRelease: 'Unknown',
    readme: '',
    summary: '',
    releases: [],
    recentIssues: [],
  };
}

function formatGithubIssues(issues: GithubIssue[]) {
  return issues
    .map((issue) => `Open issue (${issue.createdAt}) ${issue.title}: ${issue.body}`)
    .join('\n\n');
}

function formatSearchResults(results: SearchResult[]) {
  return results
    .map((result) => `${result.title}: ${result.description} (${result.url})`)
    .join('\n');
}

function summarizeSnippet(value: string, maxLength = 180) {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return '';
  }

  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength)}...`;
}

function dedupeSearchResults(results: SearchResult[]) {
  const seen = new Set<string>();

  return results.filter((result) => {
    const key = result.url.trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function dedupeResearchSources(sources: Batch2FetchAndRead['sources']) {
  const seen = new Set<string>();

  return sources.filter((source) => {
    const key = `${source.tool}::${source.url}`.toLowerCase();
    if (!source.url || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function dedupeResearchTargets(targets: ResearchTechnologyTarget[]) {
  const merged = new Map<string, ResearchTechnologyTarget>();

  for (const target of targets) {
    const key = normalizeBuilderProfileName(target.name);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, target);
      continue;
    }

    merged.set(key, {
      ...existing,
      docs_url: existing.docs_url || target.docs_url,
      github_url: existing.github_url || target.github_url,
      changelog_url: existing.changelog_url || target.changelog_url,
      docs_topic: existing.docs_topic || target.docs_topic,
      community_search_results: dedupeSearchResults([
        ...existing.community_search_results,
        ...target.community_search_results,
      ]),
      breaking_change_search_results: dedupeSearchResults([
        ...existing.breaking_change_search_results,
        ...target.breaking_change_search_results,
      ]),
    });
  }

  return Array.from(merged.values());
}

function buildResearchTargets(
  inferredTechnologies: Batch1ResearchStack['technologies'],
  builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
) {
  const inferredTargets: ResearchTechnologyTarget[] = inferredTechnologies.map((technology) => ({
    ...technology,
    docs_topic: 'installation, migration, compatibility, breaking changes, best practices',
    source: 'inferred',
  }));

  const briefTargets: ResearchTechnologyTarget[] = projectBrief.confirmedStackTools.map((technology) => {
    const researchUrls = getBuilderProfileResearchUrls(technology);
    return {
      name: technology,
      docs_url: researchUrls.docsUrl,
      github_url: researchUrls.githubUrl,
      changelog_url: researchUrls.changelogUrl,
      docs_topic:
        researchUrls.docsUrl || researchUrls.githubUrl || researchUrls.changelogUrl
          ? getBuilderProfileDocsTopic('frontend', technology)
          : 'installation, migration, compatibility, breaking changes, best practices',
      community_search_results: [],
      breaking_change_search_results: [],
      source: 'brief',
    };
  });

  const profileTargets: ResearchTechnologyTarget[] = builderProfile.declaredTools.map((tool) => ({
    name: tool.name,
    docs_url: tool.docs_url,
    github_url: tool.github_url,
    changelog_url: tool.changelog_url,
    docs_topic:
      tool.proficiency === 'learning'
        ? `${tool.docs_topic}, beginner setup, common mistakes`
        : tool.docs_topic,
    community_search_results: [],
    breaking_change_search_results: [],
      source: 'profile',
  }));

  return dedupeResearchTargets([...briefTargets, ...profileTargets, ...inferredTargets]);
}

function emptyFetchedSource(url: string, title: string) {
  return {
    content: '',
    title,
    url,
  };
}

function createResearchSource(
  technology: string,
  tool: string,
  url: string,
  title: string,
  summary: string,
): Batch2FetchAndRead['sources'][number] {
  return {
    technology,
    tool,
    url,
    title,
    summary: summarizeSnippet(summary),
  };
}

function formatReleaseDigest(releases: GithubRepoAnalysis['releases']) {
  return releases
    .slice(0, 3)
    .map((release) => `${release.tagName} (${release.publishedAt}): ${release.body}`)
    .join('\n\n');
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
    const packageName = normalizeToNpmPackage(
      selection.replace(versionMatch?.[0] || '', '').replace(/[()]/g, '').trim() || selection,
    );

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
  research: Batch2FetchAndRead,
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
      package_name: normalizeToNpmPackage(integration.package_name || integration.service),
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
    research_sources: research.sources,
    data_quality: research.data_quality,
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
  await resetGenerationThinkingState(env, projectId, batchName);
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
      await resetGenerationThinkingState(env, payload.projectId, payload.batchName || null);
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
      await resetGenerationThinkingState(env, payload.projectId, null);
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
      await resetGenerationThinkingState(env, payload.projectId, null);
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

function emitThinking(env: Bindings, projectId: string, batchName: GenerationBatchName, content: string) {
  // Provided for backwards compatibility or single-shot emits.
  const trimmed = content.trim();
  if (!trimmed) {
    return;
  }

  emitTransientGenerationStreamEvent({
    projectId,
    batchName,
    event: {
      type: 'thinking',
      content,
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

export async function loadBatchOutput<T>(
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
  const batch2 = await loadBatchOutput(env, projectId, 'batch_2_fetch_and_read', Batch2FetchAndReadSchema);
  return buildArchitectureReviewPayload(projectId, context.adr, context.input, batch2);
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

function formatTransportRetryPrompt(basePrompt: string, schemaDescription: string) {
  return `${basePrompt}

your previous response was interrupted by provider transport formatting. return ONLY a single valid JSON object with no markdown fences, no reasoning, and no extra text.

Required schema:
${schemaDescription}`;
}

function logBatchResponseFailure(
  runType: GenerationBatchName,
  stage: 'transport' | 'json' | 'schema',
  responseText: string,
) {
  console.warn('[generation-ai-parse-failure]', {
    runType,
    stage,
    responseLength: responseText.length,
    containsStreamMarkers: containsStreamTransportMarkers(responseText),
    hasMarkdownFence: responseText.includes('```'),
  });
}

async function callValidatedBatch<T>(
  provider: ProviderConfig,
  options: {
    env: Bindings;
    projectId: string;
    runType: GenerationBatchName;
    systemPrompt: string;
    prompt: string;
    schema: ZodType<T>;
    schemaDescription: string;
  },
) {
  let prompt = options.prompt;
  let lastError = 'The AI response was empty.';
  const emitter = createThrottledThinkingEmitter(options.env, options.projectId, options.runType);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { text } = await callAIText({
      providerType: provider.providerType,
      apiKey: provider.apiKey,
      model: provider.model,
      baseUrl: provider.baseUrl,
      system: options.systemPrompt,
      prompt,
      onReasoningDelta: emitter.onReasoningDelta,
    });

    let parsed: unknown;
    const cleanedText = extractJSON(text);
    try {
      parsed = JSON.parse(cleanedText);
    } catch {
      logBatchResponseFailure(
        options.runType,
        containsStreamTransportMarkers(text) ? 'transport' : 'json',
        text,
      );
      lastError = `The AI response for ${options.runType} was not valid JSON.`;
      if (attempt === 1) {
        prompt = containsStreamTransportMarkers(text)
          ? formatTransportRetryPrompt(options.prompt, options.schemaDescription)
          : formatValidationRetryPrompt(options.prompt, cleanedText, options.schemaDescription);
        continue;
      }

      await emitter.flush();
      throw new GenerationPipelineError(`${lastError} Please retry.`);
    }

    const validated = options.schema.safeParse(parsed);
    if (validated.success) {
      await emitter.flush();
      return {
        data: validated.data,
        rawResponse: JSON.stringify(validated.data),
        attemptCount: attempt,
      };
    }

    lastError = `Validation failed for ${options.runType}: ${validated.error.message}`;
    logBatchResponseFailure(options.runType, 'schema', cleanedText);
    if (attempt === 1) {
        prompt = formatValidationRetryPrompt(options.prompt, cleanedText, options.schemaDescription);
        continue;
    }

    await emitter.flush();
    throw new GenerationPipelineError(`${lastError} Please retry.`);
  }

  await emitter.flush();
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
  const workflowResult = await env.DB.prepare('SELECT id FROM workflows WHERE project_id = ? LIMIT 1').bind(projectId).first();
  let workflowId = workflowResult?.id as string | undefined;

  if (!workflowId) {
    workflowId = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO workflows (id, project_id, version, canvas_state) VALUES (?, ?, ?, ?)')
      .bind(workflowId, projectId, 1, JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  }

  const statements: Array<any> = [
    env.DB.prepare('DELETE FROM checklist_items WHERE step_id IN (SELECT id FROM steps WHERE workflow_id = ?)').bind(workflowId),
    env.DB.prepare('DELETE FROM edges WHERE workflow_id = ?').bind(workflowId),
    env.DB.prepare('DELETE FROM steps WHERE workflow_id = ?').bind(workflowId),
    env.DB.prepare('DELETE FROM stages WHERE workflow_id = ?').bind(workflowId),
    env.DB.prepare('UPDATE workflows SET version = version + 1, updated_at = datetime("now") WHERE id = ?').bind(workflowId),
  ];

  let globalOrderIndex = 0;

  for (const stage of plan.stages) {
    statements.push(
      env.DB.prepare('INSERT INTO stages (id, workflow_id, title, type, order_index, status) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(stage.id, workflowId, stage.title, stage.type, stage.order_index, stage.order_index === 0 ? 'active' : 'locked'),
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
            id, workflow_id, stage_id, title, type, category, position_x, position_y, status,
            is_gate, risk_level, order_index, objective, why_it_matters, suggested_tools, done_when,
            ai_output, prompts, is_ai_enriched
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          step.id,
          workflowId,
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
        INSERT INTO edges (id, workflow_id, source_step_id, target_step_id, edge_type)
        VALUES (?, ?, ?, ?, ?)
      `).bind(edge.id, workflowId, edge.source_step_id, edge.target_step_id, edge.edge_type || 'default'),
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
      WHERE id = ? AND workflow_id IN (SELECT id FROM workflows WHERE project_id = ?)
    `).bind(
      enrichment.ai_output,
      JSON.stringify(enrichment.prompts),
      enrichment.step_id,
      projectId,
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
      s.id,
      s.title,
      s.objective,
      s.done_when,
      s.order_index,
      st.title AS stage_title
    FROM steps s
    INNER JOIN workflows w ON w.id = s.workflow_id
    INNER JOIN stages st ON st.id = s.stage_id
    WHERE w.project_id = ? AND s.status = 'active'
    ORDER BY s.order_index ASC
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
      s.id,
      s.title,
      s.objective,
      s.done_when,
      s.order_index,
      st.title AS stage_title
    FROM steps s
    INNER JOIN workflows w ON w.id = s.workflow_id
    INNER JOIN stages st ON st.id = s.stage_id
    WHERE w.project_id = ?
    ORDER BY s.order_index ASC
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

async function executeBatch1(
  env: Bindings,
  project: ProjectRecord,
  provider: ProviderConfig,
  _builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
) {
  const startedAt = Date.now();
  const input = {
    description: projectBrief.summary || project.description || '',
  };
  const currentYear = new Date().getFullYear();
  const toolEnv: ToolEnv = {
    ...env,
    TOOL_CONTEXT: {
      projectId: project.id,
      batchName: 'batch_1_research_stack',
    },
  };

  await emitBatchStart(env, project.id, 'batch_1_research_stack');
  await logActivity(env, {
    projectId: project.id,
    batchName: 'batch_1_research_stack',
    kind: 'fetch',
    message: 'Scanning your brief for technologies, services, and infrastructure choices...',
  });

  const systemPrompt = appendProjectBriefSystemPrompt(
    'You are Scrimble’s stack research scout. Infer every technology, library, framework, hosted service, and infrastructure tool implied by the project description. Return only valid JSON.',
    projectBrief.promptContext,
  );
  const prompt = `Project description:
${projectBrief.summary || project.description || 'No description provided.'}

Identify the stack implied by the idea. For each technology, provide:
- name
- official docs URL
- GitHub repository URL
- changelog or releases URL

Only include technologies that matter to implementation.`;

  try {
    const result = await callValidatedBatch(provider, {
      env,
      projectId: project.id,
      runType: 'batch_1_research_stack',
      systemPrompt,
      prompt,
      schema: Batch1ResearchStackSchema,
      schemaDescription: schemaDescriptions.batch_1_research_stack,
    });

    const technologiesWithSearches = [];

    for (const technology of result.data.technologies) {
      await logActivity(env, {
        projectId: project.id,
        batchName: 'batch_1_research_stack',
        kind: 'fetch',
        message: `Searching for ${technology.name} community feedback...`,
      });
      const communitySearchResults = dedupeSearchResults(
        await searchWeb(`${technology.name} vs alternatives ${currentYear}`, project.user_id, toolEnv),
      );

      await logActivity(env, {
        projectId: project.id,
        batchName: 'batch_1_research_stack',
        kind: 'fetch',
        message: `Searching for ${technology.name} breaking changes...`,
      });
      const breakingChangeSearchResults = dedupeSearchResults(
        await searchWeb(
          `${technology.name} breaking changes deprecations ${currentYear}`,
          project.user_id,
          toolEnv,
        ),
      );

      if (communitySearchResults.length > 0) {
        await logActivity(env, {
          projectId: project.id,
          batchName: 'batch_1_research_stack',
          kind: 'fetch',
          message: `${technology.name} community feedback surfaced ${communitySearchResults.length} comparison source${communitySearchResults.length === 1 ? '' : 's'}.`,
        });
      }

      if (breakingChangeSearchResults.length > 0) {
        await logActivity(env, {
          projectId: project.id,
          batchName: 'batch_1_research_stack',
          kind: 'warning',
          message: `${technology.name} surfaced ${breakingChangeSearchResults.length} breaking-change or deprecation source${breakingChangeSearchResults.length === 1 ? '' : 's'}.`,
        });
      }

      technologiesWithSearches.push({
        ...technology,
        community_search_results: communitySearchResults,
        breaking_change_search_results: breakingChangeSearchResults,
      });
    }

    const enrichedBatch1 = {
      technologies: technologiesWithSearches,
    };

    await completeBatch(
      env,
      project.id,
      provider,
      'batch_1_research_stack',
      input,
      enrichedBatch1,
      result.attemptCount,
      enrichedBatch1,
      Date.now() - startedAt,
    );
    await logActivity(env, {
      projectId: project.id,
      batchName: 'batch_1_research_stack',
      kind: 'complete',
      message: `Stack candidates identified — ${enrichedBatch1.technologies.length} technologies queued for research.`,
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

async function executeBatch2(
  env: Bindings,
  project: ProjectRecord,
  provider: ProviderConfig,
  builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
) {
  const startedAt = Date.now();
  const projectId = project.id;
  const batch1 = await loadBatchOutput(env, projectId, 'batch_1_research_stack', Batch1ResearchStackSchema);
  const researchTargets = buildResearchTargets(batch1.technologies, builderProfile, projectBrief);
  const fetchedSources: FetchedTechnologyResearch[] = [];
  const connectedTools = await getConnectedResearchTools(env, project.user_id);
  let issuesFound = 0;
  const toolEnv: ToolEnv = {
    ...env,
    TOOL_CONTEXT: {
      projectId,
      batchName: 'batch_2_fetch_and_read',
    },
  };

  await emitBatchStart(env, projectId, 'batch_2_fetch_and_read');
  await logActivity(env, {
    projectId,
    batchName: 'batch_2_fetch_and_read',
    kind: 'fetch',
      message:
        projectBrief.confirmedStackTools.length > 0
          ? `Reading the docs for ${researchTargets.length} technologies, starting with ${projectBrief.confirmedStackTools.length} confirmed stack tool${projectBrief.confirmedStackTools.length === 1 ? '' : 's'} from your brief...`
          : builderProfile.declaredTools.length > 0
            ? `Reading the docs for ${researchTargets.length} technologies, starting with ${builderProfile.declaredTools.length} saved tool${builderProfile.declaredTools.length === 1 ? '' : 's'} from your builder profile...`
          : `Reading the docs for ${researchTargets.length} technolog${researchTargets.length === 1 ? 'y' : 'ies'}...`,
  });

  for (const technology of researchTargets) {
    await logActivity(env, {
      projectId,
      batchName: 'batch_2_fetch_and_read',
      kind: 'fetch',
      message:
        technology.source === 'brief'
          ? `Researching your confirmed stack tool ${technology.name} before anything else...`
          : technology.source === 'profile'
          ? `Researching your saved tool ${technology.name} before anything else...`
          : `Researching ${technology.name} with every source you've connected...`,
    });

    const githubRepository = extractGitHubRepository(technology.github_url);
    const communitySearchResults =
      technology.community_search_results.length > 0
        ? technology.community_search_results
        : dedupeSearchResults(
            await searchWeb(`${technology.name} vs alternatives ${new Date().getFullYear()}`, project.user_id, toolEnv),
          );
    const breakingChangeSearchResults =
      technology.breaking_change_search_results.length > 0
        ? technology.breaking_change_search_results
        : dedupeSearchResults(
            await searchWeb(
              `${technology.name} breaking changes deprecations ${new Date().getFullYear()}`,
              project.user_id,
              toolEnv,
            ),
          );
    const searchResults = dedupeSearchResults([
      ...communitySearchResults,
      ...breakingChangeSearchResults,
    ]);
    const docsUrl = technology.docs_url.trim();
    const changelogUrl = technology.changelog_url.trim();
    const [docsResult, changelogResult, liveDocsResult, githubAnalysis, githubIssues] = await Promise.all([
      docsUrl
        ? fetchUrl(docsUrl, toolEnv)
        : Promise.resolve(emptyFetchedSource('', `${technology.name} docs`)),
      changelogUrl
        ? fetchUrl(changelogUrl, toolEnv)
        : Promise.resolve(emptyFetchedSource('', `${technology.name} changelog`)),
      getLibraryDocs(technology.name, technology.docs_topic, project.user_id, toolEnv),
      githubRepository
        ? analyzeGithubRepo(githubRepository.owner, githubRepository.repo, project.user_id, toolEnv)
        : Promise.resolve(emptyGithubRepoAnalysis()),
      githubRepository
        ? getLibraryIssues(
            githubRepository.owner,
            githubRepository.repo,
            ['bug', 'breaking-change'],
            90,
            project.user_id,
            toolEnv,
          )
        : Promise.resolve([]),
    ]);
    const communityPages = (
      await Promise.all(
        searchResults.map(async (result) => {
          const page = await fetchUrl(result.url, toolEnv);

          return {
            title: result.title,
            url: result.url,
            description: result.description,
            content: page.content,
          };
        }),
      )
    ).filter((page): page is FetchedCommunitySource => Boolean(page.content || page.description));
    issuesFound += githubIssues.length;

    if (!docsResult.content && !liveDocsResult.content) {
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        kind: 'warning',
        message: `Could not read ${technology.name} documentation — continuing with the rest of the research.`,
      });
    }

    if (!changelogResult.content) {
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        kind: 'warning',
        message: `Could not read ${technology.name} release notes — keeping the fetch moving.`,
      });
    }

    if (githubRepository && githubAnalysis.summary) {
      const relativeUpdate =
        githubAnalysis.lastPush !== 'Unknown'
          ? `, updated ${formatRelativeAge(githubAnalysis.lastPush)}`
          : '';
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        kind: 'github',
        message: `Checking ${githubAnalysis.owner}/${githubAnalysis.repo} on GitHub — ${formatCompactNumber(githubAnalysis.stars)} stars${relativeUpdate}`,
      });

      if (githubAnalysis.latestRelease !== 'Unknown') {
        await logActivity(env, {
          projectId,
          batchName: 'batch_2_fetch_and_read',
          kind: 'github',
          message: `Checking ${githubAnalysis.owner}/${githubAnalysis.repo} — latest release ${githubAnalysis.latestRelease}`,
        });
      }

      if (githubIssues.length > 0) {
        await logActivity(env, {
          projectId,
          batchName: 'batch_2_fetch_and_read',
          kind: 'warning',
          message: `${githubIssues.length} recent bug or breaking-change issue${githubIssues.length === 1 ? '' : 's'} surfaced for ${githubAnalysis.owner}/${githubAnalysis.repo}.`,
        });
      }
    } else if (githubRepository) {
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        kind: 'warning',
        message: `Could not inspect ${technology.name} on GitHub — continuing with the rest of the sources.`,
      });
    }

    if (!githubRepository) {
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        kind: 'warning',
        message: `${technology.name} did not include a valid GitHub repository URL — skipping GitHub analysis.`,
      });
    }

    if (searchResults.length > 0) {
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        kind: 'fetch',
        message: `Read ${communityPages.length} community source${communityPages.length === 1 ? '' : 's'} for ${technology.name}.`,
      });
    }

    if (liveDocsResult.content && liveDocsResult.source === 'Context7') {
      const versionSuffix =
        liveDocsResult.version !== 'unknown' ? ` (${liveDocsResult.version})` : '';
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        kind: 'fetch',
        message: `Pulled live ${technology.name} docs from Context7${versionSuffix}.`,
      });
    }

    if (githubRepository && githubAnalysis.summary) {
      const recentBreakingSignals = githubIssues.length + breakingChangeSearchResults.length;
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        kind: 'github',
        message: `📦 ${githubAnalysis.owner}/${githubAnalysis.repo} — ${formatCompactNumber(githubAnalysis.stars)} stars, last commit ${formatRelativeAge(githubAnalysis.lastPush)}, ${recentBreakingSignals} recent breaking-change signal${recentBreakingSignals === 1 ? '' : 's'} found.`,
      });
    }

    const docsContentSections = [docsResult.content];
    if (liveDocsResult.content) {
      const sourceLabel =
        liveDocsResult.source === 'Context7' && liveDocsResult.version !== 'unknown'
          ? `${liveDocsResult.source} ${liveDocsResult.version}`
          : liveDocsResult.source;
      docsContentSections.push(`${sourceLabel}\n${liveDocsResult.content}`);
    }

    const changelogContent = trimToLimit(changelogResult.content, 5000) || 'Release notes unavailable.';
    const githubIssueDigest = formatGithubIssues(githubIssues); // formatGithubIssues already truncates to 1400 per issue
    const releaseDigest = formatReleaseDigest(githubAnalysis.releases); // formatReleaseDigest already truncates to 1200 per release
    const communitySentiment = communityPages
      .map((page) => `${page.title}: ${trimToLimit(page.content || page.description, 2000)} (${page.url})`)
      .join('\n\n');
    const repoHealthSummary = githubRepository
      ? `${githubAnalysis.owner}/${githubAnalysis.repo} has ${formatCompactNumber(githubAnalysis.stars)} stars, ${githubAnalysis.openIssues} open issues, latest release ${githubAnalysis.latestRelease}, last push ${githubAnalysis.lastPush}.`
      : 'GitHub repository data unavailable.';

    const technologySources = dedupeResearchSources([
      ...(docsResult.content
        ? [
            createResearchSource(
              technology.name,
              'Web fetch',
              docsUrl || liveDocsResult.source,
              `${technology.name} docs`,
              docsResult.content,
            ),
          ]
        : []),
      ...(liveDocsResult.content
        ? [
            createResearchSource(
              technology.name,
              liveDocsResult.source === 'Context7' ? 'Context7' : 'Live docs',
              liveDocsResult.source.startsWith('http') ? liveDocsResult.source : docsUrl,
              `${technology.name} live docs`,
              liveDocsResult.content,
            ),
          ]
        : []),
      ...(changelogResult.content
        ? [
            createResearchSource(
              technology.name,
              'Web fetch',
              changelogUrl,
              `${technology.name} changelog`,
              changelogResult.content,
            ),
          ]
        : []),
      ...(githubRepository
        ? [
            createResearchSource(
              technology.name,
              'GitHub',
              technology.github_url,
              `${githubAnalysis.owner}/${githubAnalysis.repo}`,
              `${repoHealthSummary}\n\n${githubAnalysis.summary}\n\n${releaseDigest}`,
            ),
          ]
        : []),
      ...githubIssues.slice(0, 5).map((issue) =>
        createResearchSource(technology.name, 'GitHub', issue.url, issue.title, issue.body),
      ),
      ...communityPages.map((page) =>
        createResearchSource(
          technology.name,
          connectedTools.has_brave_search ? 'Brave Search' : 'Web search',
          page.url,
          page.title,
          page.content || page.description,
        ),
      ),
    ]);
    const latestVersion =
      githubAnalysis.latestRelease !== 'Unknown'
        ? githubAnalysis.latestRelease
        : liveDocsResult.version !== 'unknown'
          ? liveDocsResult.version
          : 'Unknown';

    fetchedSources.push({
      technology: technology.name,
      docs_url: docsUrl,
      github_url: technology.github_url,
      changelog_url: changelogUrl,
      docs_content: trimToLimit(docsContentSections.filter(Boolean).join('\n\n'), 15000) || 'Documentation source unavailable.',
      github_readme: trimToLimit(githubAnalysis.readme || githubAnalysis.summary, 10000) || 'GitHub repository data unavailable.',
      latest_version: latestVersion,
      last_commit_date: githubAnalysis.lastPush || 'Unknown',
      open_issues_count: githubAnalysis.openIssues,
      recent_breaking_changes: trimToLimit([changelogContent, releaseDigest, githubIssueDigest]
        .filter(Boolean)
        .join('\n\n'), 8000),
      repo_health_summary: repoHealthSummary,
      community_sentiment:
        trimToLimit(communitySentiment || formatSearchResults(searchResults), 5000) || 'Community sentiment unavailable.',
      bug_report_digest: githubIssueDigest || 'No recent bug reports found.',
      source_ledger: technologySources,
      community_pages: communityPages,
    });

  }

  const sourceLedger = dedupeResearchSources(fetchedSources.flatMap((source) => source.source_ledger));
  const dataQuality: Batch2FetchAndRead['data_quality'] = {
    has_brave_search: connectedTools.has_brave_search,
    has_github_token: connectedTools.has_github_token,
    has_context7: connectedTools.has_context7,
    technologies_researched: fetchedSources.length,
    urls_fetched: sourceLedger.length,
    issues_found: issuesFound,
  };

  const input = {
    technologies: batch1.technologies,
    declared_tools: builderProfile.declaredTools.map((tool) => ({
      category: tool.category,
      name: tool.name,
      proficiency: tool.proficiency,
    })),
    research_targets: researchTargets.map((target) => ({
      name: target.name,
      source: target.source,
    })),
    fetched_sources: fetchedSources,
    data_quality: dataQuality,
  };

  const systemPrompt = appendProjectBriefSystemPrompt(
    'You are Scrimble’s technical research analyst. Turn fetched docs, readmes, metadata, and changelog snippets into a structured research corpus. Keep the important technical details concrete. Return only valid JSON.',
    projectBrief.promptContext,
  );
  const prompt = `Research the following fetched technology materials and convert them into a structured corpus.

${JSON.stringify({ fetchedSources, dataQuality }, null, 2)}

For each technology, return:
- technology
- docs_content
- github_readme
- latest_version
- last_commit_date
- open_issues_count
- recent_breaking_changes
- repo_health_summary
- community_sentiment
- bug_report_digest
- sources (copy the important sources you used as { technology, url, tool, title, summary })

Preserve specific version and compatibility details.`;

  console.log('[BATCH2_DEBUG] starting research analyst AI call', {
    projectId,
    technologies: researchTargets.map(t => t.name),
    fetchedSourcesCount: fetchedSources.length,
    firstSourceSample: fetchedSources[0] ? { 
      tech: fetchedSources[0].technology, 
      docsLen: fetchedSources[0].docs_content.length,
      readmeLen: fetchedSources[0].github_readme.length 
    } : null
  });

  try {
    const result = await callValidatedBatch(provider, {
      env,
      projectId,
      runType: 'batch_2_fetch_and_read',
      systemPrompt,
      prompt,
      schema: Batch2FetchAndReadSchema,
      schemaDescription: schemaDescriptions.batch_2_fetch_and_read,
    });

    const researchByTechnology = new Map(
      result.data.research.map((entry) => [entry.technology.toLowerCase(), entry] as const),
    );
    const finalResearch = fetchedSources.map((source) => {
      const generated = researchByTechnology.get(source.technology.toLowerCase());

      return {
        technology: source.technology,
        docs_content: generated?.docs_content || source.docs_content,
        github_readme: generated?.github_readme || source.github_readme,
        latest_version: generated?.latest_version || source.latest_version,
        last_commit_date: generated?.last_commit_date || source.last_commit_date,
        open_issues_count: generated?.open_issues_count ?? source.open_issues_count,
        recent_breaking_changes: generated?.recent_breaking_changes || source.recent_breaking_changes,
        repo_health_summary: generated?.repo_health_summary || source.repo_health_summary,
        community_sentiment: generated?.community_sentiment || source.community_sentiment,
        bug_report_digest: generated?.bug_report_digest || source.bug_report_digest,
        sources: source.source_ledger,
      };
    });
    const finalOutput: Batch2FetchAndRead = {
      research: finalResearch,
      sources: sourceLedger,
      data_quality: dataQuality,
    };

    await completeBatch(
      env,
      projectId,
      provider,
      'batch_2_fetch_and_read',
      input,
      finalOutput,
      result.attemptCount,
      finalOutput,
      Date.now() - startedAt,
    );
    await logActivity(env, {
      projectId,
      batchName: 'batch_2_fetch_and_read',
      kind: 'complete',
      message: `Stack research complete — ${finalOutput.research.length} technologies analysed across ${finalOutput.data_quality.urls_fetched} sources.`,
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

async function executeBatch3(
  env: Bindings,
  projectId: string,
  provider: ProviderConfig,
  project: ProjectRecord,
  _builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
) {
  const startedAt = Date.now();
  const batch2 = await loadBatchOutput(env, projectId, 'batch_2_fetch_and_read', Batch2FetchAndReadSchema);
  const input = {
    project_description: projectBrief.summary || project.description || '',
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

  const systemPrompt = appendProjectBriefSystemPrompt(
    'You are Scrimble’s staff engineer architect. Use the research corpus to produce a clear architecture decision record with explicit package and service choices. Return only valid JSON.',
    projectBrief.promptContext,
  );
  const prompt = `Project description:
${projectBrief.summary || project.description || 'No description provided.'}

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
      env,
      projectId,
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

async function executeBatch4(
  env: Bindings,
  projectId: string,
  provider: ProviderConfig,
  _builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
) {
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

  const systemPrompt = appendProjectBriefSystemPrompt(
    'You are Scrimble’s build planner. Generate the full staged implementation plan in JSON. Every step must reference the exact packages, services, and versions from the approved architecture context, including any human-reviewed changes. Return only valid JSON.',
    projectBrief.promptContext,
  );
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
      env,
      projectId,
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

async function executeBatch5(
  env: Bindings,
  projectId: string,
  provider: ProviderConfig,
  _builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
) {
  const startedAt = Date.now();
  const project = await getProjectById(env, projectId);
  if (!project) {
    throw new Error('Project not found.');
  }

  const adr = await loadBatchOutput(env, projectId, 'batch_3_architect', Batch3ArchitectSchema);
  const plan = await loadBatchOutput(env, projectId, 'batch_4_plan_build', Batch4PlanBuildSchema);
  const research = await loadBatchOutput(env, projectId, 'batch_2_fetch_and_read', Batch2FetchAndReadSchema);
  const connectedTools = await getConnectedResearchTools(env, project.user_id);
  const stepResearchContexts: StepResearchContext[] = [];

  await emitBatchStart(env, projectId, 'batch_5_enrich_steps');
  await logActivity(env, {
    projectId,
    batchName: 'batch_5_enrich_steps',
    kind: 'fetch',
    message: 'Refreshing every step with live docs, issues, and current implementation notes...',
  });

  for (const stage of plan.stages) {
    for (const step of stage.steps) {
      await logActivity(env, {
        projectId,
        batchName: 'batch_5_enrich_steps',
        kind: 'fetch',
        message: `Refreshing ${step.title} with live docs and current implementation notes...`,
      });

      const stepResearch = await collectStepResearchContext({
        env,
        userId: project.user_id,
        stepId: step.id,
        stepTitle: step.title,
        stepObjective: step.objective,
        stepWhyItMatters: step.why_it_matters,
        stepCategory: step.category,
        stepDoneWhen: step.done_when,
        stepIsGate: step.is_gate,
        adr,
        research,
        batchName: 'batch_5_enrich_steps',
        projectId,
        connectedTools,
      });

      stepResearchContexts.push(stepResearch);

      await logActivity(env, {
        projectId,
        batchName: 'batch_5_enrich_steps',
        kind: 'fetch',
        message: `${step.title} research refreshed — ${stepResearch.docs.length} doc source${stepResearch.docs.length === 1 ? '' : 's'}, ${stepResearch.issues.length} issue${stepResearch.issues.length === 1 ? '' : 's'}, ${stepResearch.community.length} community source${stepResearch.community.length === 1 ? '' : 's'}.`,
      });
    }
  }
  const input = {
    plan,
    research,
    step_research: stepResearchContexts,
  };

  await logActivity(env, {
    projectId,
    batchName: 'batch_5_enrich_steps',
    kind: 'writing',
    message: 'Writing step details for every part of the plan...',
  });

  const systemPrompt = appendProjectBriefSystemPrompt(
    'You are Scrimble’s step enrichment agent. Enrich every step in one pass with concrete AI output and copy-paste prompts. Reference the exact technologies, services, and versions from the plan and research. Return only valid JSON.',
    projectBrief.promptContext,
  );
  const prompt = `Plan:
${JSON.stringify(plan, null, 2)}

Research:
${JSON.stringify(research.research, null, 2)}

Live step research:
${stepResearchContexts.map((context) => formatStepResearchPrompt(context)).join('\n\n')}

For every step, generate:
- step_id
- ai_output
- prompts: [{ label, content }]

The ai_output should read like a senior engineer’s first pass at the work, not vague suggestions.
Use the live documentation provided to generate specific, current guidance.
Reference actual function names, hook names, and config options from the docs.
If any open bugs were found, mention them in the ai_output and explain the workaround.
For each step, obey any requirements array included in the live step research context.`;

  try {
    const result = await callValidatedBatch(provider, {
      env,
      projectId,
      runType: 'batch_5_enrich_steps',
      systemPrompt,
      prompt,
      schema: Batch5EnrichStepsSchema,
      schemaDescription: schemaDescriptions.batch_5_enrich_steps,
    });
    const stepResearchById = new Map(stepResearchContexts.map((context) => [context.stepId, context] as const));
    const finalEnrichments: Batch5EnrichSteps['enrichments'] = result.data.enrichments.map((enrichment) => ({
      ...enrichment,
      ai_output: appendResearchFooter(
        enrichment.ai_output,
        stepResearchById.get(enrichment.step_id)?.footer ||
          `Researched ${new Date().toISOString().slice(0, 10)} — connect more tools in Settings for deeper results.`,
      ),
    }));
    const finalResult: Batch5EnrichSteps = {
      enrichments: finalEnrichments,
    };

    await completeBatch(
      env,
      projectId,
      provider,
      'batch_5_enrich_steps',
      input,
      finalResult,
      result.attemptCount,
      finalResult,
      Date.now() - startedAt,
    );
    await applyStepEnrichments(env, projectId, finalResult.enrichments);
    await logActivity(env, {
      projectId,
      batchName: 'batch_5_enrich_steps',
      kind: 'complete',
      message: `Step details complete — ${finalResult.enrichments.length} steps enriched.`,
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

async function executeBatch6(
  env: Bindings,
  projectId: string,
  provider: ProviderConfig,
  builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
) {
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

  const systemPrompt = appendProjectBriefSystemPrompt(
    'You are Scrimble’s file generator. Produce every downloadable AI context file from the approved architecture and enriched plan. Return only valid JSON with the exact required filenames and complete file contents.',
    projectBrief.promptContext,
  );
  const skillFileProfileInstructions = buildSkillFileProfileInstructions(
    builderProfile.primaryCodingEnvironment,
  );
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
- the scrimble-mcp.json file should stay valid JSONC-style text and use the configuration shape expected by the selected IDE

Builder profile file rules:
${skillFileProfileInstructions}`;

  try {
    const result = await callValidatedBatch(provider, {
      env,
      projectId,
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

async function getCompletedBatches(projectId: string, env: Bindings): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT run_type FROM agent_runs 
     WHERE project_id = ? AND status = 'complete' 
     ORDER BY created_at ASC`,
  ).bind(projectId).all();
  return rows.results.map((r: any) => r.run_type as string);
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

  const completed = await getCompletedBatches(message.projectId, env);

  const provider = await resolveProviderConfiguration(env, message.userId, message.providerId);
  const builderProfile = await loadBuilderProfileContext(message.userId, env);
  const projectBrief = await loadProjectBriefContext(env, message.projectId, message.userId, {
    rawDescription: project.description || '',
    projectStack: project.stack,
    existingTools: builderProfile.declaredTools.map((tool) => tool.name),
  });

  try {
    if (currentStatus === 'queued' && !completed.includes('batch_1_research_stack')) {
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

    // Map which statuses fall through based on what is already completed
    let statusToRun = currentStatus;

    // If we're resumed, currentStatus might be something like 'batch_2_fetch_and_read'
    // but the DB says batch_2 is 'complete'. We should skip forward.
    const pipelineOrder: ProjectGenerationStatus[] = [
      'queued',
      'batch_1_research_stack',
      'batch_2_fetch_and_read',
      'batch_3_architect',
      'approved',
      'batch_4_plan_build',
      'batch_5_enrich_steps',
      'batch_6_generate_files',
    ];

    const currentIndex = pipelineOrder.indexOf(currentStatus as any);
    if (currentIndex !== -1) {
      for (let i = currentIndex; i < pipelineOrder.length; i++) {
        const batchName = pipelineOrder[i];
        if (completed.includes(batchName)) {
          // Find next status
          if (i + 1 < pipelineOrder.length) {
            statusToRun = pipelineOrder[i + 1] as any;
          }
        } else {
          break;
        }
      }
    }

    switch (statusToRun) {
      case 'intake':
        return;
      case 'queued':
        if (!completed.includes('batch_1_research_stack')) {
          await executeBatch1(env, project, provider, builderProfile, projectBrief);
        }
      // fall through
      case 'batch_1_research_stack':
        if (!completed.includes('batch_2_fetch_and_read')) {
          await executeBatch2(env, project, provider, builderProfile, projectBrief);
        }
      // fall through
      case 'batch_2_fetch_and_read':
        if (!completed.includes('batch_3_architect')) {
          await executeBatch3(env, project.id, provider, project, builderProfile, projectBrief);
        }
      // fall through
      case 'batch_3_architect':
        await pauseForArchitectureReview(env, project.id);
        return;
      case 'approved':
        if (!completed.includes('batch_4_plan_build')) {
          await executeBatch4(env, project.id, provider, builderProfile, projectBrief);
        }
      // fall through
      case 'batch_4_plan_build':
        if (!completed.includes('batch_5_enrich_steps')) {
          await executeBatch5(env, project.id, provider, builderProfile, projectBrief);
        }
      // fall through
      case 'batch_5_enrich_steps':
        if (!completed.includes('batch_6_generate_files')) {
          await executeBatch6(env, project.id, provider, builderProfile, projectBrief);
        }
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
