import { fetchAndParse, type GitHubResearchResult, type SubrequestTracker } from '../utils/fetch-url';
import { persistGenerationStreamEvent } from './generation-events';
import { getActiveMCPServer } from './mcp-servers';
import type { Bindings, GenerationBatchName } from './types';

export type ResearchResult = {
  content: string;
  source: string;
  tool: 'jina_reader' | 'cf_scrape' | 'gitmcp' | 'github_api' | 'jina_search' | 'failed';
  chars: number;
  title?: string;
  error?: string;
};

export type ToolDocsEntry = {
  docs: string;
  github?: string;
};

export const RESEARCH_SUBREQUEST_LIMIT = 35;
export type ResearchSubrequestTracker = SubrequestTracker;

export const TOOL_DOCS_MAP: Record<string, ToolDocsEntry> = {
  supabase: { docs: 'https://supabase.com/docs', github: 'supabase/supabase' },
  'supabaseauth': { docs: 'https://supabase.com/docs/guides/auth', github: 'supabase/auth' },
  nextjs: { docs: 'https://nextjs.org/docs', github: 'vercel/next.js' },
  react: { docs: 'https://react.dev', github: 'facebook/react' },
  vue: { docs: 'https://vuejs.org/guide', github: 'vuejs/core' },
  svelte: { docs: 'https://svelte.dev/docs', github: 'sveltejs/svelte' },
  astro: { docs: 'https://docs.astro.build', github: 'withastro/astro' },
  remix: { docs: 'https://remix.run/docs', github: 'remix-run/remix' },
  hono: { docs: 'https://hono.dev/docs', github: 'honojs/hono' },
  express: { docs: 'https://expressjs.com', github: 'expressjs/express' },
  vercel: { docs: 'https://vercel.com/docs', github: 'vercel/vercel' },
  railway: { docs: 'https://docs.railway.app', github: 'railwayapp/docs' },
  flyio: { docs: 'https://fly.io/docs', github: 'superfly/flyctl' },
  render: { docs: 'https://render.com/docs' },
  aws: { docs: 'https://docs.aws.amazon.com' },
  neon: { docs: 'https://neon.tech/docs', github: 'neondatabase/neon' },
  turso: { docs: 'https://docs.turso.tech', github: 'tursodatabase/turso' },
  planetscale: { docs: 'https://planetscale.com/docs', github: 'planetscale/cli' },
  mongodb: { docs: 'https://www.mongodb.com/docs', github: 'mongodb/node-mongodb-native' },
  firebase: { docs: 'https://firebase.google.com/docs', github: 'firebase/firebase-js-sdk' },
  'firebaseauth': { docs: 'https://firebase.google.com/docs/auth', github: 'firebase/firebase-js-sdk' },
  prisma: { docs: 'https://www.prisma.io/docs', github: 'prisma/prisma' },
  clerk: { docs: 'https://clerk.com/docs', github: 'clerk/javascript' },
  authjs: { docs: 'https://authjs.dev', github: 'nextauthjs/next-auth' },
  lucia: { docs: 'https://lucia-auth.com', github: 'lucia-auth/lucia' },
  betterauth: { docs: 'https://www.better-auth.com/docs', github: 'better-auth/better-auth' },
  stripe: { docs: 'https://stripe.com/docs', github: 'stripe/stripe-node' },
  lemonsqueezy: { docs: 'https://docs.lemonsqueezy.com', github: 'lmsqueezy/lemonsqueezy.js' },
  paddle: { docs: 'https://developer.paddle.com', github: 'PaddleHQ/paddle-node-sdk' },
  cloudflared1: { docs: 'https://developers.cloudflare.com/d1/', github: 'cloudflare/workers-sdk' },
  cloudflareworkers: { docs: 'https://developers.cloudflare.com/workers/', github: 'cloudflare/workers-sdk' },
  vscode: { docs: 'https://code.visualstudio.com/docs', github: 'microsoft/vscode' },
  cursor: { docs: 'https://docs.cursor.com' },
  windsurf: { docs: 'https://docs.windsurf.com' },
  zed: { docs: 'https://zed.dev/docs', github: 'zed-industries/zed' },
  neovim: { docs: 'https://neovim.io/doc', github: 'neovim/neovim' },
  claudecode: { docs: 'https://docs.anthropic.com' },
  claude: { docs: 'https://docs.anthropic.com' },
  chatgpt: { docs: 'https://platform.openai.com/docs' },
  gemini: { docs: 'https://ai.google.dev/gemini-api/docs' },
  grok: { docs: 'https://docs.x.ai' },
  perplexity: { docs: 'https://docs.perplexity.ai' },
  v0: { docs: 'https://v0.dev' },
  bolt: { docs: 'https://support.bolt.new' },
  lovable: { docs: 'https://docs.lovable.dev' },
};

