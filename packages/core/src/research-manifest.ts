import { normalizeBuilderProfileName, type BuilderProfileCategory } from './builder-profile';
import { resolveToolDocsEntry } from './research';
import type { DeclaredResearchTool } from './user-tools';
import {
  buildCanonicalRetrievalInput,
  buildResearchQuery,
  type RetrievalInputSource,
  type ResearchQueryFamily,
} from './research-query-policy';

export type ResearchManifestPriority = 'high' | 'medium' | 'low';

export type ResearchManifestTool = {
  name: string;
  category: BuilderProfileCategory;
  docsUrl: string;
  githubRepo?: string;
  searchQuery: string;
  priority: ResearchManifestPriority;
  docsTopic: string;
  source: RetrievalInputSource;
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

type BuildResearchManifestOptions = {
  confirmedStackTools?: string[];
  inferredTechnologies?: string[];
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

function rankPriority(args: {
  source: RetrievalInputSource;
  name: string;
  category: BuilderProfileCategory;
  projectDescription: string;
}): ResearchManifestPriority {
  if (args.source === 'inferred') {
    return isToolExplicitlyMentioned(args.name, args.projectDescription) ? 'medium' : 'low';
  }

  if (args.source === 'project_stack') {
    return 'high';
  }

  if (isToolExplicitlyMentioned(args.name, args.projectDescription)) {
    return 'high';
  }

  if (isCategoryRelevant(args.category, args.projectDescription)) {
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

function sourceSortValue(source: RetrievalInputSource) {
  switch (source) {
    case 'builder_profile':
      return 0;
    case 'project_stack':
      return 1;
    case 'inferred':
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
    const existingSourceScore = sourceSortValue(existing.source);
    const incomingSourceScore = sourceSortValue(tool.source);
    const useIncoming =
      incomingPriority < existingPriority
      || (incomingPriority === existingPriority && incomingSourceScore < existingSourceScore);

    const preferred = useIncoming ? tool : existing;
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

    const sourceDiff = sourceSortValue(left.source) - sourceSortValue(right.source);
    if (sourceDiff !== 0) {
      return sourceDiff;
    }

    return left.name.localeCompare(right.name);
  });
}

function inferCategoryFromTechnology(technology: string): BuilderProfileCategory {
  const normalized = normalizeBuilderProfileName(technology);

  if (/\b(auth|oauth|session|clerk|lucia|auth0|firebase auth|supabase auth)\b/.test(normalized)) {
    return 'auth';
  }

  if (/\b(database|db|postgres|mysql|sqlite|d1|drizzle|prisma|supabase)\b/.test(normalized)) {
    return 'database';
  }

  if (/\b(payment|billing|checkout|invoice|subscription|stripe|lemonsqueezy)\b/.test(normalized)) {
    return 'payments';
  }

  if (/\b(deploy|hosting|cloudflare|vercel|railway|netlify|worker|api|backend|server)\b/.test(normalized)) {
    return 'backend_hosting';
  }

  if (/\b(react|next|vue|svelte|frontend|ui|tailwind)\b/.test(normalized)) {
    return 'frontend';
  }

  return 'other_subscriptions';
}

function queryFamilyForCategory(category: BuilderProfileCategory): ResearchQueryFamily {
  switch (category) {
    case 'backend_hosting':
      return 'deployment';
    case 'auth':
      return 'errors';
    case 'database':
    case 'payments':
      return 'release_notes';
    case 'frontend':
    case 'coding_environment':
    case 'ai_assistants':
    case 'other_subscriptions':
    default:
      return 'setup';
  }
}

export function buildResearchManifest(
  workspaceProfile: WorkspaceProfile,
  projectDescription: string,
  options: BuildResearchManifestOptions = {},
): ResearchManifest {
  const { normalized } = buildProjectDescriptionTokens(projectDescription);

  const profileToolByName = new Map(
    workspaceProfile.declaredTools.map((tool) => [normalizeBuilderProfileName(tool.name), tool] as const),
  );

  const retrievalInput = buildCanonicalRetrievalInput({
    builderProfileTools: workspaceProfile.declaredTools,
    confirmedStackTools: options.confirmedStackTools || [],
    inferredTechnologies: options.inferredTechnologies || [],
  });

  const tools = dedupeManifestTools(
    retrievalInput.targets.map((target) => {
      const normalizedName = normalizeBuilderProfileName(target.technology);
      const profileTool = profileToolByName.get(normalizedName);
      const mapped = resolveToolDocsEntry(target.technology);
      const category = profileTool?.category || inferCategoryFromTechnology(target.technology);
      const docsUrl = target.docsUrl || profileTool?.docs_url || mapped?.docs || '';
      const githubRepo = parseGithubRepo(target.githubRepo || profileTool?.github_url) || mapped?.github || '';
      const docsTopic =
        target.docsTopic
        || profileTool?.docs_topic
        || 'installation, migration, compatibility, breaking changes, best practices';
      const priority = rankPriority({
        source: target.source,
        name: target.technology,
        category,
        projectDescription: normalized,
      });
      const searchFamily = queryFamilyForCategory(category);

      return {
        name: target.technology,
        category,
        docsUrl,
        githubRepo: githubRepo || undefined,
        searchQuery: buildResearchQuery({
          technology: target.technology,
          family: searchFamily,
          intent: docsTopic,
        }),
        priority,
        docsTopic,
        source: target.source,
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
      const sourceScore = tool.source === 'builder_profile' ? 3 : tool.source === 'project_stack' ? 2 : 1;
      return {
        tool,
        score: categoryScore + matchScore + priorityScore + sourceScore,
      };
    })
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.tool)
    .filter((tool) => Boolean(tool.docsUrl))
    .slice(0, 3);
}
