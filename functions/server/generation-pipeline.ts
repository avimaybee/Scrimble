import type { ZodType } from 'zod';
import { 
  fetchLibraryDocs as facadeFetchDocs, 
  analyzeGitHubRepo as facadeAnalyzeGitHubRepo, 
  searchWeb as facadeSearchWeb
} from './research-facade';
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
  type PlanAuthoringRecord,
  type Batch5EnrichSteps,
  type Batch6GenerateFiles,
  type SkillFileName,
  schemaDescriptions,
} from './generation-schemas';
import {
  GENERATION_BATCHES,
  type Bindings,
  type GenerationBatchName,
  type ProjectGenerationStatus,
  type ProviderType,
} from './types';
import {
  createThrottledThinkingEmitter,
  getBatchStartLabel,
  isTerminalGenerationEvent,
  persistGenerationStreamEvent,
  resetGenerationThinkingState,
} from './generation-events';
import {
  callAIText,
  classifyAIError,
  containsReasoningMarkers,
  containsStreamTransportMarkers,
  extractJSON,
  getProvider,
  RetryableAIError,
  type GenerationFailureClass,
} from './ai';
import {
  deleteJsonPayload,
  loadJsonPayload,
  loadJsonPayloadText,
  storeJsonPayload,
} from './checkpoint-storage';


import { extractGitHubRepository } from '../utils/fetch-url';
import { buildResearchManifest } from './research-manifest';
import { buildResearchQuery } from './research-query-policy';
import {
  createResearchSubrequestTracker,
  RESEARCH_SUBREQUEST_LIMIT,
  resolveToolDocsEntry,
  type ResearchResult,
} from './research';
import { normalizeBuilderProfileName } from '../../src/lib/builder-profile';
import { getConnectedResearchTools } from './mcp-servers';
import { appendProjectBriefSystemPrompt, loadProjectBriefContext } from './project-briefs';
import {
  collectStepResearchContext,
  formatStepResearchPrompt,
  type StepResearchContext,
} from './step-research';
import {
  buildSkillFileProfileInstructions,
  loadBuilderProfileContext,
} from './user-tools';
import { 
  getGenerationRuntimeState, 
  persistInvariantViolation,
  updateGenerationRunStatus,
  touchGenerationRunHeartbeat,
} from './generation-runtime';

export type ProviderConfig = {
  providerId: string;
  providerName: string;
  providerType: ProviderType;
  model: string;
  baseUrl: string | null;
  apiKey: string;
};

type GenerationModelRole = 'fast' | 'deep';

export type ProjectRecord = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  intake_answers: string | null;
  project_type: string | null;
  stack: string | null;
  current_generation_run_id?: string | null;
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
  review_feedback: string;
  review_feedback_provided: boolean;
};

type ArchitectureReviewContext = {
  runId: string;
  input: Record<string, unknown>;
  adr: Batch3Architect;
  reviewFeedback: string;
  reviewFeedbackProvided: boolean;
  providerId?: string;
};

type PlanStepEnrichment = Batch5EnrichSteps['enrichments'][number];

type EnrichedPlanStep = PlanAuthoringRecord['stages'][number]['steps'][number] & {
  ai_output: string;
  done_when: string;
  navigation_links: PlanStepEnrichment['navigation_links'];
  prompts: PlanStepEnrichment['prompts'];
};

type EnrichedPlanStage = Omit<PlanAuthoringRecord['stages'][number], 'steps'> & {
  steps: EnrichedPlanStep[];
};

type EnrichedPlan = Omit<PlanAuthoringRecord, 'stages'> & {
  stages: EnrichedPlanStage[];
};

type FetchedCommunitySource = {
  title: string;
  url: string;
  description: string;
  content: string;
};

type CollectedResearchSource = {
  content: string;
  url: string;
  tool: string;
  technology: string;
};

type ResearchChunk = {
  content: string;
  source: string;
  tool: string;
  technology: string;
};

type SearchResult = {
  title: string;
  url: string;
  description: string;
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
  search_query?: string;
  priority: 'high' | 'medium' | 'low';
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
  collectedSources: CollectedResearchSource[];
  researchSourceLedger?: Batch2FetchAndRead['sources'];
  issuesFound: number;
  partialFailures: Batch2FetchAndRead['data_quality']['partial_failures'];
  totalCandidateTargets?: number;
};

type Batch5ResearchStep = Pick<
  PlanAuthoringRecord['stages'][number]['steps'][number],
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
const HEARTBEAT_TOUCH_INTERVAL_MS = 30 * 1000;
const GENERATION_CHECKPOINT_ITEM_INTERVAL = 20;
const MAX_BATCH1_TECHNOLOGIES = 8;
const BATCH2_SOURCE_TARGET_COUNT = 10;
const BATCH2_SEARCH_RESULT_LIMIT = 1;
const RESEARCH_CHUNK_SIZE_CHARS = 1_600;
const RESEARCH_CHUNK_OVERLAP_CHARS = 200;
const RESEARCH_CHUNK_WARN_THRESHOLD = 10_000;
const RESEARCH_CONTEXT_TOP_K_DEFAULT = 8;
const RESEARCH_CONTEXT_TOKEN_TARGET = 8_000;
const RESEARCH_CONTEXT_TOKEN_HARD_LIMIT = 10_000;
const RESEARCH_CHARS_PER_TOKEN_ESTIMATE = 4;
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

function formatSearchResults(results: SearchResult[]) {
  return results
    .map((result) => `${result.title}: ${result.description} (${result.url})`)
    .join('\n');
}

function emptyResearchResult(source: string, error: string): ResearchResult {
  return {
    content: '',
    source,
    tool: 'failed',
    chars: 0,
    error,
  };
}

function parseGitHubSlug(value: string) {
  const normalized = value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/^github\.com\//i, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  return {
    owner: segments[0],
    repo: segments[1].replace(/\.git$/i, ''),
  };
}

function resolveResearchRepository(githubUrl: string, fallbackGithubSlug?: string) {
  const fromPrimary = extractGitHubRepository(githubUrl.trim());
  if (fromPrimary) {
    return fromPrimary;
  }

  if (!fallbackGithubSlug) {
    return null;
  }

  const fallback = parseGitHubSlug(fallbackGithubSlug);
  if (!fallback) {
    return null;
  }

  return {
    owner: fallback.owner,
    repo: fallback.repo,
  };
}

function buildBatch2SearchQuery(technologyName: string) {
  return buildResearchQuery({
    technology: technologyName,
    family: 'release_notes',
  });
}

function isNonStackWorkspaceToolCategory(category: string) {
  return category === 'coding_environment' || category === 'ai_assistants';
}

function toSearchResultFromResearch(entry: ResearchResult): SearchResult | null {
  if (entry.tool === 'failed') {
    return null;
  }

  const sourceUrl = entry.source.trim();
  if (!sourceUrl) {
    return null;
  }

  return {
    title: entry.title || sourceUrl,
    url: sourceUrl,
    description: summarizeSnippet(entry.content, 360),
  };
}

function toolLabelFromDocTool(tool: ResearchResult['tool']) {
  if (tool === 'cf_scrape') {
    return 'cf_scrape';
  }

  return 'jina_reader';
}

function toolLabelFromGithubTool(tool: ResearchResult['tool']) {
  if (tool === 'github_api') {
    return 'github_api';
  }

  return 'gitmcp';
}

function humanDocToolLabel(tool: ResearchResult['tool']) {
  if (tool === 'cf_scrape') {
    return 'Cloudflare Scrape';
  }

  if (tool === 'jina_reader') {
    return 'Jina Reader';
  }

  return 'Documentation fetch';
}

function humanGithubToolLabel(tool: ResearchResult['tool']) {
  if (tool === 'github_api') {
    return 'GitHub API fallback';
  }

  if (tool === 'gitmcp') {
    return 'GitMCP';
  }

  return 'GitHub fetch';
}

function formatCharCount(chars: number | undefined, fallback: number) {
  let value = fallback;
  if (typeof chars === 'number' && Number.isFinite(chars)) {
    value = chars;
  }

  const normalized = Math.max(0, Math.round(value));
  return `${normalized.toLocaleString()} chars`;
}

