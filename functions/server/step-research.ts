import {
  fetchUrl,
  getLibraryDocs,
  getLibraryIssues,
  searchWeb,
  type Env as ToolEnv,
  type GithubIssue,
  type SearchResult,
} from '../../workers/tools';
import type { Batch2FetchAndRead, Batch3Architect } from './generation-schemas';
import { getConnectedResearchTools } from './mcp-servers';
import { selectManifestToolsForStep, type ResearchManifest } from './research-manifest';
import type { Bindings, GenerationBatchName } from './types';
import { persistInvariantViolation } from './generation-runtime';
import { 
  fetchLibraryDocs, 
  fetchMultipleDocuments as facadeFetchMultiple,
  analyzeGitHubRepo as facadeAnalyzeGitHubRepo,
  searchWeb as facadeSearchWeb,
  type ResearchContext,
  type SubrequestTracker
} from './research-facade';
import type { WebSearchResponse, DocumentFetchResponse, GitHubAnalysisResponse } from './research-facade';
import { buildResearchQuery, type ResearchQueryFamily } from './research-query-policy';

type ConnectedResearchTools = Awaited<ReturnType<typeof getConnectedResearchTools>>;

type RelevantLibrary = {
  technology: string;
  packageName: string;
  reason: string;
  docsUrl: string | null;
  repo: { owner: string; repo: string } | null;
  research: Batch2FetchAndRead['research'][number] | null;
  score: number;
};

type StepResearchKind = 'general' | 'auth' | 'database' | 'deployment' | 'payment';

export type StepResearchContext = {
  stepId: string;
  stepTitle: string;
  stepKind: StepResearchKind;
  relevantLibraries: RelevantLibrary[];
  docs: Array<{
    library: string;
    source: string;
    version: string;
    url: string;
    content: string;
  }>;
  issues: Array<{
    library: string;
    title: string;
    url: string;
    body: string;
    createdAt: string;
  }>;
  community: Array<{
    library: string;
    title: string;
    url: string;
    summary: string;
  }>;
  toolsUsed: string[];
  requirements: string[];
  footer: string;
  footerMeta: StepResearchFooterMeta;
};

export type StepResearchFooterMeta = {
  researched_at: string;
  tools: string[];
  // B3: Quality metadata for transparency
  quality: 'live' | 'cached' | 'degraded' | 'none';
  live_source_count: number;
  cached_source_count: number;
  degraded_sources?: string[];
};

type CollectStepResearchArgs = {
  env: Bindings;
  userId: string;
  stepId: string;
  stepTitle: string;
  stepObjective: string;
  stepWhyItMatters?: string;
  stepCategory?: string;
  stepDoneWhen?: string;
  stepIsGate?: boolean;
  adr: Batch3Architect;
  research: Batch2FetchAndRead;
  batchName?: GenerationBatchName;
  projectId?: string;
  runId?: string;
  connectedTools?: ConnectedResearchTools;
  researchManifest?: ResearchManifest;
  additionalResearch?: Batch2FetchAndRead['research'];
  subrequestTracker?: SubrequestTracker;
};

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'app',
  'build',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'set',
  'setup',
  'the',
  'to',
  'up',
  'with',
  'your',
]);

function createToolEnv(
  env: Bindings,
  batchName?: GenerationBatchName,
  projectId?: string,
  runId?: string,
): ToolEnv {
  if (!batchName || !projectId) {
    return env;
  }

  return {
    ...env,
    TOOL_CONTEXT: {
      projectId,
      batchName,
      runId,
    },
  };
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase();
}

function buildKeywordList(...values: Array<string | null | undefined>) {
  const keywords = new Set<string>();

  values.forEach((value) => {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) {
      return;
    }

    normalized
      .split(/[^a-z0-9@/._-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 1)
      .forEach((token) => {
        const cleaned = token.replace(/^@/, '');
        if (cleaned.length > 1 && !STOP_WORDS.has(cleaned)) {
          keywords.add(cleaned);
        }

        cleaned
          .split(/[/.:_-]+/)
          .map((part) => part.trim())
          .filter((part) => part.length > 1 && !STOP_WORDS.has(part))
          .forEach((part) => keywords.add(part));
      });
  });

  return Array.from(keywords);
}

