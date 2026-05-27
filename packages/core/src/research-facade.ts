/**
 * Unified Research Facade (Task B1)
 * 
 * This module provides the single canonical interface for all research operations
 * in Scrimble. It consolidates the overlapping capabilities from:
 * - `functions/server/research.ts` (lower-level fetching)
 * - `workers/tools/index.ts` (MCP tool integrations)
 * 
 * All research operations should go through this facade to ensure:
 * - Consistent fallback behavior
 * - Unified metadata shape
 * - Single source of truth for degradation signals
 * - Predictable subrequest tracking
 * 
 * Design principles:
 * - One function per research type (search, fetch, analyze)
 * - Every result includes quality/degradation metadata
 * - Fallbacks are explicit and trackable
 * - MCP integrations are first-class but optional
 */

import type { Bindings, GenerationBatchName } from './types';
import { getActiveMCPServer } from './mcp-servers';
import { persistGenerationStreamEvent } from './generation-events';
import { fetchAndParse, type GitHubResearchResult } from './utils/fetch-url';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/**
 * Tool used to perform research. Used for tracking and quality signals.
 */
export type ResearchTool =
  | 'brave_search'     // Brave Search API (requires MCP config)
  | 'jina_search'      // Jina AI search (fallback)
  | 'jina_reader'      // Jina AI reader
  | 'cf_scrape'        // Cloudflare scrape gateway
  | 'context7'         // Context7 docs API (requires MCP config)
  | 'github_api'       // GitHub API (optionally with MCP token)
  | 'direct_fetch'     // Direct HTTP fetch
  | 'fallback'         // Fallback/degraded result
  | 'failed';          // Complete failure

/**
 * Quality level of a research result.
 */
export type ResearchQuality = 'high' | 'medium' | 'low' | 'degraded' | 'failed';

/**
 * Metadata about how a research result was obtained.
 */
export interface ResearchMetadata {
  tool: ResearchTool;
  quality: ResearchQuality;
  cached: boolean;
  degraded: boolean;
  degradationReason?: string;
  fetchedAt: string;
  durationMs?: number;
  subrequestCount?: number;
}

/**
 * A single web search result.
 */
export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  source: 'brave' | 'jina' | 'fallback';
}

/**
 * Result of a web search operation.
 */
export interface WebSearchResponse {
  results: WebSearchResult[];
  metadata: ResearchMetadata;
  query: string;
}

/**
 * Result of a document fetch operation.
 */
export interface DocumentFetchResponse {
  content: string;
  title: string;
  url: string;
  charCount: number;
  metadata: ResearchMetadata;
}

/**
 * Result of a GitHub repository analysis.
 */
export interface GitHubAnalysisResponse {
  owner: string;
  repo: string;
  stars: number;
  forks: number;
  openIssues: number;
  lastPush: string;
  latestRelease: string;
  readme: string;
  summary: string;
  releases: Array<{
    tagName: string;
    publishedAt: string;
    body: string;
  }>;
  recentIssues: Array<{
    title: string;
    url: string;
    body: string;
    createdAt: string;
  }>;
  metadata: ResearchMetadata;
}

/**
 * Result of a library documentation fetch.
 */
export interface LibraryDocsResponse {
  library: string;
  topic: string;
  content: string;
  source: string;
  version: string;
  metadata: ResearchMetadata;
}

/**
 * Subrequest tracker for staying under Cloudflare limits.
 */
export interface SubrequestTracker {
  count: number;
  limit: number;
}

/**
 * Context for research operations.
 */