function parseOpenIssuesCount(content: string) {
  const match = content.match(/([0-9][0-9,]*)\s+open issues?/i);
  if (!match) {
    return 0;
  }

  const parsed = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseLatestVersionFromText(...values: string[]) {
  for (const value of values) {
    const match = value.match(/(?:latest release|latest version|release|version)\s*[:#-]?\s*(v?\d+(?:\.\d+){1,3}(?:[-+.\w]+)?)/i);
    if (match?.[1]) {
      return match[1];
    }
  }

  return 'Unknown';
}

function parseLastCommitDateFromText(...values: string[]) {
  for (const value of values) {
    const isoMatch = value.match(/\b(20\d{2}-\d{2}-\d{2}(?:[T ][0-9:.+-Z]*)?)\b/);
    if (isoMatch?.[1]) {
      return isoMatch[1];
    }
  }

  return 'Unknown';
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

function dedupeResearchResults(results: ResearchResult[]) {
  const seen = new Set<string>();

  return results.filter((result) => {
    if (result.tool === 'failed') {
      return true;
    }

    const key = result.source.trim().toLowerCase();
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

  const getPriorityRank = (priority: ResearchTechnologyTarget['priority']) => {
    switch (priority) {
      case 'high':
        return 0;
      case 'medium':
        return 1;
      case 'low':
      default:
        return 2;
    }
  };

  for (const target of targets) {
    const key = normalizeBuilderProfileName(target.name);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, target);
      continue;
    }

    const useIncomingAsBase = getPriorityRank(target.priority) < getPriorityRank(existing.priority);
    const primary = useIncomingAsBase ? target : existing;
    const secondary = useIncomingAsBase ? existing : target;

    merged.set(key, {
      ...primary,
      docs_url: primary.docs_url || secondary.docs_url,
      github_url: primary.github_url || secondary.github_url,
      changelog_url: primary.changelog_url || secondary.changelog_url,
      docs_topic: primary.docs_topic || secondary.docs_topic,
      search_query: primary.search_query || secondary.search_query,
      community_search_results: dedupeSearchResults([
        ...primary.community_search_results,
        ...secondary.community_search_results,
      ]),
      breaking_change_search_results: dedupeSearchResults([
        ...primary.breaking_change_search_results,
        ...secondary.breaking_change_search_results,
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
  priority: ResearchTechnologyTarget['priority'] = 'low',
  searchQuery?: string,
): ResearchTechnologyTarget {
  return {
    name: technology.name || 'Unknown technology',
    docs_url: technology.docs_url || '',
    github_url: technology.github_url || '',
    changelog_url: technology.changelog_url || '',
    docs_topic: docsTopic,
    search_query: searchQuery,
    priority,
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

function resolveBatch2SourceTargetCount() {
  return BATCH2_SOURCE_TARGET_COUNT;
}

function resolveBatch2SearchResultLimit() {
  return BATCH2_SEARCH_RESULT_LIMIT;
}

function getResearchTargetPriorityValue(priority: ResearchTechnologyTarget['priority']) {
  switch (priority) {
    case 'high':
      return 0;
    case 'medium':
      return 1;
    case 'low':
    default:
      return 2;
  }
}

function scoreResearchTargetRelevance(
  target: ResearchTechnologyTarget,
  projectBrief: LoadedProjectBriefContext,
) {
  const targetTokens = buildMatchTokens(
    target.name,
    target.docs_topic,
    target.docs_url,
    target.github_url,
    target.changelog_url,
  );
  const confirmedTokens = projectBrief.confirmedStackTools.flatMap((tool) => buildMatchTokens(tool));
  const summaryTokens = buildMatchTokens(projectBrief.summary);
  const normalizedSummary = projectBrief.summary.toLowerCase();

  let score = 0;
  if (targetsOverlap(targetTokens, confirmedTokens)) {
    score += 8;
  }
  if (targetsOverlap(targetTokens, summaryTokens)) {
    score += 4;
  }
  if (normalizedSummary.includes(target.name.toLowerCase())) {
    score += 3;
  }
  if (target.source === 'brief') {
    score += 3;
  } else if (target.source === 'profile') {
    score += 1;
  }
  if (target.docs_url) {
    score += 1;
  }
  if (target.github_url) {
    score += 1;
  }

  return score;
}

function limitResearchTargets(
  targets: ResearchTechnologyTarget[],
  projectBrief: LoadedProjectBriefContext,
  maxTargets: number,
) {
  const ranked = dedupeResearchTargets(targets).sort((left, right) => {
    const priorityDiff = getResearchTargetPriorityValue(left.priority) - getResearchTargetPriorityValue(right.priority);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const scoreDiff = scoreResearchTargetRelevance(right, projectBrief) - scoreResearchTargetRelevance(left, projectBrief);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return left.name.localeCompare(right.name);
  });

  return {
    targets: ranked.slice(0, Math.max(1, maxTargets)),
    totalCandidates: ranked.length,
  };
}

function buildResearchTargets(
  inferredTechnologies: Batch1ResearchStack['technologies'],
  builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
  maxTargets: number,
) {
  // B2: Profile tools are now HARD inputs, not filtered by inference
  // The profile determines the research graph; inference fills gaps
  
  const nonStackWorkspaceToolKeys = new Set(
    builderProfile.tools
      .filter((tool) => isNonStackWorkspaceToolCategory(tool.category))
      .map((tool) => normalizeBuilderProfileName(tool.name))
      .filter(Boolean),
  );
  const stackInferredTechnologies = inferredTechnologies.filter((technology) => {
    const normalized = normalizeBuilderProfileName(technology.name || '');
    return Boolean(normalized) && !nonStackWorkspaceToolKeys.has(normalized);
  });

  const manifest = buildResearchManifest(
    builderProfile,
    projectBrief.summary || stackInferredTechnologies.map((technology) => technology.name).join(' '),
    {
      confirmedStackTools: projectBrief.confirmedStackTools,
      inferredTechnologies: stackInferredTechnologies
        .map((technology) => technology.name || '')
        .filter(Boolean),
    },
  );

  const toTargetSource = (source: 'builder_profile' | 'project_stack' | 'inferred') =>
    source === 'builder_profile' ? 'profile' : source === 'project_stack' ? 'brief' : 'inferred';

  const profileTargets: ResearchTechnologyTarget[] = manifest.tools
    .filter((tool) => tool.source === 'builder_profile')
    .map((tool) => ({
      name: tool.name,
      docs_url: tool.docsUrl,
      github_url: tool.githubRepo ? `https://github.com/${tool.githubRepo}` : '',
      changelog_url: '',
      docs_topic: tool.docsTopic,
      search_query: tool.searchQuery || buildBatch2SearchQuery(tool.name),
      priority: tool.priority,
      community_search_results: [],
      breaking_change_search_results: [],
      source: toTargetSource(tool.source),
    }));

  const briefTargets: ResearchTechnologyTarget[] = manifest.tools
    .filter((tool) => tool.source === 'project_stack')
    .map((tool) => ({
      name: tool.name,
      docs_url: tool.docsUrl,
      github_url: tool.githubRepo ? `https://github.com/${tool.githubRepo}` : '',
      changelog_url: '',
      docs_topic: tool.docsTopic,
      search_query: tool.searchQuery || buildBatch2SearchQuery(tool.name),
      priority: tool.priority,
      community_search_results: [],
      breaking_change_search_results: [],
      source: toTargetSource(tool.source),
    }));

  const inferredTargets: ResearchTechnologyTarget[] = manifest.tools
    .filter((tool) => tool.source === 'inferred')
    .map((tool) => ({
      name: tool.name,
      docs_url: tool.docsUrl,
      github_url: tool.githubRepo ? `https://github.com/${tool.githubRepo}` : '',
      changelog_url: '',
      docs_topic: tool.docsTopic,
      search_query: tool.searchQuery || buildBatch2SearchQuery(tool.name),
      priority: tool.priority,
      community_search_results: [],
      breaking_change_search_results: [],
      source: toTargetSource(tool.source),
    }));

  // Combine: brief first (highest signal), then profile, then inferred (gap-fillers)
  const allTargets = [...briefTargets, ...profileTargets, ...inferredTargets];
  const limitedTargets = limitResearchTargets(allTargets, projectBrief, maxTargets);
  const fallbackTargets = limitResearchTargets(inferredTargets, projectBrief, maxTargets);
  return limitedTargets.targets.length > 0 ? limitedTargets : fallbackTargets;
}

function createResearchSource(
  technology: string,
  tool: string,
  url: string,
  title: string,
  summary: string,
  charsRead: number,
  relevance: ResearchTechnologyTarget['priority'],
  insight?: string,
): Batch2FetchAndRead['sources'][number] {
  const summarizedInsight = summarizeSnippet(insight || summary, 220);

  return {
    technology,
    tool,
    url,
    title,
    summary: summarizeSnippet(summary),
    insight: summarizedInsight,
    chars_read: Math.max(0, Math.floor(charsRead)),
    relevance,
  };
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function estimateTokenCount(value: string) {
  if (!value.trim()) {
    return 0;
  }

  return Math.max(1, Math.ceil(value.length / RESEARCH_CHARS_PER_TOKEN_ESTIMATE));
}

function chunkText(
  text: string,
  chunkSize = RESEARCH_CHUNK_SIZE_CHARS,
  overlap = RESEARCH_CHUNK_OVERLAP_CHARS,
): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const separators = ['\n\n', '\n', '. ', ' '];
  const splitRecursively = (value: string, separatorIndex: number): string[] => {
    if (value.length <= chunkSize) {
      return [value];
    }

    if (separatorIndex >= separators.length) {
      const slices: string[] = [];
      for (let index = 0; index < value.length; index += chunkSize) {
        slices.push(value.slice(index, index + chunkSize));
      }
      return slices;
    }

    const separator = separators[separatorIndex];
    const parts = value.split(separator);
    if (parts.length <= 1) {
      return splitRecursively(value, separatorIndex + 1);
    }

    const chunks: string[] = [];
    let current = '';
    for (const part of parts) {
      const nextCandidate = current ? `${current}${separator}${part}` : part;
      if (nextCandidate.length <= chunkSize) {
        current = nextCandidate;
        continue;
      }

      if (current) {
        chunks.push(current);
        current = '';
      }

      if (part.length > chunkSize) {
        chunks.push(...splitRecursively(part, separatorIndex + 1));
      } else {
        current = part;
      }
    }

    if (current) {
      chunks.push(current);
    }

    return chunks;
  };

  const rawChunks = splitRecursively(normalized, 0)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  const safeOverlap = Math.max(0, overlap);

  for (let index = 0; index < rawChunks.length; index += 1) {
    const previousTail = index > 0 ? rawChunks[index - 1].slice(-safeOverlap) : '';
    const combined = `${previousTail}${rawChunks[index]}`.trim();
    if (combined) {
      chunks.push(combined);
    }
  }

  return chunks;
}

function dedupeCollectedSources(sources: CollectedResearchSource[]) {
  const seen = new Set<string>();

  return sources.filter((source) => {
    const key = `${source.tool}::${source.url}::${source.technology}`.toLowerCase();
    if (!source.url || !source.content.trim() || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function dedupeResearchChunks(chunks: ResearchChunk[]) {
  const seen = new Set<string>();

  return chunks.filter((chunk) => {
    const key = `${chunk.source}::${chunk.tool}::${chunk.technology}::${chunk.content.slice(0, 120)}`.toLowerCase();
    if (!chunk.content.trim() || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildResearchChunkStore(collectedSources: CollectedResearchSource[]) {
  const chunkStore: ResearchChunk[] = [];

  for (const source of dedupeCollectedSources(collectedSources)) {
    const chunks = chunkText(source.content);
    for (const chunk of chunks) {
      chunkStore.push({
        content: chunk,
        source: source.url,
        tool: source.tool,
        technology: source.technology,
      });
    }
  }

  return dedupeResearchChunks(chunkStore);
}

function retrieveRelevantChunks(
  query: string,
  chunks: ResearchChunk[],
  topK = RESEARCH_CONTEXT_TOP_K_DEFAULT,
): ResearchChunk[] {
  if (chunks.length === 0) {
    return [];
  }

  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 3);

  if (queryTerms.length === 0) {
    return chunks.slice(0, Math.max(1, topK));
  }

  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    const count = chunks.reduce((total, chunk) =>
      total + (chunk.content.toLowerCase().includes(term) ? 1 : 0), 0);
    documentFrequency.set(term, count);
  }

  const scored = chunks.map((chunk) => {
    const text = chunk.content.toLowerCase();
    let score = 0;

    for (const term of queryTerms) {
      const occurrences = (text.match(new RegExp(escapeRegExp(term), 'g')) || []).length;
      const firstPos = text.indexOf(term);
      const posScore = firstPos === -1 ? 0 : 1 - (firstPos / Math.max(1, text.length));
      const idf = Math.log((chunks.length + 1) / ((documentFrequency.get(term) || 0) + 1)) + 1;
      score += (occurrences * 0.7 + posScore * 0.3) * idf;
    }

    return { chunk, score };
  });

  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, topK))
    .map((entry) => entry.chunk);
}

type RetrievedResearchSlice = {
  context: string;
  chunkCount: number;
  totalChunks: number;
  estimatedTokens: number;
};

function retrieveResearchSlice(
  query: string,
  chunkStore: ResearchChunk[],
  topK = RESEARCH_CONTEXT_TOP_K_DEFAULT,
  maxTokens = RESEARCH_CONTEXT_TOKEN_TARGET,
): RetrievedResearchSlice {
  const retrieved = retrieveRelevantChunks(query, chunkStore, topK);
  if (retrieved.length === 0) {
    return {
      context: '',
      chunkCount: 0,
      totalChunks: chunkStore.length,
      estimatedTokens: 0,
    };
  }

  const tokenLimit = Math.min(Math.max(1, Math.floor(maxTokens)), RESEARCH_CONTEXT_TOKEN_HARD_LIMIT);
  const sections: string[] = [];
  let estimatedTokens = 0;
  let chunkCount = 0;

  for (const chunk of retrieved) {
    const block = `[${chunk.technology} via ${chunk.tool}]\n${chunk.content}`;
    const blockTokens = estimateTokenCount(block);
    if (chunkCount > 0 && estimatedTokens + blockTokens > tokenLimit) {
      continue;
    }

    sections.push(block);
    estimatedTokens += blockTokens;
    chunkCount += 1;

    if (estimatedTokens >= tokenLimit) {
      break;
    }
  }

  return {
    context: sections.join('\n\n---\n\n'),
    chunkCount,
    totalChunks: chunkStore.length,
    estimatedTokens,
  };
}

function retrieveStepResearchSlice(
  steps: Batch5ResearchStep[],
  projectStack: string,
  chunkStore: ResearchChunk[],
  topKPerStep = 5,
  maxTokens = RESEARCH_CONTEXT_TOKEN_TARGET,
): RetrievedResearchSlice {
  const candidates: Array<{ stepTitle: string; chunk: ResearchChunk }> = [];

  for (const step of steps) {
    const stepChunks = retrieveRelevantChunks(
      `${step.title} ${step.category} ${projectStack}`,
      chunkStore,
      topKPerStep,
    );
    for (const chunk of stepChunks) {
      candidates.push({ stepTitle: step.title, chunk });
    }
  }

  if (candidates.length === 0) {
    return {
      context: '',
      chunkCount: 0,
      totalChunks: chunkStore.length,
      estimatedTokens: 0,
    };
  }

  const tokenLimit = Math.min(Math.max(1, Math.floor(maxTokens)), RESEARCH_CONTEXT_TOKEN_HARD_LIMIT);
  const sections: string[] = [];
  const seen = new Set<string>();
  let estimatedTokens = 0;

  for (const candidate of candidates) {
    const key =
      `${candidate.stepTitle}::${candidate.chunk.source}::${candidate.chunk.tool}::${candidate.chunk.content.slice(0, 120)}`
        .toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    const block =
      `Step: ${candidate.stepTitle}\n` +
      `[${candidate.chunk.technology} via ${candidate.chunk.tool}]\n` +
      candidate.chunk.content;
    const blockTokens = estimateTokenCount(block);
    if (sections.length > 0 && estimatedTokens + blockTokens > tokenLimit) {
      continue;
    }

    sections.push(block);
    seen.add(key);
    estimatedTokens += blockTokens;

    if (estimatedTokens >= tokenLimit) {
      break;
    }
  }

  return {
    context: sections.join('\n\n---\n\n'),
    chunkCount: seen.size,
    totalChunks: chunkStore.length,
    estimatedTokens,
  };
}

function buildBatch2FanOutQueries(toolName: string) {
  return [buildResearchQuery({ technology: toolName, family: 'setup' })];
}

function buildBatch2PromptPayload(
  fetchedSources: FetchedTechnologyResearch[],
  dataQuality: Batch2FetchAndRead['data_quality'],
  chunkStore: ResearchChunk[],
  projectDescription: string,
) {
  const retrievalQuery = `${projectDescription} ${fetchedSources.map((source) => source.technology).join(' ')} setup migration compatibility breaking changes`;
  const retrievedSlice = retrieveResearchSlice(retrievalQuery, chunkStore, 10, RESEARCH_CONTEXT_TOKEN_TARGET);

  return {
    payload: {
      fetchedSources: fetchedSources.map((source) => ({
        technology: source.technology,
        latest_version: source.latest_version,
        last_commit_date: source.last_commit_date,
        open_issues_count: source.open_issues_count,
        recent_breaking_changes: source.recent_breaking_changes,
        repo_health_summary: source.repo_health_summary,
        community_sentiment: source.community_sentiment,
        bug_report_digest: source.bug_report_digest,
        sources: source.source_ledger.slice(0, 8).map((entry) => ({
          technology: entry.technology,
          url: entry.url,
          tool: entry.tool,
          title: entry.title,
          summary: entry.summary,
          insight: entry.insight,
          chars_read: entry.chars_read,
          relevance: entry.relevance,
        })),
      })),
      retrieved_research_context: retrievedSlice.context,
      retrieved_chunk_count: retrievedSlice.chunkCount,
      retrieved_context_estimated_tokens: retrievedSlice.estimatedTokens,
      dataQuality,
    },
    retrievedSlice,
  };
}

function normalizeChunkStoreEntries(chunks: Batch2FetchAndRead['chunk_store']) {
  return dedupeResearchChunks(
    chunks
      .map((chunk) => ({
        content: chunk.content.trim(),
        source: chunk.source.trim(),
        tool: chunk.tool.trim(),
        technology: chunk.technology.trim(),
      }))
      .filter((chunk) => chunk.content && chunk.source && chunk.tool && chunk.technology),
  );
}

function resolveChunkStoreFromBatch2(batch2: Batch2FetchAndRead) {
  const storedChunks = normalizeChunkStoreEntries(batch2.chunk_store || []);
  if (storedChunks.length > 0) {
    return storedChunks;
  }

  const fallbackCollectedSources: CollectedResearchSource[] = [];
  for (const entry of batch2.research) {
    const primarySource = entry.sources.find((source) => source.url)?.url || `batch2://research/${entry.technology}`;
    const githubSource =
      entry.sources.find((source) => source.url && source.url.toLowerCase().includes('github.com'))?.url
      || primarySource;

    if (entry.docs_content.trim()) {
      fallbackCollectedSources.push({
        content: entry.docs_content,
        url: primarySource,
        tool: 'batch2_docs',
        technology: entry.technology,
      });
    }
    if (entry.github_readme.trim()) {
      fallbackCollectedSources.push({
        content: entry.github_readme,
        url: githubSource,
        tool: 'batch2_github',
        technology: entry.technology,
      });
    }
    if (entry.recent_breaking_changes.trim()) {
      fallbackCollectedSources.push({
        content: entry.recent_breaking_changes,
        url: primarySource,
        tool: 'batch2_breaking_changes',
        technology: entry.technology,
      });
    }
    if (entry.community_sentiment.trim()) {
      fallbackCollectedSources.push({
        content: entry.community_sentiment,
        url: primarySource,
        tool: 'batch2_community',
        technology: entry.technology,
      });
    }
    if (entry.bug_report_digest.trim()) {
      fallbackCollectedSources.push({
        content: entry.bug_report_digest,
        url: primarySource,
        tool: 'batch2_bugs',
        technology: entry.technology,
      });
    }
  }

  return buildResearchChunkStore(fallbackCollectedSources);
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

function fallbackStackCardsFromRecommendedStack(adr: Batch3Architect, research: Batch2FetchAndRead['research'] = []): ArchitectureReviewStackCard[] {
  return Object.entries(adr.recommended_stack).map(([category, selection]) => {
    const versionMatch = selection.match(/\bv?\d+(?:\.\d+)+(?:[-\w.]*)?/i);
    const version = versionMatch?.[0] || 'See ADR';
    
    // Attempt to find a matching technology in the research corpus for better package naming
    const cleanSelection = selection.replace(versionMatch?.[0] || '', '').replace(/[()]/g, '').trim();
    const researchEntry = research.find(r => 
      r.technology.toLowerCase() === cleanSelection.toLowerCase() ||
      cleanSelection.toLowerCase().includes(r.technology.toLowerCase())
    );

    const packageName = researchEntry 
      ? normalizeToNpmPackage(researchEntry.technology)
      : normalizeToNpmPackage(cleanSelection || selection);

    return {
      technology: category.replace(/^\w/, (character) => character.toUpperCase()),
      package_name: packageName,
      version: researchEntry?.latest_version || version,
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
    stack_cards: stackCards.length > 0 ? stackCards : fallbackStackCardsFromRecommendedStack(adr, research.research),
    stack_sections: buildArchitectureStackSections(adr),
    data_model: adr.data_model.map((table) => ({
      table: table.table,
      description: describeArchitectureDataTable(table),
      columns: table.columns.map((column) => `${column.name} (${column.type})`),
    })),
    gotchas: adr.gotchas,
    research_sources: research.sources,
    data_quality: research.data_quality,
    review_feedback: reviewFeedback,
    review_feedback_provided: reviewFeedbackProvided,
  };
}

function countPlanSteps(plan: PlanAuthoringRecord) {
  return plan.stages.reduce((total, stage) => total + stage.steps.length, 0);
}

export function mergePlanWithEnrichments(plan: PlanAuthoringRecord, enrichments: Batch5EnrichSteps['enrichments']): EnrichedPlan {
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
          done_when: enrichment?.done_when || step.done_when || '',
          navigation_links: enrichment?.navigation_links || [],
          prompts: enrichment?.prompts || [],
        };
      }),
    })),
  };
}

export function buildPlanMarkdown(
  authoredPlan: PlanAuthoringRecord,
  enrichedPlan: EnrichedPlan,
  reviewFeedback: string | undefined,
): string {
  const lines: string[] = [];
  lines.push(`# ${authoredPlan.project_name}`);
  lines.push('');
  lines.push(`Type: ${authoredPlan.project_type}`);
  lines.push('');
  lines.push('## The problem');
  lines.push('');
  lines.push(authoredPlan.problem);
  lines.push('');
  lines.push("## What we're building");
  lines.push('');
  lines.push(authoredPlan.solution);
  lines.push('');
  lines.push("## Who it's for");
  lines.push('');
  lines.push(authoredPlan.target_user);
  lines.push('');
  lines.push('## MVP scope');
  lines.push('');
  lines.push(authoredPlan.mvp_scope);
  lines.push('');
  lines.push('## Done when');
  lines.push('');
  lines.push(authoredPlan.done_when);
  lines.push('');
  lines.push("## How it's built");
  lines.push('');
  lines.push(authoredPlan.architecture_notes);
  lines.push('');
  lines.push('## Data model');
  lines.push('');
  lines.push(authoredPlan.data_model_notes);
  lines.push('');
  lines.push(buildPlanSectionMarkdown(enrichedPlan));

  if (reviewFeedback?.trim()) {
    lines.push('');
    lines.push('## Review Notes');
    lines.push('');
    lines.push(reviewFeedback.trim());
  }

  return lines.join('\n');
}

function buildPlanSectionMarkdown(enrichedPlan: EnrichedPlan): string {
  const lines: string[] = [];
  lines.push('## Build plan\n');
  
  for (const stage of enrichedPlan.stages) {
    lines.push(`### ${stage.title}\n`);
    
    for (const step of stage.steps) {
      const statusBadge = step.is_milestone 
        ? `[Milestone: ${step.milestone_label || 'Checkpoint'}]`
        : step.is_gate 
          ? '[Gate]' 
          : '';
      
      lines.push(`#### ${step.title} ${statusBadge}\n`);
      
      if (step.objective) {
        lines.push(`**Objective:** ${step.objective}\n`);
      }
      
      if (step.why_it_matters) {
        lines.push(`**Why it matters:** ${step.why_it_matters}\n`);
      }
      
      if (step.done_when) {
        lines.push(`**Done when:** ${step.done_when}\n`);
      }
      
      if (step.suggested_tools && step.suggested_tools.length > 0) {
        lines.push(`**Suggested tools:** ${step.suggested_tools.join(', ')}\n`);
      }
      
      if (step.checklist && step.checklist.length > 0) {
        lines.push('\n**Checklist:**');
        for (const item of step.checklist) {
          const required = item.is_required ? ' (required)' : '';
          lines.push(`- [ ] ${item.label}${required}`);
        }
        lines.push('');
      }
      
      lines.push('');
    }
  }
  
  return lines.join('\n');
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

export function normalizePlanStructure(plan: PlanAuthoringRecord): PlanAuthoringRecord {
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
  const edges: PlanAuthoringRecord['edges'] = [];
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

function normalizeNavigationLinks(
  links: Batch5EnrichSteps['enrichments'][number]['navigation_links'],
) {
  const seen = new Set<string>();
  const normalized: Batch5EnrichSteps['enrichments'][number]['navigation_links'] = [];

  for (const link of links || []) {
    const label = (link.label || '').trim();
    const url = (link.url || '').trim();
    if (!label || !url) {
      continue;
    }

    const key = `${label.toLowerCase()}::${url.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    normalized.push({
      label,
      url,
      when: (link.when || '').trim() || 'Start here',
    });
  }

  return normalized.slice(0, 4);
}

function buildFallbackNavigationLinks(stepResearch: StepResearchContext | undefined) {
  if (!stepResearch) {
    return [];
  }

  const seen = new Set<string>();
  return stepResearch.docs
    .map((doc, index) => {
      const url = (doc.url || '').trim();
      if (!url || seen.has(url.toLowerCase())) {
        return null;
      }

      seen.add(url.toLowerCase());
      return {
        label: `Open ${doc.library} docs`,
        url,
        when: index === 0 ? 'Start here' : 'Reference',
      };
    })
    .filter((link): link is { label: string; url: string; when: string } => Boolean(link))
    .slice(0, 3);
}

function normalizeDoneWhen(value: string, fallback: string) {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return fallback;
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.includes('feel confident')
    || lower.includes('when ready')
    || lower.includes('looks good')
    || lower.includes('seems complete')
  ) {
    return fallback;
  }

  return trimmed;
}

function normalizeResearchFooterMeta(
  value: Batch5EnrichSteps['enrichments'][number]['research_footer_meta'] | undefined,
  fallbackDateLabel: string,
) {
  const researchedAt = (value?.researched_at || '').trim() || fallbackDateLabel;
  const tools = (value?.tools || [])
    .map((tool) => tool.trim())
    .filter(Boolean);

  return {
    researched_at: researchedAt,
    tools: tools.length > 0 ? tools : ['default research stack'],
  };
}

function ensureCompleteStepEnrichments(
  steps: Batch5ResearchStep[],
  stepResearchById: Map<string, StepResearchContext>,
  enrichments: Batch5EnrichSteps['enrichments'],
): Batch5EnrichSteps['enrichments'] {
  const enrichmentById = new Map<string, Batch5EnrichSteps['enrichments'][number]>();
  const fallbackDateLabel = new Date().toISOString().slice(0, 10);

  for (const enrichment of enrichments) {
    if (!enrichment.step_id || enrichmentById.has(enrichment.step_id)) {
      continue;
    }

    enrichmentById.set(enrichment.step_id, {
      step_id: enrichment.step_id,
      ai_output: enrichment.ai_output.trim(),
      done_when: normalizeDoneWhen(enrichment.done_when || '', ''),
      research_footer_meta: normalizeResearchFooterMeta(enrichment.research_footer_meta, fallbackDateLabel),
      navigation_links: normalizeNavigationLinks(enrichment.navigation_links),
      prompts: normalizePromptCards(enrichment.prompts),
    });
  }

  return steps.map((step) => {
    const existing = enrichmentById.get(step.id);
    const stepResearchContext = stepResearchById.get(step.id);
    const footerMeta = normalizeResearchFooterMeta(
      existing?.research_footer_meta || stepResearchContext?.footerMeta,
      fallbackDateLabel,
    );
    const body = existing?.ai_output || buildFallbackStepEnrichmentBody(step);
    const fallbackDoneWhen =
      step.done_when?.trim()
      || `You can verify ${step.title.toLowerCase()} works end-to-end in your local environment.`;
    const doneWhen = normalizeDoneWhen(existing?.done_when || '', fallbackDoneWhen);
    const navigationLinks = existing?.navigation_links?.length
      ? existing.navigation_links
      : buildFallbackNavigationLinks(stepResearchById.get(step.id));

    return {
      step_id: step.id,
      ai_output: body,
      done_when: doneWhen,
      research_footer_meta: footerMeta,
      navigation_links: navigationLinks,
      prompts: existing?.prompts || [],
    };
  });
}

function normalizeGeneratedFileName(value: string): SkillFileName | null {
  return SKILL_FILE_NAMES.includes(value as SkillFileName) ? (value as SkillFileName) : null;
}

function buildFallbackGeneratedFileContent(filename: SkillFileName) {
  switch (filename) {
    case 'plan.md':
    default:
      return [
        '# Build Plan',
        '',
        'Scrimble could not fully regenerate this file in the last pass.',
        'Use the approved architecture and the enriched plan as the current source of truth.',
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

function flattenPlanSteps(plan: PlanAuthoringRecord): Batch5ResearchStep[] {
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





async function maybeTouchGenerationHeartbeat(
  env: Bindings,
  projectId: string,
  runId?: string | null,
) {
  if (!runId) {
    return;
  }

  const lastTouchedAt = lastHeartbeatTouchByProject.get(projectId) || 0;
  if (Date.now() - lastTouchedAt < HEARTBEAT_TOUCH_INTERVAL_MS) {
    return;
  }
  lastHeartbeatTouchByProject.set(projectId, Date.now());
  await touchGenerationRunHeartbeat(env, runId);
}

async function insertAgentRun(
  env: Bindings,
  payload: {
    projectId: string;
    runId?: string | null;
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
      id, project_id, run_id, run_type, status, input, output, output_r2_key, provider, model, sequence_index, attempt_count, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))
  `)
    .bind(
      id,
      payload.projectId,
      payload.runId || null,
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

  await touchGenerationRunHeartbeat(env, runId);
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
  const { changes } = await updateGenerationRunStatus(env, runId, batchName, {
    currentBatch: batchName,
  });
  if (changes === 0) {
    throw staleGenerationRunError(projectId, runId, `starting ${batchName}`);
  }
  await touchGenerationRunHeartbeat(env, runId);
  await resetGenerationThinkingState(env, projectId, batchName);
  await persistGenerationStreamEvent(env, {
    projectId,
    runId,
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
        runId: optionalText(payload.body.run_id),
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
        runId: optionalText(payload.body.run_id),
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
        runId: optionalText(payload.body.run_id),
        batchName: payload.batchName,
        event: {
          type: 'batch_complete',
          batch: asText(payload.body.batch || payload.batchName) as GenerationBatchName,
          duration_ms: Number(payload.body.duration_ms) || 0,
          progress_percent: Number(payload.body.progress_percent) || 0,
        },
      });
      await resetGenerationThinkingState(env, payload.projectId, payload.batchName || null);
      return;
    case 'review_required':
      if (payload.body.adr) {
        await persistGenerationStreamEvent(env, {
          projectId: payload.projectId,
          runId: optionalText(payload.body.run_id),
          batchName: payload.batchName,
          event: {
            type: 'checkpoint',
            adr: payload.body.adr as Batch3Architect,
            run_id: optionalText(payload.body.run_id) || undefined,
          },
        });
      }
      return;
    case 'generation_complete':
      await persistGenerationStreamEvent(env, {
        projectId: payload.projectId,
        runId: optionalText(payload.body.run_id),
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
        runId: optionalText(payload.body.run_id),
        batchName: payload.batchName,
        event: {
          type: 'pipeline_failed',
          error: asText(payload.body.error, 'Project generation failed.'),
          failureClass: asText(payload.body.failureClass, 'unknown'),
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
      run_id: payload.runId || undefined,
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
  let active = true;

  // Background heartbeat loop
  const heartbeatLoop = async () => {
    while (active) {
      try {
        await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_TOUCH_INTERVAL_MS));
        if (!active) break;
        await touchGenerationRunHeartbeat(env, runId);
      } catch (error) {
        console.warn('[generation-heartbeat] Failed to refresh heartbeat during AI call:', error);
      }
    }
  };

  const loopPromise = heartbeatLoop();

  try {
    await touchGenerationRunHeartbeat(env, runId);
    const response = await callAIText(payload);
    await touchGenerationRunHeartbeat(env, runId);
    return response;
  } finally {
    active = false;
    // We don't strictly need to await loopPromise here as the loop will exit on next tick/delay
  }
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

  if (!typedRecord) {
    throw new GenerationPipelineError(`Missing output record for ${runType}. Please ensure the previous step completed successfully.`);
  }

  const storedOutput = await loadJsonPayloadText(env, typedRecord.output, typedRecord.output_r2_key);

  if (!storedOutput) {
    throw new GenerationPipelineError(`Output record for ${runType} exists but content is empty.`);
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
) {
  const timestamp = new Date().toISOString();
  const context = await loadArchitectureReviewContext(env, projectId);
  const trimmedFeedback = feedback.trim();
  const nextInput = {
    ...context.input,
    review_feedback: trimmedFeedback,
    review_feedback_provided: trimmedFeedback.length > 0,
    review_feedback_updated_at: timestamp,
  };

  await env.DB.prepare('UPDATE agent_runs SET input = ? WHERE id = ?')
    .bind(JSON.stringify(nextInput), context.runId)
    .run();

  return {
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


async function resolveProviderConfiguration(
  env: Bindings,
  projectId: string,
  runId: string | null,
  userId: string,
  role: GenerationModelRole,
  providerId?: string,
): Promise<ProviderConfig> {
  const provider = await getProvider(env, userId, { providerId, role });
  if (!provider) {
    throw new GenerationPipelineError('No AI provider is configured yet. Add one in Settings first.');
  }

  await persistGenerationStreamEvent(env, {
    projectId,
    runId,
    event: {
      type: 'activity',
      icon: '⚡',
      message: `[MODEL_RESOLUTION] Role: ${role} → Provider: ${provider.providerName} Model: ${provider.model}`,
      timestamp: new Date().toISOString(),
    },
  });

  return provider;
}

export async function resolveGenerationProviderConfiguration(
  env: Bindings,
  projectId: string,
  userId: string,
  role: GenerationModelRole,
  providerId?: string,
): Promise<ProviderConfig> {
  return resolveProviderConfiguration(env, projectId, null, userId, role, providerId);
}

function formatSchemaCorrectionPrompt(previousResponse: string, schemaDescription: string) {
  // Truncate previous response if it's too long to avoid context limit issues
  const truncatedResponse = previousResponse.length > 4000 
    ? previousResponse.slice(0, 2000) + '\n... [truncated] ...\n' + previousResponse.slice(-2000)
    : previousResponse;

  return `The previous response had a schema error. Return ONLY the corrected JSON object with no other text. Schema: ${schemaDescription}
Previous response: ${truncatedResponse}`;
}

function formatValidationRetryPrompt(basePrompt: string, previousResponse: string, schemaDescription: string) {
  // Truncate previous response if it's too long to avoid context limit issues
  const truncatedResponse = previousResponse.length > 4000 
    ? previousResponse.slice(0, 2000) + '\n... [truncated] ...\n' + previousResponse.slice(-2000)
    : previousResponse;

  return `${basePrompt}

your previous response failed validation — here is what you returned and here is the schema you must follow

Previous response (truncated if long):
${truncatedResponse}

Required schema:
${schemaDescription}`;
}

function formatReasoningOnlyRetryPrompt(basePrompt: string, schemaDescription: string) {
  return `${basePrompt}

Your previous response contained only reasoning/thoughts but no JSON data. 
YOU MUST RETURN ONLY A VALID JSON OBJECT matching the schema below. 
DO NOT include any reasoning, thoughts, or conversational text. 
DO NOT use markdown code fences.

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
    role: GenerationModelRole;
    systemPrompt: string;
    prompt: string;
    schema: ZodType<T>;
    schemaDescription: string;
  },
) {
  let prompt = options.prompt;
  let lastError = 'The AI response was empty.';
  const emitter = createThrottledThinkingEmitter(
    options.env,
    options.projectId,
    options.runId,
    options.runType,
  );
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await logActivity(options.env, {
        projectId: options.projectId,
        batchName: options.runType,
        runId: options.runId,
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
        role: options.role,
        onReasoningDelta: emitter.onReasoningDelta,
      });
      await logActivity(options.env, {
        projectId: options.projectId,
        batchName: options.runType,
        runId: options.runId,
        kind: 'system',
        message: `Model response received for ${getBatchStartLabel(options.runType).toLowerCase()}. Validating and applying it now...`,
      });

      let parsed: unknown;
      const cleanedText = extractJSON(text);
      const isReasoningOnly = containsReasoningMarkers(text) && !cleanedText.startsWith('{') && !cleanedText.startsWith('[');

      try {
        if (isReasoningOnly) {
          throw new Error('Reasoning only detected');
        }
        parsed = JSON.parse(cleanedText);
      } catch {
        logBatchResponseFailure(
          options.runType,
          containsStreamTransportMarkers(text) ? 'transport' : 'json',
          text,
        );
        lastError = isReasoningOnly 
          ? `The AI only provided reasoning for ${options.runType} and no JSON.`
          : `The AI response for ${options.runType} was not valid JSON.`;

        if (attempt === 1) {
          await logActivity(options.env, {
            projectId: options.projectId,
            batchName: options.runType,
            runId: options.runId,
            kind: 'warning',
            message: isReasoningOnly
              ? 'The model provided only thoughts but no data, so I am retrying with a direct JSON instruction.'
              : 'The first model reply was not valid JSON, so I asked for a corrected response before continuing.',
          });
          
          if (isReasoningOnly) {
            prompt = formatReasoningOnlyRetryPrompt(options.prompt, options.schemaDescription);
          } else {
            prompt = containsStreamTransportMarkers(text)
              ? formatTransportRetryPrompt(options.prompt, options.schemaDescription)
              : options.role === 'fast'
                ? formatSchemaCorrectionPrompt(cleanedText, options.schemaDescription)
                : formatValidationRetryPrompt(options.prompt, cleanedText, options.schemaDescription);
          }
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
          runId: options.runId,
          kind: 'warning',
          message: `The first model reply had a schema error, so I'm asking for a correction.`,
        });
        const correctionSchema = `${options.schemaDescription}\n\nERROR TO FIX: ${validationError}`;
        prompt = options.role === 'fast'
          ? formatSchemaCorrectionPrompt(cleanedText, correctionSchema)
          : formatValidationRetryPrompt(options.prompt, cleanedText, correctionSchema);
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
  error: unknown,
  attemptCount: number,
): Promise<never> {
  const message = error instanceof Error ? error.message : String(error);
  
  await insertAgentRun(env, {
    projectId,
    runId,
    runType,
    status: 'failed',
    input: serializeJson(input),
    output: message,
    provider: provider.providerType,
    model: provider.model,
    sequenceIndex: batchSequenceIndexes[runType],
    attemptCount,
  });

  const { changes } = await updateGenerationRunStatus(env, runId, 'failed', {
    errorMessage: message,
  });
  if (changes === 0) {
    throw staleGenerationRunError(projectId, runId, `failing ${runType}`);
  }

  await insertGenerationEvent(env, {
    projectId,
    eventType: 'generation_failed',
    batchName: runType,
    body: {
      batch: runType,
      error: message,
      failureClass: classifyAIError(error),
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
  await insertAgentRun(env, {
    projectId,
    runId,
    runType,
    status: 'complete',
    input: serializeJson(input),
    output: JSON.stringify(storedOutput),
    provider: provider.providerType,
    model: provider.model,
    sequenceIndex: batchSequenceIndexes[runType],
    attemptCount,
  });

  const { changes } = await updateGenerationRunStatus(env, runId, runType, {
    currentBatch: runType,
  });
  if (changes === 0) {
    throw staleGenerationRunError(projectId, runId, `completing ${runType}`);
  }

  await insertGenerationEvent(env, {
    projectId,
    eventType: 'batch_completed',
    batchName: runType,
    body: {
      batch: runType,
      duration_ms: durationMs,
      progress_percent: Math.round((batchSequenceIndexes[runType] / GENERATION_BATCHES.length) * 100),
    },
  });
}

async function materializePlanStructure(env: Bindings, projectId: string, plan: PlanAuthoringRecord) {
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
            is_gate, is_milestone, milestone_label, risk_level, order_index, objective, why_it_matters, suggested_tools, done_when,
            ai_output, prompts, navigation_links, is_ai_enriched
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          step.is_milestone ? 1 : 0,
          step.milestone_label || null,
          step.risk_level || 'low',
          globalOrderIndex,
          step.objective || '',
          step.why_it_matters || '',
          JSON.stringify(step.suggested_tools || []),
          step.done_when || '',
          null,
          JSON.stringify([]),
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
          done_when = ?,
          research_footer_meta = ?,
          prompts = ?,
          navigation_links = ?,
          is_ai_enriched = 1,
          status = CASE
            WHEN is_gate = 1 AND status = 'active' THEN 'needs_review'
            ELSE status
          END,
          updated_at = datetime("now")
      WHERE id = ? AND workflow_id IN (SELECT id FROM workflows WHERE project_id = ?)
    `).bind(
      enrichment.ai_output,
      enrichment.done_when,
      JSON.stringify(
        enrichment.research_footer_meta || {
          researched_at: new Date().toISOString().slice(0, 10),
          tools: ['default research stack'],
        },
      ),
      JSON.stringify(enrichment.prompts),
      JSON.stringify(enrichment.navigation_links || []),
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

type StoredIntakeAnswerEntry = {
  question: string;
  answer: string;
};

type StoredIntakeAnswersPayload = {
  answers: StoredIntakeAnswerEntry[];
};

function parseStoredIntakeAnswers(value: string | null | undefined): StoredIntakeAnswersPayload | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const payload = parsed as { answers?: unknown };
    const answers = Array.isArray(payload.answers)
      ? payload.answers
          .map((entry) => ({
            question:
              entry && typeof entry === 'object' && !Array.isArray(entry) && typeof (entry as { question?: unknown }).question === 'string'
                ? (entry as { question: string }).question.trim()
                : '',
            answer:
              entry && typeof entry === 'object' && !Array.isArray(entry) && typeof (entry as { answer?: unknown }).answer === 'string'
                ? (entry as { answer: string }).answer.trim()
                : '',
          }))
          .filter((entry: StoredIntakeAnswerEntry) => entry.question && entry.answer)
      : [];

    if (answers.length === 0) {
      return null;
    }

    return { answers };
  } catch {
    return null;
  }
}

function formatStoredIntakeAnswers(value: string | null | undefined) {
  const parsed = parseStoredIntakeAnswers(value);
  if (!parsed) {
    return '';
  }

  return parsed.answers
    .map((entry, index) => `${index + 1}. ${entry.question}\nAnswer: ${entry.answer}`)
    .join('\n\n');
}

export async function executeBatch1(
  env: Bindings,
  project: ProjectRecord,
  provider: ProviderConfig,
  runId: string,
  _builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
): Promise<BatchExecutionResult> {
  const startedAt = Date.now();
  const intakeAnswers = formatStoredIntakeAnswers(project.intake_answers);
  const projectDescription = projectBrief.summary || project.description || '';
  const input = {
    description: projectDescription,
    intake_answers: intakeAnswers || undefined,
  };

  await emitBatchStart(env, project.id, runId, 'batch_1_research_stack');
  await logActivity(env, {
    projectId: project.id,
    batchName: 'batch_1_research_stack',
    runId,
    kind: 'fetch',
    message: 'Scanning your brief for technologies, services, and infrastructure choices...',
  });

  const systemPrompt = appendProjectBriefSystemPrompt(
    'You are Scrimble’s stack research scout. Infer every technology, library, framework, hosted service, and infrastructure tool implied by the project description. Return only valid JSON. Return ONLY a raw JSON object. No markdown. No backticks. No explanation. Start your response with { and end with }',
    projectBrief.promptContext,
  );
  const prompt = `Project description:
${projectDescription || 'No description provided.'}

${intakeAnswers
    ? `Clarifying intake answers:
${intakeAnswers}

Use these answers as additional context when identifying implementation-critical technologies.`
    : ''}

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
      role: 'fast',
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
        runId,
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
      runId,
      kind: 'complete',
      message: `Stack candidates identified — ${enrichedBatch1.technologies.length} technologies queued for deeper research next.`,
    });
    return 'complete';
  } catch (error) {
    const errorClass = classifyAIError(error);
    if (errorClass === 'transport_provider_transient' || errorClass === 'orchestration') {
      const errorMessage = error instanceof Error ? error.message : 'Batch 1 failed.';
      throw new RetryableGenerationPipelineError(errorMessage, 45);
    }

    await failBatch(
      env,
      project.id,
      runId,
      provider,
      'batch_1_research_stack',
      input,
      error,
      2,
    );
  }
}

// Cloudflare hard-limits Workers to 50 subrequests. Stop research at 35 to preserve headroom.
const SUBREQUEST_RESERVE = 0;

export async function executeBatch2(
  env: Bindings,
  project: ProjectRecord,
  provider: ProviderConfig,
  deepProvider: ProviderConfig,
  runId: string,
  builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
  checkpointItemInterval = GENERATION_CHECKPOINT_ITEM_INTERVAL,
): Promise<BatchExecutionResult> {
  const startedAt = Date.now();
  const projectId = project.id;
  const maxSubrequestBudget = RESEARCH_SUBREQUEST_LIMIT;
  const batch1 = await loadBatchOutput(env, projectId, 'batch_1_research_stack', Batch1ResearchStackSchema);
  const sourceTargetCount = resolveBatch2SourceTargetCount();
  const searchResultLimit = resolveBatch2SearchResultLimit();
  const targetSelection = buildResearchTargets(
    batch1.technologies,
    builderProfile,
    projectBrief,
    sourceTargetCount,
  );
  const checkpoint = await loadGenerationCheckpoint<Batch2CheckpointData>(
    env,
    projectId,
    runId,
    'batch_2_fetch_and_read',
  );
  const researchTargets =
    checkpoint?.data.researchTargets || targetSelection.targets;
  const totalCandidateTargets = checkpoint?.data.totalCandidateTargets ?? targetSelection.totalCandidates;
  const fetchedSources: FetchedTechnologyResearch[] = checkpoint?.data.fetchedSources
    ? [...checkpoint.data.fetchedSources]
    : [];
  const collectedSources: CollectedResearchSource[] = checkpoint?.data.collectedSources
    ? [...checkpoint.data.collectedSources]
    : [];
  const connectedTools = await getConnectedResearchTools(env, project.user_id);
  const briefResearchCount = researchTargets.filter((target) => target.source === 'brief').length;
  const profileResearchCount = researchTargets.filter((target) => target.source === 'profile').length;
  let issuesFound = checkpoint?.data.issuesFound ?? 0;
  const partialFailures = checkpoint?.data.partialFailures ? [...checkpoint.data.partialFailures] : [];
  const degradedTools = new Set(partialFailures.map((failure) => failure.tool));
  // IMPORTANT: Checkpoints store durable logical progress (index + fetched data), not transient
  // per-invocation counters. A resumed workflow step starts with a fresh subrequest budget.
  let subrequestCounter = 0;
  const startIndex = checkpoint?.currentIndex ?? 0;
  let processedThisInvocation = 0;
  const subrequestTracker = createResearchSubrequestTracker({
    initialCount: 0,
    limit: maxSubrequestBudget,
  });

  const recordPartialFailure = async (tool: string, technologyName: string, message: string) => {
    pushPartialFailure(partialFailures, tool, technologyName, message);
    degradedTools.add(tool);
    await logActivity(env, {
      projectId,
      batchName: 'batch_2_fetch_and_read',
      runId,
      kind: 'warning',
      message,
    });
  };

  await emitBatchStart(env, projectId, runId, 'batch_2_fetch_and_read');
  await logActivity(env, {
    projectId,
    batchName: 'batch_2_fetch_and_read',
    runId,
    kind: 'fetch',
    message:
      briefResearchCount > 0
        ? `Reading the docs for ${researchTargets.length} technologies, starting with ${briefResearchCount} confirmed stack tool${briefResearchCount === 1 ? '' : 's'} from your brief...`
        : profileResearchCount > 0
          ? `Reading the docs for ${researchTargets.length} technologies, starting with ${profileResearchCount} relevant saved tool${profileResearchCount === 1 ? '' : 's'} from your builder profile...`
          : `Reading the docs for ${researchTargets.length} technolog${researchTargets.length === 1 ? 'y' : 'ies'}...`,
  });
  await logActivity(env, {
    projectId,
    batchName: 'batch_2_fetch_and_read',
    runId,
    kind: 'system',
    message: `RAG retrieval mode enabled with ${deepProvider.model}: researching up to ${sourceTargetCount} technologies, using strict sequential fetches and one targeted search query per tool, and assembling prompts from retrieved chunks only.`,
  });

  if (checkpoint) {
    await logActivity(env, {
      projectId,
      batchName: 'batch_2_fetch_and_read',
      runId,
      kind: 'system',
      message: `Resuming fetched-doc research at technology ${startIndex + 1} of ${researchTargets.length}.`,
    });
  }

  for (let index = startIndex; index < researchTargets.length; index += 1) {
    const technology = researchTargets[index];
    await logActivity(env, {
      projectId,
      batchName: 'batch_2_fetch_and_read',
      runId,
      kind: 'fetch',
      message:
        technology.source === 'brief'
          ? `Researching your confirmed stack tool ${technology.name} before anything else...`
          : technology.source === 'profile'
          ? `Researching your saved tool ${technology.name} before anything else...`
          : `Researching ${technology.name} with every source you've connected...`,
    });

    // Check budget before starting research for this technology.
    // This guard prevents runaway fetching if something goes wrong with tracking.
    // With proper counter reset on resume, this should rarely trigger.
    if (processedThisInvocation > 0 && subrequestCounter >= maxSubrequestBudget - SUBREQUEST_RESERVE) {
      await saveGenerationCheckpoint(env, projectId, runId, 'batch_2_fetch_and_read', index, {
        researchTargets,
        fetchedSources,
        researchSourceLedger: dedupeResearchSources(fetchedSources.flatMap((source) => source.source_ledger)),
        issuesFound,
        partialFailures,
        totalCandidateTargets,
        collectedSources,
      });
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        runId,
        kind: 'system',
        message: `Approaching subrequest budget limit — saved checkpoint at technology ${index + 1} of ${researchTargets.length}. Resuming from the next workflow step...`,
      });
      return 'checkpointed';
    }

    const mappedDocs = resolveToolDocsEntry(technology.name);
    const docsUrl = (technology.docs_url || '').trim() || mappedDocs?.docs || '';
    const githubRepository = resolveResearchRepository(technology.github_url || '', mappedDocs?.github);
      const githubUrl = githubRepository
      ? `https://github.com/${githubRepository.owner}/${githubRepository.repo}`
      : (technology.github_url || '').trim();
      const changelogUrl = (technology.changelog_url || '').trim();

    const researchContext: Parameters<typeof facadeFetchDocs>[0] = {
      env,
      userId: project.user_id,
      projectId,
      batchName: 'batch_2_fetch_and_read',
      subrequestTracker,
    };

    const fanOutQueries = buildBatch2FanOutQueries(technology.name);
    
    // docsResult
    let docsResult: ResearchResult;
    if (docsUrl) {
      const resp = await facadeFetchDocs(researchContext, technology.name, technology.docs_topic, docsUrl);
      docsResult = {
        content: resp.content,
        source: resp.source,
        tool: resp.metadata.tool as any,
        chars: resp.content.length,
        error: resp.metadata.degraded ? resp.metadata.degradationReason : undefined,
      };
    } else {
      docsResult = emptyResearchResult('', `No docs URL found for ${technology.name}.`);
    }

    // githubResult
    let githubResult: ResearchResult;
    if (githubRepository) {
      const resp = await facadeAnalyzeGitHubRepo(researchContext, githubRepository.owner, githubRepository.repo);
      const headline = `${resp.owner}/${resp.repo} — ${resp.stars} stars, ${resp.openIssues} open issues`;
      const releasesText = (resp.releases || [])
        .slice(0, 4)
        .map((r: any) => `${r.tagName} (${r.publishedAt}): ${r.body}`)
        .join('\n\n');
      const issuesText = (resp.recentIssues || [])
        .slice(0, 8)
        .map((i: any) => `Issue (${i.createdAt}) ${i.title}: ${i.body}`)
        .join('\n\n');
      const combinedContent = [headline, resp.readme, releasesText, issuesText].filter(Boolean).join('\n\n');
      
      githubResult = {
        content: combinedContent,
        source: `https://github.com/${resp.owner}/${resp.repo}`,
        tool: resp.metadata.tool as any,
        chars: combinedContent.length,
        error: resp.metadata.degraded && resp.metadata.quality === 'failed' ? resp.metadata.degradationReason : undefined,
      };
    } else {
      githubResult = emptyResearchResult('', `No GitHub repo found for ${technology.name}.`);
    }

    // fanOutSearchResults
    const fanOutSearchResultsRaw = await Promise.all(
      fanOutQueries.map((query) => facadeSearchWeb(researchContext, query, searchResultLimit))
    );
    
    // Legacy compatibility for following lines: fanOutSearchResults.flat()
    const fanOutSearchResults: ResearchResult[][] = fanOutSearchResultsRaw.map(resp => 
      resp.results.map(r => ({
        content: r.description,
        source: r.url,
        title: r.title,
        tool: (resp.metadata.tool as any) || 'jina_search',
        chars: r.description.length,
      }))
    );

    const flattenedWebResearchResults: ResearchResult[] = fanOutSearchResults.flat();

    subrequestCounter = subrequestTracker.count;

    if (docsUrl && docsResult.tool === 'failed') {
      await recordPartialFailure(
        'Jina Reader',
        technology.name,
        docsResult.error || `Jina Reader failed for ${technology.name}.`,
      );
    }

    if (docsUrl && docsResult.tool !== 'failed' && docsResult.content) {
      const charCount = formatCharCount(docsResult.chars, docsResult.content.length);
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        runId,
        kind: 'fetch',
        message: `${humanDocToolLabel(docsResult.tool)}: read ${charCount} from ${technology.name} docs.`,
      });
    }

    if (githubRepository && githubResult.tool === 'failed') {
      await recordPartialFailure(
        'GitMCP',
        technology.name,
        githubResult.error || `GitMCP failed for ${technology.name}.`,
      );
    }

    const failedSearch = fanOutSearchResults.flat().find((entry) => entry.tool === 'failed');
    if (failedSearch) {
      await recordPartialFailure(
        'Jina Search',
        technology.name,
        failedSearch.error || `Jina Search failed for ${technology.name}.`,
      );
    }

    const searchResults = dedupeSearchResults([
      ...flattenedWebResearchResults
        .map((entry) => toSearchResultFromResearch(entry))
        .filter((entry): entry is SearchResult => Boolean(entry)),
      ...technology.community_search_results,
      ...technology.breaking_change_search_results,
    ]);

    const communityPages: FetchedCommunitySource[] = searchResults
      .filter((result) => result.description.trim().length > 0)
      .slice(0, 6)
      .map((result) => ({
        title: result.title,
        url: result.url,
        description: result.description,
        content: result.description,
      }));

    if (!docsResult.content) {
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        runId,
        kind: 'warning',
        message: `Could not read ${technology.name} documentation — continuing with the rest of the research.`,
      });
    }

    if (!githubRepository) {
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        runId,
        kind: 'warning',
        message: `${technology.name} did not include a valid GitHub repository URL — skipping repository analysis.`,
      });
    } else if (!githubResult.content) {
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        runId,
        kind: 'warning',
        message: `Could not inspect ${technology.name} on GitHub — continuing with the rest of the sources.`,
      });
    } else {
      const charCount = formatCharCount(githubResult.chars, githubResult.content.length);
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        runId,
        kind: 'github',
        message: `${humanGithubToolLabel(githubResult.tool)}: read ${charCount} from ${githubRepository.owner}/${githubRepository.repo}.`,
      });
    }

    if (searchResults.length > 0) {
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        runId,
        kind: 'fetch',
        message: `Read ${searchResults.length} web source${searchResults.length === 1 ? '' : 's'} for ${technology.name}.`,
      });
    } else {
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        runId,
        kind: 'warning',
        message: `No web changelog sources were found for ${technology.name} in this pass.`,
      });
    }

    const repoHealthSummary = githubResult.content
      ? summarizeSnippet(githubResult.content, 1_600)
      : 'GitHub repository data unavailable.';
    const releaseSignal = formatSearchResults(
      searchResults.filter((result) => /release|changelog|deprecat|breaking|migration/i.test(`${result.title} ${result.description}`)),
    );
    const bugSignal = formatSearchResults(
      searchResults.filter((result) => /bug|issue|regression|incident|outage/i.test(`${result.title} ${result.description}`)),
    );
    const communitySentiment = communityPages
      .map((page) => `${page.title}: ${summarizeSnippet(page.content || page.description, 1_200)} (${page.url})`)
      .join('\n\n');
    const recentBreakingChangesRaw = releaseSignal || 'Release notes unavailable.';
    const latestVersion = parseLatestVersionFromText(githubResult.content, releaseSignal);
    const lastCommitDate = parseLastCommitDateFromText(githubResult.content);
    const openIssuesCount = parseOpenIssuesCount(githubResult.content);
    issuesFound += openIssuesCount;

    const technologySources = dedupeResearchSources([
      ...(docsResult.content
        ? [
            createResearchSource(
              technology.name,
              toolLabelFromDocTool(docsResult.tool),
              docsUrl || docsResult.source,
              `${technology.name} docs`,
              docsResult.content,
              docsResult.chars || docsResult.content.length,
              technology.priority,
            ),
          ]
        : []),
      ...(githubResult.content
        ? [
            createResearchSource(
              technology.name,
              toolLabelFromGithubTool(githubResult.tool),
              githubResult.source || githubUrl,
              githubRepository
                ? `${githubRepository.owner}/${githubRepository.repo}`
                : `${technology.name} repository`,
              githubResult.content,
              githubResult.chars || githubResult.content.length,
              technology.priority,
            ),
          ]
        : []),
      ...communityPages.map((page) =>
        createResearchSource(
          technology.name,
          'jina_search',
          page.url,
          page.title,
          page.content || page.description,
          (page.content || page.description || '').length,
          technology.priority,
        ),
      ),
    ]);
    if (docsResult.content) {
      collectedSources.push({
        content: docsResult.content,
        url: docsUrl || docsResult.source,
        tool: toolLabelFromDocTool(docsResult.tool),
        technology: technology.name,
      });
    }
    if (githubResult.content) {
      collectedSources.push({
        content: githubResult.content,
        url: githubResult.source || githubUrl,
        tool: toolLabelFromGithubTool(githubResult.tool),
        technology: technology.name,
      });
    }
    for (const page of communityPages) {
      const content = (page.content || page.description || '').trim();
      if (!content) {
        continue;
      }

      collectedSources.push({
        content,
        url: page.url,
        tool: 'jina_search',
        technology: technology.name,
      });
    }

    fetchedSources.push({
      technology: technology.name,
      docs_url: docsUrl,
      github_url: githubUrl,
      changelog_url: changelogUrl,
      docs_content: docsResult.content || 'Documentation source unavailable.',
      github_readme: githubResult.content || 'GitHub repository data unavailable.',
      latest_version: latestVersion,
      last_commit_date: lastCommitDate,
      open_issues_count: openIssuesCount,
      recent_breaking_changes: recentBreakingChangesRaw,
      repo_health_summary: repoHealthSummary,
      community_sentiment:
        (communitySentiment || formatSearchResults(searchResults)).trim() || 'Community sentiment unavailable.',
      bug_report_digest: (bugSignal || 'No recent bug reports found.').trim(),
      source_ledger: technologySources,
      community_pages: communityPages,
    });

    processedThisInvocation += 1;

    const hasMoreWork = index + 1 < researchTargets.length;
    const processedCount = index + 1;
    const normalizedCheckpointItemInterval = Math.max(1, checkpointItemInterval);
    if (
      hasMoreWork &&
      (processedCount % normalizedCheckpointItemInterval === 0
        || subrequestCounter >= maxSubrequestBudget - SUBREQUEST_RESERVE)
    ) {
      await saveGenerationCheckpoint(env, projectId, runId, 'batch_2_fetch_and_read', index + 1, {
        researchTargets,
        fetchedSources,
        researchSourceLedger: dedupeResearchSources(fetchedSources.flatMap((source) => source.source_ledger)),
        issuesFound,
        partialFailures,
        totalCandidateTargets,
        collectedSources,
      });
      await logActivity(env, {
        projectId,
        batchName: 'batch_2_fetch_and_read',
        runId,
        kind: 'system',
        message: `Saved a fetch checkpoint after ${fetchedSources.length} technologies. Continuing from the latest checkpoint...`,
      });
      return 'checkpointed';
    }
  }

  const sourceLedger = dedupeResearchSources(fetchedSources.flatMap((source) => source.source_ledger));
  const chunkStore = buildResearchChunkStore(collectedSources);
  if (chunkStore.length > RESEARCH_CHUNK_WARN_THRESHOLD) {
    await logActivity(env, {
      projectId,
      batchName: 'batch_2_fetch_and_read',
      runId,
      kind: 'warning',
      message: `Chunk store is large (${chunkStore.length.toLocaleString()} chunks). Retrieval will continue with top-ranked subsets.`,
    });
  }
  const dataQuality: Batch2FetchAndRead['data_quality'] = {
    has_brave_search: connectedTools.has_brave_search,
    has_github_token: connectedTools.has_github_token,
    has_context7: connectedTools.has_context7,
    technologies_researched: fetchedSources.length,
    urls_fetched: sourceLedger.length,
    issues_found: issuesFound,
    degraded_tools: Array.from(degradedTools),
    partial_failures: partialFailures,
    model_context_window: RESEARCH_CONTEXT_TOKEN_HARD_LIMIT,
    source_target_count: sourceTargetCount,
    used_full_context_window: false,
    truncated_to_fit_context: false,
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
    chunk_store_count: chunkStore.length,
    data_quality: dataQuality,
  };

  const systemPrompt = appendProjectBriefSystemPrompt(
    'You are Scrimble’s technical research analyst. Turn fetched docs, metadata, and retrieved research chunks into a structured research corpus. Keep technical details concrete and current. Return only valid JSON.',
    projectBrief.promptContext,
  );
  const { payload: promptPayload, retrievedSlice } = buildBatch2PromptPayload(
    fetchedSources,
    dataQuality,
    chunkStore,
    projectBrief.summary || project.description || '',
  );
  await logActivity(env, {
    projectId,
    batchName: 'batch_2_fetch_and_read',
    runId,
    kind: 'system',
    message: `Retrieved ${retrievedSlice.chunkCount} chunks from ${retrievedSlice.totalChunks} total (estimated ${retrievedSlice.estimatedTokens.toLocaleString()} tokens) for batch 2 prompt assembly.`,
  });
  const prompt = `Research the following fetched technology materials and convert them into a structured corpus.

${JSON.stringify(promptPayload, null, 2)}

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
- sources (copy the important sources you used as { technology, url, tool, title, summary, insight, chars_read, relevance })

Preserve specific version and compatibility details.`;

  try {
    const result = await callValidatedBatch(provider, {
      env,
      projectId,
      runId,
      runType: 'batch_2_fetch_and_read',
      role: 'fast',
      systemPrompt,
      prompt,
      schema: Batch2FetchAndReadSchema,
      schemaDescription: schemaDescriptions.batch_2_fetch_and_read,
    });

    const researchByTechnology = new Map(
      result.data.research.map((entry) => [entry.technology.toLowerCase(), entry] as const),
    );
    const technologyInsightByName = new Map(
      result.data.research.map((entry) => {
        const combinedInsight = summarizeSnippet(
          [
            entry.repo_health_summary,
            entry.recent_breaking_changes,
            entry.community_sentiment,
            entry.bug_report_digest,
          ]
            .filter(Boolean)
            .join(' '),
          220,
        );
        return [entry.technology.toLowerCase(), combinedInsight] as const;
      }),
    );
    const finalResearch = fetchedSources.map((source) => {
      const generated = researchByTechnology.get(source.technology.toLowerCase());
      const technologyInsight = technologyInsightByName.get(source.technology.toLowerCase()) || '';
      const enrichedSources = source.source_ledger.map((entry) => ({
        ...entry,
        chars_read: entry.chars_read || entry.summary.length,
        relevance: entry.relevance || 'medium',
        insight: summarizeSnippet(entry.insight || technologyInsight || entry.summary, 220),
      }));

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
        sources: enrichedSources,
      };
    });
    const finalSourceLedger = dedupeResearchSources(finalResearch.flatMap((entry) => entry.sources));
    const finalDataQuality: Batch2FetchAndRead['data_quality'] = {
      ...dataQuality,
      urls_fetched: finalSourceLedger.length,
      used_full_context_window: false,
      truncated_to_fit_context: false,
    };
    const finalOutput: Batch2FetchAndRead = {
      research: finalResearch,
      sources: finalSourceLedger,
      data_quality: finalDataQuality,
      chunk_store: chunkStore,
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
      runId,
      kind: 'complete',
      message: `Stack research complete — ${finalOutput.research.length} technologies analysed across ${finalOutput.data_quality.urls_fetched} sources.`,
    });
    return 'complete';
  } catch (error) {
    const errorClass = classifyAIError(error);
    if (errorClass === 'transport_provider_transient' || errorClass === 'orchestration') {
      const errorMessage = error instanceof Error ? error.message : 'Batch 2 failed.';
      throw new RetryableGenerationPipelineError(errorMessage, 45);
    }

    await failBatch(
      env,
      projectId,
      runId,
      provider,
      'batch_2_fetch_and_read',
      input,
      error,
      2,
    );
  }
}

