import type { ZodType } from 'zod';
import {
  Batch1ResearchStackSchema,
  Batch2FetchAndReadSchema,
  Batch3ArchitectSchema,
  Batch4PlanBuildSchema,
  Batch5EnrichStepsSchema,
  Batch6GenerateFilesSchema,
  getSkillFileSortIndex,
  SKILL_FILE_NAMES,
  type Batch1ResearchStack,
  type Batch2FetchAndRead,
  type Batch3Architect,
  type Batch4PlanBuild,
  type Batch5EnrichSteps,
  type Batch6GenerateFiles,
  type SkillFileName,
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
  PipelineQuotaExceededError,
  RetryableAIError,
  trimToLimit,
} from './ai';
import {
  deleteJsonPayload,
  loadJsonPayload,
  loadJsonPayloadText,
  storeJsonPayload,
} from './checkpoint-storage';
import { sendGenerationDispatch } from './generation-dispatch';


import { decrypt } from '../utils/crypto';
import { extractGitHubRepository } from '../utils/fetch-url';
import {
  analyzeGithubRepo,
  fetchUrl,
  getLibraryDocs,
  getLibraryIssues,
  searchWeb,
  type Env as ToolEnv,
  type LibraryDocsResult,
  type SearchResult,
  type GithubIssue,
  type GithubRepoAnalysis,
  ToolExecutionError,
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
  generation_run_id: string | null;
  generation_provider_id: string | null;
  generation_heartbeat_at: string | null;
};

type AgentRunRecord = {
  id: string;
  input: string | null;
  output: string | null;
  output_r2_key: string | null;
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
  description: string;
  columns: string[];
};

export type ArchitectureReviewResearchSource = Batch2FetchAndRead['sources'][number];
export type ArchitectureReviewDataQuality = Batch2FetchAndRead['data_quality'];
export type ArchitectureReviewGotcha = Batch3Architect['gotchas'][number];

type ArchitectureReviewStackSectionId =
  | 'frontend'
  | 'backend'
  | 'database'
  | 'auth'
  | 'ai'
  | 'storage'
  | 'payments'
  | 'email'
  | 'deploy';

export type ArchitectureReviewStackSection = {
  id: ArchitectureReviewStackSectionId;
  label: string;
  chips: string[];
  description: string;
};

