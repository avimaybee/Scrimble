const DOC_MAX_TOKENS = 8000;
const README_MAX_TOKENS = 4000;
const RELEASE_BODY_MAX_TOKENS = 1200;
const ISSUE_BODY_MAX_TOKENS = 600;
const RELEASE_LIMIT = 3;
const ISSUE_LIMIT = 10;
const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = 'ScrimbleAgent/1.0';

export type GitHubRepositoryRef = {
  owner: string;
  repo: string;
};

export type ResearchFetchStatus = number | 'fetch_error' | 'invalid_url' | 'timeout';

export type FetchAttemptLog = {
  url: string;
  source:
    | 'document'
    | 'github_issues_breaking_change'
    | 'github_issues_bug'
    | 'github_metadata'
    | 'github_readme'
    | 'github_releases';
  status: ResearchFetchStatus;
  duration_ms: number;
};

export type ResearchFailure = {
  kind: 'error';
  url: string;
  error: 'fetch_failed';
  status?: ResearchFetchStatus;
  message?: string;
};

export type DocumentResearchResult = {
  kind: 'document';
  url: string;
  content_type: string;
  text: string;
  token_count: number;
};

export type GitHubReleaseResearch = {
  tag_name: string;
  published_at: string;
  body: string;
};

export type GitHubIssueResearch = {
  title: string;
  body: string;
  url: string;
  created_at: string;
};

export type GitHubResearchResult = {
  kind: 'github_repo';
  url: string;
  repo: GitHubRepositoryRef;
  metadata: {
    stars: number;
    forks: number;
    open_issues_count: number;
    last_push_date: string;
  };
  readme: string;
  latest_version: string;
  releases: GitHubReleaseResearch[];
  recent_issues: GitHubIssueResearch[];
  partial_errors: Array<Omit<ResearchFailure, 'kind'>>;
};

export type ResearchResult = DocumentResearchResult | GitHubResearchResult | ResearchFailure;

type FetchAndParseOptions = {
  githubToken?: string | null;
  onLog?: (attempt: FetchAttemptLog) => Promise<void> | void;
};

type TimedFetchSuccess = {
  ok: true;
  response: Response;
  durationMs: number;
};

type TimedFetchFailure = {
  ok: false;
  durationMs: number;
  status: ResearchFetchStatus;
  message: string;
};

type GitHubRepositoryMetadataResponse = {
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  pushed_at?: string;
};

type GitHubReadmeResponse = {
  content?: string;
  encoding?: string;
};

type GitHubReleaseResponse = {
  tag_name?: string;
  published_at?: string;
  body?: string;
};

type GitHubIssueResponse = {
  html_url?: string;
  title?: string;
  body?: string;
  created_at?: string;
  pull_request?: unknown;
};

class FetchTimeoutError extends Error {
  constructor(url: string) {
    super(`Request timed out after ${FETCH_TIMEOUT_MS}ms for ${url}`);
    this.name = 'FetchTimeoutError';
  }
}

function isTimedFetchFailure(result: TimedFetchSuccess | TimedFetchFailure): result is TimedFetchFailure {
  return result.ok === false;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function collapseWhitespace(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function countTokens(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function trimToTokenLimit(value: string, maxTokens: number) {
  const trimmed = collapseWhitespace(value);
  const tokens = trimmed ? trimmed.split(/\s+/) : [];
  return tokens.length <= maxTokens ? trimmed : `${tokens.slice(0, maxTokens).join(' ')}...`;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal: string) => String.fromCodePoint(parseInt(decimal, 10)));
}

function pickFirstContentMatch(source: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) {
      continue;
    }

    const fragment = match.slice(1).find(Boolean);
    if (fragment) {
      return fragment;
    }
  }

  return source;
}

function stripNamedContainers(source: string, patterns: RegExp[]) {
  let output = source;

  for (const pattern of patterns) {
    let previous = '';
    while (previous !== output) {
      previous = output;
      output = output.replace(pattern, ' ');
    }
  }

  return output;
}