export async function executeBatch3(
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
  const projectDescription = projectBrief.summary || project.description || '';
  const chunkStore = resolveChunkStoreFromBatch2(batch2);
  const architectureResearchSlice = retrieveResearchSlice(
    `${projectDescription} database schema auth system architecture infrastructure`,
    chunkStore,
    8,
    RESEARCH_CONTEXT_TOKEN_TARGET,
  );
  const researchCatalog = batch2.research.map((entry) => ({
    technology: entry.technology,
    latest_version: entry.latest_version,
    open_issues_count: entry.open_issues_count,
    sources: entry.sources.slice(0, 3).map((source) => source.url),
  }));
  const input = {
    project_description: projectDescription,
    provider_id: provider.providerId,
    research_catalog: researchCatalog,
    chunk_store_count: chunkStore.length,
    retrieved_chunk_count: architectureResearchSlice.chunkCount,
    review_feedback: '',
    review_feedback_provided: false,
  };

  await emitBatchStart(env, projectId, runId, 'batch_3_architect');
  await logActivity(env, {
    projectId,
    batchName: 'batch_3_architect',
    runId,
    kind: 'architecture',
    message: 'Designing your data model...',
  });
  await logActivity(env, {
    projectId,
    batchName: 'batch_3_architect',
    runId,
    kind: 'system',
    message: `Retrieved ${architectureResearchSlice.chunkCount} chunks from ${architectureResearchSlice.totalChunks} total (estimated ${architectureResearchSlice.estimatedTokens.toLocaleString()} tokens) for architecture prompt assembly.`,
  });

  const systemPrompt = appendProjectBriefSystemPrompt(
    'You are Scrimble’s staff engineer architect. Use the research corpus to produce a clear architecture decision record with explicit package and service choices. Every recommendation must be grounded in the provided research data. Return only valid JSON.',
    projectBrief.promptContext,
  );
  const prompt = `Project description:
${projectDescription || 'No description provided.'}

Researched technologies and source coverage:
${JSON.stringify(researchCatalog, null, 2)}

Retrieved research context:
${architectureResearchSlice.context || 'No retrieved research chunks were available for this architecture pass.'}

Produce a structured Architecture Decision Record (ADR):
- project_name: A concise, catchy name.
- project_type: The primary technical category (e.g., "SaaS", "Mobile App", "Internal Tool").
- project_summary: 2-3 sentence plain-language prose summary of what the product does, who it's for, and what problem it solves.
- how_it_connects: 4-6 sentence plain-language prose explanation of how the main pieces connect and how data moves through the system.
- recommended_stack: A flat object with keys { frontend, backend, auth, database, payments, email, deploy }.
  IMPORTANT: Each value must be a plain string technology name (e.g., "Next.js", "Firebase", "Stripe"). 
  ONLY use technology names found in the research corpus technology list.

- data_model: Array of tables with columns (name, type, nullable), and relationships.
- integrations: Array of { service, purpose, package_name, version }. 
  IMPORTANT: The "service" field should be the common name of the technology (e.g., "Next.js", "Firebase", "Stripe"). 
  Retrieve the exact package_name and highest stable version from the research corpus for each integration. Do not use "latest" or placeholder names if the information is available in the research.

- security_surface: Critical concerns and mitigation strategies.
- gotchas: Explicit technology-specific warnings (technology, issue, mitigation) derived from the "recent_breaking_changes" and "bug_report_digest" in the research corpus.

Base every single recommendation on the provided research corpus. If a technology was not researched in Batch 2, do not recommend it unless it is a standard browser feature.`;

  try {
    const result = await callValidatedBatch(provider, {
      env,
      projectId,
      runId,
      runType: 'batch_3_architect',
      role: 'deep',
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
        runId,
        kind: 'warning',
        message: `Found: ${gotcha.issue} — ${gotcha.mitigation}`,
      });
    }
    await logActivity(env, {
      projectId,
      batchName: 'batch_3_architect',
      runId,
      kind: 'complete',
      message: `Architecture locked in — ${result.data.data_model.length} tables, ${result.data.integrations.length} integrations.`,
    });
  } catch (error) {
    const errorClass = classifyAIError(error);
    if (errorClass === 'transport_provider_transient' || errorClass === 'orchestration') {
      const errorMessage = error instanceof Error ? error.message : 'Batch 3 failed.';
      throw new RetryableGenerationPipelineError(errorMessage, 45);
    }

    await failBatch(
      env,
      projectId,
      runId,
      provider,
      'batch_3_architect',
      input,
      error,
      2,
    );
  }
}