function extractGithubRepoFromUrl(url: string | null | undefined) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes('github.com')) {
      return null;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return null;
    }

    return {
      owner: segments[0],
      repo: segments[1].replace(/\.git$/i, ''),
    };
  } catch {
    return null;
  }
}

function getDocsUrlFromResearch(item: Batch2FetchAndRead['research'][number] | null) {
  if (!item) {
    return null;
  }

  const docsSource = item.sources.find((source) => {
    const title = source.title.toLowerCase();
    return (
      !source.url.toLowerCase().includes('github.com') &&
      (title.includes('docs') || title.includes('live docs') || source.tool === 'Context7')
    );
  });

  return docsSource?.url || null;
}

function matchCount(tokens: string[], text: string) {
  const haystack = text.toLowerCase();
  return tokens.reduce((count, token) => (haystack.includes(token) ? count + 1 : count), 0);
}

function inferRelevantLibraries(
  stepTitle: string,
  stepObjective: string,
  adr: Batch3Architect,
  researchEntries: Batch2FetchAndRead['research'],
) {
  const stepText = `${stepTitle}\n${stepObjective}`.toLowerCase();
  const candidates = new Map<string, RelevantLibrary>();

  const researchIndex = new Map(
    researchEntries.map((item) => [normalizeToken(item.technology), item] as const),
  );

  for (const integration of adr.integrations) {
    const tokens = buildKeywordList(integration.service, integration.package_name, integration.purpose);
    const score = matchCount(tokens, stepText);
    const researchItem =
      researchIndex.get(normalizeToken(integration.service)) ||
      researchEntries.find((item) =>
        buildKeywordList(item.technology).some((token) => tokens.includes(token)),
      ) ||
      null;
    const repo =
      researchItem?.sources
        .map((source) => extractGithubRepoFromUrl(source.url))
        .find((entry): entry is { owner: string; repo: string } => Boolean(entry)) || null;
    const key = normalizeToken(`${integration.service}:${integration.package_name}`);

    candidates.set(key, {
      technology: integration.service,
      packageName: integration.package_name,
      reason: integration.purpose,
      docsUrl: getDocsUrlFromResearch(researchItem),
      repo,
      research: researchItem,
      score,
    });
  }

  for (const researchItem of researchEntries) {
    const tokens = buildKeywordList(
      researchItem.technology,
      ...researchItem.sources.map((source) => source.title || source.url),
    );
    const score = matchCount(tokens, stepText);
    const repo =
      researchItem.sources
        .map((source) => extractGithubRepoFromUrl(source.url))
        .find((entry): entry is { owner: string; repo: string } => Boolean(entry)) || null;
    const key = normalizeToken(researchItem.technology);

    if (!candidates.has(key)) {
      candidates.set(key, {
        technology: researchItem.technology,
        packageName: researchItem.technology,
        reason: 'Referenced in the project research corpus.',
        docsUrl: getDocsUrlFromResearch(researchItem),
        repo,
        research: researchItem,
        score,
      });
    } else {
      const existing = candidates.get(key);
      if (existing && score > existing.score) {
        existing.score = score;
      }
    }
  }

  if (candidates.size === 0) {
    return researchEntries.slice(0, 2).map((item) => ({
      technology: item.technology,
      packageName: item.technology,
      reason: 'Referenced in the project research corpus.',
      docsUrl: getDocsUrlFromResearch(item),
      repo:
        item.sources
          .map((source) => extractGithubRepoFromUrl(source.url))
          .find((entry): entry is { owner: string; repo: string } => Boolean(entry)) || null,
      research: item,
      score: 0,
    }));
  }

  const sorted = Array.from(candidates.values())
    .sort((left, right) => right.score - left.score)
    .filter((candidate, index) => candidate.score > 0 || index < 2);

  return sorted.slice(0, 2);
}