function htmlToReadableText(html: string) {
  const withoutInvisibleMarkup = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ');

  const mainContent = pickFirstContentMatch(withoutInvisibleMarkup, [
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<section\b[^>]*(?:id|class|role)=["'][^"']*(?:content|doc|documentation|main|article|markdown-body)[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
    /<div\b[^>]*(?:id|class|role)=["'][^"']*(?:content|doc|documentation|main|article|markdown-body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<body\b[^>]*>([\s\S]*?)<\/body>/i,
  ]);

  const withoutChrome = stripNamedContainers(mainContent, [
    /<(nav|header|footer|aside|form|button|dialog|menu)\b[\s\S]*?<\/\1>/gi,
    /<([a-z0-9:-]+)\b[^>]*(?:id|class|role|aria-label)=["'][^"']*(?:breadcrumb|cookie|drawer|footer|header|hero-nav|masthead|menu|nav|pagination|search|sidebar|skip|social|table-of-contents|toc|toolbar)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
  ]);

  const blockSeparated = withoutChrome
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|li|ul|ol|pre|code|blockquote|h[1-6]|table|tr)>/gi, '\n');

  return collapseWhitespace(
    decodeHtmlEntities(blockSeparated.replace(/<[^>]+>/g, ' '))
      .replace(/\s*\n\s*/g, '\n')
      .replace(/\n{3,}/g, '\n\n'),
  );
}

function decodeBase64Utf8(value: string) {
  const normalized = value.replace(/\n/g, '');
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function extractPublicIssueBodies(
  issues: GitHubIssueResponse[],
  knownUrls: Set<string>,
) {
  const results: GitHubIssueResearch[] = [];

  for (const issue of issues) {
    if (issue.pull_request || !issue.html_url || knownUrls.has(issue.html_url)) {
      continue;
    }

    knownUrls.add(issue.html_url);
    results.push({
      title: asText(issue.title, 'Untitled issue'),
      body: trimToTokenLimit(asText(issue.body), ISSUE_BODY_MAX_TOKENS),
      url: issue.html_url,
      created_at: asText(issue.created_at, 'Unknown'),
    });

    if (results.length >= ISSUE_LIMIT) {
      break;
    }
  }

  return results;
}

function buildGitHubHeaders(token?: string | null, accept = 'application/vnd.github+json'): HeadersInit {
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

export function extractGitHubRepository(url: string): GitHubRepositoryRef | null {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname !== 'github.com') {
      return null;
    }

    const segments = parsedUrl.pathname.split('/').filter(Boolean);
    if (segments.length !== 2) {
      return null;
    }

    const [owner, repo] = segments;
    if (!owner || !repo) {
      return null;
    }

    return { owner, repo: repo.replace(/\.git$/i, '') };
  } catch {
    return null;
  }
}

async function logFetchAttempt(options: FetchAndParseOptions, attempt: FetchAttemptLog) {
  await options.onLog?.(attempt);
}

async function timedFetch(
  url: string,
  init: RequestInit,
  source: FetchAttemptLog['source'],
  options: FetchAndParseOptions,
): Promise<TimedFetchSuccess | TimedFetchFailure> {
  const controller = new AbortController();
  const startedAt = Date.now();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const response = await Promise.race<Response | never>([
      fetch(url, {
        ...init,
        signal: controller.signal,
      }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new FetchTimeoutError(url));
        }, FETCH_TIMEOUT_MS);
      }),
    ]);

    const durationMs = Date.now() - startedAt;
    await logFetchAttempt(options, {
      url,
      source,
      status: response.status,
      duration_ms: durationMs,
    });

    if (!response.ok) {
      return {
        ok: false,
        durationMs,
        status: response.status,
        message: `Request failed with status ${response.status}`,
      };
    }

    return {
      ok: true,
      response,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const status: ResearchFetchStatus = error instanceof FetchTimeoutError ? 'timeout' : 'fetch_error';
    await logFetchAttempt(options, {
      url,
      source,
      status,
      duration_ms: durationMs,
    });

    return {
      ok: false,
      durationMs,
      status,
      message: error instanceof Error ? error.message : `Request failed for ${url}`,
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function toResearchFailure(url: string, status: ResearchFetchStatus, message: string): ResearchFailure {
  return {
    kind: 'error',
    url,
    error: 'fetch_failed',
    status,
    message,
  };
}

async function fetchGitHubResearch(
  url: string,
  repository: GitHubRepositoryRef,
  options: FetchAndParseOptions,
): Promise<ResearchResult> {
  const repoUrl = `https://api.github.com/repos/${repository.owner}/${repository.repo}`;
  const githubToken = options.githubToken || null;

  const metadataResult = await timedFetch(
    repoUrl,
    { headers: buildGitHubHeaders(githubToken) },
    'github_metadata',
    options,
  );

  if (isTimedFetchFailure(metadataResult)) {
    return toResearchFailure(url, metadataResult.status, metadataResult.message);
  }

  const repoData = await metadataResult.response.json() as GitHubRepositoryMetadataResponse;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [readmeResult, releasesResult, bugIssuesResult, breakingChangeIssuesResult] = await Promise.all([
    timedFetch(
      `${repoUrl}/readme`,
      { headers: buildGitHubHeaders(githubToken) },
      'github_readme',
      options,
    ),
    timedFetch(
      `${repoUrl}/releases?per_page=${RELEASE_LIMIT}`,
      { headers: buildGitHubHeaders(githubToken) },
      'github_releases',
      options,
    ),
    timedFetch(
      `${repoUrl}/issues?labels=bug&state=open&since=${encodeURIComponent(ninetyDaysAgo)}&per_page=${ISSUE_LIMIT}`,
      { headers: buildGitHubHeaders(githubToken) },
      'github_issues_bug',
      options,
    ),
    timedFetch(
      `${repoUrl}/issues?labels=breaking-change&state=open&since=${encodeURIComponent(ninetyDaysAgo)}&per_page=${ISSUE_LIMIT}`,
      { headers: buildGitHubHeaders(githubToken) },
      'github_issues_breaking_change',
      options,
    ),
  ]);

  const partialErrors: Array<Omit<ResearchFailure, 'kind'>> = [];

  let readme = '';
  if (!isTimedFetchFailure(readmeResult)) {
    const readmePayload = await readmeResult.response.json() as GitHubReadmeResponse;
    if (readmePayload.encoding === 'base64' && readmePayload.content) {
      readme = trimToTokenLimit(collapseWhitespace(decodeBase64Utf8(readmePayload.content)), README_MAX_TOKENS);
    }
  } else {
    partialErrors.push({
      url: `${repoUrl}/readme`,
      error: 'fetch_failed',
      status: readmeResult.status,
      message: readmeResult.message,
    });
  }

  let releases: GitHubReleaseResearch[] = [];
  if (!isTimedFetchFailure(releasesResult)) {
    const releasesPayload = await releasesResult.response.json() as GitHubReleaseResponse[];
    releases = releasesPayload.slice(0, RELEASE_LIMIT).map((release) => ({
      tag_name: asText(release.tag_name, 'Unknown'),
      published_at: asText(release.published_at, 'Unknown'),
      body: trimToTokenLimit(collapseWhitespace(asText(release.body)), RELEASE_BODY_MAX_TOKENS),
    }));
  } else {
    partialErrors.push({
      url: `${repoUrl}/releases?per_page=${RELEASE_LIMIT}`,
      error: 'fetch_failed',
      status: releasesResult.status,
      message: releasesResult.message,
    });
  }

  const knownIssueUrls = new Set<string>();
  let recentIssues: GitHubIssueResearch[] = [];

  if (!isTimedFetchFailure(bugIssuesResult)) {
    const issuesPayload = await bugIssuesResult.response.json() as GitHubIssueResponse[];
    recentIssues = recentIssues.concat(extractPublicIssueBodies(issuesPayload, knownIssueUrls));
  } else {
    partialErrors.push({
      url: `${repoUrl}/issues?labels=bug&state=open&since=${encodeURIComponent(ninetyDaysAgo)}`,
      error: 'fetch_failed',
      status: bugIssuesResult.status,
      message: bugIssuesResult.message,
    });
  }

  if (!isTimedFetchFailure(breakingChangeIssuesResult) && recentIssues.length < ISSUE_LIMIT) {
    const issuesPayload = await breakingChangeIssuesResult.response.json() as GitHubIssueResponse[];
    recentIssues = recentIssues.concat(extractPublicIssueBodies(issuesPayload, knownIssueUrls));
  } else if (isTimedFetchFailure(breakingChangeIssuesResult)) {
    partialErrors.push({
      url: `${repoUrl}/issues?labels=breaking-change&state=open&since=${encodeURIComponent(ninetyDaysAgo)}`,
      error: 'fetch_failed',
      status: breakingChangeIssuesResult.status,
      message: breakingChangeIssuesResult.message,
    });
  }

  return {
    kind: 'github_repo',
    url,
    repo: repository,
    metadata: {
      stars: asNumber(repoData.stargazers_count),
      forks: asNumber(repoData.forks_count),
      open_issues_count: asNumber(repoData.open_issues_count),
      last_push_date: asText(repoData.pushed_at, 'Unknown'),
    },
    readme,
    latest_version: releases[0]?.tag_name || 'Unknown',
    releases,
    recent_issues: recentIssues.slice(0, ISSUE_LIMIT),
    partial_errors: partialErrors,
  };
}

export async function fetchAndParse(url: string, options: FetchAndParseOptions = {}): Promise<ResearchResult> {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    await logFetchAttempt(options, {
      url,
      source: 'document',
      status: 'invalid_url',
      duration_ms: 0,
    });
    return toResearchFailure(url, 'invalid_url', `Invalid URL: ${url}`);
  }

  const repository = extractGitHubRepository(parsedUrl.toString());
  if (repository) {
    return fetchGitHubResearch(parsedUrl.toString(), repository, options);
  }

  const documentResult = await timedFetch(
    parsedUrl.toString(),
    {
      headers: {
        Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8',
        'User-Agent': USER_AGENT,
      },
    },
    'document',
    options,
  );

  if (isTimedFetchFailure(documentResult)) {
    return toResearchFailure(parsedUrl.toString(), documentResult.status, documentResult.message);
  }

  const contentType = documentResult.response.headers.get('content-type') || 'text/plain';
  const rawText = await documentResult.response.text();
  const normalizedText = contentType.includes('text/html')
    ? htmlToReadableText(rawText)
    : collapseWhitespace(decodeHtmlEntities(rawText));
  const text = trimToTokenLimit(normalizedText, DOC_MAX_TOKENS);

  return {
    kind: 'document',
    url: parsedUrl.toString(),
    content_type: contentType,
    text,
    token_count: countTokens(text),
  };
}