async function computeHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(',')}}`;
}

function computeAuthoringPayload(plan: PlanAuthoringRecord) {
  const canonicalPlan = {
    project_name: plan.project_name,
    project_type: plan.project_type,
    problem: plan.problem,
    solution: plan.solution,
    target_user: plan.target_user,
    mvp_scope: plan.mvp_scope,
    done_when: plan.done_when,
    architecture_notes: plan.architecture_notes,
    data_model_notes: plan.data_model_notes,
    stages: plan.stages,
    edges: plan.edges,
  };

  return stableSerialize(canonicalPlan);
}

export async function computePlanAuthoringHash(plan: PlanAuthoringRecord): Promise<string> {
  return computeHash(computeAuthoringPayload(plan));
}

async function withAuthoringHash(plan: PlanAuthoringRecord): Promise<PlanAuthoringRecord> {
  const authoringHash = await computePlanAuthoringHash(plan);
  return { ...plan, authoring_hash: authoringHash };
}

export async function executeBatch4(
  env: Bindings,
  projectId: string,
  runId: string,
  provider: ProviderConfig,
  _builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
) {
  const startedAt = Date.now();
  const reviewContext = await loadArchitectureReviewContext(env, projectId);
  const batch2 = await loadBatchOutput(env, projectId, 'batch_2_fetch_and_read', Batch2FetchAndReadSchema);
  const chunkStore = resolveChunkStoreFromBatch2(batch2);
  const projectDescription = projectBrief.summary || '';
  const planResearchSlice = retrieveResearchSlice(
    `${projectDescription} implementation steps setup configuration`,
    chunkStore,
    8,
    RESEARCH_CONTEXT_TOKEN_TARGET,
  );
  const input = {
    architecture: reviewContext.adr,
    chunk_store_count: chunkStore.length,
    retrieved_chunk_count: planResearchSlice.chunkCount,
    review_feedback: reviewContext.reviewFeedback,
    review_feedback_provided: reviewContext.reviewFeedbackProvided,
  };

  await emitBatchStart(env, projectId, runId, 'batch_4_plan_build');
  await logActivity(env, {
    projectId,
    batchName: 'batch_4_plan_build',
    runId,
    kind: 'architecture',
    message: 'Building your execution plan...',
  });
  await logActivity(env, {
    projectId,
    batchName: 'batch_4_plan_build',
    runId,
    kind: 'system',
    message: `Retrieved ${planResearchSlice.chunkCount} chunks from ${planResearchSlice.totalChunks} total (estimated ${planResearchSlice.estimatedTokens.toLocaleString()} tokens) for plan prompt assembly.`,
  });

  const systemPrompt = appendProjectBriefSystemPrompt(
    'You are Scrimble’s Product Lead and Build Architect. Batch 4 is the only authoring stage. Return one canonical structured authoring record as valid JSON.',
    projectBrief.promptContext,
  );
  const prompt = `Architecture Decision Record & Research:
${JSON.stringify(reviewContext.adr, null, 2)}

Human review feedback:
${reviewContext.reviewFeedbackProvided ? reviewContext.reviewFeedback : 'No changes requested. Continue with the approved architecture as written.'}

Retrieved research context:
${planResearchSlice.context || 'No retrieved research chunks were available for this plan pass.'}

Return exactly this shape:
{
  "project_name": string,
  "project_type": string,
  "problem": string,
  "solution": string,
  "target_user": string,
  "mvp_scope": string,
  "done_when": string,
  "architecture_notes": string,
  "data_model_notes": string,
  "stages": [...],
  "edges": [...]
}

Rules:
- This is the only authored artifact. Do not include prd_markdown.
- stages/edges must represent only MVP scope.
- suggested_tools must reference specific packages/versions from the ADR.
- Include mandatory milestones as gate steps:
  1. "MVP complete" — sits at the end of the build stage. Prompt: "Your core product is built. Before we move to testing and launch — does everything work the way you expected?"
  2. "Ready to launch" — sits at the end of the deploy stage. Prompt: "Everything is live. Take a moment to check it yourself before we call this done."
- Add inflection point milestones where meaningful (e.g., "Auth working end to end", "Data model locked").
- Milestone nodes must have is_milestone: true and a milestone_label.
- if human feedback asks to swap, remove, or add technologies, you must honour it everywhere.
- return ONLY a single valid JSON object for the shape above.
- content must be dense and senior-developer quality.`;

  try {
    const result = await callValidatedBatch(provider, {
      env,
      projectId,
      runId,
      runType: 'batch_4_plan_build',
      role: 'deep',
      systemPrompt,
      prompt,
      schema: Batch4PlanBuildSchema,
      schemaDescription: schemaDescriptions.batch_4_plan_build,
    });
    const normalizedPlan = await withAuthoringHash(normalizePlanStructure(result.data));

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
      runId,
      kind: 'complete',
      message: `Plan ready — ${normalizedPlan.stages.length} stages, ${countPlanSteps(normalizedPlan)} steps.`,
    });
  } catch (error) {
    const errorClass = classifyAIError(error);
    if (errorClass === 'transport_provider_transient' || errorClass === 'orchestration') {
      const errorMessage = error instanceof Error ? error.message : 'Batch 4 failed.';
      throw new RetryableGenerationPipelineError(errorMessage, 45);
    }

    await failBatch(
      env,
      projectId,
      runId,
      provider,
      'batch_4_plan_build',
      input,
      error,
      2,
    );
  }
}

export async function executeBatch5(
  env: Bindings,
  projectId: string,
  provider: ProviderConfig,
  runId: string,
  builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
  checkpointStepInterval = 3,
): Promise<BatchExecutionResult> {
  const startedAt = Date.now();
  const project = await getProjectById(env, projectId);
  if (!project) {
    throw new Error('Project not found.');
  }

  const adr = await loadBatchOutput(env, projectId, 'batch_3_architect', Batch3ArchitectSchema);
  const plan = await loadBatchOutput(env, projectId, 'batch_4_plan_build', Batch4PlanBuildSchema);
  const research = await loadBatchOutput(env, projectId, 'batch_2_fetch_and_read', Batch2FetchAndReadSchema);
  const chunkStore = resolveChunkStoreFromBatch2(research);
  const projectStack = [project.stack || '', projectBrief.summary || project.description || '']
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    || 'web app';
  const checkpoint = await loadGenerationCheckpoint<Batch5CheckpointData>(
    env,
    projectId,
    runId,
    'batch_5_enrich_steps',
  );
  const connectedTools = await getConnectedResearchTools(env, project.user_id);
  const researchManifest = buildResearchManifest(
    builderProfile,
    projectBrief.summary || project.description || '',
    {
      confirmedStackTools: projectBrief.confirmedStackTools,
      inferredTechnologies: research.research.map((entry) => entry.technology).filter(Boolean),
    },
  );
  const planSteps = checkpoint?.data.steps || flattenPlanSteps(plan);
  const stepResearchContexts: StepResearchContext[] = checkpoint?.data.stepResearchContexts
    ? [...checkpoint.data.stepResearchContexts]
    : [];
  const startIndex = checkpoint?.currentIndex ?? 0;
  const subrequestTracker = createResearchSubrequestTracker({
    initialCount: 0,
    limit: 40, // Cloudflare standard limit is 50
  });

  await emitBatchStart(env, projectId, runId, 'batch_5_enrich_steps');
  await logActivity(env, {
    projectId,
    batchName: 'batch_5_enrich_steps',
    runId,
    kind: 'fetch',
    message: 'Refreshing every step with live docs, issues, and current implementation notes...',
  });

  if (checkpoint) {
    await logActivity(env, {
      projectId,
      batchName: 'batch_5_enrich_steps',
      runId,
      kind: 'system',
      message: `Resuming step research at step ${Math.min(startIndex + 1, planSteps.length)} of ${planSteps.length}.`,
    });
  }

  for (let index = startIndex; index < planSteps.length; index += 1) {
    const step = planSteps[index];

    await maybeTouchGenerationHeartbeat(env, projectId, runId);

    await logActivity(env, {
      projectId,
      batchName: 'batch_5_enrich_steps',
      runId,
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
      researchManifest,
      runId,
      subrequestTracker,
    });

    stepResearchContexts.push(stepResearch);

    await logActivity(env, {
      projectId,
      batchName: 'batch_5_enrich_steps',
      runId,
      kind: 'fetch',
      message: `${step.title} research refreshed — ${stepResearch.docs.length} doc source${stepResearch.docs.length === 1 ? '' : 's'}, ${stepResearch.issues.length} issue${stepResearch.issues.length === 1 ? '' : 's'}, ${stepResearch.community.length} community source${stepResearch.community.length === 1 ? '' : 's'}.`,
    });

    // Standard overhead for current step (heartbeat, logs)
    subrequestTracker.count += 3;

    const normalizedCheckpointStepInterval = Math.max(1, checkpointStepInterval);
    const shouldCheckpoint = (index + 1 < planSteps.length) && (
      (index + 1 - startIndex) >= normalizedCheckpointStepInterval || // Process groups safely within one turn
      subrequestTracker.count >= 32 // Or when near subrequest limit (40 - 8 reserve)
    );

    if (shouldCheckpoint) {
      await saveGenerationCheckpoint(env, projectId, runId, 'batch_5_enrich_steps', index + 1, {
        steps: planSteps,
        stepResearchContexts,
      });
      await logActivity(env, {
        projectId,
        batchName: 'batch_5_enrich_steps',
        runId,
        kind: 'system',
        message: `Saved a step-research checkpoint after ${stepResearchContexts.length} step${stepResearchContexts.length === 1 ? '' : 's'}. Continuing from the latest checkpoint...`,
      });
      return 'checkpointed';
    }
  }
  const stepResearchSlice = retrieveStepResearchSlice(
    planSteps,
    projectStack,
    chunkStore,
    5,
    RESEARCH_CONTEXT_TOKEN_TARGET,
  );
  const researchCatalog = research.research.map((entry) => ({
    technology: entry.technology,
    latest_version: entry.latest_version,
    open_issues_count: entry.open_issues_count,
    sources: entry.sources.slice(0, 2).map((source) => source.url),
  }));
  const input = {
    plan,
    research_catalog: researchCatalog,
    chunk_store_count: chunkStore.length,
    retrieved_chunk_count: stepResearchSlice.chunkCount,
    step_research: stepResearchContexts,
  };

  await touchGenerationRunHeartbeat(env, runId);

  await logActivity(env, {
    projectId,
    batchName: 'batch_5_enrich_steps',
    runId,
    kind: 'writing',
    message: 'Writing step details for every part of the plan...',
  });
  await logActivity(env, {
    projectId,
    batchName: 'batch_5_enrich_steps',
    runId,
    kind: 'system',
    message: `Retrieved ${stepResearchSlice.chunkCount} chunks from ${stepResearchSlice.totalChunks} total (estimated ${stepResearchSlice.estimatedTokens.toLocaleString()} tokens) for step enrichment prompt assembly.`,
  });

  const systemPrompt = appendProjectBriefSystemPrompt(
    'You are Scrimble’s step enrichment agent. Enrich every step in one pass using turn-by-turn navigation guidance. Reference the exact technologies, services, and versions from the plan and research. Return only valid JSON.',
    projectBrief.promptContext,
  );
  const prompt = `Plan:
${JSON.stringify(plan, null, 2)}

Researched technology catalog:
${JSON.stringify(researchCatalog, null, 2)}

Retrieved step-targeted research context:
${stepResearchSlice.context || 'No retrieved chunks were available for the current step set.'}

Live step research:
${stepResearchContexts.map((context) => formatStepResearchPrompt(context)).join('\n\n')}

For every step, generate:
- step_id
- ai_output
- done_when
- navigation_links: [{ label, url, when }]
- prompts: [{ label, content }]

The ai_output must follow this standard:
- Lead with WHERE to go: exact tool, URL, or interface.
- Follow with WHAT to do there: specific actions, not concepts.
- End with WHAT to bring back when marking the step done.
- Reference the user's actual tools by name.
- Keep it to a maximum of 3 paragraphs.
- If an AI coding prompt is needed, include the exact prompt but keep prompts as a small part.

done_when must be concrete and verifiable, never subjective.
Use the live documentation provided to generate specific, current guidance.
Reference actual function names, hook names, and config options from the docs.
If any open bugs were found, mention them in the ai_output and explain the workaround.
For each step, obey any requirements array included in the live step research context.
Populate navigation_links from the researched docs URLs so the user can click directly into setup pages.`;

  try {
    const result = await callValidatedBatch(provider, {
      env,
      projectId,
      runId,
      runType: 'batch_5_enrich_steps',
      role: 'deep',
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
      runId,
      kind: 'complete',
      message: `Step details complete — ${finalResult.enrichments.length} steps enriched.`,
    });
    return 'complete';
  } catch (error) {
    const errorClass = classifyAIError(error);
    if (errorClass === 'transport_provider_transient' || errorClass === 'orchestration') {
      const errorMessage = error instanceof Error ? error.message : 'Batch 5 failed.';
      throw new RetryableGenerationPipelineError(errorMessage, 45);
    }

    await failBatch(
      env,
      projectId,
      runId,
      provider,
      'batch_5_enrich_steps',
      input,
      error,
      2,
    );
  }
}

export async function executeBatch6(
  env: Bindings,
  projectId: string,
  runId: string,
  provider: ProviderConfig,
  builderProfile: LoadedBuilderProfileContext,
  projectBrief: LoadedProjectBriefContext,
) {
  const startedAt = Date.now();
  const reviewContext = await loadArchitectureReviewContext(env, projectId);
  const batch2 = await loadBatchOutput(env, projectId, 'batch_2_fetch_and_read', Batch2FetchAndReadSchema);
  const plan = await loadBatchOutput(env, projectId, 'batch_4_plan_build', Batch4PlanBuildSchema);
  const enrichments = await loadBatchOutput(env, projectId, 'batch_5_enrich_steps', Batch5EnrichStepsSchema);
  const chunkStore = resolveChunkStoreFromBatch2(batch2);
  const fileResearchSlice = retrieveResearchSlice(
    `${projectBrief.summary || ''} final delivery plan markdown build steps launch`,
    chunkStore,
    8,
    RESEARCH_CONTEXT_TOKEN_TARGET,
  );
  const enrichedPlan = mergePlanWithEnrichments(plan, enrichments.enrichments);
  const currentActiveStep = await loadCurrentActiveStep(env, projectId);
  const input = {
    architecture: reviewContext.adr,
    enriched_plan: enrichedPlan,
    chunk_store_count: chunkStore.length,
    retrieved_chunk_count: fileResearchSlice.chunkCount,
    review_feedback: reviewContext.reviewFeedback,
    review_feedback_provided: reviewContext.reviewFeedbackProvided,
    current_step: currentActiveStep,
  };

  await emitBatchStart(env, projectId, runId, 'batch_6_generate_files');
  await logActivity(env, {
    projectId,
    batchName: 'batch_6_generate_files',
    runId,
    kind: 'writing',
    message: 'Preparing your downloadable files...',
  });

  // C1: Batch 6 is deterministic rendering only; fail closed on authored-record drift.
  const storedHash = plan.authoring_hash;
  const currentHash = await computePlanAuthoringHash(plan);

  if (storedHash && storedHash !== currentHash) {
    const errorMsg = `Authoring record drift detected. Batch 4 authored content changed before Batch 6 assembly. Resume from Batch 4 to regenerate canonical outputs. (Stored: ${storedHash.slice(0, 8)}, Current: ${currentHash.slice(0, 8)})`;
    console.error(`[INVARIANT_VIOLATION] Batch 6: ${errorMsg} for project ${projectId}`);
    
    await persistInvariantViolation(
      env,
      projectId,
      runId,
      'authoring_record_drift',
      errorMsg
    );
    
    // Fail the run - Batch 6 must be assembly-only and cannot tolerate drift
    await failBatch(
      env,
      projectId,
      runId,
      provider,
      'batch_6_generate_files',
      input,
      errorMsg,
      0
    );
    return;
  }

  const reviewFeedbackText = reviewContext.reviewFeedbackProvided 
    ? reviewContext.reviewFeedback 
    : undefined;
  const planContent = buildPlanMarkdown(plan, enrichedPlan, reviewFeedbackText);
  
  const finalFiles: Array<{ filename: SkillFileName; content: string }> = [
    { filename: 'plan.md' as SkillFileName, content: planContent },
  ];
  const finalResult: Batch6GenerateFiles = { files: finalFiles };

  try {
    await completeBatch(
      env,
      projectId,
      runId,
      provider,
      'batch_6_generate_files',
      input,
      finalResult,
      1, // No retries needed - deterministic
      finalFiles,
      Date.now() - startedAt,
    );
    await persistGeneratedFiles(env, projectId, finalFiles);
    await logActivity(env, {
      projectId,
      batchName: 'batch_6_generate_files',
      runId,
      kind: 'complete',
      message: 'Project plan.md is ready for download.',
    });
  } catch (error) {
    await failBatch(
      env,
      projectId,
      runId,
      provider,
      'batch_6_generate_files',
      input,
      error,
      1,
    );
  }
}

export async function pauseForArchitectureReview(env: Bindings, projectId: string, runId: string) {
  // HARDENING: Check if we already have an approval for this run
  if (await hasApprovedArchitectureReview(env, projectId)) {
    return;
  }

  const reviewContext = await loadArchitectureReviewContext(env, projectId);

  const { changes } = await updateGenerationRunStatus(env, runId, 'awaiting_review');
  if (changes === 0) {
    return;
  }

  await logActivity(env, {
    projectId,
    batchName: 'batch_3_architect',
    runId,
    kind: 'system',
    message: "Here's what I found — review the architecture before I build the plan.",
  });
  await insertGenerationEvent(env, {
    projectId,
    eventType: 'review_required',
    batchName: 'batch_3_architect',
    body: {
      adr: reviewContext.adr,
      run_id: runId,
    },
  });
}

export async function finalizeProjectGeneration(env: Bindings, projectId: string, runId: string) {
  const { changes } = await updateGenerationRunStatus(env, runId, 'complete');
  if (changes === 0) {
    throw staleGenerationRunError(projectId, runId, 'finalizing generation');
  }
  await clearGenerationCheckpoints(env, projectId, runId);
  await logActivity(env, {
    projectId,
    batchName: 'batch_6_generate_files',
    runId,
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

export async function resolvePipelineStatusToRun(
  env: Bindings,
  projectId: string,
  _currentStatus: ProjectGenerationStatus,
  completedBatches: string[],
): Promise<ProjectGenerationStatus> {
  const hasOutput = async (batch: GenerationBatchName) => {
    const record = await loadBatchRunRecord(env, projectId, batch);
    // Be strict: if the record exists but text is empty, it's not a valid output for resumption
    return (!!record?.output && record.output.length > 10) || !!record?.output_r2_key;
  };

  // 1. Research Stack
  if (!completedBatches.includes('batch_1_research_stack') || !(await hasOutput('batch_1_research_stack'))) {
    return 'queued';
  }

  // 2. Fetch and Read
  if (!completedBatches.includes('batch_2_fetch_and_read') || !(await hasOutput('batch_2_fetch_and_read'))) {
    return 'batch_1_research_stack';
  }

  // 3. Architect
  if (!completedBatches.includes('batch_3_architect') || !(await hasOutput('batch_3_architect'))) {
    return 'batch_2_fetch_and_read';
  }

  // Human Gate: Review Approval
  if (!(await hasApprovedArchitectureReview(env, projectId))) {
    return 'awaiting_review';
  }

  // 4. Plan Build
  if (!completedBatches.includes('batch_4_plan_build') || !(await hasOutput('batch_4_plan_build'))) {
    return 'approved';
  }

  // 5. Enrich Steps
  if (!completedBatches.includes('batch_5_enrich_steps') || !(await hasOutput('batch_5_enrich_steps'))) {
    return 'batch_4_plan_build';
  }

  // 6. Generate Files
  if (!completedBatches.includes('batch_6_generate_files') || !(await hasOutput('batch_6_generate_files'))) {
    return 'batch_5_enrich_steps';
  }

  return 'complete';
}






