import { z } from 'zod';
import {
  analyzeGithubRepo,
  getLibraryDocs,
  searchWeb,
  type Env as ToolEnv,
  type GithubRepoAnalysis,
  type SearchResult,
} from '../../workers/tools';
import { callAIText } from './ai';
import {
  Batch2FetchAndReadSchema,
  Batch3ArchitectSchema,
  type Batch2FetchAndRead,
  type Batch3Architect,
} from './generation-schemas';
import { loadBatchOutput } from './generation-pipeline';
import { applyPlanDiffToProject } from './plan-diff';
import { appendResearchFooter, collectStepResearchContext, formatStepResearchPrompt } from './step-research';
import type { PlanDiff } from '../types/diff';
import { diffSchema } from '../types/diff';
import type { Bindings, ProviderType } from './types';

type WorkflowUpdateProviderContext = {
  providerType: ProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string | null;
};

type WorkflowUpdateProjectRecord = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  stack: string | null;
};

type WorkflowUpdateStageRecord = {
  id: string;
  title: string;
  type: string;
  order_index: number;
};

type WorkflowUpdateStepRecord = {
  id: string;
  stage_id: string;
  title: string;
  type: string;
  category: string;
  status: string;
  is_gate: number | string | boolean;
  objective: string | null;
  why_it_matters: string | null;
  done_when: string | null;
};

type WorkflowUpdateProgress = {
  icon: string;
  message: string;
};

type WorkflowUpdateIntent = {
  summary: string;
  changes: Array<{
    technology: string;
    action: 'add' | 'remove' | 'replace' | 'update';
    rationale: string;
    is_new_technology: boolean;
    docs_topic: string;
    github_owner: string;
    github_repo: string;
    search_query: string;
  }>;
};

type WorkflowMiniResearchItem = Batch2FetchAndRead['research'][number];

const workflowUpdateRequestSchema = z.object({
  message: z.string().trim().min(1),
  providerId: z.string().trim().optional(),
});

const workflowUpdateIntentSchema = z.object({
  summary: z.string(),
  changes: z
    .array(
      z.object({
        technology: z.string(),
        action: z.enum(['add', 'remove', 'replace', 'update']),
        rationale: z.string().optional().default(''),
        is_new_technology: z.boolean().optional().default(false),
        docs_topic: z.string().optional().default('getting started'),
        github_owner: z.string().optional().default(''),
        github_repo: z.string().optional().default(''),
        search_query: z.string().optional().default(''),
      }),
    )
    .default([]),
});

const stepDetailSchema = z.object({
  ai_output: z.string(),
  prompts: z.array(
    z.object({
      label: z.string(),
      content: z.string(),
    }),
  ),
});

const KNOWN_TECH_PROFILES: Record<
  string,
  { githubOwner: string; githubRepo: string; docsTopic: string; searchHint: string }
> = {
  railway: {
    githubOwner: 'railwayapp',
    githubRepo: 'cli',
    docsTopic: 'deployment',
    searchHint: 'Railway deployment',
  },
  resend: {
    githubOwner: 'resend',
    githubRepo: 'resend-node',
    docsTopic: 'email delivery',
    searchHint: 'Resend email integration',
  },
  stripe: {
    githubOwner: 'stripe',
    githubRepo: 'stripe-node',
    docsTopic: 'checkout',
    searchHint: 'Stripe webhook verification',
  },
  clerk: {
    githubOwner: 'clerk',
    githubRepo: 'javascript',
    docsTopic: 'authentication',
    searchHint: 'Clerk authentication',
  },
  drizzle: {
    githubOwner: 'drizzle-team',
    githubRepo: 'drizzle-orm',
    docsTopic: 'schema migrations',
    searchHint: 'Drizzle ORM migrations',
  },
  prisma: {
    githubOwner: 'prisma',
    githubRepo: 'prisma',
    docsTopic: 'schema migrations',
    searchHint: 'Prisma schema migrations',
  },
  supabase: {
    githubOwner: 'supabase',
    githubRepo: 'supabase-js',
    docsTopic: 'getting started',
    searchHint: 'Supabase Next.js',
  },
  vercel: {
    githubOwner: 'vercel',
    githubRepo: 'next.js',
    docsTopic: 'deployment',
    searchHint: 'Vercel deployment',
  },
};

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toBoolean(value: unknown) {
  return value === true || value === 1 || value === '1';
}