const DEFAULT_TIMEOUT_MS = 30_000;
const CF_SCRAPE_ENDPOINT = 'https://gateway.ai.cloudflare.com/v1/scrape';

type ResearchServiceContext = {
  env: Bindings;
  userId?: string;
  projectId?: string;
  batchName?: GenerationBatchName;
  runId?: string;
  subrequestTracker?: ResearchSubrequestTracker;
};

type ResearchService = {
  fetchDoc: (url: string) => Promise<ResearchResult>;
  searchWeb: (query: string, maxResults?: number) => Promise<ResearchResult[]>;
  fetchGitHubRepo: (owner: string, repo: string) => Promise<ResearchResult>;
  fetchMultiple: (urls: string[], options?: { maxConcurrent?: number }) => Promise<ResearchResult[]>;
};

export function createResearchSubrequestTracker(
  options: { initialCount?: number; limit?: number } = {},
): ResearchSubrequestTracker {
  return {
    count: Math.max(0, Math.floor(options.initialCount || 0)),
    limit: Math.max(1, Math.floor(options.limit || RESEARCH_SUBREQUEST_LIMIT)),
  };
}

export async function fetchSequentially<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrent = 1,
): Promise<T[]> {
  if (maxConcurrent !== 1) {
    console.warn(`[research] fetchSequentially forcing maxConcurrent=1 (received ${maxConcurrent}).`);
  }

  const results: T[] = [];
  for (const task of tasks) {
    results.push(await task());
  }
  return results;
}

function normalizeToolKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.+/]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function extractGithubContent(result: GitHubResearchResult) {
  const releaseSummary = result.releases
    .slice(0, 4)
    .map((release) => `${release.tag_name} (${release.published_at}): ${release.body}`)
    .join('\n\n');
  const issueSummary = result.recent_issues
    .slice(0, 8)
    .map((issue) => `Issue (${issue.created_at}) ${issue.title}: ${issue.body}`)
    .join('\n\n');
  const headline = `${result.repo.owner}/${result.repo.repo} — ${result.metadata.stars} stars, ${result.metadata.open_issues_count} open issues, latest release ${result.latest_version}, last push ${result.metadata.last_push_date}.`;

  return [headline, result.readme, releaseSummary, issueSummary].filter(Boolean).join('\n\n');
}

