import { normalizeBuilderProfileName, type BuilderProfileCategory } from '../../src/lib/builder-profile';
import { resolveToolDocsEntry } from './research';
import type { DeclaredResearchTool } from './user-tools';

export type ResearchManifestPriority = 'high' | 'medium' | 'low';

export type ResearchManifestTool = {
  name: string;
  category: BuilderProfileCategory;
  docsUrl: string;
  githubRepo?: string;
  searchQuery: string;
  priority: ResearchManifestPriority;
  docsTopic: string;
};

export type ResearchManifest = {
  tools: ResearchManifestTool[];
  searchQueries: string[];
};

type WorkspaceProfile = {
  declaredTools: Array<
    Pick<
      DeclaredResearchTool,
      'name' | 'category' | 'docs_url' | 'github_url' | 'docs_topic'
    >
  >;
};

const CATEGORY_PRIORITY_KEYWORDS: Record<BuilderProfileCategory, string[]> = {
  coding_environment: ['editor', 'ide', 'codebase', 'repository', 'source code'],
  ai_assistants: ['ai', 'agent', 'copilot', 'assistant', 'prompt'],
  frontend: ['ui', 'frontend', 'landing', 'dashboard', 'web app', 'component'],
  backend_hosting: ['api', 'backend', 'server', 'worker', 'deploy', 'hosting'],
  database: ['database', 'schema', 'table', 'query', 'storage', 'data'],
  auth: ['auth', 'login', 'sign in', 'session', 'account', 'permission', 'oauth'],
  payments: ['payment', 'billing', 'checkout', 'subscription', 'invoice', 'pricing'],
  other_subscriptions: ['integration', 'automation', 'analytics', 'support'],
};

const STEP_KIND_TO_CATEGORY_PRIORITY: Record<
  'general' | 'auth' | 'database' | 'deployment' | 'payment',
  BuilderProfileCategory[]
> = {
  general: ['frontend', 'backend_hosting', 'database', 'auth', 'payments'],
  auth: ['auth', 'backend_hosting', 'database'],
  database: ['database', 'backend_hosting'],
  deployment: ['backend_hosting', 'database', 'frontend'],
  payment: ['payments', 'backend_hosting', 'auth'],
};

function parseGithubRepo(value: string | null | undefined) {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return '';
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

function buildProjectDescriptionTokens(projectDescription: string) {
  const normalized = projectDescription.toLowerCase();
  const compact = normalizeBuilderProfileName(projectDescription);
  return { normalized, compact };
}

function isToolExplicitlyMentioned(toolName: string, projectDescription: string) {
  const normalizedTool = normalizeBuilderProfileName(toolName);
  if (!normalizedTool) {
    return false;
  }

  const compactDescription = normalizeBuilderProfileName(projectDescription);
  return compactDescription.includes(normalizedTool);
}

function isCategoryRelevant(category: BuilderProfileCategory, projectDescription: string) {
  const haystack = projectDescription.toLowerCase();
  const keywords = CATEGORY_PRIORITY_KEYWORDS[category] || [];
  if (keywords.some((keyword) => haystack.includes(keyword))) {
    return true;
  }

  // Most projects need these layers even when the builder does not mention them explicitly.
  if (category === 'frontend' || category === 'backend_hosting' || category === 'database') {
    return true;
  }

  return false;
}

function rankPriority(
  tool: WorkspaceProfile['declaredTools'][number],
  projectDescription: string,
): ResearchManifestPriority {
  if (isToolExplicitlyMentioned(tool.name, projectDescription)) {
    return 'high';
  }

  if (isCategoryRelevant(tool.category, projectDescription)) {
    return 'high';
  }

  return 'medium';
}

function prioritySortValue(priority: ResearchManifestPriority) {
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

function dedupeManifestTools(tools: ResearchManifestTool[]) {
  const merged = new Map<string, ResearchManifestTool>();

  for (const tool of tools) {
    const key = normalizeBuilderProfileName(tool.name);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, tool);
      continue;
    }

    const existingPriority = prioritySortValue(existing.priority);
    const incomingPriority = prioritySortValue(tool.priority);
    const preferred = incomingPriority < existingPriority ? tool : existing;
    const fallback = preferred === existing ? tool : existing;

    merged.set(key, {
      ...preferred,
      docsUrl: preferred.docsUrl || fallback.docsUrl,
      githubRepo: preferred.githubRepo || fallback.githubRepo,
      searchQuery: preferred.searchQuery || fallback.searchQuery,
      docsTopic: preferred.docsTopic || fallback.docsTopic,
    });
  }

  return Array.from(merged.values()).sort((left, right) => {
    const priorityDiff = prioritySortValue(left.priority) - prioritySortValue(right.priority);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return left.name.localeCompare(right.name);
  });
}

function buildToolSearchQuery(toolName: string) {
  return normalizeBuilderProfileName(toolName)
    .replace(/[^a-z0-9@.+#\-/ ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 5)
    .join(' ')
    .concat(' changelog 2026');
}

export function buildResearchManifest(
  workspaceProfile: WorkspaceProfile,
  projectDescription: string,
): ResearchManifest {
  const { normalized } = buildProjectDescriptionTokens(projectDescription);

  const tools = dedupeManifestTools(
    workspaceProfile.declaredTools.map((tool) => {
      const mapped = resolveToolDocsEntry(tool.name);
      const docsUrl = tool.docs_url || mapped?.docs || '';
      const githubRepo = parseGithubRepo(tool.github_url) || mapped?.github || '';
      const priority = rankPriority(tool, normalized);

      return {
        name: tool.name,
        category: tool.category,
        docsUrl,
        githubRepo: githubRepo || undefined,
        searchQuery: buildToolSearchQuery(tool.name),
        priority,
        docsTopic: tool.docs_topic || 'installation, migration, compatibility, breaking changes, best practices',
      };
    }),
  );

  const searchQueries = Array.from(
    new Set(
      tools
        .filter((tool) => tool.priority !== 'low')
        .map((tool) => tool.searchQuery),
    ),
  );

  return {
    tools,
    searchQueries,
  };
}

type ManifestStepSelectionOptions = {
  stepKind: 'general' | 'auth' | 'database' | 'deployment' | 'payment';
  stepCategory?: string;
  stepTitle?: string;
  stepObjective?: string;
};

function countMatches(text: string, ...candidates: string[]) {
  const haystack = normalizeBuilderProfileName(text);
  return candidates.reduce((score, candidate) => {
    const normalizedCandidate = normalizeBuilderProfileName(candidate);
    if (!normalizedCandidate) {
      return score;
    }

    return haystack.includes(normalizedCandidate) ? score + 1 : score;
  }, 0);
}

export function selectManifestToolsForStep(
  manifest: ResearchManifest,
  options: ManifestStepSelectionOptions,
) {
  const preferredCategories = new Set(STEP_KIND_TO_CATEGORY_PRIORITY[options.stepKind] || []);
  const stepContextText = [options.stepCategory, options.stepTitle, options.stepObjective]
    .filter(Boolean)
    .join(' ');

  return manifest.tools
    .map((tool) => {
      const categoryScore = preferredCategories.has(tool.category) ? 4 : 0;
      const matchScore = countMatches(stepContextText, tool.name, tool.docsTopic);
      const priorityScore = tool.priority === 'high' ? 3 : tool.priority === 'medium' ? 2 : 1;
      return {
        tool,
        score: categoryScore + matchScore + priorityScore,
      };
    })
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.tool)
    .filter((tool) => Boolean(tool.docsUrl))
    .slice(0, 3);
}