function normalizeTechKey(value: string) {
  return value.trim().toLowerCase().replace(/^@/, '');
}

function summarizeText(value: string, maxLength = 220) {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return '';
  }

  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength)}...`;
}

function formatSearchDigest(results: SearchResult[]) {
  return results.map((result) => `${result.title}: ${result.description} (${result.url})`).join('\n');
}

function formatReleaseDigest(releases: GithubRepoAnalysis['releases']) {
  return releases
    .slice(0, 3)
    .map((release) => `${release.tagName} (${release.publishedAt}): ${release.body}`)
    .join('\n\n');
}

function parseGitHubRepoUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.hostname.toLowerCase().includes('github.com')) {
      return null;
    }

    const segments = parsedUrl.pathname.split('/').filter(Boolean);
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

function parseJsonResponse<T>(rawText: string, schema: z.ZodType<T>, errorMessage: string) {
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`${errorMessage}: ${error instanceof Error ? error.message : 'Invalid JSON.'}`);
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`${errorMessage}: ${validated.error.message}`);
  }

  return validated.data;
}

async function loadWorkflowSnapshot(env: Bindings, workflowId: string) {
  const [stagesResult, stepsResult] = await Promise.all([
    env.DB.prepare(`
      SELECT id, title, type, order_index
      FROM stages
      WHERE workflow_id = ?
      ORDER BY order_index ASC, created_at ASC
    `)
      .bind(workflowId)
      .all(),
    env.DB.prepare(`
      SELECT id, stage_id, title, type, category, status, is_gate, objective, why_it_matters, done_when
      FROM steps
      WHERE workflow_id = ?
      ORDER BY order_index ASC, created_at ASC
    `)
      .bind(workflowId)
      .all(),
  ]);

  const stages = stagesResult.results as WorkflowUpdateStageRecord[];
  const steps = stepsResult.results as WorkflowUpdateStepRecord[];

  return stages.map((stage) => ({
    id: stage.id,
    title: stage.title,
    type: stage.type,
    order_index: stage.order_index,
    steps: steps
      .filter((step) => step.stage_id === stage.id)
      .map((step) => ({
        id: step.id,
        title: step.title,
        type: step.type,
        category: step.category,
        status: step.status,
        objective: asText(step.objective),
        why_it_matters: asText(step.why_it_matters),
        done_when: asText(step.done_when),
      })),
  }));
}

async function analyzeWorkflowUpdateIntent(options: {
  provider: WorkflowUpdateProviderContext;
  project: WorkflowUpdateProjectRecord;
  adr: Batch3Architect;
  research: Batch2FetchAndRead;
  message: string;
}) {
  const systemPrompt =
    'You are Scrimble’s plan update analyzer. Read the requested plan change, identify the technologies that are being added, removed, swapped, or substantially updated, and return only valid JSON.';
  const prompt = `Project:
${JSON.stringify(
    {
      name: options.project.name,
      description: options.project.description,
      stack: options.project.stack,
      architecture: options.adr.recommended_stack,
      integrations: options.adr.integrations,
      researched_technologies: options.research.research.map((item) => item.technology),
    },
    null,
    2,
  )}

User request:
${options.message}

Return:
- summary
- changes: [{ technology, action, rationale, is_new_technology, docs_topic, github_owner, github_repo, search_query }]