function readObjectValue(input: unknown, candidates: string[]) {
  if (!input || typeof input !== 'object') {
    return '';
  }

  const record = input as Record<string, unknown>;
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function extractContentFromUnknown(payload: unknown, depth = 0): string {
  if (depth > 4 || payload == null) {
    return '';
  }

  if (typeof payload === 'string') {
    return payload.trim();
  }

  if (Array.isArray(payload)) {
    const values = payload
      .map((entry) => extractContentFromUnknown(entry, depth + 1))
      .filter(Boolean);
    return values.join('\n\n').trim();
  }

  if (typeof payload === 'object') {
    const direct = readObjectValue(payload, ['markdown', 'content', 'text', 'body', 'output', 'result']);
    if (direct) {
      return direct;
    }

    const record = payload as Record<string, unknown>;
    const nestedCandidates = [record.data, record.result, record.document, record.documents, record.response];
    for (const nested of nestedCandidates) {
      const extracted = extractContentFromUnknown(nested, depth + 1);
      if (extracted) {
        return extracted;
      }
    }
  }

  return '';
}

async function fetchText(
  context: ResearchServiceContext,
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; text: string; error?: string }> {
  const tracker = context.subrequestTracker;
  if (tracker) {
    if (tracker.count >= tracker.limit) {
      return {
        ok: false,
        status: 0,
        text: '',
        error: `Subrequest limit reached (${tracker.limit}).`,
      };
    }
    tracker.count += 1;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        text,
        error: `Request failed with status ${response.status}`,
      };
    }

    return {
      ok: true,
      status: response.status,
      text,
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

function parseJinaSearchResults(markdown: string, maxResults: number): ResearchResult[] {
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const results: ResearchResult[] = [];
  const sectionPattern = /Title:\s*(.+?)\nURL Source:\s*(.+?)\n(?:Markdown Content:\s*)?([\s\S]*?)(?=\nTitle:|\n---\s*title:|$)/g;
  let sectionMatch: RegExpExecArray | null;
  while ((sectionMatch = sectionPattern.exec(normalized)) && results.length < maxResults) {
    const title = sectionMatch[1]?.trim() || 'Untitled source';
    const source = sectionMatch[2]?.trim() || '';
    const content = sectionMatch[3]?.trim() || '';
    if (!source || !content) {
      continue;
    }

    results.push({
      content,
      source,
      title,
      tool: 'jina_search',
      chars: content.length,
    });
  }

  if (results.length > 0) {
    return results;
  }

  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  const seen = new Set<string>();
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkPattern.exec(normalized)) && results.length < maxResults) {
    const title = linkMatch[1]?.trim() || 'Web result';
    const source = linkMatch[2]?.trim() || '';
    if (!source || seen.has(source.toLowerCase())) {
      continue;
    }

    seen.add(source.toLowerCase());
    results.push({
      title,
      source,
      content: normalized.slice(Math.max(0, linkMatch.index - 120), Math.min(normalized.length, linkMatch.index + 420)).trim(),
      tool: 'jina_search',
      chars: Math.min(540, normalized.length),
    });
  }

  if (results.length > 0) {
    return results;
  }

  return [
    {
      content: normalized,
      source: '',
      tool: 'jina_search',
      chars: normalized.length,
    },
  ];
}

export function resolveToolDocsEntry(toolName: string): ToolDocsEntry | null {
  const key = normalizeToolKey(toolName);
  if (!key) {
    return null;
  }

  const direct = TOOL_DOCS_MAP[key];
  if (direct) {
    return direct;
  }

  const partial = Object.entries(TOOL_DOCS_MAP).find(([candidate]) =>
    candidate.includes(key) || key.includes(candidate),
  );
  return partial?.[1] || null;
}

