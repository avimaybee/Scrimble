import { fetchAndParse, type GitHubResearchResult } from '../../functions/utils/fetch-url';
import { persistGenerationStreamEvent } from '../../functions/server/generation-events';
import { decrypt } from '../../functions/utils/crypto';
import type { Bindings, GenerationBatchName } from '../../functions/server/types';

const TOOL_TIMEOUT_MS = 10_000;
const BRAVE_RESULT_LIMIT = 5;
const ISSUE_LIMIT = 10;

export type Env = Bindings & {
  TOOL_CONTEXT?: {
    projectId: string;
    batchName: GenerationBatchName;
    runId?: string;
  };
};

export type SearchResult = {
  title: string;
  url: string;
  description: string;
};

export type GithubRepoAnalysis = {
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
  recentIssues: GithubIssue[];
};

export type GithubIssue = {
  id: number;
  title: string;
  url: string;
  body: string;
  createdAt: string;
  labels: string[];
  state: string;
};

export type ToolExecutionOptions = {
  throwOnError?: boolean;
};

export class ToolExecutionError extends Error {
  constructor(
    readonly tool: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

export type LibraryDocsResult = {
  content: string;
  source: string;
  version: string;
  degraded?: boolean;
  degradationCode?: 'context7_failed' | 'context7_empty';
  degradationMessage?: string;
};

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function trimText(value: string, maxLength = 2000) {
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength)}...`;
}

function deriveTitleFromUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    const leaf = parsedUrl.pathname.split('/').filter(Boolean).pop();
    const raw = leaf || parsedUrl.hostname;
    return raw
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase());
  } catch {
    return url;
  }
}

function summarizeGitHubResearch(result: GitHubResearchResult) {
  const parts = [
    `${result.repo.owner}/${result.repo.repo}`,
    `${result.metadata.stars} stars`,
    `${result.metadata.open_issues_count} open issues`,
    result.latest_version !== 'Unknown' ? `latest release ${result.latest_version}` : '',
  ].filter(Boolean);

  return parts.join(' — ');
}

function formatGitHubResultAsText(result: GitHubResearchResult) {
  const sections = [
    summarizeGitHubResearch(result),
    result.readme,
    result.releases
      .map((release) => `Release ${release.tag_name} (${release.published_at}): ${release.body}`)
      .join('\n\n'),
    result.recent_issues
      .map((issue) => `Issue (${issue.created_at}) ${issue.title}: ${issue.body}`)
      .join('\n\n'),
  ].filter(Boolean);

  return sections.join('\n\n');
}

function guessDocsHomepage(library: string) {
  const normalized = library
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\s+/g, '-')
    .replace(/\.js$/g, '')
    .replace(/[^a-z0-9/_-]/g, '');

  const npmPackage = normalized === 'next' || normalized === 'nextjs' ? 'next' : normalized;
  return `https://www.npmjs.com/package/${encodeURIComponent(npmPackage || 'npm')}`;
}