function detectStepResearchKind(args: {
  stepTitle: string;
  stepObjective: string;
  stepWhyItMatters?: string;
  stepCategory?: string;
  stepDoneWhen?: string;
  stepIsGate?: boolean;
}): StepResearchKind {
  const haystack = [
    args.stepTitle,
    args.stepObjective,
    args.stepWhyItMatters,
    args.stepCategory,
    args.stepDoneWhen,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    haystack.includes('payment') ||
    haystack.includes('billing') ||
    haystack.includes('stripe') ||
    haystack.includes('checkout') ||
    haystack.includes('webhook')
  ) {
    return 'payment';
  }

  if (
    haystack.includes('auth') ||
    haystack.includes('authentication') ||
    haystack.includes('session') ||
    haystack.includes('secure') ||
    (args.stepIsGate && haystack.includes('security'))
  ) {
    return 'auth';
  }

  if (
    haystack.includes('database') ||
    haystack.includes('schema') ||
    haystack.includes('model') ||
    haystack.includes('migration') ||
    haystack.includes('relationship')
  ) {
    return 'database';
  }

  if (
    haystack.includes('deploy') ||
    haystack.includes('launch') ||
    haystack.includes('production') ||
    haystack.includes('hosting')
  ) {
    return 'deployment';
  }

  return 'general';
}

function mergeResearchEntries(
  primary: Batch2FetchAndRead['research'],
  additional: Batch2FetchAndRead['research'],
) {
  const merged = new Map<string, Batch2FetchAndRead['research'][number]>();

  [...primary, ...additional].forEach((entry) => {
    merged.set(normalizeToken(entry.technology), entry);
  });

  return Array.from(merged.values());
}