export type ArchitectureReviewPayload = {
  project_id: string;
  project_name: string;
  project_type: string;
  project_summary: string;
  how_it_connects: string;
  recommended_stack: Batch3Architect['recommended_stack'];
  stack_cards: ArchitectureReviewStackCard[];
  stack_sections: ArchitectureReviewStackSection[];
  data_model: ArchitectureReviewDataModelTable[];
  gotchas: ArchitectureReviewGotcha[];
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

type ArchitectureReviewStackSectionConfig = {
  id: ArchitectureReviewStackSectionId;
  label: string;
  recommendedKey?: keyof Batch3Architect['recommended_stack'];
  keywords: string[];
  alwaysInclude?: boolean;
};

type LoadedBuilderProfileContext = Awaited<ReturnType<typeof loadBuilderProfileContext>>;
type LoadedProjectBriefContext = Awaited<ReturnType<typeof loadProjectBriefContext>>;

type ResearchTechnologyTarget = {
  name: string;
  docs_url?: string;
  github_url?: string;
  changelog_url?: string;
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

export class GenerationPipelineError extends Error {
  constructor(message: string, readonly alreadyPersisted = false) {
    super(message);
    this.name = 'GenerationPipelineError';
  }
}

export class RetryableGenerationPipelineError extends GenerationPipelineError {
  constructor(
    message: string,
    readonly delaySeconds = 30,
  ) {
    super(message);
    this.name = 'RetryableGenerationPipelineError';
  }
}

type BatchExecutionResult = 'complete' | 'checkpointed';

type Batch2CheckpointData = {
  researchTargets: ResearchTechnologyTarget[];
  fetchedSources: FetchedTechnologyResearch[];
  issuesFound: number;
  contextSevenBroken: boolean;
  githubIssuesBroken: boolean;
  partialFailures: Batch2FetchAndRead['data_quality']['partial_failures'];
};

type Batch5ResearchStep = Pick<
  Batch4PlanBuild['stages'][number]['steps'][number],
  'id' | 'title' | 'objective' | 'why_it_matters' | 'category' | 'done_when' | 'is_gate'
>;

type Batch5CheckpointData = {
  steps: Batch5ResearchStep[];
  stepResearchContexts: StepResearchContext[];
};

type GenerationCheckpointRecord = {
  id: string;
  payload_inline: string | null;
  payload_r2_key: string | null;
  current_index: number;
};

const ACTIVE_GENERATION_STATUSES = new Set<ProjectGenerationStatus | 'approved'>([
  'queued',
  'approved',
  'batch_1_research_stack',
  'batch_2_fetch_and_read',
  'batch_3_architect',
  'batch_4_plan_build',
  'batch_5_enrich_steps',
  'batch_6_generate_files',
]);
const ACTIVE_GENERATION_HEARTBEAT_STATUSES = Array.from(ACTIVE_GENERATION_STATUSES);

export const GENERATION_STALE_MS = 15 * 60 * 1000;
export const QUEUED_GENERATION_RESUME_MS = 2 * 60 * 1000;
export const MAX_PROJECT_GENERATION_RETRY_ATTEMPTS = 3;
const HEARTBEAT_TOUCH_INTERVAL_MS = 30 * 1000;
const GENERATION_CHECKPOINT_ITEM_INTERVAL = 20;
const MAX_BATCH1_TECHNOLOGIES = 8;
const MAX_BATCH2_RESEARCH_TARGETS = 10;
const MAX_INFERRED_BATCH2_RESEARCH_TARGETS = 6;
const MAX_PROFILE_BATCH2_RESEARCH_TARGETS = 2;
const lastHeartbeatTouchByProject = new Map<string, number>();

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

function getBatchWorkDescription(batchName: GenerationBatchName) {
  switch (batchName) {
    case 'batch_1_research_stack':
      return 'infer the implementation stack from your brief';
    case 'batch_2_fetch_and_read':
      return 'read the most relevant docs, repositories, and release notes';
    case 'batch_3_architect':
      return 'turn the research into an architecture decision record';
    case 'batch_4_plan_build':
      return 'turn the approved architecture into a staged implementation plan';
    case 'batch_5_enrich_steps':
      return 'write concrete implementation details for each step';
    case 'batch_6_generate_files':
      return 'prepare the downloadable AI companion files';
    default:
      return 'finish the current generation pass';
  }
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

function normalizeStoredSearchResults(results: Array<Partial<SearchResult>> | undefined) {
  return dedupeSearchResults(
    (results || [])
      .map((result) => ({
        title: result.title || 'Untitled source',
        url: result.url || '',
        description: result.description || '',
      }))
      .filter((result) => Boolean(result.url)),
  );
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

function targetsOverlap(left: string[], right: string[]) {
  return left.some((leftToken) =>
    right.some(
      (rightToken) =>
        leftToken === rightToken
        || leftToken.includes(rightToken)
        || rightToken.includes(leftToken),
    ),
  );
}

function toResearchTechnologyTarget(
  technology: Partial<Batch1ResearchStack['technologies'][number]>,
  source: ResearchTechnologyTarget['source'],
  docsTopic: string,
): ResearchTechnologyTarget {
  return {
    name: technology.name || 'Unknown technology',
    docs_url: technology.docs_url || '',
    github_url: technology.github_url || '',
    changelog_url: technology.changelog_url || '',
    docs_topic: docsTopic,
    community_search_results: normalizeStoredSearchResults(technology.community_search_results),
    breaking_change_search_results: normalizeStoredSearchResults(technology.breaking_change_search_results),
    source,
  };
}

function limitBatch1Technologies(technologies: Batch1ResearchStack['technologies']) {
  const uniqueTechnologies = dedupeResearchTargets(
    technologies.map((technology) => toResearchTechnologyTarget(technology, 'inferred', '')),
  );

  return uniqueTechnologies.slice(0, MAX_BATCH1_TECHNOLOGIES).map((technology) => ({
    name: technology.name,
    docs_url: technology.docs_url,
    github_url: technology.github_url,
    changelog_url: technology.changelog_url,
    community_search_results: technology.community_search_results,
    breaking_change_search_results: technology.breaking_change_search_results,
  }));
}

function filterRelevantProfileTargets(
  builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
  inferredTechnologies: Batch1ResearchStack['technologies'],
) {
  const projectTokens = [
    ...projectBrief.confirmedStackTools.flatMap((technology) => buildMatchTokens(technology)),
    ...inferredTechnologies.flatMap((technology) => buildMatchTokens(technology.name)),
  ];

  const relevantTargets = builderProfile.declaredTools.filter((tool) =>
    targetsOverlap(buildMatchTokens(tool.name), projectTokens),
  );

  if (relevantTargets.length > 0) {
    return relevantTargets.slice(0, MAX_PROFILE_BATCH2_RESEARCH_TARGETS);
  }

  if (projectTokens.length === 0) {
    return builderProfile.declaredTools.slice(0, MAX_PROFILE_BATCH2_RESEARCH_TARGETS);
  }

  return [];
}

function limitResearchTargets(targets: ResearchTechnologyTarget[]) {
  const selected: ResearchTechnologyTarget[] = [];
  let inferredCount = 0;
  let profileCount = 0;

  for (const target of targets) {
    if (selected.length >= MAX_BATCH2_RESEARCH_TARGETS) {
      break;
    }

    if (target.source === 'inferred' && inferredCount >= MAX_INFERRED_BATCH2_RESEARCH_TARGETS) {
      continue;
    }

    if (target.source === 'profile' && profileCount >= MAX_PROFILE_BATCH2_RESEARCH_TARGETS) {
      continue;
    }

    selected.push(target);

    if (target.source === 'inferred') {
      inferredCount += 1;
    } else if (target.source === 'profile') {
      profileCount += 1;
    }
  }

  return selected;
}

function buildResearchTargets(
  inferredTechnologies: Batch1ResearchStack['technologies'],
  builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
) {
  const inferredTargets: ResearchTechnologyTarget[] = inferredTechnologies.map((technology) =>
    toResearchTechnologyTarget(
      technology,
      'inferred',
      'installation, migration, compatibility, breaking changes, best practices',
    ),
  );

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

  const profileTargets: ResearchTechnologyTarget[] = filterRelevantProfileTargets(
    builderProfile,
    projectBrief,
    inferredTechnologies,
  ).map((tool) => ({
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

  return limitResearchTargets(dedupeResearchTargets([...briefTargets, ...inferredTargets, ...profileTargets]));
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

function pushPartialFailure(
  partialFailures: Batch2FetchAndRead['data_quality']['partial_failures'],
  tool: string,
  technology: string,
  message: string,
) {
  const nextFailure = {
    tool,
    technology,
    message,
  };

  const alreadyRecorded = partialFailures.some((failure) =>
    failure.tool === nextFailure.tool
      && (failure.technology || '') === (nextFailure.technology || '')
      && failure.message === nextFailure.message,
  );

  if (!alreadyRecorded) {
    partialFailures.push(nextFailure);
  }
}

const MAX_BATCH2_PROMPT_CHARS = 120_000;

function buildBatch2PromptPayload(
  fetchedSources: FetchedTechnologyResearch[],
  dataQuality: Batch2FetchAndRead['data_quality'],
) {
  return {
    fetchedSources: fetchedSources.map((source) => ({
      technology: source.technology,
      docs_content: trimToLimit(source.docs_content, 6_000),
      github_readme: trimToLimit(source.github_readme, 4_000),
      latest_version: source.latest_version,
      last_commit_date: source.last_commit_date,
      open_issues_count: source.open_issues_count,
      recent_breaking_changes: trimToLimit(source.recent_breaking_changes, 3_000),
      repo_health_summary: trimToLimit(source.repo_health_summary, 1_200),
      community_sentiment: trimToLimit(source.community_sentiment, 2_000),
      bug_report_digest: trimToLimit(source.bug_report_digest, 2_000),
      sources: source.source_ledger.slice(0, 8).map((entry) => ({
        technology: entry.technology,
        url: entry.url,
        tool: entry.tool,
        title: trimToLimit(entry.title, 120),
        summary: trimToLimit(entry.summary, 360),
      })),
    })),
    dataQuality,
  };
}

function stringifyBatch2PromptPayload(
  fetchedSources: FetchedTechnologyResearch[],
  dataQuality: Batch2FetchAndRead['data_quality'],
) {
  const payload = buildBatch2PromptPayload(fetchedSources, dataQuality);
  const serialized = JSON.stringify(payload, null, 2);
  if (serialized.length > MAX_BATCH2_PROMPT_CHARS) {
    throw new GenerationPipelineError(
      `Batch 2 research payload exceeded the prompt budget (${serialized.length} chars). Reduce the fetched research before calling the model.`,
    );
  }

  return serialized;
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

const architectureReviewStackSectionConfigs: ArchitectureReviewStackSectionConfig[] = [
  {
    id: 'frontend',
    label: 'Frontend',
    recommendedKey: 'frontend',
    keywords: ['frontend', 'client', 'browser', 'ui', 'react', 'next', 'vite', 'tailwind'],
  },
  {
    id: 'backend',
    label: 'Backend',
    recommendedKey: 'backend',
    keywords: ['backend', 'server', 'api', 'worker', 'hono', 'express', 'fastify', 'lambda'],
  },
  {
    id: 'database',
    label: 'Database',
    recommendedKey: 'database',
    keywords: ['database', 'db', 'sql', 'postgres', 'mysql', 'sqlite', 'd1', 'prisma', 'drizzle', 'orm'],
  },
  {
    id: 'auth',
    label: 'Auth',
    recommendedKey: 'auth',
    keywords: ['auth', 'authentication', 'authorization', 'session', 'oauth', 'jwt', 'clerk', 'firebase'],
  },
  {
    id: 'ai',
    label: 'AI',
    keywords: ['ai', 'llm', 'openai', 'anthropic', 'gemini', 'model', 'inference', 'embeddings', 'vector'],
  },
  {
    id: 'storage',
    label: 'Storage',
    keywords: ['storage', 'bucket', 'upload', 'uploads', 'file', 'files', 'asset', 'assets', 'blob', 'r2', 's3'],
  },
  {
    id: 'payments',
    label: 'Payments',
    recommendedKey: 'payments',
    keywords: ['payment', 'payments', 'billing', 'checkout', 'invoice', 'subscription', 'stripe', 'paypal', 'paddle'],
    alwaysInclude: true,
  },
  {
    id: 'email',
    label: 'Email',
    recommendedKey: 'email',
    keywords: ['email', 'mail', 'smtp', 'resend', 'postmark', 'sendgrid'],
  },
  {
    id: 'deploy',
    label: 'Deploy',
    recommendedKey: 'deploy',
    keywords: ['deploy', 'deployment', 'hosting', 'host', 'vercel', 'netlify', 'cloudflare pages', 'docker'],
  },
];

function hasTokenOverlap(left: string[], right: string[]) {
  return left.some((leftToken) =>
    right.some(
      (rightToken) => leftToken.includes(rightToken) || rightToken.includes(leftToken),
    ),
  );
}

function isMeaningfulArchitectureSelection(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === '-' || normalized === '—') {
    return false;
  }

  return !(
    normalized === 'none'
    || normalized === 'n/a'
    || normalized === 'na'
    || normalized.startsWith('none ')
    || normalized.includes('not needed')
    || normalized.includes('not in scope')
    || normalized.includes('not required')
  );
}

function ensureSentence(value: string, fallback: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  const normalized = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function buildIntegrationChip(integration: Batch3Architect['integrations'][number]) {
  const service = integration.service.trim() || integration.package_name.trim();
  const version = integration.version.trim();
  if (!version || version === 'Unknown' || service.toLowerCase().includes(version.toLowerCase())) {
    return service;
  }

  return `${service} ${version}`;
}

function defaultStackSectionDescription(
  config: ArchitectureReviewStackSectionConfig,
  adr: Batch3Architect,
) {
  switch (config.id) {
    case 'frontend':
      return 'Handles the interface people use and the flows they move through.';
    case 'backend':
      return 'Runs the application logic, APIs, and the work happening behind the scenes.';
    case 'database':
      return adr.data_model.length > 0
        ? `Stores the core product records across ${adr.data_model.length} main table${adr.data_model.length === 1 ? '' : 's'}.`
        : 'Stores the core product records and supporting history.';
    case 'auth':
      return 'Signs people in and controls access to private data.';
    case 'ai':
      return 'Powers the model-driven parts of the product and any AI-assisted workflows.';
    case 'storage':
      return 'Holds uploads, generated assets, and large payloads outside the main database.';
    case 'payments':
      return 'Not part of the current scope.';
    case 'email':
      return 'Sends transactional updates and product emails when the flow needs them.';
    case 'deploy':
      return 'Hosts the product in production and delivers it to end users.';
  }

  return 'Supports this part of the architecture.';
}

function buildStackSectionDescription(
  config: ArchitectureReviewStackSectionConfig,
  adr: Batch3Architect,
  matchingIntegrations: Batch3Architect['integrations'],
) {
  const fallback = defaultStackSectionDescription(config, adr);
  const purpose = matchingIntegrations
    .map((integration) => integration.purpose.trim())
    .find(Boolean);

  if (!purpose) {
    return fallback;
  }

  const baseSentence = ensureSentence(purpose, fallback);
  if (config.id === 'database' && adr.data_model.length > 0 && !baseSentence.toLowerCase().includes('table')) {
    return `${baseSentence} ${adr.data_model.length} core table${adr.data_model.length === 1 ? '' : 's'} support the product data.`;
  }

  return baseSentence;
}

function buildArchitectureStackSections(adr: Batch3Architect): ArchitectureReviewStackSection[] {
  return architectureReviewStackSectionConfigs.flatMap((config) => {
    const selection = config.recommendedKey ? adr.recommended_stack[config.recommendedKey] : '';
    const selectionTokens = isMeaningfulArchitectureSelection(selection) ? buildMatchTokens(selection) : [];
    const matchingIntegrations = adr.integrations.filter((integration) => {
      const integrationTokens = buildMatchTokens(
        integration.service,
        integration.package_name,
        integration.purpose,
      );

      return (
        (selectionTokens.length > 0 && hasTokenOverlap(selectionTokens, integrationTokens))
        || hasTokenOverlap(config.keywords, integrationTokens)
      );
    });

    const chips = Array.from(
      new Set(
        [
          ...matchingIntegrations.map(buildIntegrationChip),
          ...(isMeaningfulArchitectureSelection(selection) ? [selection.trim()] : []),
        ]
          .map((chip) => chip.trim())
          .filter(Boolean),
      ),
    ).slice(0, 4);

    if (chips.length === 0 && !config.alwaysInclude) {
      return [];
    }

    return [{
      id: config.id,
      label: config.label,
      chips,
      description: chips.length > 0
        ? buildStackSectionDescription(config, adr, matchingIntegrations)
        : defaultStackSectionDescription(config, adr),
    }];
  });
}

function humanizeIdentifier(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularizeIdentifier(value: string) {
  if (value.endsWith('ies') && value.length > 3) {
    return `${value.slice(0, -3)}y`;
  }

  if (value.endsWith('ses') || value.endsWith('ss')) {
    return value;
  }

  if (value.endsWith('s') && value.length > 3) {
    return value.slice(0, -1);
  }

  return value;
}

function describeArchitectureDataTable(table: Batch3Architect['data_model'][number]) {
  const tableName = table.table.toLowerCase();
  const columnTokens = buildMatchTokens(
    table.table,
    ...table.columns.map((column) => `${column.name} ${column.notes || ''}`),
    ...table.relationships,
  );
  const foreignKeyCount = table.columns.filter((column) => column.name.toLowerCase().endsWith('_id')).length;

  if (/user|profile|account|member|customer/.test(tableName) || hasTokenOverlap(columnTokens, ['user', 'profile', 'account'])) {
    return 'Stores the people using the product and the details tied to their account.';
  }

  if (/project|workspace|team|organization|company|board/.test(tableName)) {
    return 'Stores the top-level spaces or projects the rest of the product data belongs to.';
  }

  if (/session|token|invite|permission|role|access|auth/.test(tableName)) {
    return 'Stores sign-in state, permissions, and the records that control access.';
  }

  if (/payment|invoice|billing|subscription|checkout/.test(tableName)) {
    return 'Stores billing state, subscriptions, and payment history.';
  }

  if (/message|conversation|chat|thread|comment|notification|activity|event|log|history|audit/.test(tableName)) {
    return 'Stores conversations, updates, and the activity trail inside the product.';
  }

  if (/file|asset|media|document|upload|attachment/.test(tableName)) {
    return 'Stores uploaded files and the metadata needed to retrieve them later.';
  }

  if (/task|step|todo|ticket|issue|item/.test(tableName)) {
    return 'Stores the main work items users create, track, and complete in the product.';
  }

  if (foreignKeyCount >= 2 && table.columns.length <= 5) {
    return 'Stores the link records that connect the main objects together.';
  }

  const singularName = humanizeIdentifier(singularizeIdentifier(table.table));
  if (table.relationships.length > 0) {
    return `Stores the core ${singularName} records and their links to the rest of the product.`;
  }

  return `Stores the core ${singularName} records used by this product.`;
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
    project_summary:
      optionalText(adr.project_summary)
      || `${adr.project_name} is being built around the selected stack and the research-backed architecture recommendations.`,
    how_it_connects:
      optionalText(adr.how_it_connects)
      || 'The interface talks to the application backend, the backend writes to the core database, and the supporting services handle the surrounding workflows.',
    recommended_stack: adr.recommended_stack,
    stack_cards: stackCards.length > 0 ? stackCards : fallbackStackCardsFromRecommendedStack(adr),
    stack_sections: buildArchitectureStackSections(adr),
    data_model: adr.data_model.map((table) => ({
      table: table.table,
      description: describeArchitectureDataTable(table),
      columns: table.columns.map((column) => `${column.name} (${column.type})`),
    })),
    gotchas: adr.gotchas,
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

function makeUniquePlanId(value: string, fallbackPrefix: string, index: number, seen: Set<string>) {
  const base = normalizeBuilderProfileName(value) || `${fallbackPrefix}-${index + 1}`;
  let candidate = base;
  let suffix = 2;

  while (seen.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  seen.add(candidate);
  return candidate;
}

function normalizePlanStructure(plan: Batch4PlanBuild): Batch4PlanBuild {
  const seenStageIds = new Set<string>();
  const seenStepIds = new Set<string>();
  const seenChecklistIds = new Set<string>();
  const seenEdgeIds = new Set<string>();
  const stepIdMap = new Map<string, string>();
  let globalStepIndex = 0;

  const stages = plan.stages.map((stage, stageIndex) => {
    const stageId = makeUniquePlanId(stage.id, 'stage', stageIndex, seenStageIds);
    const steps = stage.steps.map((step, stepIndex) => {
      const normalizedStepId = makeUniquePlanId(
        step.id || `${stageId}-step-${stepIndex + 1}`,
        'step',
        globalStepIndex,
        seenStepIds,
      );
      if (step.id) {
        stepIdMap.set(step.id, normalizedStepId);
      }

      const checklist = step.checklist.map((item, checklistIndex) => ({
        ...item,
        id: makeUniquePlanId(
          item.id || `${normalizedStepId}-check-${checklistIndex + 1}`,
          'check',
          checklistIndex,
          seenChecklistIds,
        ),
        label: item.label || `Check ${checklistIndex + 1}`,
      }));

      globalStepIndex += 1;

      return {
        ...step,
        id: normalizedStepId,
        checklist,
      };
    });

    return {
      ...stage,
      id: stageId,
      order_index: Number.isFinite(stage.order_index) ? stage.order_index : stageIndex,
      steps,
    };
  });

  const validStepIds = new Set(stages.flatMap((stage) => stage.steps.map((step) => step.id)));
  const edges: Batch4PlanBuild['edges'] = [];
  for (const [index, edge] of plan.edges.entries()) {
    const sourceStepId = stepIdMap.get(edge.source_step_id) || edge.source_step_id;
    const targetStepId = stepIdMap.get(edge.target_step_id) || edge.target_step_id;

    if (!sourceStepId || !targetStepId || sourceStepId === targetStepId) {
      continue;
    }

    if (!validStepIds.has(sourceStepId) || !validStepIds.has(targetStepId)) {
      continue;
    }

    edges.push({
      ...edge,
      id: makeUniquePlanId(
        edge.id || `${sourceStepId}-to-${targetStepId}`,
        'edge',
        index,
        seenEdgeIds,
      ),
      source_step_id: sourceStepId,
      target_step_id: targetStepId,
      edge_type: edge.edge_type || 'default',
    });
  }

  return {
    ...plan,
    stages,
    edges,
  };
}

function buildFallbackStepEnrichmentBody(step: Batch5ResearchStep) {
  return [
    `${step.title} still needs a final AI write-up, so Scrimble preserved the core execution guidance instead of blocking the workflow.`,
    step.objective ? `Goal: ${step.objective}` : 'Goal: Complete this part of the build using the approved architecture and current plan.',
    step.why_it_matters ? `Why it matters: ${step.why_it_matters}` : '',
    step.done_when ? `Done when: ${step.done_when}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function normalizePromptCards(prompts: Batch5EnrichSteps['enrichments'][number]['prompts']) {
  return prompts.filter((prompt) => prompt.label.trim() && prompt.content.trim());
}

function ensureCompleteStepEnrichments(
  steps: Batch5ResearchStep[],
  stepResearchById: Map<string, StepResearchContext>,
  enrichments: Batch5EnrichSteps['enrichments'],
): Batch5EnrichSteps['enrichments'] {
  const enrichmentById = new Map<string, Batch5EnrichSteps['enrichments'][number]>();

  for (const enrichment of enrichments) {
    if (!enrichment.step_id || enrichmentById.has(enrichment.step_id)) {
      continue;
    }

    enrichmentById.set(enrichment.step_id, {
      step_id: enrichment.step_id,
      ai_output: enrichment.ai_output.trim(),
      prompts: normalizePromptCards(enrichment.prompts),
    });
  }

  return steps.map((step) => {
    const footer =
      stepResearchById.get(step.id)?.footer
      || `Researched ${new Date().toISOString().slice(0, 10)} — connect more tools in Settings for deeper results.`;
    const existing = enrichmentById.get(step.id);
    const body = existing?.ai_output || buildFallbackStepEnrichmentBody(step);

    return {
      step_id: step.id,
      ai_output: appendResearchFooter(body, footer),
      prompts: existing?.prompts || [],
    };
  });
}

function normalizeGeneratedFileName(value: string): SkillFileName | null {
  return SKILL_FILE_NAMES.includes(value as SkillFileName) ? (value as SkillFileName) : null;
}

function buildFallbackGeneratedFileContent(filename: SkillFileName) {
  switch (filename) {
    case '.cursor/rules/scrimble-project.mdc':
      return [
        '---',
        'description: Scrimble fallback project rules',
        'globs:',
        'alwaysApply: false',
        '---',
        '',
        'Scrimble could not fully regenerate this file in the last pass.',
        'Use the approved architecture, plan, and generated context files as the source of truth, then rerun generation when you want a refreshed rules file.',
      ].join('\n');
    case 'scrimble-mcp.json':
      return JSON.stringify({ mcpServers: {} }, null, 2);
    case '.windsurfrules':
      return [
        'Scrimble fallback rules',
        '',
        'The latest generation run could not fully rewrite this file.',
        'Use the approved architecture, the enriched plan, and the downloaded context files as the current source of truth.',
      ].join('\n');
    case 'CLAUDE.md':
    case '.github/copilot-instructions.md':
    case 'scrimble-context.md':
    default:
      return [
        `# ${filename}`,
        '',
        'Scrimble could not fully regenerate this file in the last pass.',
        'Use the approved architecture, the enriched plan, and the rest of the generated files as the current source of truth, then rerun generation when you want a refreshed version.',
      ].join('\n');
  }
}

async function loadExistingGeneratedFileMap(env: Bindings, projectId: string) {
  const rows = await env.DB.prepare(`
    SELECT filename, content
    FROM project_files
    WHERE project_id = ?
  `)
    .bind(projectId)
    .all();

  const fileMap = new Map<SkillFileName, string>();

  for (const row of rows.results as Array<{ filename?: unknown; content?: unknown }>) {
    const filename = normalizeGeneratedFileName(typeof row.filename === 'string' ? row.filename : '');
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    if (!filename || !content) {
      continue;
    }

    fileMap.set(filename, content);
  }

  return fileMap;
}

async function ensureCompleteGeneratedFiles(
  env: Bindings,
  projectId: string,
  files: Batch6GenerateFiles['files'],
): Promise<Array<{ filename: SkillFileName; content: string }>> {
  const existingFiles = await loadExistingGeneratedFileMap(env, projectId);
  const nextFiles = new Map<SkillFileName, string>();

  for (const file of files) {
    const filename = normalizeGeneratedFileName(file.filename);
    const content = file.content.trim();

    if (!filename || !content || nextFiles.has(filename)) {
      continue;
    }

    nextFiles.set(filename, content);
  }

  return SKILL_FILE_NAMES.map((filename) => ({
    filename,
    content: nextFiles.get(filename) || existingFiles.get(filename) || buildFallbackGeneratedFileContent(filename),
  }));
}

function flattenPlanSteps(plan: Batch4PlanBuild): Batch5ResearchStep[] {
  return plan.stages.flatMap((stage) =>
    stage.steps.map((step) => ({
      id: step.id,
      title: step.title,
      objective: step.objective,
      why_it_matters: step.why_it_matters,
      category: step.category,
      done_when: step.done_when,
      is_gate: step.is_gate,
    })),
  );
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
    clearCompletedAt?: boolean;
    touchHeartbeat?: boolean;
    generationRunId?: string | null;
    generationProviderId?: string | null;
    expectedRunId?: string | null;
  } = {},
) {
  const generationError = options.generationError ?? null;
  const result = await env.DB.prepare(`
    UPDATE projects
    SET generation_status = ?,
        generation_error = ?,
        generation_run_id = CASE
          WHEN ? = 1 THEN ?
          ELSE generation_run_id
        END,
        generation_provider_id = CASE
          WHEN ? = 1 THEN ?
          ELSE generation_provider_id
        END,
        generation_started_at = CASE
          WHEN ? = 1 AND generation_started_at IS NULL THEN datetime("now")
          ELSE generation_started_at
        END,
        generation_completed_at = CASE
          WHEN ? = 1 THEN datetime("now")
          WHEN ? = 1 THEN NULL
          ELSE generation_completed_at
        END,
        generation_heartbeat_at = CASE
          WHEN ? = 1 THEN datetime("now")
          ELSE generation_heartbeat_at
        END,
        updated_at = datetime("now")
    WHERE id = ?
      AND generation_status <> 'cancelled'
      AND (
        ? IS NULL
        OR generation_run_id IS NULL
        OR generation_run_id = ?
      )
  `)
    .bind(
      generationStatus,
      generationError,
      options.generationRunId !== undefined ? 1 : 0,
      options.generationRunId ?? null,
      options.generationProviderId !== undefined ? 1 : 0,
      options.generationProviderId ?? null,
      options.markStarted ? 1 : 0,
      options.markCompleted ? 1 : 0,
      options.clearCompletedAt ? 1 : 0,
      options.touchHeartbeat ? 1 : 0,
      projectId,
      options.expectedRunId ?? null,
      options.expectedRunId ?? null,
    )
    .run();

  return Number((result as { meta?: { changes?: number } }).meta?.changes || 0);
}

async function touchGenerationHeartbeat(
  env: Bindings,
  projectId: string,
  runId?: string | null,
) {
  if (runId) {
    const result = await env.DB.prepare(`
      UPDATE projects
      SET generation_run_id = CASE
            WHEN generation_run_id IS NULL THEN ?
            ELSE generation_run_id
          END,
          generation_heartbeat_at = datetime("now"),
          updated_at = datetime("now")
      WHERE id = ?
        AND generation_status IN (${ACTIVE_GENERATION_HEARTBEAT_STATUSES.map(() => '?').join(', ')})
        AND (generation_run_id IS NULL OR generation_run_id = ?)
    `)
      .bind(runId, projectId, ...ACTIVE_GENERATION_HEARTBEAT_STATUSES, runId)
      .run();

    if (Number((result as { meta?: { changes?: number } }).meta?.changes || 0) > 0) {
      lastHeartbeatTouchByProject.set(projectId, Date.now());
    }
    return;
  }

  const result = await env.DB.prepare(`
    UPDATE projects
    SET generation_heartbeat_at = datetime("now"),
        updated_at = datetime("now")
    WHERE id = ?
      AND generation_status IN (${ACTIVE_GENERATION_HEARTBEAT_STATUSES.map(() => '?').join(', ')})
  `)
    .bind(projectId, ...ACTIVE_GENERATION_HEARTBEAT_STATUSES)
    .run();

  if (Number((result as { meta?: { changes?: number } }).meta?.changes || 0) > 0) {
    lastHeartbeatTouchByProject.set(projectId, Date.now());
  }
}

async function maybeTouchGenerationHeartbeat(
  env: Bindings,
  projectId: string,
  runId?: string | null,
) {
  const lastTouchedAt = lastHeartbeatTouchByProject.get(projectId) || 0;
  if (Date.now() - lastTouchedAt < HEARTBEAT_TOUCH_INTERVAL_MS) {
    return;
  }

  await touchGenerationHeartbeat(env, projectId, runId);
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
  const storedOutput = payload.output
    ? await storeJsonPayload(
        env,
        `agent-runs/${payload.projectId}/${payload.runType}/${id}`,
        payload.output,
      )
    : { inlineText: null, r2Key: null };

  await env.DB.prepare(`
    INSERT INTO agent_runs (
      id, project_id, run_type, status, input, output, output_r2_key, provider, model, sequence_index, attempt_count, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))
  `)
    .bind(
      id,
      payload.projectId,
      payload.runType,
      payload.status,
      payload.input || null,
      storedOutput.inlineText,
      storedOutput.r2Key,
      payload.provider || null,
      payload.model || null,
      payload.sequenceIndex,
      payload.attemptCount,
    )
    .run();

  return id;
}

async function loadGenerationCheckpoint<T>(
  env: Bindings,
  projectId: string,
  runId: string,
  batchName: GenerationBatchName,
): Promise<{ currentIndex: number; data: T } | null> {
  const record = await env.DB.prepare(`
    SELECT id, payload_inline, payload_r2_key, current_index
    FROM generation_checkpoints
    WHERE project_id = ? AND run_id = ? AND batch_name = ?
    LIMIT 1
  `)
    .bind(projectId, runId, batchName)
    .first();

  const typedRecord = record as GenerationCheckpointRecord | null;
  if (!typedRecord) {
    return null;
  }

  const data = await loadJsonPayload<T>(env, typedRecord.payload_inline, typedRecord.payload_r2_key);
  if (!data) {
    console.error('[GENERATION_CHECKPOINT] Missing or unreadable checkpoint payload.', {
      projectId,
      runId,
      batchName,
      hasInlinePayload: Boolean(typedRecord.payload_inline),
      payloadR2Key: typedRecord.payload_r2_key,
    });
    throw new GenerationPipelineError(
      `Checkpoint data for ${batchName} is unavailable. Resume again to restart from the last safe point.`,
    );
  }

  return {
    currentIndex: Number(typedRecord.current_index) || 0,
    data,
  };
}

async function saveGenerationCheckpoint<T>(
  env: Bindings,
  projectId: string,
  runId: string,
  batchName: GenerationBatchName,
  currentIndex: number,
  data: T,
) {
  const existing = await env.DB.prepare(`
    SELECT id, payload_r2_key
    FROM generation_checkpoints
    WHERE project_id = ? AND run_id = ? AND batch_name = ?
    LIMIT 1
  `)
    .bind(projectId, runId, batchName)
    .first();

  const typedExisting = existing as { id: string; payload_r2_key: string | null } | null;
  const storedPayload = await storeJsonPayload(
    env,
    `generation-checkpoints/${projectId}/${runId}/${batchName}`,
    data,
    typedExisting?.payload_r2_key || null,
  );

  if (typedExisting) {
    await env.DB.prepare(`
      UPDATE generation_checkpoints
      SET current_index = ?,
          payload_inline = ?,
          payload_r2_key = ?,
          size_bytes = ?,
          updated_at = datetime("now")
      WHERE id = ?
    `)
      .bind(
        currentIndex,
        storedPayload.inlineText,
        storedPayload.r2Key,
        storedPayload.sizeBytes,
        typedExisting.id,
      )
      .run();
  } else {
    await env.DB.prepare(`
      INSERT INTO generation_checkpoints (
        id, project_id, run_id, batch_name, current_index, payload_inline, payload_r2_key, size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        crypto.randomUUID(),
        projectId,
        runId,
        batchName,
        currentIndex,
        storedPayload.inlineText,
        storedPayload.r2Key,
        storedPayload.sizeBytes,
      )
      .run();
  }

  await touchGenerationHeartbeat(env, projectId, runId);
}

async function clearGenerationCheckpoint(
  env: Bindings,
  projectId: string,
  runId: string,
  batchName: GenerationBatchName,
) {
  const existing = await env.DB.prepare(`
    SELECT id, payload_r2_key
    FROM generation_checkpoints
    WHERE project_id = ? AND run_id = ? AND batch_name = ?
    LIMIT 1
  `)
    .bind(projectId, runId, batchName)
    .first();

  const typedExisting = existing as { id: string; payload_r2_key: string | null } | null;
  if (!typedExisting) {
    return;
  }

  await deleteJsonPayload(env, typedExisting.payload_r2_key);
  await env.DB.prepare('DELETE FROM generation_checkpoints WHERE id = ?')
    .bind(typedExisting.id)
    .run();
}

export async function clearGenerationCheckpoints(
  env: Bindings,
  projectId: string,
  runId?: string,
) {
  const rows = await env.DB.prepare(`
    SELECT id, payload_r2_key
    FROM generation_checkpoints
    WHERE project_id = ?
      ${runId ? 'AND run_id = ?' : ''}
  `)
    .bind(...(runId ? [projectId, runId] : [projectId]))
    .all();

  for (const row of rows.results as Array<{ id: string; payload_r2_key: string | null }>) {
    await deleteJsonPayload(env, row.payload_r2_key);
  }

  await env.DB.prepare(`
    DELETE FROM generation_checkpoints
    WHERE project_id = ?
      ${runId ? 'AND run_id = ?' : ''}
  `)
    .bind(...(runId ? [projectId, runId] : [projectId]))
    .run();
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

function staleGenerationRunError(projectId: string, runId: string, phase: string) {
  return new GenerationPipelineError(
    `Generation run ${runId} for project ${projectId} is no longer active while ${phase}.`,
    true,
  );
}

async function emitBatchStart(env: Bindings, projectId: string, runId: string, batchName: GenerationBatchName) {
  const statusChanges = await updateProjectGenerationStatus(env, projectId, batchName, {
    generationError: null,
    markStarted: true,
    clearCompletedAt: true,
    touchHeartbeat: true,
    generationRunId: runId,
    expectedRunId: runId,
  });
  if (statusChanges === 0) {
    throw staleGenerationRunError(projectId, runId, `starting ${batchName}`);
  }
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
    runId?: string | null;
    kind: ActivityKind;
    message: string;
  },
) {
  await maybeTouchGenerationHeartbeat(env, payload.projectId, payload.runId);
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

async function callAITextWithHeartbeat(
  env: Bindings,
  projectId: string,
  runId: string,
  payload: Parameters<typeof callAIText>[0],
) {
  const intervalId = setInterval(() => {
    void touchGenerationHeartbeat(env, projectId, runId).catch((error) => {
      console.warn('[generation-heartbeat] Failed to refresh heartbeat during AI call:', error);
    });
  }, HEARTBEAT_TOUCH_INTERVAL_MS);

  try {
    await touchGenerationHeartbeat(env, projectId, runId);
    const response = await callAIText(payload);
    await touchGenerationHeartbeat(env, projectId, runId);
    return response;
  } finally {
    clearInterval(intervalId);
  }
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
    SELECT id, input, output, output_r2_key
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

  const storedOutput = typedRecord
    ? await loadJsonPayloadText(env, typedRecord.output, typedRecord.output_r2_key)
    : null;

  if (!storedOutput) {
    throw new GenerationPipelineError(`Missing output for ${runType}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(storedOutput);
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

  const storedOutput = architectRun
    ? await loadJsonPayloadText(env, architectRun.output, architectRun.output_r2_key)
    : null;

  if (!architectRun?.id || !storedOutput) {
    throw new GenerationPipelineError('Architecture review is not ready yet.');
  }

  let parsedOutput: unknown;
  try {
    parsedOutput = JSON.parse(storedOutput);
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

export async function hasApprovedArchitectureReview(env: Bindings, projectId: string) {
  const runs = await env.DB.prepare(`
    SELECT input
    FROM agent_runs
    WHERE project_id = ?
      AND run_type = 'batch_3_architect'
      AND status = 'complete'
    ORDER BY created_at DESC
  `)
    .bind(projectId)
    .all();

  for (const row of runs.results as Array<{ input: string | null }>) {
    const parsedInput = parseJsonObject(row.input);
    if (optionalText(parsedInput.review_feedback_updated_at) !== null) {
      return true;
    }
  }

  return false;
}

export function isGenerationExecutionStale(
  generationStatus: string | null | undefined,
  heartbeatAt: string | null | undefined,
  now = Date.now(),
) {
  if (!generationStatus || !ACTIVE_GENERATION_STATUSES.has(generationStatus as ProjectGenerationStatus)) {
    return false;
  }

  return isHeartbeatOlderThan(heartbeatAt, GENERATION_STALE_MS, now);
}

export function isQueuedGenerationResumeReady(
  generationStatus: string | null | undefined,
  heartbeatAt: string | null | undefined,
  now = Date.now(),
) {
  return generationStatus === 'queued' && isHeartbeatOlderThan(heartbeatAt, QUEUED_GENERATION_RESUME_MS, now);
}

function isHeartbeatOlderThan(
  heartbeatAt: string | null | undefined,
  maxAgeMs: number,
  now = Date.now(),
) {
  if (!heartbeatAt) {
    return true;
  }

  const heartbeatTimestamp = Date.parse(heartbeatAt);
  if (Number.isNaN(heartbeatTimestamp)) {
    return true;
  }

  return now - heartbeatTimestamp > maxAgeMs;
}

export function resolveResumeGenerationStatus(
  completedBatches: string[],
  hasReviewApproval: boolean,
): ProjectGenerationStatus {
  if (!completedBatches.includes('batch_1_research_stack')) {
    return 'queued';
  }

  if (!completedBatches.includes('batch_2_fetch_and_read')) {
    return 'batch_1_research_stack';
  }

  if (!completedBatches.includes('batch_3_architect')) {
    return 'batch_2_fetch_and_read';
  }

  if (!hasReviewApproval) {
    return 'awaiting_review';
  }

  if (!completedBatches.includes('batch_4_plan_build')) {
    return 'approved';
  }

  if (!completedBatches.includes('batch_5_enrich_steps')) {
    return 'batch_4_plan_build';
  }

  if (!completedBatches.includes('batch_6_generate_files')) {
    return 'batch_5_enrich_steps';
  }

  return 'batch_6_generate_files';
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
    runId: string;
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
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await logActivity(options.env, {
        projectId: options.projectId,
        batchName: options.runType,
        kind: 'system',
        message:
          attempt === 1
            ? `Waiting for ${provider.model} to ${getBatchWorkDescription(options.runType)}...`
            : `Retrying ${getBatchStartLabel(options.runType).toLowerCase()} with a stricter JSON correction pass...`,
      });
      const { text } = await callAITextWithHeartbeat(options.env, options.projectId, options.runId, {
        providerType: provider.providerType,
        apiKey: provider.apiKey,
        model: provider.model,
        baseUrl: provider.baseUrl,
        system: options.systemPrompt,
        prompt,
        onReasoningDelta: emitter.onReasoningDelta,
      });
      await logActivity(options.env, {
        projectId: options.projectId,
        batchName: options.runType,
        kind: 'system',
        message: `Model response received for ${getBatchStartLabel(options.runType).toLowerCase()}. Validating and applying it now...`,
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
          await logActivity(options.env, {
            projectId: options.projectId,
            batchName: options.runType,
            kind: 'warning',
            message: 'The first model reply was not valid JSON, so I asked for a corrected response before continuing.',
          });
          prompt = containsStreamTransportMarkers(text)
            ? formatTransportRetryPrompt(options.prompt, options.schemaDescription)
            : formatValidationRetryPrompt(options.prompt, cleanedText, options.schemaDescription);
          continue;
        }

        throw new GenerationPipelineError(`${lastError} Please retry.`);
      }

      const validated = options.schema.safeParse(parsed);
      if (validated.success) {
        return {
          data: validated.data,
          rawResponse: JSON.stringify(validated.data),
          attemptCount: attempt,
        };
      }

      const validationError = validated.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      lastError = `Validation failed for ${options.runType}: ${validationError}`;
      logBatchResponseFailure(options.runType, 'schema', cleanedText);
      
      if (attempt === 1) {
          await logActivity(options.env, {
            projectId: options.projectId,
            batchName: options.runType,
            kind: 'warning',
            message: `The first model reply had a schema error, so I'm asking for a correction.`,
          });
          prompt = formatValidationRetryPrompt(options.prompt, cleanedText, `${options.schemaDescription}\n\nERROR TO FIX: ${validationError}`);
          continue;
      }

      throw new GenerationPipelineError(`${lastError} Please retry.`);
    }

    throw new GenerationPipelineError(lastError);
  } finally {
    await emitter.flush();
  }
}

async function failBatch(
  env: Bindings,
  projectId: string,
  runId: string,
  provider: ProviderConfig,
  runType: GenerationBatchName,
  input: unknown,
  message: string,
  attemptCount: number,
): Promise<never> {
  const statusChanges = await updateProjectGenerationStatus(env, projectId, 'failed', {
    generationError: message,
    markStarted: true,
    markCompleted: true,
    touchHeartbeat: true,
    generationRunId: runId,
    expectedRunId: runId,
  });
  if (statusChanges === 0) {
    throw staleGenerationRunError(projectId, runId, `failing ${runType}`);
  }

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
  runId: string,
  provider: ProviderConfig,
  runType: GenerationBatchName,
  input: unknown,
  data: T,
  attemptCount: number,
  storedOutput: unknown = data,
  durationMs = 0,
) {
  const statusChanges = await updateProjectGenerationStatus(env, projectId, runType, {
    generationError: null,
    markStarted: true,
    touchHeartbeat: true,
    generationRunId: runId,
    expectedRunId: runId,
  });
  if (statusChanges === 0) {
    throw staleGenerationRunError(projectId, runId, `completing ${runType}`);
  }

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
      .bind(workflowId, projectId, 1, JSON.stringify({ x: 0, y: 0, zoom: 1 }))
      .run();
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

async function persistGeneratedFiles(
  env: Bindings,
  projectId: string,
  files: Array<{ filename: SkillFileName; content: string }>,
) {
  const statements: Array<any> = [env.DB.prepare('DELETE FROM project_files WHERE project_id = ?').bind(projectId)];

  const orderedFiles = [...files].sort(
    (left, right) => getSkillFileSortIndex(left.filename) - getSkillFileSortIndex(right.filename),
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
  runId: string,
  _builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
): Promise<BatchExecutionResult> {
  const startedAt = Date.now();
  const input = {
    description: projectBrief.summary || project.description || '',
  };

  await emitBatchStart(env, project.id, runId, 'batch_1_research_stack');
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
      runId,
      runType: 'batch_1_research_stack',
      systemPrompt,
      prompt,
      schema: Batch1ResearchStackSchema,
      schemaDescription: schemaDescriptions.batch_1_research_stack,
    });
    const technologies = limitBatch1Technologies(result.data.technologies);

    if (technologies.length < result.data.technologies.length) {
      await logActivity(env, {
        projectId: project.id,
        batchName: 'batch_1_research_stack',
        kind: 'system',
        message: `Focused the stack scan on the top ${technologies.length} implementation-critical technologies so research stays fast.`,
      });
    }

    const enrichedBatch1 = {
      technologies,
    };

    await completeBatch(
      env,
      project.id,
      runId,
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
      message: `Stack candidates identified — ${enrichedBatch1.technologies.length} technologies queued for deeper research next.`,
    });
    return 'complete';
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Batch 1 failed.';
    const isRetryable = 
      error instanceof RetryableAIError ||
      errorMessage.includes('Network connection lost') ||
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('ECONNREFUSED');
    
    if (isRetryable) {
      throw new RetryableGenerationPipelineError(errorMessage, 45);
    }

    await failBatch(
      env,
      project.id,
      runId,
      provider,
      'batch_1_research_stack',
      input,
      error instanceof Error ? error.message : 'Batch 1 failed.',
      2,
    );
  }
}

// Leave headroom for D1 writes, queue continuation dispatches, and stream events in the same invocation.
// Queue consumers have tight subrequest budgets; DOs do not.
const MAX_SUBREQUEST_BUDGET_QUEUE = 20;
const MAX_SUBREQUEST_BUDGET_DO = 500;
const SUBREQUEST_RESERVE = 3;

async function executeBatch2(
  env: Bindings,
  project: ProjectRecord,
  provider: ProviderConfig,
  runId: string,
  builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
  continuationMode: GenerationContinuationMode = 'queue',
): Promise<BatchExecutionResult> {
  const startedAt = Date.now();
  const projectId = project.id;
  const maxSubrequestBudget = continuationMode === 'inline'
    ? MAX_SUBREQUEST_BUDGET_DO
    : MAX_SUBREQUEST_BUDGET_QUEUE;
  const batch1 = await loadBatchOutput(env, projectId, 'batch_1_research_stack', Batch1ResearchStackSchema);
  const checkpoint = await loadGenerationCheckpoint<Batch2CheckpointData>(
    env,
    projectId,
    runId,
    'batch_2_fetch_and_read',
  );
  const researchTargets =
    checkpoint?.data.researchTargets || buildResearchTargets(batch1.technologies, builderProfile, projectBrief);
  const fetchedSources: FetchedTechnologyResearch[] = checkpoint?.data.fetchedSources
    ? [...checkpoint.data.fetchedSources]
    : [];
  const connectedTools = await getConnectedResearchTools(env, project.user_id);
  const briefResearchCount = researchTargets.filter((target) => target.source === 'brief').length;
  const profileResearchCount = researchTargets.filter((target) => target.source === 'profile').length;
  let issuesFound = checkpoint?.data.issuesFound ?? 0;
  const partialFailures = checkpoint?.data.partialFailures ? [...checkpoint.data.partialFailures] : [];
  const degradedTools = new Set(partialFailures.map((failure) => failure.tool));
  const toolEnv: ToolEnv = {
    ...env,
    TOOL_CONTEXT: {
      projectId,
      batchName: 'batch_2_fetch_and_read',
    },
  };

  // Circuit-breakers: stop calling tools that consistently fail
  let contextSevenBroken = checkpoint?.data.contextSevenBroken ?? false;
  let githubIssuesBroken = checkpoint?.data.githubIssuesBroken ?? false;
  let subrequestCounter = 0;
  const startIndex = checkpoint?.currentIndex ?? 0;

  const recordPartialFailure = async (tool: string, technologyName: string, message: string) => {
    pushPartialFailure(partialFailures, tool, technologyName, message);
    degradedTools.add(tool);
    await logActivity(env, {
      projectId,
      batchName: 'batch_2_fetch_and_read',
      kind: 'warning',
      message,
    });
  };

  await emitBatchStart(env, projectId, runId, 'batch_2_fetch_and_read');
  await logActivity(env, {
    projectId,
    batchName: 'batch_2_fetch_and_read',
    kind: 'fetch',
    message:
      briefResearchCount > 0
        ? `Reading the docs for ${researchTargets.length} technologies, starting with ${briefResearchCount} confirmed stack tool${briefResearchCount === 1 ? '' : 's'} from your brief...`
        : profileResearchCount > 0
          ? `Reading the docs for ${researchTargets.length} technologies, starting with ${profileResearchCount} relevant saved tool${profileResearchCount === 1 ? '' : 's'} from your builder profile...`
          : `Reading the docs for ${researchTargets.length} technolog${researchTargets.length === 1 ? 'y' : 'ies'}...`,
  });

  if (checkpoint) {
    await logActivity(env, {
      projectId,
      batchName: 'batch_2_fetch_and_read',
      kind: 'system',
      message: `Resuming fetched-doc research at technology ${startIndex + 1} of ${researchTargets.length}.`,
    });
  }

  for (let index = startIndex; index < researchTargets.length; index += 1) {
    const technology = researchTargets[index];
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

    // Check budget before starting research for this technology
    if (subrequestCounter >= maxSubrequestBudget - SUBREQUEST_RESERVE) {
      await saveGenerationCheckpoint(env, projectId, runId, 'batch_2_fetch_and_read', index, {
        researchTargets,
        fetchedSources,
        issuesFound,
        contextSevenBroken,
        githubIssuesBroken,
        partialFailures,
      });
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        kind: 'system',
        message: `Saved a fetch checkpoint after ${fetchedSources.length} technologies. Continuing from the latest checkpoint...`,
      });
      return 'checkpointed';
    }

    const githubUrl = technology.github_url || '';
    const githubRepository = extractGitHubRepository(githubUrl);
    
    // We assume: searchWeb=1, fetchUrl=5 (github) or 1 (other), getLibraryDocs=1, analyzeGithubRepo=5, getLibraryIssues=1
    
    const communitySearchPromise =
      technology.community_search_results.length > 0
        ? Promise.resolve(technology.community_search_results)
        : (async () => {
            subrequestCounter += 1;
            try {
              const results = dedupeSearchResults(
                await searchWeb(
                  `${technology.name} vs alternatives ${new Date().getFullYear()}`,
                  project.user_id,
                  toolEnv,
                  { throwOnError: true },
                ),
              );
              return results;
            } catch (error) {
              const message = error instanceof ToolExecutionError
                ? error.message
                : `Brave Search could not complete community research for ${technology.name}.`;
              await recordPartialFailure('Brave Search', technology.name, message);
              return [];
            }
          })();

    const breakingChangeSearchPromise =
      technology.breaking_change_search_results.length > 0
        ? Promise.resolve(technology.breaking_change_search_results)
        : (async () => {
            subrequestCounter += 1;
            try {
              const results = dedupeSearchResults(
                await searchWeb(
                  `${technology.name} breaking changes deprecations ${new Date().getFullYear()}`,
                  project.user_id,
                  toolEnv,
                  { throwOnError: true },
                ),
              );
              return results;
            } catch (error) {
              const message = error instanceof ToolExecutionError
                ? error.message
                : `Brave Search could not complete breaking-change research for ${technology.name}.`;
              await recordPartialFailure('Brave Search', technology.name, message);
              return [];
            }
          })();

    const [communitySearchResults, breakingChangeSearchResults] = await Promise.all([
      communitySearchPromise,
      breakingChangeSearchPromise,
    ]);

    const searchResults = dedupeSearchResults([
      ...communitySearchResults,
      ...breakingChangeSearchResults,
    ]);
    
    const docsUrl = (technology.docs_url || '').trim();
    const changelogUrl = (technology.changelog_url || '').trim();
    
    // REDUNDANCY CHECK: Is doc or changelog URL the same as the github repo?
    const docsRepo = extractGitHubRepository(docsUrl);
    const changelogRepo = extractGitHubRepository(changelogUrl);
    
    const isDocsSameAsMainRepo = githubRepository && docsRepo && 
      githubRepository.owner === docsRepo.owner && githubRepository.repo === docsRepo.repo;
    const isChangelogSameAsMainRepo = githubRepository && changelogRepo && 
      githubRepository.owner === changelogRepo.owner && githubRepository.repo === changelogRepo.repo;

    const attemptedContextSeven = !contextSevenBroken;
    const attemptedGithubIssues = Boolean(githubRepository && !githubIssuesBroken);

    const [githubAnalysis, liveDocsResult] = await Promise.all([
      githubRepository
        ? analyzeGithubRepo(
            githubRepository.owner,
            githubRepository.repo,
            project.user_id,
            toolEnv,
            { throwOnError: true },
          ).catch(async (err) => {
            const message = err instanceof ToolExecutionError
              ? err.message
              : `GitHub research for ${technology.name} failed — using partial data.`;
            await recordPartialFailure('GitHub repo', technology.name, message);
            return emptyGithubRepoAnalysis(githubRepository.owner, githubRepository.repo);
          })
        : Promise.resolve(emptyGithubRepoAnalysis()),
      contextSevenBroken
        ? Promise.resolve({ content: '', source: 'Context7', version: 'unknown' })
        : getLibraryDocs(
            technology.name,
            technology.docs_topic,
            project.user_id,
            toolEnv,
            { throwOnError: true },
          ).then(async (result) => {
            if (result.degraded && result.degradationMessage) {
              await recordPartialFailure('Context7', technology.name, result.degradationMessage);
              if (result.degradationCode === 'context7_failed') {
                contextSevenBroken = true;
              }
            }
            return result;
          }).catch(async (err) => {
            const message = err instanceof ToolExecutionError
              ? err.message
              : `Context7 failed for ${technology.name}.`;
            contextSevenBroken = true;
            await recordPartialFailure('Context7', technology.name, message);
            return { content: '', source: 'Context7', version: 'unknown' } as LibraryDocsResult;
          }),
    ]);
    
    if (githubRepository) subrequestCounter += 5;
    if (attemptedContextSeven) subrequestCounter += 1;

    // Fetch survivors (only if not redundant)
    const [docsResult, changelogResult, githubIssues] = await Promise.all([
      docsUrl && !isDocsSameAsMainRepo
        ? fetchUrl(docsUrl, toolEnv, { throwOnError: true }).catch(async (err) => {
            const message = err instanceof ToolExecutionError
              ? err.message
              : `Couldn't read ${docsUrl} — continuing with partial research.`;
            await recordPartialFailure('Web fetch', technology.name, message);
            return emptyFetchedSource(docsUrl, `${technology.name} docs`);
          })
        : isDocsSameAsMainRepo
          ? Promise.resolve({ content: githubAnalysis.readme, title: `${githubAnalysis.owner}/${githubAnalysis.repo}`, url: docsUrl })
          : Promise.resolve(emptyFetchedSource('', `${technology.name} docs`)),
      changelogUrl && !isChangelogSameAsMainRepo
        ? fetchUrl(changelogUrl, toolEnv, { throwOnError: true }).catch(async (err) => {
            const message = err instanceof ToolExecutionError
              ? err.message
              : `Couldn't read ${changelogUrl} — continuing with partial research.`;
            await recordPartialFailure('Web fetch', technology.name, message);
            return emptyFetchedSource(changelogUrl, `${technology.name} changelog`);
          })
        : isChangelogSameAsMainRepo
          ? Promise.resolve({ content: githubAnalysis.summary, title: `${githubAnalysis.owner}/${githubAnalysis.repo}`, url: changelogUrl })
          : Promise.resolve(emptyFetchedSource('', `${technology.name} changelog`)),
      githubRepository && !githubIssuesBroken
        ? getLibraryIssues(
            githubRepository.owner,
            githubRepository.repo,
            ['bug', 'breaking-change'],
            90,
            project.user_id,
            toolEnv,
            { throwOnError: true },
          ).catch((err) => {
            githubIssuesBroken = true;
            const message = err instanceof ToolExecutionError
              ? err.message
              : `Issue lookup failed for ${githubRepository.owner}/${githubRepository.repo} — continuing without issue data.`;
            return recordPartialFailure('GitHub issues', technology.name, message).then(() => [] as GithubIssue[]);
          })
        : Promise.resolve([] as GithubIssue[]),
    ]);

    if (docsUrl && !isDocsSameAsMainRepo) subrequestCounter += (docsRepo ? 5 : 1);
    if (changelogUrl && !isChangelogSameAsMainRepo) subrequestCounter += (changelogRepo ? 5 : 1);
    if (attemptedGithubIssues) subrequestCounter += 1;



    // Skip community page fetching to conserve subrequests.
    // Use search result text summaries instead of fetching each page.
    const communityPages: FetchedCommunitySource[] = searchResults
      .filter((r) => r.description)
      .map((r) => ({ title: r.title, url: r.url, description: r.description, content: r.description }));
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
                githubUrl,
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
      github_url: githubUrl,
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

    const hasMoreWork = index + 1 < researchTargets.length;
    const processedCount = index + 1;
    if (
      hasMoreWork &&
      (processedCount % GENERATION_CHECKPOINT_ITEM_INTERVAL === 0
        || subrequestCounter >= maxSubrequestBudget - SUBREQUEST_RESERVE)
    ) {
      await saveGenerationCheckpoint(env, projectId, runId, 'batch_2_fetch_and_read', index + 1, {
        researchTargets,
        fetchedSources,
        issuesFound,
        contextSevenBroken,
        githubIssuesBroken,
        partialFailures,
      });
          await logActivity(env, {
            projectId,
            batchName: 'batch_2_fetch_and_read',
            kind: 'system',
            message: `Saved a fetch checkpoint after ${fetchedSources.length} technologies. Continuing from the latest checkpoint...`,
          });
          return 'checkpointed';
        }
  }

  const sourceLedger = dedupeResearchSources(fetchedSources.flatMap((source) => source.source_ledger));
  const dataQuality: Batch2FetchAndRead['data_quality'] = {
    has_brave_search: connectedTools.has_brave_search,
    has_github_token: connectedTools.has_github_token,
    has_context7: connectedTools.has_context7,
    technologies_researched: fetchedSources.length,
    urls_fetched: sourceLedger.length,
    issues_found: issuesFound,
    degraded_tools: Array.from(degradedTools),
    partial_failures: partialFailures,
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
  const promptPayload = stringifyBatch2PromptPayload(fetchedSources, dataQuality);
  const prompt = `Research the following fetched technology materials and convert them into a structured corpus.

${promptPayload}

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

  try {
    const result = await callValidatedBatch(provider, {
      env,
      projectId,
      runId,
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

    await clearGenerationCheckpoint(env, projectId, runId, 'batch_2_fetch_and_read');
    await completeBatch(
      env,
      projectId,
      runId,
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
    return 'complete';
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Batch 2 failed.';
    const isRetryable = 
      error instanceof RetryableAIError ||
      errorMessage.includes('Network connection lost') ||
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('ECONNREFUSED');
    
    if (isRetryable) {
      throw new RetryableGenerationPipelineError(errorMessage, 45);
    }

    await failBatch(
      env,
      projectId,
      runId,
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
  runId: string,
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

  await emitBatchStart(env, projectId, runId, 'batch_3_architect');
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
- project_name (string)
- project_type (string)
- project_summary (2-3 sentence plain-language prose summary of what the product does, who it's for, and what problem it solves)
- how_it_connects (4-6 sentence plain-language prose explanation of how the main pieces connect and how data moves through the system)
- recommended_stack (each field should be a plain string like "Next.js", not an object)
- data_model
- integrations with package_name and version
- security_surface
- gotchas with mitigations

Base every recommendation on the provided research corpus.

IMPORTANT: For recommended_stack, return plain strings like "Next.js" or "PostgreSQL", NOT objects like { label: "Next.js", value: "nextjs" }. Each field (frontend, backend, auth, database, payments, email, deploy) must be a single technology name as a string.`;

  try {
    const result = await callValidatedBatch(provider, {
      env,
      projectId,
      runId,
      runType: 'batch_3_architect',
      systemPrompt,
      prompt,
      schema: Batch3ArchitectSchema,
      schemaDescription: schemaDescriptions.batch_3_architect,
    });

    await completeBatch(
      env,
      projectId,
      runId,
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
    const errorMessage = error instanceof Error ? error.message : 'Batch 3 failed.';
    const isRetryable = 
      error instanceof RetryableAIError ||
      errorMessage.includes('Network connection lost') ||
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('ECONNREFUSED');
    
    if (isRetryable) {
      throw new RetryableGenerationPipelineError(errorMessage, 45);
    }

    await failBatch(
      env,
      projectId,
      runId,
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
  runId: string,
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

  await emitBatchStart(env, projectId, runId, 'batch_4_plan_build');
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
      runId,
      runType: 'batch_4_plan_build',
      systemPrompt,
      prompt,
      schema: Batch4PlanBuildSchema,
      schemaDescription: schemaDescriptions.batch_4_plan_build,
    });
    const normalizedPlan = normalizePlanStructure(result.data);

    await completeBatch(
      env,
      projectId,
      runId,
      provider,
      'batch_4_plan_build',
      input,
      normalizedPlan,
      result.attemptCount,
      normalizedPlan,
      Date.now() - startedAt,
    );
    await materializePlanStructure(env, projectId, normalizedPlan);
    await logActivity(env, {
      projectId,
      batchName: 'batch_4_plan_build',
      kind: 'complete',
      message: `Plan ready — ${normalizedPlan.stages.length} stages, ${countPlanSteps(normalizedPlan)} steps.`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Batch 4 failed.';
    const isRetryable = 
      error instanceof RetryableAIError ||
      errorMessage.includes('Network connection lost') ||
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('ECONNREFUSED');
    
    if (isRetryable) {
      throw new RetryableGenerationPipelineError(errorMessage, 45);
    }

    await failBatch(
      env,
      projectId,
      runId,
      provider,
      'batch_4_plan_build',
      input,
      errorMessage,
      2,
    );
  }
}

async function executeBatch5(
  env: Bindings,
  projectId: string,
  provider: ProviderConfig,
  runId: string,
  _builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
): Promise<BatchExecutionResult> {
  const startedAt = Date.now();
  const project = await getProjectById(env, projectId);
  if (!project) {
    throw new Error('Project not found.');
  }

  const adr = await loadBatchOutput(env, projectId, 'batch_3_architect', Batch3ArchitectSchema);
  const plan = await loadBatchOutput(env, projectId, 'batch_4_plan_build', Batch4PlanBuildSchema);
  const research = await loadBatchOutput(env, projectId, 'batch_2_fetch_and_read', Batch2FetchAndReadSchema);
  const checkpoint = await loadGenerationCheckpoint<Batch5CheckpointData>(
    env,
    projectId,
    runId,
    'batch_5_enrich_steps',
  );
  const connectedTools = await getConnectedResearchTools(env, project.user_id);
  const planSteps = checkpoint?.data.steps || flattenPlanSteps(plan);
  const stepResearchContexts: StepResearchContext[] = checkpoint?.data.stepResearchContexts
    ? [...checkpoint.data.stepResearchContexts]
    : [];
  const startIndex = checkpoint?.currentIndex ?? 0;

  await emitBatchStart(env, projectId, runId, 'batch_5_enrich_steps');
  await logActivity(env, {
    projectId,
    batchName: 'batch_5_enrich_steps',
    kind: 'fetch',
    message: 'Refreshing every step with live docs, issues, and current implementation notes...',
  });

  if (checkpoint) {
    await logActivity(env, {
      projectId,
      batchName: 'batch_5_enrich_steps',
      kind: 'system',
      message: `Resuming step research at step ${Math.min(startIndex + 1, planSteps.length)} of ${planSteps.length}.`,
    });
  }

  for (let index = startIndex; index < planSteps.length; index += 1) {
    const step = planSteps[index];

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

    if (index + 1 < planSteps.length) {
      await saveGenerationCheckpoint(env, projectId, runId, 'batch_5_enrich_steps', index + 1, {
        steps: planSteps,
        stepResearchContexts,
      });
      await logActivity(env, {
        projectId,
        batchName: 'batch_5_enrich_steps',
        kind: 'system',
        message: `Saved a step-research checkpoint after ${stepResearchContexts.length} step${stepResearchContexts.length === 1 ? '' : 's'}. Continuing from the latest checkpoint...`,
      });
      return 'checkpointed';
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
      runId,
      runType: 'batch_5_enrich_steps',
      systemPrompt,
      prompt,
      schema: Batch5EnrichStepsSchema,
      schemaDescription: schemaDescriptions.batch_5_enrich_steps,
    });
    const stepResearchById = new Map(stepResearchContexts.map((context) => [context.stepId, context] as const));
    const finalEnrichments = ensureCompleteStepEnrichments(
      planSteps,
      stepResearchById,
      result.data.enrichments,
    );
    const finalResult: Batch5EnrichSteps = {
      enrichments: finalEnrichments,
    };

    await clearGenerationCheckpoint(env, projectId, runId, 'batch_5_enrich_steps');
    await completeBatch(
      env,
      projectId,
      runId,
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
    return 'complete';
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Batch 5 failed.';
    const isRetryable = 
      error instanceof RetryableAIError ||
      errorMessage.includes('Network connection lost') ||
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('ECONNREFUSED');
    
    if (isRetryable) {
      throw new RetryableGenerationPipelineError(errorMessage, 45);
    }

    await failBatch(
      env,
      projectId,
      runId,
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
  runId: string,
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

  await emitBatchStart(env, projectId, runId, 'batch_6_generate_files');
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
      runId,
      runType: 'batch_6_generate_files',
      systemPrompt,
      prompt,
      schema: Batch6GenerateFilesSchema,
      schemaDescription: schemaDescriptions.batch_6_generate_files,
    });
    const finalFiles = await ensureCompleteGeneratedFiles(env, projectId, result.data.files);
    const finalResult: Batch6GenerateFiles = {
      files: finalFiles,
    };

    await completeBatch(
      env,
      projectId,
      runId,
      provider,
      'batch_6_generate_files',
      input,
      finalResult,
      result.attemptCount,
      finalFiles,
      Date.now() - startedAt,
    );
    await persistGeneratedFiles(env, projectId, finalFiles);
    await logActivity(env, {
      projectId,
      batchName: 'batch_6_generate_files',
      kind: 'complete',
      message: `Files prepared — ${finalFiles.length} downloadable artifact${finalFiles.length === 1 ? '' : 's'} ready.`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Batch 6 failed.';
    const isRetryable = 
      error instanceof RetryableAIError ||
      errorMessage.includes('Network connection lost') ||
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('ECONNREFUSED');
    
    if (isRetryable) {
      throw new RetryableGenerationPipelineError(errorMessage, 45);
    }

    await failBatch(
      env,
      projectId,
      runId,
      provider,
      'batch_6_generate_files',
      input,
      error instanceof Error ? error.message : 'Batch 6 failed.',
      2,
    );
  }
}

async function pauseForArchitectureReview(env: Bindings, projectId: string, runId: string) {
  const reviewContext = await loadArchitectureReviewContext(env, projectId);

  const statusChanges = await updateProjectGenerationStatus(env, projectId, 'awaiting_review', {
    generationError: null,
    markStarted: true,
    touchHeartbeat: true,
    generationRunId: runId,
    expectedRunId: runId,
  });
  if (statusChanges === 0) {
    throw staleGenerationRunError(projectId, runId, 'pausing for architecture review');
  }
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

async function finalizeProjectGeneration(env: Bindings, projectId: string, runId: string) {
  const statusChanges = await updateProjectGenerationStatus(env, projectId, 'complete', {
    generationError: null,
    markStarted: true,
    markCompleted: true,
    touchHeartbeat: true,
    generationRunId: runId,
    expectedRunId: runId,
  });
  if (statusChanges === 0) {
    throw staleGenerationRunError(projectId, runId, 'finalizing generation');
  }
  await clearGenerationCheckpoints(env, projectId, runId);
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
     WHERE project_id = ? AND status = 'complete' AND run_type IN (${GENERATION_BATCHES.map(() => '?').join(', ')})
     ORDER BY created_at ASC`,
  ).bind(projectId, ...GENERATION_BATCHES).all();
  return rows.results.map((r: any) => r.run_type as string);
}

function resolvePipelineStatusToRun(
  currentStatus: ProjectGenerationStatus,
  completedBatches: string[],
): ProjectGenerationStatus {
  if (currentStatus === 'queued' && completedBatches.includes('batch_1_research_stack')) {
    return 'batch_1_research_stack';
  }

  if (currentStatus === 'batch_1_research_stack' && completedBatches.includes('batch_2_fetch_and_read')) {
    return 'batch_2_fetch_and_read';
  }

  if (currentStatus === 'batch_2_fetch_and_read' && completedBatches.includes('batch_3_architect')) {
    return 'batch_3_architect';
  }

  if (currentStatus === 'approved' && completedBatches.includes('batch_4_plan_build')) {
    return 'batch_4_plan_build';
  }

  if (currentStatus === 'batch_4_plan_build' && completedBatches.includes('batch_5_enrich_steps')) {
    return 'batch_5_enrich_steps';
  }

  if (currentStatus === 'batch_5_enrich_steps' && completedBatches.includes('batch_6_generate_files')) {
    return 'batch_6_generate_files';
  }

  return currentStatus;
}

async function enqueueProjectGeneration(
  env: Bindings,
  payload: {
    projectId: string;
    userId: string;
    providerId: string;
    runId: string;
    targetStatus: ProjectGenerationStatus;
    delaySeconds?: number;
  },
) {
  if (!env.AGENT_QUEUE) {
    throw new GenerationPipelineError('Project generation queue is not configured.');
  }

  await sendGenerationDispatch(env, {
    projectId: payload.projectId,
    userId: payload.userId,
    providerId: payload.providerId,
    runId: payload.runId,
    kind: 'continuation',
    previousStatus: payload.targetStatus,
    targetStatus: payload.targetStatus,
    delaySeconds: payload.delaySeconds,
  });
}

const PIPELINE_VERSION = '1.2.0-heartbeat-safe';
const INLINE_GENERATION_TURN_LIMIT = 256;

type GenerationContinuationMode = 'queue' | 'inline';

type ProcessProjectGenerationOptions = {
  continuationMode?: GenerationContinuationMode;
  maxInlineTurns?: number;
};

async function processProjectGenerationTurn(
  env: Bindings,
  message: QueueMessageBody,
  continuationMode: GenerationContinuationMode,
) {
  const project = await getProjectById(env, message.projectId);
  if (!project) {
    throw new GenerationPipelineError('The queued project no longer exists.');
  }

  if (message.runId && project.generation_run_id && message.runId !== project.generation_run_id) {
    return false;
  }

  const currentStatus = (project.generation_status || 'queued') as ProjectGenerationStatus;
  if (
    currentStatus === 'complete'
    || currentStatus === 'failed'
    || currentStatus === 'awaiting_review'
    || currentStatus === 'cancelled'
  ) {
    return false;
  }

  const completed = await getCompletedBatches(message.projectId, env);
  if (message.providerId && project.generation_provider_id && message.providerId !== project.generation_provider_id) {
    throw new GenerationPipelineError('Queued generation provider does not match the project’s pinned provider.');
  }

  const pinnedProviderId = message.providerId || project.generation_provider_id;
  if (!pinnedProviderId) {
    throw new GenerationPipelineError(
      'The original AI provider for this generation run is missing. Start a new generation with an explicit provider.',
    );
  }

  const provider = await resolveProviderConfiguration(
    env,
    message.userId,
    pinnedProviderId,
  );
  const activeRunId = project.generation_run_id || message.runId || crypto.randomUUID();
  const statusToRun = resolvePipelineStatusToRun(currentStatus, completed);

  const primingChanges = await updateProjectGenerationStatus(env, project.id, currentStatus, {
    generationError: null,
    markStarted: true,
    clearCompletedAt: true,
    touchHeartbeat: true,
    generationRunId: activeRunId,
    generationProviderId: provider.providerId,
    expectedRunId: activeRunId,
  });
  if (primingChanges === 0) {
    return false;
  }

  if (statusToRun === 'queued' && !completed.includes('batch_1_research_stack')) {
    const queuedChanges = await updateProjectGenerationStatus(env, project.id, 'queued', {
      generationError: null,
      markStarted: true,
      clearCompletedAt: true,
      touchHeartbeat: true,
      generationRunId: activeRunId,
      generationProviderId: provider.providerId,
      expectedRunId: activeRunId,
    });
    if (queuedChanges === 0) {
      return false;
    }
    await logActivity(env, {
      projectId: project.id,
      batchName: 'batch_1_research_stack',
      kind: 'system',
      message: 'Agent picked up your brief and is starting the research sequence.',
    });
  }

  const builderProfile = await loadBuilderProfileContext(message.userId, env);
  const projectBrief = await loadProjectBriefContext(env, message.projectId, message.userId, {
    rawDescription: project.description || '',
    projectStack: project.stack,
    existingTools: builderProfile.declaredTools.map((tool) => tool.name),
  });

  switch (statusToRun) {
    case 'intake':
      return false;
    case 'queued':
      if (!completed.includes('batch_1_research_stack')) {
        await executeBatch1(env, project, provider, activeRunId, builderProfile, projectBrief);
        if (continuationMode === 'queue') {
          await enqueueProjectGeneration(env, {
            projectId: project.id,
            userId: message.userId,
            providerId: provider.providerId,
            runId: activeRunId,
            targetStatus: 'queued',
          });
        }
        return true;
      }
      return false;
    case 'batch_1_research_stack':
      if (!completed.includes('batch_2_fetch_and_read')) {
        await executeBatch2(env, project, provider, activeRunId, builderProfile, projectBrief, continuationMode);
        if (continuationMode === 'queue') {
          await enqueueProjectGeneration(env, {
            projectId: project.id,
            userId: message.userId,
            providerId: provider.providerId,
            runId: activeRunId,
            targetStatus: 'batch_1_research_stack',
          });
        }
        return true;
      }
      return false;
    case 'batch_2_fetch_and_read':
      if (!completed.includes('batch_3_architect')) {
        await executeBatch3(env, project.id, activeRunId, provider, project, builderProfile, projectBrief);
      }
      await pauseForArchitectureReview(env, project.id, activeRunId);
      return false;
    case 'batch_3_architect':
      await pauseForArchitectureReview(env, project.id, activeRunId);
      return false;
    case 'approved':
      if (!completed.includes('batch_4_plan_build')) {
        await executeBatch4(env, project.id, activeRunId, provider, builderProfile, projectBrief);
        if (continuationMode === 'queue') {
          await enqueueProjectGeneration(env, {
            projectId: project.id,
            userId: message.userId,
            providerId: provider.providerId,
            runId: activeRunId,
            targetStatus: 'approved',
          });
        }
        return true;
      }
      return false;
    case 'batch_4_plan_build':
      if (!completed.includes('batch_5_enrich_steps')) {
        await executeBatch5(env, project.id, provider, activeRunId, builderProfile, projectBrief);
        if (continuationMode === 'queue') {
          await enqueueProjectGeneration(env, {
            projectId: project.id,
            userId: message.userId,
            providerId: provider.providerId,
            runId: activeRunId,
            targetStatus: 'batch_4_plan_build',
          });
        }
        return true;
      }
      return false;
    case 'batch_5_enrich_steps':
      if (!completed.includes('batch_6_generate_files')) {
        await executeBatch6(env, project.id, activeRunId, provider, builderProfile, projectBrief);
      }
      await finalizeProjectGeneration(env, project.id, activeRunId);
      return false;
    case 'batch_6_generate_files':
      await finalizeProjectGeneration(env, project.id, activeRunId);
      return false;
    default:
      return false;
  }
}

export async function processProjectGeneration(
  env: Bindings,
  message: QueueMessageBody,
  options: ProcessProjectGenerationOptions = {},
) {
  const continuationMode = options.continuationMode || 'queue';
  const maxInlineTurns = options.maxInlineTurns || INLINE_GENERATION_TURN_LIMIT;

  try {
    if (continuationMode === 'inline') {
      let turnCount = 0;
      while (turnCount < maxInlineTurns) {
        turnCount += 1;
        const shouldContinue = await processProjectGenerationTurn(env, message, continuationMode);
        if (!shouldContinue) {
          return;
        }
      }

      throw new GenerationPipelineError(
        'Project generation exceeded the Durable Object turn limit. Resume to continue from the latest checkpoint.',
      );
    }

    await processProjectGenerationTurn(env, message, continuationMode);
  } catch (error) {
    if (error instanceof RetryableGenerationPipelineError) {
      throw error;
    }

    if (error instanceof GenerationPipelineError && error.alreadyPersisted) {
      throw error;
    }

    // Convert quota/runtime-limit errors into retryable errors so the DO
    // can checkpoint and resume instead of killing the whole pipeline.
    if (error instanceof PipelineQuotaExceededError) {
      throw new RetryableGenerationPipelineError(error.message, 30);
    }

    const messageText =
      error instanceof Error ? error.message : 'Project generation failed before the pipeline could finish.';

    await updateProjectGenerationStatus(env, message.projectId, 'failed', {
      generationError: messageText,
      markStarted: true,
      markCompleted: true,
      touchHeartbeat: true,
    });
    await insertGenerationEvent(env, {
      projectId: message.projectId,
      eventType: 'generation_failed',
      body: {
        error: messageText,
        generation_status: 'failed',
        project_id: message.projectId,
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

      if (error instanceof RetryableGenerationPipelineError && message.attempts < MAX_PROJECT_GENERATION_RETRY_ATTEMPTS) {
        if (projectId) {
          await touchGenerationHeartbeat(env, projectId, message.body.runId || null);
        }

        console.warn(`Retrying project ${projectId} after transient failure: ${fallbackMessage}`);
        message.retry({ delaySeconds: error.delaySeconds });
        continue;
      }

      if (error instanceof GenerationPipelineError && error.alreadyPersisted) {
        message.ack();
        continue;
      }

      if (projectId) {
        await updateProjectGenerationStatus(env, projectId, 'failed', {
          generationError: fallbackMessage,
          markStarted: true,
          markCompleted: true,
          touchHeartbeat: true,
        });
        await insertGenerationEvent(env, {
          projectId,
          eventType: 'generation_failed',
          body: {
            error: fallbackMessage,
            generation_status: 'failed',
            project_id: projectId,
          },
        });
      }

      message.ack();
    }
  }
}