function buildGitHubHeaders(token?: string | null): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ScrimbleAgent/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function getUserMCPConfig(
  userId: string,
  serverType: 'brave-search' | 'github' | 'context7',
  env: Bindings,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT config_enc FROM mcp_servers
     WHERE user_id = ? AND server_type = ? AND is_active = 1
     LIMIT 1`,
  )
    .bind(userId, serverType)
    .first();

  if (!row) {
    return null;
  }

  const config = JSON.parse(await decrypt(row.config_enc as string, env.ENCRYPTION_KEY)) as {
    apiKey?: string;
    token?: string;
  };

  return config.apiKey || config.token || null;
}

async function emitToolEvent(env: Env | undefined, icon: string, message: string) {
  const context = env?.TOOL_CONTEXT;
  if (!context) {
    return;
  }

  try {
    await persistGenerationStreamEvent(env, {
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
    console.warn('[workers/tools] Failed to emit SSE event', error);
  }
}

async function emitWarning(env: Env | undefined, message: string) {
  await emitToolEvent(env, '⚠️', message);
}

async function fetchJson(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return response.json() as Promise<unknown>;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeContext7Response(payload: unknown) {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const buckets = [
    record.results,
    record.data,
    record.documents,
    record.matches,
  ].filter(Array.isArray) as unknown[][];

  const content = buckets
    .flat()
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return '';
      }

      const document = entry as Record<string, unknown>;
      return [
        asText(document.title),
        asText(document.content),
        asText(document.text),
        asText(document.markdown),
        asText(document.snippet),
        asText(document.excerpt),
        asText(document.body),
      ]
        .filter(Boolean)
        .join('\n');
    })
    .filter(Boolean)
    .join('\n\n');

  const firstVersionedDocument = buckets
    .flat()
    .find((entry) => entry && typeof entry === 'object' && 'version' in (entry as Record<string, unknown>)) as
      | Record<string, unknown>
      | undefined;

  const version =
    asText(record.version) ||
    asText(firstVersionedDocument?.version) ||
    'unknown';

  return {
    content: trimText(content, 14000),
    source: 'Context7',
    version,
  };
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

export async function searchWeb(
  query: string,
  userId: string,
  env: Env,
  options: ToolExecutionOptions = {},
): Promise<SearchResult[]> {
  await emitToolEvent(env, '🔍', `Searching for ${query}...`);

  try {
    const token = await getUserMCPConfig(userId, 'brave-search', env);
    if (!token) {
      await emitToolEvent(env, '🔍', 'Brave Search not connected — continuing without web results.');
      return [];
    }

    const endpoint = new URL('https://api.search.brave.com/res/v1/web/search');
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('count', `${BRAVE_RESULT_LIMIT}`);

    const payload = await fetchJson(endpoint.toString(), {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': token,
      },
    }) as {
      web?: {
        results?: Array<Record<string, unknown>>;
      };
    };

    return (payload.web?.results || []).slice(0, BRAVE_RESULT_LIMIT).map((result) => ({
      title: asText(result.title, 'Untitled result'),
      url: asText(result.url),
      description: asText(result.description || result.snippet),
    }));
  } catch (error) {
    const message = `Brave Search could not complete "${query}" — continuing without web results.`;
    await emitWarning(
      env,
      message,
    );
    console.warn('[workers/tools] searchWeb failed', error);
    if (options.throwOnError) {
      throw new ToolExecutionError('Brave Search', message);
    }
    return [];
  }
}

export async function fetchUrl(
  url: string,
  env?: Env,
  options: ToolExecutionOptions = {},
): Promise<{ content: string; title: string; url: string }> {
  await emitToolEvent(env, '🔍', `Reading ${url}...`);

  try {
    const result = await fetchAndParse(url);

    if (result.kind === 'document') {
      return {
        content: result.text,
        title: deriveTitleFromUrl(result.url),
        url: result.url,
      };
    }

    if (result.kind === 'github_repo') {
      return {
        content: formatGitHubResultAsText(result),
        title: `${result.repo.owner}/${result.repo.repo}`,
        url: result.url,
      };
    }

    const message = `Couldn't read ${url} — continuing with partial research.`;
    await emitWarning(env, message);
    if (options.throwOnError) {
      throw new ToolExecutionError('Web fetch', message);
    }
    return {
      content: '',
      title: deriveTitleFromUrl(url),
      url,
    };
  } catch (error) {
    const message = `Couldn't read ${url} — continuing with partial research.`;
    await emitWarning(env, message);
    console.warn('[workers/tools] fetchUrl failed', error);
    if (options.throwOnError) {
      throw new ToolExecutionError('Web fetch', message);
    }
    return {
      content: '',
      title: deriveTitleFromUrl(url),
      url,
    };
  }
}

export async function analyzeGithubRepo(
  owner: string,
  repo: string,
  userId: string,
  env: Env,
  options: ToolExecutionOptions = {},
): Promise<GithubRepoAnalysis> {
  await emitToolEvent(env, '📦', `Checking ${owner}/${repo} on GitHub...`);

  try {
    const token = await getUserMCPConfig(userId, 'github', env);
    if (!token) {
      await emitToolEvent(env, '📦', 'GitHub not connected — using public API (rate limited).');
    }

    const result = await fetchAndParse(`https://github.com/${owner}/${repo}`, {
      githubToken: token,
    });

    if (result.kind !== 'github_repo') {
      const message = `GitHub research for ${owner}/${repo} came back empty.`;
      await emitWarning(env, message);
      if (options.throwOnError) {
        throw new ToolExecutionError('GitHub repo', message);
      }
      return emptyGithubRepoAnalysis(owner, repo);
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
      summary: summarizeGitHubResearch(result),
      releases: result.releases.map((release) => ({
        tagName: release.tag_name,
        publishedAt: release.published_at,
        body: release.body,
      })),
      recentIssues: result.recent_issues.map((issue, index) => ({
        id: index + 1,
        title: issue.title,
        url: issue.url,
        body: issue.body,
        createdAt: issue.created_at,
        labels: [],
        state: 'open',
      })),
    };
  } catch (error) {
    const message = `GitHub research for ${owner}/${repo} failed — using partial data.`;
    await emitWarning(env, message);
    console.warn('[workers/tools] analyzeGithubRepo failed', error);
    if (options.throwOnError) {
      throw new ToolExecutionError('GitHub repo', message);
    }
    return emptyGithubRepoAnalysis(owner, repo);
  }
}

