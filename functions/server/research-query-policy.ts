import { normalizeBuilderProfileName } from '../../src/lib/builder-profile';

export type ResearchQueryFamily = 'setup' | 'errors' | 'release_notes' | 'deployment';

export type RetrievalInputSource = 'builder_profile' | 'project_stack' | 'inferred';

export type RetrievalInputTarget = {
  technology: string;
  source: RetrievalInputSource;
  docsTopic?: string;
  docsUrl?: string;
  githubRepo?: string;
};

function truncateQueryWords(query: string, maxWords = 8) {
  return query
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, maxWords)
    .join(' ');
}

function normalizeTechnology(value: string) {
  return normalizeBuilderProfileName(value).replace(/[^a-z0-9@.+#\-/ ]/g, '').trim();
}

export function buildResearchQuery(args: {
  technology: string;
  family: ResearchQueryFamily;
  year?: number;
  intent?: string;
}) {
  const normalizedTechnology = normalizeTechnology(args.technology) || 'technology';
  const year = args.year || new Date().getFullYear();
  const normalizedIntent = truncateQueryWords(args.intent || '', 4);

  switch (args.family) {
    case 'errors':
      return truncateQueryWords(`${normalizedTechnology} errors troubleshooting ${year}`);
    case 'release_notes':
      return truncateQueryWords(`${normalizedTechnology} changelog release notes ${year}`);
    case 'deployment':
      return truncateQueryWords(`${normalizedTechnology} deployment production ${year}`);
    case 'setup':
    default:
      return truncateQueryWords(`${normalizedTechnology} ${normalizedIntent || 'setup getting started'} ${year}`);
  }
}

function normalizeGithubRepo(value: string | undefined) {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return '';
  }

  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname.toLowerCase().includes('github.com')) {
      return '';
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return '';
    }

    return `${segments[0]}/${segments[1].replace(/\.git$/i, '')}`;
  } catch {
    return '';
  }
}

function chooseHighestPrecedenceTarget(
  existing: RetrievalInputTarget,
  incoming: RetrievalInputTarget,
) {
  const rank = (source: RetrievalInputSource) => {
    switch (source) {
      case 'builder_profile':
        return 0;
      case 'project_stack':
        return 1;
      case 'inferred':
      default:
        return 2;
    }
  };

  const useIncomingAsBase = rank(incoming.source) < rank(existing.source);
  const primary = useIncomingAsBase ? incoming : existing;
  const secondary = useIncomingAsBase ? existing : incoming;

  return {
    ...primary,
    docsTopic: primary.docsTopic || secondary.docsTopic,
    docsUrl: primary.docsUrl || secondary.docsUrl,
    githubRepo: primary.githubRepo || secondary.githubRepo,
  } satisfies RetrievalInputTarget;
}

export function buildCanonicalRetrievalInput(args: {
  builderProfileTools: Array<{
    name: string;
    docs_topic?: string;
    docs_url?: string;
    github_url?: string;
  }>;
  confirmedStackTools: string[];
  inferredTechnologies: string[];
}) {
  const merged = new Map<string, RetrievalInputTarget>();

  const addTarget = (target: RetrievalInputTarget) => {
    const normalizedTechnology = normalizeTechnology(target.technology);
    if (!normalizedTechnology) {
      return;
    }

    const normalizedTarget: RetrievalInputTarget = {
      technology: target.technology.trim() || normalizedTechnology,
      source: target.source,
      docsTopic: target.docsTopic?.trim() || undefined,
      docsUrl: target.docsUrl?.trim() || undefined,
      githubRepo: normalizeGithubRepo(target.githubRepo),
    };

    const existing = merged.get(normalizedTechnology);
    if (!existing) {
      merged.set(normalizedTechnology, normalizedTarget);
      return;
    }

    merged.set(
      normalizedTechnology,
      chooseHighestPrecedenceTarget(existing, normalizedTarget),
    );
  };

  for (const tool of args.builderProfileTools) {
    addTarget({
      technology: tool.name,
      source: 'builder_profile',
      docsTopic: tool.docs_topic,
      docsUrl: tool.docs_url,
      githubRepo: tool.github_url,
    });
  }

  for (const technology of args.confirmedStackTools) {
    addTarget({
      technology,
      source: 'project_stack',
    });
  }

  for (const technology of args.inferredTechnologies) {
    addTarget({
      technology,
      source: 'inferred',
    });
  }

  return {
    targets: Array.from(merged.values()),
  };
}