Rules:
- Only include technologies that materially affect the plan.
- Set is_new_technology to true when the technology is not already part of the current stack or when the user is clearly introducing it.
- Provide github_owner and github_repo when you are confident.
- search_query should be a useful current-year web query for researching the change.
- action must be one of add, remove, replace, update.`;

  const { text } = await callAIText({
    providerType: options.provider.providerType,
    apiKey: options.provider.apiKey,
    model: options.provider.model,
    baseUrl: options.provider.baseUrl,
    system: systemPrompt,
    prompt,
  });

  return parseJsonResponse<WorkflowUpdateIntent>(
    text,
    workflowUpdateIntentSchema,
    'Failed to understand the requested workflow change',
  );
}

function resolveResearchHints(
  change: WorkflowUpdateIntent['changes'][number],
  research: Batch2FetchAndRead,
  adr: Batch3Architect,
) {
  const normalizedKey = normalizeTechKey(change.technology);
  const researchMatch =
    research.research.find((item) => normalizeTechKey(item.technology) === normalizedKey) || null;
  const githubSource =
    researchMatch?.sources
      .map((source) => parseGitHubRepoUrl(source.url))
      .find((entry): entry is { owner: string; repo: string } => Boolean(entry)) || null;
  const knownProfile = KNOWN_TECH_PROFILES[normalizedKey] || null;
  const integrationMatch =
    adr.integrations.find((integration) =>
      [integration.service, integration.package_name].some(
        (value) => normalizeTechKey(value).includes(normalizedKey) || normalizedKey.includes(normalizeTechKey(value)),
      ),
    ) || null;

  return {
    docsTopic: change.docs_topic || knownProfile?.docsTopic || 'getting started',
    githubOwner: change.github_owner || githubSource?.owner || knownProfile?.githubOwner || '',
    githubRepo: change.github_repo || githubSource?.repo || knownProfile?.githubRepo || '',
    searchQuery:
      change.search_query ||
      `${knownProfile?.searchHint || change.technology} ${adr.project_type || adr.project_name} ${new Date().getFullYear()}`,
    packageName: integrationMatch?.package_name || change.technology,
  };
}

async function runMiniResearch(options: {
  env: Bindings;
  userId: string;
  adr: Batch3Architect;
  research: Batch2FetchAndRead;
  intent: WorkflowUpdateIntent;
  onProgress?: (progress: WorkflowUpdateProgress) => Promise<void> | void;
}) {
  const currentYear = new Date().getFullYear();
  const miniResearch: WorkflowMiniResearchItem[] = [];
  const toolEnv: ToolEnv = options.env;

  for (const change of options.intent.changes) {
    if (!change.technology || (!change.is_new_technology && change.action === 'remove')) {
      continue;
    }

    const hints = resolveResearchHints(change, options.research, options.adr);
    await options.onProgress?.({
      icon: '🔍',
      message: `Reading ${change.technology} documentation...`,
    });

    const [docs, githubAnalysis, webResults] = await Promise.all([
      getLibraryDocs(change.technology, hints.docsTopic, options.userId, toolEnv),
      hints.githubOwner && hints.githubRepo
        ? analyzeGithubRepo(hints.githubOwner, hints.githubRepo, options.userId, toolEnv)
        : Promise.resolve({
            owner: '',
            repo: '',
            stars: 0,
            forks: 0,
            openIssues: 0,
            lastPush: 'Unknown',
            latestRelease: 'Unknown',
            readme: '',
            summary: '',
            releases: [],
            recentIssues: [],
          }),
      searchWeb(
        hints.searchQuery.includes(`${currentYear}`) ? hints.searchQuery : `${hints.searchQuery} ${currentYear}`,
        options.userId,
        toolEnv,
      ),
    ]);

    const repoUrl =
      hints.githubOwner && hints.githubRepo
        ? `https://github.com/${hints.githubOwner}/${hints.githubRepo}`
        : '';
    const sources: Batch2FetchAndRead['sources'] = [
      ...(docs.content
        ? [
            {
              technology: change.technology,
              tool: docs.source === 'Context7' ? 'Context7' : 'Live docs',
              url: docs.source.startsWith('http') ? docs.source : `https://docs.example.com/${change.technology}`,
              title: `${change.technology} docs`,
              summary: summarizeText(docs.content),
            },
          ]
        : []),
      ...(repoUrl
        ? [
            {
              technology: change.technology,
              tool: 'GitHub',
              url: repoUrl,
              title: `${hints.githubOwner}/${hints.githubRepo}`,
              summary: summarizeText(`${githubAnalysis.summary}\n\n${formatReleaseDigest(githubAnalysis.releases)}`),
            },
          ]
        : []),
      ...webResults.slice(0, 3).map((result) => ({
        technology: change.technology,
        tool: 'Brave Search',
        url: result.url,
        title: result.title,
        summary: summarizeText(result.description),
      })),
    ];

    miniResearch.push({
      technology: change.technology,
      docs_content: docs.content || 'Documentation unavailable.',
      github_readme: githubAnalysis.readme || githubAnalysis.summary || 'GitHub repository data unavailable.',
      latest_version: githubAnalysis.latestRelease || docs.version || 'Unknown',
      last_commit_date: githubAnalysis.lastPush || 'Unknown',
      open_issues_count: githubAnalysis.openIssues || 0,
      recent_breaking_changes: formatReleaseDigest(githubAnalysis.releases),
      repo_health_summary:
        githubAnalysis.summary ||
        (repoUrl
          ? `${hints.githubOwner}/${hints.githubRepo} has ${githubAnalysis.stars} stars and ${githubAnalysis.openIssues} open issues.`
          : 'GitHub repository data unavailable.'),
      community_sentiment: formatSearchDigest(webResults) || 'Community sentiment unavailable.',
      bug_report_digest: githubAnalysis.recentIssues
        .map((issue) => `${issue.title}: ${issue.body}`)
        .join('\n\n'),
      sources,
    });
  }

  if (miniResearch.length > 0) {
    await options.onProgress?.({
      icon: '✅',
      message: 'Research complete',
    });
  }

  return miniResearch;
}