export async function getLibraryDocs(
  library: string,
  topic: string,
  userId: string,
  env: Env,
  options: ToolExecutionOptions = {},
): Promise<LibraryDocsResult> {
  await emitToolEvent(env, '🔍', `Looking up live docs for ${library}...`);
  let degradationCode: LibraryDocsResult['degradationCode'];
  let degradationMessage: string | undefined;

  try {
    const token = await getUserMCPConfig(userId, 'context7', env);
    if (token) {
      const payload = await fetchJson('https://api.context7.com/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-API-Key': token,
        },
        body: JSON.stringify({
          library,
          topic,
          max_tokens: 4000,
        }),
      });

      const normalized = normalizeContext7Response(payload);
      if (normalized.content) {
        return normalized;
      }

      degradationCode = 'context7_empty';
      degradationMessage = `Context7 had no fresh docs for ${library} — falling back to the docs homepage.`;
      await emitWarning(env, degradationMessage);
    } else {
      await emitToolEvent(env, '🔍', 'Context7 not connected — using the docs homepage fallback.');
    }
  } catch (error) {
    degradationCode = 'context7_failed';
    degradationMessage = `Context7 lookup failed for ${library} — falling back to the docs homepage.`;
    await emitWarning(env, degradationMessage);
    console.warn('[workers/tools] getLibraryDocs failed', error);
  }

  const fallbackUrl = guessDocsHomepage(library);
  const fallback = await fetchUrl(fallbackUrl, env);

  if (options.throwOnError && !fallback.content && degradationCode) {
    throw new ToolExecutionError('Context7', degradationMessage || `Context7 lookup failed for ${library}.`);
  }

  return {
    content: fallback.content,
    source: fallback.url,
    version: 'unknown',
    degraded: Boolean(degradationCode),
    degradationCode,
    degradationMessage,
  };
}

export async function getLibraryIssues(
  owner: string,
  repo: string,
  labels: string[],
  daysSince: number,
  userId: string,
  env: Env,
  options: ToolExecutionOptions = {},
): Promise<GithubIssue[]> {
  await emitToolEvent(env, '📦', `Searching ${owner}/${repo} issues...`);

  try {
    const token = await getUserMCPConfig(userId, 'github', env);
    if (!token) {
      await emitToolEvent(env, '📦', 'GitHub not connected — using public API (rate limited).');
    }

    const since = new Date(Date.now() - daysSince * 24 * 60 * 60 * 1000).toISOString();
    const endpoint = new URL(`https://api.github.com/repos/${owner}/${repo}/issues`);
    endpoint.searchParams.set('state', 'open');
    endpoint.searchParams.set('since', since);
    endpoint.searchParams.set('per_page', `${ISSUE_LIMIT}`);

    if (labels.length > 0) {
      endpoint.searchParams.set('labels', labels.join(','));
    }

    const payload = await fetchJson(endpoint.toString(), {
      headers: buildGitHubHeaders(token),
    }) as Array<Record<string, unknown>>;

    return payload
      .filter((issue) => !('pull_request' in issue))
      .slice(0, ISSUE_LIMIT)
      .map((issue) => ({
        id: asNumber(issue.id),
        title: asText(issue.title, 'Untitled issue'),
        url: asText(issue.html_url),
        body: trimText(asText(issue.body), 1400),
        createdAt: asText(issue.created_at, 'Unknown'),
        labels: Array.isArray(issue.labels)
          ? issue.labels
              .map((label) =>
                typeof label === 'string'
                  ? label
                  : label && typeof label === 'object'
                    ? asText((label as Record<string, unknown>).name)
                    : '',
              )
              .filter(Boolean)
          : [],
        state: asText(issue.state, 'open'),
      }));
  } catch (error) {
    const message = `Issue lookup failed for ${owner}/${repo} — continuing without issue data.`;
    await emitWarning(env, message);
    console.warn('[workers/tools] getLibraryIssues failed', error);
    if (options.throwOnError) {
      throw new ToolExecutionError('GitHub issues', message);
    }
    return [];
  }
}