export interface ResearchContext {
  env: Bindings;
  userId: string;
  projectId?: string;
  batchName?: GenerationBatchName;
  runId?: string;
  subrequestTracker?: SubrequestTracker;
  emitEvents?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const RESEARCH_SUBREQUEST_LIMIT = 35;
const DEFAULT_TIMEOUT_MS = 30_000;
const SEARCH_RESULT_LIMIT = 5;

// ─────────────────────────────────────────────────────────────────
// Subrequest Tracking
// ─────────────────────────────────────────────────────────────────

/**
 * Create a new subrequest tracker.
 */
export function createSubrequestTracker(
  options: { initialCount?: number; limit?: number } = {},
): SubrequestTracker {
  return {
    count: Math.max(0, Math.floor(options.initialCount || 0)),
    limit: Math.max(1, Math.floor(options.limit || RESEARCH_SUBREQUEST_LIMIT)),
  };
}

/**
 * Check if we can make another subrequest.
 */
function canMakeSubrequest(tracker?: SubrequestTracker): boolean {
  if (!tracker) return true;
  return tracker.count < tracker.limit;
}

/**
 * Record a subrequest.
 */
function recordSubrequest(tracker?: SubrequestTracker): void {
  if (tracker) {
    tracker.count += 1;
  }
}

// ─────────────────────────────────────────────────────────────────
// Event Emission
// ─────────────────────────────────────────────────────────────────

async function emitResearchEvent(
  context: ResearchContext,
  icon: string,
  message: string,
): Promise<void> {
  if (!context.emitEvents || !context.projectId || !context.batchName) {
    return;
  }

  try {
    await persistGenerationStreamEvent(context.env, {
      projectId: context.projectId,
      runId: context.runId || null,
      batchName: context.batchName,
      event: {
        type: 'activity',
        icon,
        message,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.warn('[research-facade] Failed to emit event:', error);
  }
}

// ─────────────────────────────────────────────────────────────────
// MCP Configuration
// ─────────────────────────────────────────────────────────────────

async function getMCPToken(
  context: ResearchContext,
  serverType: 'brave-search' | 'github' | 'context7',
): Promise<string | null> {
  try {
    const server = await getActiveMCPServer(context.env, context.userId, serverType);
    if (!server) return null;
    // GitHub uses 'token', others use 'apiKey'
    if (serverType === 'github') {
      return (server.config as { token: string }).token || null;
    }
    return (server.config as { apiKey: string }).apiKey || null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Core Fetch Utilities
// ─────────────────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; text: string; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: '',
      error: error instanceof Error ? error.message : 'Request failed',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function createMetadata(
  tool: ResearchTool,
  quality: ResearchQuality,
  options: Partial<ResearchMetadata> = {},
): ResearchMetadata {
  return {
    tool,
    quality,
    cached: false,
    degraded: quality === 'degraded' || quality === 'failed',
    fetchedAt: new Date().toISOString(),
    ...options,
  };
}

// ─────────────────────────────────────────────────────────────────
// Web Search
// ─────────────────────────────────────────────────────────────────

/**
 * Search the web for a query.
 * 
 * Uses Brave Search if configured, falls back to Jina Search.
 */
export async function searchWeb(
  context: ResearchContext,
  query: string,
  maxResults = SEARCH_RESULT_LIMIT,
): Promise<WebSearchResponse> {
  const startTime = Date.now();

  if (!canMakeSubrequest(context.subrequestTracker)) {
    return {
      results: [],
      metadata: createMetadata('failed', 'failed', {
        degradationReason: 'Subrequest limit reached',
      }),
      query,
    };
  }

  await emitResearchEvent(context, '🔍', `Searching for "${query}"...`);

  // Try Brave Search first
  const braveToken = await getMCPToken(context, 'brave-search');
  if (braveToken) {
    try {
      recordSubrequest(context.subrequestTracker);
      const endpoint = new URL('https://api.search.brave.com/res/v1/web/search');
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('count', `${maxResults}`);

      const response = await fetchWithTimeout(endpoint.toString(), {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': braveToken,
        },
      });

      if (response.ok) {
        const payload = JSON.parse(response.text) as {
          web?: { results?: Array<Record<string, unknown>> };
        };

        const results: WebSearchResult[] = (payload.web?.results || [])
          .slice(0, maxResults)
          .map((r) => ({
            title: String(r.title || 'Untitled'),
            url: String(r.url || ''),
            description: String(r.description || r.snippet || ''),
            source: 'brave' as const,
          }))
          .filter((r) => r.url);

        return {
          results,
          metadata: createMetadata('brave_search', 'high', {
            durationMs: Date.now() - startTime,
          }),
          query,
        };
      }
    } catch (error) {
      console.warn('[research-facade] Brave Search failed:', error);
    }
  }

  // Fallback to Jina Search
  try {
    recordSubrequest(context.subrequestTracker);
    const jinaUrl = `https://s.jina.ai/${encodeURIComponent(query)}`;
    const response = await fetchWithTimeout(jinaUrl, {
      headers: {
        Accept: 'text/plain',
        'X-Return-Format': 'markdown',
      },
    });

    if (response.ok && response.text) {
      const results = parseJinaSearchResults(response.text, maxResults);
      return {
        results,
        metadata: createMetadata('jina_search', braveToken ? 'medium' : 'high', {
          durationMs: Date.now() - startTime,
          degraded: !!braveToken,
          degradationReason: braveToken ? 'Brave Search failed, used Jina fallback' : undefined,
        }),
        query,
      };
    }
  } catch (error) {
    console.warn('[research-facade] Jina Search failed:', error);
  }

  await emitResearchEvent(context, '⚠️', `Search for "${query}" returned no results.`);
  return {
    results: [],
    metadata: createMetadata('failed', 'failed', {
      durationMs: Date.now() - startTime,
      degradationReason: 'All search providers failed',
    }),
    query,
  };
}

function parseJinaSearchResults(markdown: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const pattern = /Title:\s*(.+?)\nURL Source:\s*(.+?)\n(?:Markdown Content:\s*)?([\s\S]*?)(?=\nTitle:|\n---\s*title:|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown)) && results.length < maxResults) {
    const title = match[1]?.trim() || '';
    const url = match[2]?.trim() || '';
    const content = match[3]?.trim() || '';

    if (title && url) {
      results.push({
        title,
        url,
        description: content.slice(0, 300),
        source: 'jina',
      });
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────
// Document Fetch
// ─────────────────────────────────────────────────────────────────

/**
 * Fetch and parse a document from a URL.
 * 
 * Handles various document types including web pages and GitHub repos.
 */
export async function fetchDocument(
  context: ResearchContext,
  url: string,
): Promise<DocumentFetchResponse> {
  const startTime = Date.now();

  if (!canMakeSubrequest(context.subrequestTracker)) {
    return {
      content: '',
      title: deriveTitleFromUrl(url),
      url,
      charCount: 0,
      metadata: createMetadata('failed', 'failed', {
        degradationReason: 'Subrequest limit reached',
      }),
    };
  }

  await emitResearchEvent(context, '📄', `Reading ${url}...`);
  recordSubrequest(context.subrequestTracker);

  try {
    const result = await fetchAndParse(url);

    if (result.kind === 'document') {
      return {
        content: result.text,
        title: deriveTitleFromUrl(result.url),
        url: result.url,
        charCount: result.text.length,
        metadata: createMetadata('jina_reader', 'high', {
          durationMs: Date.now() - startTime,
        }),
      };
    }

    if (result.kind === 'github_repo') {
      const content = formatGitHubContent(result);
      return {
        content,
        title: `${result.repo.owner}/${result.repo.repo}`,
        url: result.url,
        charCount: content.length,
        metadata: createMetadata('github_api', 'high', {
          durationMs: Date.now() - startTime,
        }),
      };
    }

    // Failed to parse
    await emitResearchEvent(context, '⚠️', `Couldn't read ${url}`);
    return {
      content: '',
      title: deriveTitleFromUrl(url),
      url,
      charCount: 0,
      metadata: createMetadata('failed', 'failed', {
        durationMs: Date.now() - startTime,
        degradationReason: 'Document could not be parsed',
      }),
    };
  } catch (error) {
    console.warn('[research-facade] fetchDocument failed:', error);
    await emitResearchEvent(context, '⚠️', `Couldn't read ${url}`);
    return {
      content: '',
      title: deriveTitleFromUrl(url),
      url,
      charCount: 0,
      metadata: createMetadata('failed', 'failed', {
        durationMs: Date.now() - startTime,
        degradationReason: error instanceof Error ? error.message : 'Fetch failed',
      }),
    };
  }
}

function deriveTitleFromUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    const leaf = parsedUrl.pathname.split('/').filter(Boolean).pop();
    const raw = leaf || parsedUrl.hostname;
    return raw
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return url;
  }
}

function formatGitHubContent(result: GitHubResearchResult): string {
  const headline = `${result.repo.owner}/${result.repo.repo} — ${result.metadata.stars} stars, ${result.metadata.open_issues_count} open issues`;
  const releases = result.releases
    .slice(0, 4)
    .map((r) => `${r.tag_name} (${r.published_at}): ${r.body}`)
    .join('\n\n');
  const issues = result.recent_issues
    .slice(0, 8)
    .map((i) => `Issue (${i.created_at}) ${i.title}: ${i.body}`)
    .join('\n\n');

  return [headline, result.readme, releases, issues].filter(Boolean).join('\n\n');
}

// ─────────────────────────────────────────────────────────────────
// GitHub Analysis
// ─────────────────────────────────────────────────────────────────

/**
 * Analyze a GitHub repository.
 */
export async function analyzeGitHubRepo(
  context: ResearchContext,
  owner: string,
  repo: string,
): Promise<GitHubAnalysisResponse> {
  const startTime = Date.now();

  if (!canMakeSubrequest(context.subrequestTracker)) {
    return createEmptyGitHubResponse(owner, repo, 'Subrequest limit reached');
  }

  await emitResearchEvent(context, '📦', `Analyzing ${owner}/${repo}...`);
  recordSubrequest(context.subrequestTracker);

  const githubToken = await getMCPToken(context, 'github');

  try {
    const result = await fetchAndParse(`https://github.com/${owner}/${repo}`, {
      githubToken: githubToken || undefined,
    });

    if (result.kind !== 'github_repo') {
      return createEmptyGitHubResponse(owner, repo, 'Repository not found or inaccessible');
    }

    return {
      owner,
      repo,
      stars: result.metadata.stars,
      forks: result.metadata.forks,
      openIssues: result.metadata.open_issues_count,
      lastPush: result.metadata.last_push_date,
      latestRelease: result.latest_version,
      readme: result.readme,
      summary: `${owner}/${repo} — ${result.metadata.stars} stars, ${result.metadata.open_issues_count} open issues`,
      releases: result.releases.map((r) => ({
        tagName: r.tag_name,
        publishedAt: r.published_at,
        body: r.body,
      })),
      recentIssues: result.recent_issues.map((i) => ({
        title: i.title,
        url: i.url,
        body: i.body,
        createdAt: i.created_at,
      })),
      metadata: createMetadata('github_api', githubToken ? 'high' : 'medium', {
        durationMs: Date.now() - startTime,
        degraded: !githubToken,
        degradationReason: githubToken ? undefined : 'Using public API (rate limited)',
      }),
    };
  } catch (error) {
    console.warn('[research-facade] analyzeGitHubRepo failed:', error);
    return createEmptyGitHubResponse(
      owner,
      repo,
      error instanceof Error ? error.message : 'Analysis failed',
    );
  }
}

function createEmptyGitHubResponse(
  owner: string,
  repo: string,
  reason: string,
): GitHubAnalysisResponse {
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
    metadata: createMetadata('failed', 'failed', {
      degradationReason: reason,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────
// Library Documentation
// ─────────────────────────────────────────────────────────────────

/**
 * Fetch documentation for a library/framework.
 * 
 * Uses Context7 if configured, falls back to fetching docs homepage.
 */
export async function fetchLibraryDocs(
  context: ResearchContext,
  library: string,
  topic: string,
  docsUrl?: string,
): Promise<LibraryDocsResponse> {
  const startTime = Date.now();

  if (!canMakeSubrequest(context.subrequestTracker)) {
    return {
      library,
      topic,
      content: '',
      source: '',
      version: 'unknown',
      metadata: createMetadata('failed', 'failed', {
        degradationReason: 'Subrequest limit reached',
      }),
    };
  }

  await emitResearchEvent(context, '📚', `Looking up docs for ${library}...`);

  // Try Context7 first
  const context7Token = await getMCPToken(context, 'context7');
  if (context7Token) {
    try {
      recordSubrequest(context.subrequestTracker);
      const response = await fetchWithTimeout('https://api.context7.com/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${context7Token}`,
          'X-API-Key': context7Token,
        },
        body: JSON.stringify({
          library,
          topic,
          max_tokens: 4000,
        }),
      });

      if (response.ok) {
        const payload = JSON.parse(response.text) as Record<string, unknown>;
        const normalized = normalizeContext7Response(payload);

        if (normalized.content) {
          return {
            library,
            topic,
            content: normalized.content,
            source: 'Context7',
            version: normalized.version,
            metadata: createMetadata('context7', 'high', {
              durationMs: Date.now() - startTime,
            }),
          };
        }
      }
    } catch (error) {
      console.warn('[research-facade] Context7 failed:', error);
    }
  }

  // Fallback to fetching docs URL directly
  if (docsUrl) {
    const docResult = await fetchDocument(context, docsUrl);
    if (docResult.content) {
      return {
        library,
        topic,
        content: docResult.content,
        source: docsUrl,
        version: 'unknown',
        metadata: createMetadata('jina_reader', context7Token ? 'medium' : 'high', {
          durationMs: Date.now() - startTime,
          degraded: !!context7Token,
          degradationReason: context7Token ? 'Context7 failed, fetched docs URL directly' : undefined,
        }),
      };
    }
  }

  await emitResearchEvent(context, '⚠️', `No docs found for ${library}`);
  return {
    library,
    topic,
    content: '',
    source: '',
    version: 'unknown',
    metadata: createMetadata('failed', 'failed', {
      durationMs: Date.now() - startTime,
      degradationReason: 'No documentation available',
    }),
  };
}

function normalizeContext7Response(payload: Record<string, unknown>): {
  content: string;
  version: string;
} {
  const buckets = [
    payload.results,
    payload.data,
    payload.documents,
    payload.matches,
  ].filter(Array.isArray) as unknown[][];

  const content = buckets
    .flat()
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const doc = entry as Record<string, unknown>;
      return [
        typeof doc.title === 'string' ? doc.title : '',
        typeof doc.content === 'string' ? doc.content : '',
        typeof doc.text === 'string' ? doc.text : '',
        typeof doc.markdown === 'string' ? doc.markdown : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 14000);

  const version =
    typeof payload.version === 'string'
      ? payload.version
      : 'unknown';

  return { content, version };
}

// ─────────────────────────────────────────────────────────────────
// Batch Operations
// ─────────────────────────────────────────────────────────────────

/**
 * Fetch multiple documents sequentially.
 * 
 * Uses sequential fetching to stay under subrequest limits.
 */
export async function fetchMultipleDocuments(
  context: ResearchContext,
  urls: string[],
): Promise<DocumentFetchResponse[]> {
  const results: DocumentFetchResponse[] = [];

  for (const url of urls) {
    if (!canMakeSubrequest(context.subrequestTracker)) {
      break;
    }
    results.push(await fetchDocument(context, url));
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────
// Quality Assessment
// ─────────────────────────────────────────────────────────────────

/**
 * Aggregate quality metadata from multiple research results.
 */
export function aggregateResearchQuality(
  results: Array<{ metadata: ResearchMetadata }>,
): {
  overallQuality: ResearchQuality;
  toolsUsed: ResearchTool[];
  degradedCount: number;
  failedCount: number;
  totalCount: number;
} {
  const toolsUsed = [...new Set(results.map((r) => r.metadata.tool))];
  const degradedCount = results.filter((r) => r.metadata.degraded && r.metadata.quality !== 'failed').length;
  const failedCount = results.filter((r) => r.metadata.quality === 'failed').length;
  const totalCount = results.length;

  let overallQuality: ResearchQuality;
  if (failedCount === totalCount) {
    overallQuality = 'failed';
  } else if (failedCount > totalCount / 2) {
    overallQuality = 'degraded';
  } else if (degradedCount > totalCount / 2) {
    overallQuality = 'low';
  } else if (degradedCount > 0 || failedCount > 0) {
    overallQuality = 'medium';
  } else {
    overallQuality = 'high';
  }

  return {
    overallQuality,
    toolsUsed,
    degradedCount,
    failedCount,
    totalCount,
  };
}

// ─────────────────────────────────────────────────────────────────
// Legacy Compatibility Shims
// ─────────────────────────────────────────────────────────────────

/**
 * Legacy-compatible search web function.
 * @deprecated Use searchWeb() with ResearchContext instead for richer metadata.
 */
export async function searchWebLegacy(
  query: string,
  userId: string,
  env: Bindings,
  projectId?: string,
  batchName?: GenerationBatchName,
): Promise<Array<{ title: string; url: string; description: string }>> {
  const context: ResearchContext = { env, userId, projectId, batchName };
  const response = await searchWeb(context, query, 10);
  return response.results.map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description,
  }));
}

/**
 * Legacy-compatible fetch URL function.
 * @deprecated Use fetchDocument() with ResearchContext instead for richer metadata.
 */
export async function fetchUrlLegacy(
  url: string,
  env: Bindings,
  projectId?: string,
  batchName?: GenerationBatchName,
): Promise<{ url: string; content: string; error?: string }> {
  // Note: userId not required for URL fetch in legacy API
  const context: ResearchContext = { env, userId: '', projectId, batchName };
  const response = await fetchDocument(context, url);
  return {
    url: response.url,
    content: response.content,
    error: response.metadata.quality === 'failed' ? response.metadata.degradationReason : undefined,
  };
}

/**
 * Legacy-compatible GitHub repo analysis.
 * @deprecated Use analyzeGitHubRepo() with ResearchContext instead for richer metadata.
 * 
 * Note: The new interface returns different fields. This shim maps available
 * fields and provides empty values for fields not in the new response.
 */
export async function analyzeGithubRepoLegacy(
  owner: string,
  repo: string,
  userId: string,
  env: Bindings,
  projectId?: string,
  batchName?: GenerationBatchName,
): Promise<{
  owner: string;
  repo: string;
  stars: number;
  forks: number;
  description: string;
  homepage: string;
  topics: string[];
  language: string;
  license: string;
  readmeExcerpt: string;
  recentActivity: string;
}> {
  const context: ResearchContext = { env, userId, projectId, batchName };
  const response = await analyzeGitHubRepo(context, owner, repo);
  return {
    owner: response.owner,
    repo: response.repo,
    stars: response.stars,
    forks: response.forks,
    description: response.summary || '',
    homepage: '',
    topics: [],
    language: '',
    license: '',
    readmeExcerpt: response.readme.slice(0, 500),
    recentActivity: response.lastPush,
  };
}

/**
 * Legacy-compatible library docs fetch.
 * @deprecated Use fetchLibraryDocs() with ResearchContext instead for richer metadata.
 */
export async function getLibraryDocsLegacy(
  library: string,
  topic: string,
  userId: string,
  env: Bindings,
  projectId?: string,
  batchName?: GenerationBatchName,
): Promise<Array<{ library: string; source: string; version: string; url: string; content: string }>> {
  const context: ResearchContext = { env, userId, projectId, batchName };
  const response = await fetchLibraryDocs(context, library, topic);
  // The new API returns a single doc result, wrap in array for compatibility
  return response.content
    ? [
        {
          library: response.library,
          source: response.source,
          version: response.version || '',
          url: '', // New API doesn't return URL
          content: response.content,
        },
      ]
    : [];
}