async function generatePlanDiff(options: {
  provider: WorkflowUpdateProviderContext;
  project: WorkflowUpdateProjectRecord;
  workflowSnapshot: Awaited<ReturnType<typeof loadWorkflowSnapshot>>;
  adr: Batch3Architect;
  research: Batch2FetchAndRead;
  intent: WorkflowUpdateIntent;
  miniResearch: WorkflowMiniResearchItem[];
  message: string;
}) {
  const systemPrompt =
    'You are Scrimble’s plan adapter. Update the workflow surgically based on the user’s request and the live research corpus. Return only valid JSON that matches the required diff schema.';
  const prompt = `Project:
${JSON.stringify(
    {
      name: options.project.name,
      description: options.project.description,
      stack: options.project.stack,
    },
    null,
    2,
  )}

Workflow snapshot:
${JSON.stringify(options.workflowSnapshot, null, 2)}

Architecture record:
${JSON.stringify(options.adr, null, 2)}

Existing research:
${JSON.stringify(options.research.research, null, 2)}

Update intent:
${JSON.stringify(options.intent, null, 2)}

Mini research for this change:
${JSON.stringify(options.miniResearch, null, 2)}

User request:
${options.message}

Return:
- summary
- changes using only update_step, add_step, or remove_step

Rules:
- Use existing stage_id and step_id values from the workflow snapshot.
- Only change the minimum number of steps necessary.
- When you update step content, make the objectives, done_when text, and checklist items specific to the researched technology. Include actual CLI commands, config file names, and environment variable names when the research supports them.
- Never invent made-up IDs or generic placeholder syntax.`;

  const { text } = await callAIText({
    providerType: options.provider.providerType,
    apiKey: options.provider.apiKey,
    model: options.provider.model,
    baseUrl: options.provider.baseUrl,
    system: systemPrompt,
    prompt,
  });

  return parseJsonResponse<PlanDiff>(text, diffSchema, 'Failed to generate a workflow diff');
}

async function loadAffectedSteps(
  env: Bindings,
  workflowId: string,
  affectedStepIds: string[],
) {
  if (affectedStepIds.length === 0) {
    return [];
  }

  const placeholders = affectedStepIds.map(() => '?').join(', ');
  const result = await env.DB.prepare(`
    SELECT id, stage_id, title, type, category, status, is_gate, objective, why_it_matters, done_when
    FROM steps
    WHERE workflow_id = ? AND id IN (${placeholders})
  `)
    .bind(workflowId, ...affectedStepIds)
    .all();

  return result.results as WorkflowUpdateStepRecord[];
}