export function createResearchService(context: ResearchServiceContext): ResearchService {
  const emitActivity = async (message: string, icon = '🔍') => {
    if (!context.projectId || !context.batchName) {
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
      console.warn('[research] Failed to emit activity event', error);
    }
  };

  const fetchDoc = async (url: string): Promise<ResearchResult> => {
    const targetUrl = url.trim();
    if (!targetUrl) {
      return {
        content: '',
        source: '',
        tool: 'failed',
        chars: 0,
        error: 'Missing URL.',
      };
    }

    await emitActivity(`Fetching documentation from ${targetUrl}...`, '📚');
    const jinaUrl = `https://r.jina.ai/${targetUrl}`;
    const jinaAttempt = await fetchText(context, jinaUrl);
    if (jinaAttempt.ok && jinaAttempt.text.trim()) {
      const content = jinaAttempt.text.trim();
      await emitActivity(`Fetched docs via Jina Reader (${content.length.toLocaleString()} chars).`, '✅');
      return {
        content,
        source: targetUrl,
        tool: 'jina_reader',
        chars: content.length,
      };
    }

    await emitActivity(`Jina Reader struggled with ${targetUrl}; trying Cloudflare scrape fallback...`, '⚠️');

    const cfHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const gatewayToken =
      ((context.env as unknown as Record<string, unknown>).CF_AIG_TOKEN as string | undefined)
      || ((context.env as unknown as Record<string, unknown>).AI_GATEWAY_TOKEN as string | undefined)
      || ((context.env as unknown as Record<string, unknown>).CLOUDFLARE_AI_GATEWAY_TOKEN as string | undefined)
      || '';
    if (gatewayToken) {
      cfHeaders.Authorization = `Bearer ${gatewayToken}`;
      cfHeaders['cf-aig-authorization'] = `Bearer ${gatewayToken}`;
    }

    const payloadCandidates: unknown[] = [
      { url: targetUrl, format: 'markdown' },
      { source: targetUrl, format: 'markdown' },
      { input: { url: targetUrl }, format: 'markdown' },
      { urls: [targetUrl], format: 'markdown' },
    ];

    const fallbackErrors: string[] = [];
    for (const payload of payloadCandidates) {
      const cfAttempt = await fetchText(context, CF_SCRAPE_ENDPOINT, {
        method: 'POST',
        headers: cfHeaders,
        body: JSON.stringify(payload),
      });

      if (!cfAttempt.ok) {
        fallbackErrors.push(cfAttempt.error || `Cloudflare scrape status ${cfAttempt.status}`);
        continue;
      }

      let parsed: unknown = null;
      try {
        parsed = JSON.parse(cfAttempt.text);
      } catch {
        parsed = cfAttempt.text;
      }

      const content = extractContentFromUnknown(parsed);
      if (content) {
        await emitActivity(`Fetched docs via Cloudflare scrape (${content.length.toLocaleString()} chars).`, '✅');
        return {
          content,
          source: targetUrl,
          tool: 'cf_scrape',
          chars: content.length,
        };
      }
    }

    const fallbackErrorMessage = [
      jinaAttempt.error || 'Jina Reader returned no content.',
      ...fallbackErrors,
    ].filter(Boolean).join(' | ');

    await emitActivity(`Documentation fetch failed for ${targetUrl}. Continuing with partial research.`, '⚠️');
    return {
      content: '',
      source: targetUrl,
      tool: 'failed',
      chars: 0,
      error: fallbackErrorMessage || 'Failed to fetch document.',
    };
  };

  const searchWeb = async (query: string, maxResults = 4): Promise<ResearchResult[]> => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [{
        content: '',
        source: '',
        tool: 'failed',
        chars: 0,
        error: 'Missing query.',
      }];
    }

    await emitActivity(`Searching the web with Jina Search for "${normalizedQuery}"...`, '🔎');
    const searchUrl = `https://s.jina.ai/${encodeURIComponent(normalizedQuery)}`;
    const searchAttempt = await fetchText(context, searchUrl);
    if (!searchAttempt.ok) {
      const errorMessage = searchAttempt.error || `Jina Search failed with status ${searchAttempt.status}`;
      await emitActivity(`Jina Search failed for "${normalizedQuery}".`, '⚠️');
      return [{
        content: '',
        source: searchUrl,
        tool: 'failed',
        chars: 0,
        error: errorMessage,
      }];
    }

    const parsed = parseJinaSearchResults(searchAttempt.text, Math.max(1, maxResults));
    const normalized = parsed
      .map((entry) => ({
        ...entry,
        source: entry.source || searchUrl,
      }))
      .slice(0, Math.max(1, maxResults));

    await emitActivity(`Jina Search returned ${normalized.length} result${normalized.length === 1 ? '' : 's'}.`, '✅');
    return normalized;
  };

  const fetchGitHubRepo = async (owner: string, repo: string): Promise<ResearchResult> => {
    const normalizedOwner = owner.trim();
    const normalizedRepo = repo.trim();
    const sourceUrl = `https://github.com/${normalizedOwner}/${normalizedRepo}`;

    if (!normalizedOwner || !normalizedRepo) {
      return {
        content: '',
        source: sourceUrl,
        tool: 'failed',
        chars: 0,
        error: 'Missing owner or repository.',
      };
    }

    await emitActivity(`Fetching repository context for ${normalizedOwner}/${normalizedRepo} via GitMCP...`, '📦');
    const gitMcpUrl = `https://gitmcp.io/${normalizedOwner}/${normalizedRepo}`;
    const gitMcpAttempt = await fetchText(context, gitMcpUrl);
    if (gitMcpAttempt.ok && gitMcpAttempt.text.trim()) {
      const content = gitMcpAttempt.text.trim();
      await emitActivity(`Fetched ${normalizedOwner}/${normalizedRepo} via GitMCP (${content.length.toLocaleString()} chars).`, '✅');
      return {
        content,
        source: gitMcpUrl,
        tool: 'gitmcp',
        chars: content.length,
      };
    }

    await emitActivity(`GitMCP fallback engaged for ${normalizedOwner}/${normalizedRepo}; trying GitHub API flow...`, '⚠️');

    try {
      const githubServer = context.userId
        ? await getActiveMCPServer(context.env, context.userId, 'github')
        : null;
      const githubToken = githubServer?.config.token || undefined;
      const fallback = await fetchAndParse(sourceUrl, {
        githubToken,
        subrequestTracker: context.subrequestTracker,
      });

      if (fallback.kind === 'github_repo') {
        const content = extractGithubContent(fallback);
        await emitActivity(`Fetched ${normalizedOwner}/${normalizedRepo} via GitHub API fallback.`, '✅');
        return {
          content,
          source: sourceUrl,
          tool: 'github_api',
          chars: content.length,
        };
      }

      if (fallback.kind === 'document') {
        const content = fallback.text.trim();
        await emitActivity(`Fetched ${normalizedOwner}/${normalizedRepo} via GitHub API fallback.`, '✅');
        return {
          content,
          source: sourceUrl,
          tool: 'github_api',
          chars: content.length,
        };
      }

      await emitActivity(`Failed to fetch ${normalizedOwner}/${normalizedRepo} from GitMCP/GitHub API.`, '⚠️');
      return {
        content: '',
        source: sourceUrl,
        tool: 'failed',
        chars: 0,
        error: fallback.message || gitMcpAttempt.error || 'Failed to fetch GitHub repository.',
      };
    } catch (error) {
      await emitActivity(`Failed to fetch ${normalizedOwner}/${normalizedRepo} from GitMCP/GitHub API.`, '⚠️');
      return {
        content: '',
        source: sourceUrl,
        tool: 'failed',
        chars: 0,
        error: error instanceof Error ? error.message : 'Failed to fetch GitHub repository.',
      };
    }
  };

  const fetchMultiple = async (
    urls: string[],
    options: { maxConcurrent?: number } = {},
  ): Promise<ResearchResult[]> => {
    const targets = urls.map((url) => url.trim()).filter(Boolean);
    if (targets.length === 0) {
      return [];
    }

    const maxConcurrent = Math.max(1, Math.min(options.maxConcurrent || 1, 8));
    await emitActivity(`Fetching ${targets.length} documentation source${targets.length === 1 ? '' : 's'}...`, '📚');
    const results = await fetchSequentially(
      targets.map((target) => () => fetchDoc(target)),
      maxConcurrent,
    );
    await emitActivity(`Finished multi-fetch pass across ${targets.length} source${targets.length === 1 ? '' : 's'}.`, '✅');
    return results;
  };

  return {
    fetchDoc,
    searchWeb,
    fetchGitHubRepo,
    fetchMultiple,
  };
}