function summarizeText(value: string, maxLength = 280) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function trimLongText(value: string, maxLength: number) {
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function findExistingDocsSource(researchItem: Batch2FetchAndRead['research'][number] | null) {
  if (!researchItem) {
    return null;
  }

  return researchItem.sources.find((source) => {
    const title = source.title.toLowerCase();
    return (
      source.tool === 'Context7'
      || (!source.url.toLowerCase().includes('github.com')
        && (title.includes('docs') || title.includes('documentation') || title.includes('guide')))
    );
  }) || null;
}

function appendExistingResearchContext(args: {
  library: RelevantLibrary;
  docsLibraryName: string;
  docs: StepResearchContext['docs'];
  community: StepResearchContext['community'];
  toolsUsed: Set<string>;
}) {
  const researchItem = args.library.research;
  if (!researchItem) {
    return;
  }

  const docsContent = researchItem.docs_content.trim();
  const docsSource = findExistingDocsSource(researchItem);
  if (docsContent) {
    args.docs.push({
      library: args.docsLibraryName,
      source: docsSource?.tool === 'Context7' ? 'Context7' : 'Docs',
      version: researchItem.latest_version || 'unknown',
      url: docsSource?.url || args.library.docsUrl || '',
      content: trimLongText(docsContent, 3200),
    });
    args.toolsUsed.add(docsSource?.tool === 'Context7' ? 'Context7' : 'Live docs');
  }

  const communitySources = researchItem.sources
    .filter((source) => source.tool === 'Brave Search' && source.summary.trim().length > 0)
    .slice(0, 2);

  communitySources.forEach((source) => {
    args.community.push({
      library: args.library.packageName,
      title: source.title,
      url: source.url,
      summary: trimLongText(source.summary, 280),
    });
  });

  if (communitySources.length > 0) {
    args.toolsUsed.add('Brave Search');
  }
}

function filterIssuesByStepKeywords(
  issues: GithubIssue[],
  stepTitle: string,
  stepObjective: string,
) {
  const keywords = buildKeywordList(stepTitle, stepObjective);

  return issues.filter((issue) => {
    const title = issue.title.toLowerCase();
    return keywords.some((keyword) => title.includes(keyword));
  });
}

function buildFooter(dateLabel: string, toolsUsed: string[], connectedTools: ConnectedResearchTools, quality: StepResearchFooterMeta['quality']) {
  const qualityLabel = quality === 'live' 
    ? '' 
    : quality === 'cached' 
      ? ' (using cached research)' 
      : quality === 'degraded' 
        ? ' (some sources unavailable)' 
        : ' (limited research)';
  
  if (connectedTools.has_brave_search && connectedTools.has_context7 && toolsUsed.length > 0) {
    return `Researched ${dateLabel} using ${toolsUsed.join(', ')}${qualityLabel}`;
  }

  return `Researched ${dateLabel} using the default research stack${qualityLabel}`;
}

type FooterMetaInput = {
  dateLabel: string;
  toolsUsed: string[];
  liveSourceCount: number;
  cachedSourceCount: number;
  degradedSources?: string[];
};

function buildFooterMeta(input: FooterMetaInput): StepResearchFooterMeta {
  const { dateLabel, toolsUsed, liveSourceCount, cachedSourceCount, degradedSources } = input;
  
  // B3: Determine quality based on source distribution
  let quality: StepResearchFooterMeta['quality'];
  const totalSources = liveSourceCount + cachedSourceCount;
  
  if (totalSources === 0) {
    quality = 'none';
  } else if ((degradedSources?.length ?? 0) > 0) {
    quality = 'degraded';
  } else if (cachedSourceCount > liveSourceCount) {
    quality = 'cached';
  } else {
    quality = 'live';
  }
  
  return {
    researched_at: dateLabel,
    tools: toolsUsed.length > 0 ? toolsUsed : ['default research stack'],
    quality,
    live_source_count: liveSourceCount,
    cached_source_count: cachedSourceCount,
    degraded_sources: degradedSources?.length ? degradedSources : undefined,
  };
}

function getStepKindRequirements(stepKind: StepResearchKind, frameworkLabel: string) {
  switch (stepKind) {
    case 'auth':
      return [
        'Include a security checklist derived from the live docs.',
        'Call out any vulnerabilities or security caveats found in the latest research and explain the workaround.',
        'Name the exact environment variables required for the auth setup.',
      ];
    case 'database':
      return [
        'Include a starter schema as a fenced code block using the actual syntax of the chosen ORM or database layer.',
        'Use Drizzle schema syntax for Drizzle, Prisma schema syntax for Prisma, or raw SQL when the stack uses D1/direct SQL.',
        'Explain how migrations and relationships should be handled in this step.',
      ];
    case 'deployment':
      return [
        'Include a deployment checklist with the actual CLI commands, environment variable names, and config file examples.',
        'Mention any current platform issues or CLI caveats that could block production deploys.',
      ];
    case 'payment':
      return [
        'Include the webhook handler pattern, required environment variables, and a test-mode vs live-mode checklist.',
        'Call out the most common integration mistakes to avoid.',
        `Tailor the webhook verification guidance to ${frameworkLabel}.`,
      ];
    default:
      return [];
  }
}

function getFrameworkLabel(adr: Batch3Architect) {
  return [adr.recommended_stack.frontend, adr.recommended_stack.backend]
    .filter(Boolean)
    .join(' + ');
}

function getPrimaryDocsTopic(stepKind: StepResearchKind, stepTitle: string) {
  switch (stepKind) {
    case 'auth':
      return `${stepTitle} security best practices`;
    case 'database':
      return `${stepTitle} schema migrations`;
    case 'deployment':
      return `${stepTitle} deployment`;
    case 'payment':
      return `${stepTitle} checkout webhook verification`;
    default:
      return stepTitle;
  }
}

function getPrimarySearchQuery(args: {
  stepKind: StepResearchKind;
  packageName: string;
  docsTopic: string;
}) {
  const packageName = normalizeToken(args.packageName).replace(/[^a-z0-9@.+#\-/]/g, '');
  const queryFamilyByStepKind: Record<StepResearchKind, ResearchQueryFamily> = {
    auth: 'errors',
    database: 'release_notes',
    deployment: 'deployment',
    payment: 'errors',
    general: 'setup',
  };
  const technology = args.stepKind === 'payment' ? 'stripe' : packageName;
  return buildResearchQuery({
    technology,
    family: queryFamilyByStepKind[args.stepKind],
    intent: args.docsTopic,
  });
}

function prioritizeLibrariesForStepKind(stepKind: StepResearchKind, libraries: RelevantLibrary[]) {
  const priorityTokens: Record<Exclude<StepResearchKind, 'general'>, string[]> = {
    auth: ['auth', 'authentication', 'session', 'clerk', 'supabase', 'auth0', 'lucia'],
    database: ['database', 'schema', 'migration', 'drizzle', 'prisma', 'postgres', 'mysql', 'd1'],
    deployment: ['deploy', 'deployment', 'vercel', 'railway', 'cloudflare', 'netlify'],
    payment: ['payment', 'billing', 'checkout', 'stripe', 'webhook'],
  };

  if (stepKind === 'general') {
    return libraries;
  }

  return [...libraries]
    .sort((left, right) => {
      const leftText = `${left.technology} ${left.packageName} ${left.reason}`.toLowerCase();
      const rightText = `${right.technology} ${right.packageName} ${right.reason}`.toLowerCase();
      const leftScore = priorityTokens[stepKind].reduce(
        (score, token) => (leftText.includes(token) ? score + 1 : score),
        0,
      );
      const rightScore = priorityTokens[stepKind].reduce(
        (score, token) => (rightText.includes(token) ? score + 1 : score),
        0,
      );

      return rightScore - leftScore;
    })
    .slice(0, 2);
}

export async function collectStepResearchContext({
  env,
  userId,
  stepId,
  stepTitle,
  stepObjective,
  stepWhyItMatters,
  stepCategory,
  stepDoneWhen,
  stepIsGate,
  adr,
  research,
  batchName,
  projectId,
  runId,
  connectedTools,
  researchManifest,
  additionalResearch = [],
  subrequestTracker,
}: CollectStepResearchArgs): Promise<StepResearchContext> {
  const startedAt = Date.now();
  const toolEnv = createToolEnv(env, batchName, projectId, runId);
  const resolvedConnectedTools = connectedTools || (await getConnectedResearchTools(env, userId));
  const mergedResearchEntries = mergeResearchEntries(research.research, additionalResearch);
  const stepKind = detectStepResearchKind({
    stepTitle,
    stepObjective,
    stepWhyItMatters,
    stepCategory,
    stepDoneWhen,
    stepIsGate,
  });
  const relevantLibraries = prioritizeLibrariesForStepKind(
    stepKind,
    inferRelevantLibraries(stepTitle, stepObjective, adr, mergedResearchEntries),
  ).slice(0, stepKind !== 'general' || Boolean(stepIsGate) ? 2 : 1);
  const docs: StepResearchContext['docs'] = [];
  const issues: StepResearchContext['issues'] = [];
  const community: StepResearchContext['community'] = [];
  const toolsUsed = new Set<string>();
  const dateLabel = new Date().toISOString().slice(0, 10);
  const frameworkLabel = getFrameworkLabel(adr);
  const requirements = getStepKindRequirements(stepKind, frameworkLabel);
  
  // B3: Default to live research for ALL steps, not just specialized ones
  // This ensures user-visible steps are backed by current evidence
  const shouldUseLiveResearch = true;
  
  // B3: Track source quality for transparency
  let liveSourceCount = 0;
  let cachedSourceCount = 0;
  const degradedSources: string[] = [];
  
  const manifestTools = researchManifest
    ? selectManifestToolsForStep(researchManifest, {
        stepKind,
        stepCategory,
        stepTitle,
        stepObjective,
      })
    : [];
  const seenManifestDocUrls = new Set<string>();

  for (const manifestTool of manifestTools) {
    const docsUrl = (manifestTool.docsUrl || '').trim();
    if (!docsUrl || seenManifestDocUrls.has(docsUrl.toLowerCase())) {
      continue;
    }

    seenManifestDocUrls.add(docsUrl.toLowerCase());
    const context: ResearchContext = { env, userId, projectId, batchName, runId, subrequestTracker };
    const [facadeDoc] = await facadeFetchMultiple(context, [docsUrl]);
    
    if (!facadeDoc || !facadeDoc.content) {
      // B3: Track failed fetches as degraded
      degradedSources.push(`${manifestTool.name} docs`);
      continue;
    }

    docs.push({
      library: manifestTool.name,
      source: facadeDoc.metadata.tool === 'cf_scrape' ? 'Cloudflare Scrape' : 'Jina Reader',
      version: 'unknown',
      url: docsUrl,
      content: trimLongText(facadeDoc.content, 3200),
    });
    toolsUsed.add(facadeDoc.metadata.tool === 'cf_scrape' ? 'Cloudflare Scrape' : 'Jina Reader');
    liveSourceCount++; // B3: Track live source
  }

  for (const library of relevantLibraries) {
    const docsLibraryName =
      stepKind === 'payment' && !library.packageName.toLowerCase().includes('stripe')
        ? 'stripe'
        : library.packageName;

    // B3: shouldUseLiveResearch is now always true, but keep fallback path for future configurability
    if (!shouldUseLiveResearch) {
      appendExistingResearchContext({
        library,
        docsLibraryName,
        docs,
        community,
        toolsUsed,
      });
      cachedSourceCount++; // B3: Track cached source
      continue;
    }

    const docsTopic = getPrimaryDocsTopic(stepKind, stepTitle);
    
    // Phase 2: Facade is now primary
    const facadeContext = { env, userId, projectId, batchName };
    const facadeResult = await fetchLibraryDocs(
      facadeContext as any, 
      docsLibraryName, 
      docsTopic, 
      library.docsUrl || undefined
    );
    
    if (facadeResult.content) {
      docs.push({
        library: docsLibraryName,
        source: facadeResult.source,
        version: facadeResult.version || 'unknown',
        url: facadeResult.source.startsWith('http') ? facadeResult.source : (library.docsUrl || ''),
        content: trimLongText(facadeResult.content, 3200),
      });
      toolsUsed.add(facadeResult.source === 'Context7' ? 'Context7' : 'Live docs');
      liveSourceCount++;
    } else {
      degradedSources.push(`${docsLibraryName} docs (facade)`);
    }

    // GitHub and Search via Facade
    const researchContext: ResearchContext = { env, userId, projectId, batchName, runId, subrequestTracker };
    
    let facadeGitHub: GitHubAnalysisResponse | null = null;
    if (library.repo) {
      facadeGitHub = await facadeAnalyzeGitHubRepo(researchContext, library.repo.owner, library.repo.repo);
    }

    const searchQuery = resolvedConnectedTools.has_brave_search
      ? getPrimarySearchQuery({
          stepKind,
          packageName: library.packageName,
          docsTopic,
        })
      : '';

    let facadeSearch: WebSearchResponse | null = null;
    if (searchQuery) {
      facadeSearch = await facadeSearchWeb(researchContext, searchQuery, 3);
    }

    if (facadeGitHub && facadeGitHub.metadata.quality !== 'failed') {
      const filteredIssues = stepKind === 'deployment'
        ? facadeGitHub.recentIssues.slice(0, 3)
        : filterIssuesByStepKeywords(
            facadeGitHub.recentIssues.map(i => ({ ...i, id: 0, labels: [], state: 'open' as any })),
            stepTitle, 
            stepObjective
          ).slice(0, 3);

      filteredIssues.forEach((issue) => {
        issues.push({
          library: library.packageName,
          title: issue.title,
          url: issue.url,
          body: trimLongText(issue.body, 900),
          createdAt: issue.createdAt,
        });
      });
      if (filteredIssues.length > 0) {
        toolsUsed.add('GitHub');
        liveSourceCount++;
      }
    }

    if (facadeSearch && facadeSearch.results.length > 0) {
      const communityPages = facadeSearch.results.slice(0, 3).map((result) => ({
        library: library.packageName,
        title: result.title,
        url: result.url,
        summary: summarizeText(result.description || result.title),
      }));

      communityPages
        .filter((page) => page.summary.length > 0)
        .forEach((page) => {
          community.push(page);
        });

      if (communityPages.length > 0) {
        toolsUsed.add(facadeSearch.metadata.tool === 'brave_search' ? 'Brave Search' : 'Jina Search');
        liveSourceCount++;
      }
    }
  }

  const orderedTools = Array.from(toolsUsed);
  
  // B3: Build footer with quality metadata
  const footerMeta = buildFooterMeta({
    dateLabel,
    toolsUsed: orderedTools,
    liveSourceCount,
    cachedSourceCount,
    degradedSources: degradedSources.length > 0 ? degradedSources : undefined,
  });

  return {
    stepId,
    stepTitle,
    stepKind,
    relevantLibraries,
    docs,
    issues,
    community,
    toolsUsed: orderedTools,
    requirements,
    footer: buildFooter(dateLabel, orderedTools, resolvedConnectedTools, footerMeta.quality),
    footerMeta,
  };
}

export function formatStepResearchPrompt(context: StepResearchContext) {
  return JSON.stringify(
    {
      step_id: context.stepId,
      step_title: context.stepTitle,
      step_kind: context.stepKind,
      relevant_libraries: context.relevantLibraries.map((library) => ({
        technology: library.technology,
        package_name: library.packageName,
        reason: library.reason,
      })),
      docs: context.docs.map((doc) => ({
        library: doc.library,
        source: doc.source,
        version: doc.version,
        url: doc.url,
        content: doc.content,
      })),
      issues: context.issues,
      community: context.community,
      requirements: context.requirements,
      footer: context.footer,
      footer_meta: context.footerMeta,
    },
    null,
    2,
  );
}