async function reEnrichAffectedSteps(options: {
  env: Bindings;
  workflowId: string;
  project: WorkflowUpdateProjectRecord;
  provider: WorkflowUpdateProviderContext;
  adr: Batch3Architect;
  research: Batch2FetchAndRead;
  miniResearch: WorkflowMiniResearchItem[];
  affectedStepIds: string[];
  onProgress?: (progress: WorkflowUpdateProgress) => Promise<void> | void;
}) {
  const affectedSteps = await loadAffectedSteps(options.env, options.workflowId, options.affectedStepIds);

  for (const step of affectedSteps) {
    await options.onProgress?.({
      icon: '🔄',
      message: `Refreshing ${step.title}...`,
    });

    const stepResearchContext = await collectStepResearchContext({
      env: options.env,
      userId: options.project.user_id,
      stepId: step.id,
      stepTitle: step.title,
      stepObjective: asText(step.objective),
      stepWhyItMatters: asText(step.why_it_matters),
      stepCategory: step.category,
      stepDoneWhen: asText(step.done_when),
      stepIsGate: toBoolean(step.is_gate),
      adr: options.adr,
      research: options.research,
      additionalResearch: options.miniResearch,
    });

    const systemPrompt =
      'You are Scrimble’s step enrichment agent. You produce specific, actionable guidance for a single build step. Write for a solo builder in plain language with no jargon. Respond ONLY with valid JSON in the shape {"ai_output": string, "prompts": [{"label": string, "content": string}] }.';
    const prompt = [
      `Step title: ${step.title}`,
      `Project name: ${options.project.name}`,
      `Project brief: ${options.project.description || 'No project description provided.'}`,
      `Project stack: ${options.project.stack || '{}'}`,
      `Step objective: ${step.objective || 'Not specified yet.'}`,
      `Why it matters: ${step.why_it_matters || 'Not specified yet.'}`,
      `Done when: ${step.done_when || 'Not specified yet.'}`,
      `Live research context:\n${formatStepResearchPrompt(stepResearchContext)}`,
      'Use the live documentation provided to generate specific, current guidance. Reference actual function names, hook names, and config options from the docs. If any open bugs were found, mention them in the ai_output and explain the workaround. Follow any requirements listed in the live research context exactly.',
    ].join('\n\n');

    const { text } = await callAIText({
      providerType: options.provider.providerType,
      apiKey: options.provider.apiKey,
      model: options.provider.model,
      baseUrl: options.provider.baseUrl,
      system: systemPrompt,
      prompt,
    });

    const enriched = parseJsonResponse(text, stepDetailSchema, `Failed to re-enrich ${step.title}`);
    const aiOutputWithFooter = appendResearchFooter(enriched.ai_output, stepResearchContext.footer);

    await options.env.DB.prepare(`
      UPDATE steps
      SET ai_output = ?, prompts = ?, is_ai_enriched = 1, updated_at = datetime("now")
      WHERE id = ? AND workflow_id = ?
    `)
      .bind(aiOutputWithFooter, JSON.stringify(enriched.prompts), step.id, options.workflowId)
      .run();
  }
}

export async function processWorkflowUpdate(options: {
  env: Bindings;
  workflowId: string;
  project: WorkflowUpdateProjectRecord;
  provider: WorkflowUpdateProviderContext;
  message: string;
  onProgress?: (progress: WorkflowUpdateProgress) => Promise<void> | void;
}) {
  const [adr, research, workflowSnapshot] = await Promise.all([
    loadBatchOutput(options.env, options.project.id, 'batch_3_architect', Batch3ArchitectSchema),
    loadBatchOutput(options.env, options.project.id, 'batch_2_fetch_and_read', Batch2FetchAndReadSchema),
    loadWorkflowSnapshot(options.env, options.workflowId),
  ]);

  await options.onProgress?.({
    icon: '🔍',
    message: 'Understanding what changed...',
  });

  const intent = await analyzeWorkflowUpdateIntent({
    provider: options.provider,
    project: options.project,
    adr,
    research,
    message: options.message,
  });

  const miniResearch = await runMiniResearch({
    env: options.env,
    userId: options.project.user_id,
    adr,
    research,
    intent,
    onProgress: options.onProgress,
  });

  await options.onProgress?.({
    icon: '🔄',
    message: 'Updating your plan...',
  });

  const diff = await generatePlanDiff({
    provider: options.provider,
    project: options.project,
    workflowSnapshot,
    adr,
    research,
    intent,
    miniResearch,
    message: options.message,
  });

  const applyResult = await applyPlanDiffToProject(options.env, options.project.id, diff);
  await options.env.DB.prepare('UPDATE projects SET updated_at = datetime("now") WHERE id = ?')
    .bind(options.project.id)
    .run();

  if (applyResult.affectedStepIds.length > 0) {
    await reEnrichAffectedSteps({
      env: options.env,
      workflowId: options.workflowId,
      project: options.project,
      provider: options.provider,
      adr,
      research,
      miniResearch,
      affectedStepIds: applyResult.affectedStepIds,
      onProgress: options.onProgress,
    });
  }

  await options.onProgress?.({
    icon: '✅',
    message: `${applyResult.affectedStepIds.length || applyResult.appliedChangeCount} step${applyResult.affectedStepIds.length + applyResult.removedStepIds.length === 1 ? '' : 's'} updated`,
  });

  return {
    summary: diff.summary,
    updated_steps: applyResult.affectedStepIds.length || applyResult.appliedChangeCount,
  };
}

export { workflowUpdateRequestSchema };
