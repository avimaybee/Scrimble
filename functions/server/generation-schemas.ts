import { z } from 'zod';

function normalizeText(value: unknown, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }

    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }

  return fallback;
}

function normalizeNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => (typeof entry === 'string' ? [entry.trim()] : []))
    .filter(Boolean);
}

function normalizeObjectArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
  );
}

function normalizeObject<T extends Record<string, unknown>>(
  value: unknown,
  fallbackFactory: () => T,
) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallbackFactory();
}

function createOptionalTextSchema(fallback = '') {
  return z.preprocess((value) => normalizeText(value, fallback), z.string());
}

function createRequiredTextSchema(fallback = 'Not specified') {
  return z.preprocess((value) => normalizeText(value, fallback), z.string().min(1));
}

function createStringArraySchema() {
  return z.preprocess(normalizeStringArray, z.array(z.string().min(1)));
}

function createBooleanSchema(fallback = false) {
  return z.preprocess((value) => normalizeBoolean(value, fallback), z.boolean());
}

function createNumberSchema(fallback = 0) {
  return z.preprocess((value) => normalizeNumber(value, fallback), z.number());
}

function createNonNegativeIntSchema(fallback = 0) {
  return z.preprocess((value) => {
    const normalized = normalizeNumber(value, fallback);
    return normalized < 0 ? fallback : Math.trunc(normalized);
  }, z.number().int().nonnegative());
}

const searchResultSchema = z.preprocess(
  (value) => normalizeObject(value, () => ({})),
  z.object({
    title: createRequiredTextSchema('Search result'),
    url: createOptionalTextSchema(''),
    description: createOptionalTextSchema(''),
  }),
);

const researchSourceSchema = z.preprocess(
  (value) => normalizeObject(value, () => ({})),
  z.object({
    technology: createOptionalTextSchema(''),
    url: createOptionalTextSchema(''),
    tool: createOptionalTextSchema('Web fetch'),
    title: createOptionalTextSchema(''),
    summary: createOptionalTextSchema(''),
  }),
);

const partialFailureSchema = z.preprocess(
  (value) => normalizeObject(value, () => ({})),
  z.object({
    tool: createRequiredTextSchema('Unknown tool'),
    technology: createOptionalTextSchema(''),
    message: createRequiredTextSchema('The fetch failed.'),
  }),
);

export const Batch1ResearchStackSchema = z.preprocess(
  (value) => normalizeObject(value, () => ({})),
  z.object({
    technologies: z.preprocess(
      normalizeObjectArray,
      z.array(
        z.preprocess(
          (entry) => normalizeObject(entry, () => ({})),
          z.object({
            name: createRequiredTextSchema('Unknown technology'),
            docs_url: createOptionalTextSchema(''),
            github_url: createOptionalTextSchema(''),
            changelog_url: createOptionalTextSchema(''),
            community_search_results: z.preprocess(normalizeObjectArray, z.array(searchResultSchema)),
            breaking_change_search_results: z.preprocess(normalizeObjectArray, z.array(searchResultSchema)),
          }),
        ),
      ).min(1),
    ),
  }),
);

export const Batch2FetchAndReadSchema = z.preprocess(
  (value) => normalizeObject(value, () => ({})),
  z.object({
    research: z.preprocess(
      normalizeObjectArray,
      z.array(
        z.preprocess(
          (entry) => normalizeObject(entry, () => ({})),
          z.object({
            technology: createRequiredTextSchema('Unknown technology'),
            docs_content: createOptionalTextSchema(''),
            github_readme: createOptionalTextSchema(''),
            latest_version: createOptionalTextSchema('Unknown'),
            last_commit_date: createOptionalTextSchema('Unknown'),
            open_issues_count: createNonNegativeIntSchema(0),
            recent_breaking_changes: createOptionalTextSchema(''),
            repo_health_summary: createOptionalTextSchema(''),
            community_sentiment: createOptionalTextSchema(''),
            bug_report_digest: createOptionalTextSchema(''),
            sources: z.preprocess(normalizeObjectArray, z.array(researchSourceSchema)),
          }),
        ),
      ).min(1),
    ),
    sources: z.preprocess(normalizeObjectArray, z.array(researchSourceSchema)),
    data_quality: z.preprocess(
      (entry) => normalizeObject(entry, () => ({})),
      z.object({
        has_brave_search: createBooleanSchema(false),
        has_github_token: createBooleanSchema(false),
        has_context7: createBooleanSchema(false),
        technologies_researched: createNonNegativeIntSchema(0),
        urls_fetched: createNonNegativeIntSchema(0),
        issues_found: createNonNegativeIntSchema(0),
        model_context_window: createNonNegativeIntSchema(128_000),
        source_target_count: createNonNegativeIntSchema(0),
        used_full_context_window: createBooleanSchema(false),
        truncated_to_fit_context: createBooleanSchema(false),
        degraded_tools: createStringArraySchema(),
        partial_failures: z.preprocess(normalizeObjectArray, z.array(partialFailureSchema)),
      }),
    ),
  }),
);

export const Batch3ArchitectSchema = z.preprocess(
  (value) => normalizeObject(value, () => ({})),
  z.object({
    project_name: createRequiredTextSchema('Untitled Project'),
    project_type: createRequiredTextSchema('other'),
    project_summary: createRequiredTextSchema('Project summary not available yet.'),
    how_it_connects: createRequiredTextSchema(
      'The interface talks to the backend, the backend writes to storage, and the supporting services handle the rest.',
    ),
    recommended_stack: z.preprocess(
      (entry) => normalizeObject(entry, () => ({})),
      z.object({
        frontend: createRequiredTextSchema('Web framework'),
        backend: createRequiredTextSchema('Server environment'),
        auth: createRequiredTextSchema('Authentication provider'),
        database: createRequiredTextSchema('Primary database'),
        payments: createRequiredTextSchema('Payment processor (optional)'),
        email: createRequiredTextSchema('Email service (optional)'),
        deploy: createRequiredTextSchema('Deployment platform'),
      }),
    ),
    data_model: z.preprocess(
      normalizeObjectArray,
      z.array(
        z.preprocess(
          (entry) => normalizeObject(entry, () => ({})),
          z.object({
            table: createRequiredTextSchema('unnamed_table'),
            columns: z.preprocess(
              normalizeObjectArray,
              z.array(
                z.preprocess(
                  (column) => normalizeObject(column, () => ({})),
                  z.object({
                    name: createRequiredTextSchema('column'),
                    type: createRequiredTextSchema('text'),
                    nullable: createBooleanSchema(false),
                    notes: createOptionalTextSchema(''),
                  }),
                ),
              ),
            ),
            relationships: createStringArraySchema(),
          }),
        ),
      ),
    ),
    integrations: z.preprocess(
      normalizeObjectArray,
      z.array(
        z.preprocess(
          (entry) => normalizeObject(entry, () => ({})),
          z.object({
            service: createRequiredTextSchema('External Service'),
            purpose: createRequiredTextSchema('Implementation detail'),
            package_name: createRequiredTextSchema('library-or-service'),
            version: createRequiredTextSchema('latest'),
          }),
        ),
      ),
    ),
    security_surface: z.preprocess(
      normalizeObjectArray,
      z.array(
        z.preprocess(
          (entry) => normalizeObject(entry, () => ({})),
          z.object({
            concern: createRequiredTextSchema('Security concern'),
            approach: createRequiredTextSchema('Mitigation not specified'),
          }),
        ),
      ),
    ),
    gotchas: z.preprocess(
      normalizeObjectArray,
      z.array(
        z.preprocess(
          (entry) => normalizeObject(entry, () => ({})),
          z.object({
            technology: createRequiredTextSchema('General Architecture'),
            issue: createRequiredTextSchema('General implementation consideration'),
            mitigation: createRequiredTextSchema('Follow standard patterns and best practices'),
          }),
        ),
      ),
    ),
  }),
);

const checklistItemSchema = z.preprocess(
  (value) => normalizeObject(value, () => ({})),
  z.object({
    id: createOptionalTextSchema(''),
    label: createRequiredTextSchema('Checklist item'),
    is_required: createBooleanSchema(false),
  }),
);

const planStepSchema = z.preprocess(
  (value) => normalizeObject(value, () => ({})),
  z.object({
    id: createOptionalTextSchema(''),
    title: createRequiredTextSchema('Untitled step'),
    type: createRequiredTextSchema('task'),
    category: createOptionalTextSchema(''),
    objective: createOptionalTextSchema(''),
    why_it_matters: createOptionalTextSchema(''),
    risk_level: createOptionalTextSchema('low'),
    is_gate: createBooleanSchema(false),
    is_milestone: createBooleanSchema(false),
    milestone_label: createOptionalTextSchema(''),
    done_when: createOptionalTextSchema(''),
    suggested_tools: createStringArraySchema(),
    checklist: z.preprocess(normalizeObjectArray, z.array(checklistItemSchema)),
  }),
);

export const Batch4PlanBuildSchema = z.preprocess(
  (value) => normalizeObject(value, () => ({})),
  z.object({
    project_name: createRequiredTextSchema('Untitled Project'),
    project_type: createRequiredTextSchema('other'),
    prd_markdown: createRequiredTextSchema(''),
    stack: z.preprocess((value) => {
      if (typeof value === 'string') {
        return value.trim();
      }

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
      }

      return '';
    }, z.union([z.string(), z.record(z.string(), z.unknown())])),
    stages: z.preprocess(
      normalizeObjectArray,
      z.array(
        z.preprocess(
          (entry) => normalizeObject(entry, () => ({})),
          z.object({
            id: createOptionalTextSchema(''),
            title: createRequiredTextSchema('Untitled stage'),
            type: createRequiredTextSchema('stage'),
            order_index: createNumberSchema(0),
            steps: z.preprocess(normalizeObjectArray, z.array(planStepSchema).min(1)),
          }),
        ),
      ).min(1),
    ),
    edges: z.preprocess(
      normalizeObjectArray,
      z.array(
        z.preprocess(
          (entry) => normalizeObject(entry, () => ({})),
          z.object({
            id: createOptionalTextSchema(''),
            source_step_id: createOptionalTextSchema(''),
            target_step_id: createOptionalTextSchema(''),
            edge_type: createOptionalTextSchema('default'),
          }),
        ),
      ),
    ),
  }),
);

export const Batch5EnrichStepsSchema = z.preprocess(
  (value) => normalizeObject(value, () => ({})),
  z.object({
    enrichments: z.preprocess(
      normalizeObjectArray,
      z.array(
        z.preprocess(
          (entry) => normalizeObject(entry, () => ({})),
          z.object({
            step_id: createOptionalTextSchema(''),
            ai_output: createOptionalTextSchema(''),
            prompts: z.preprocess(
              normalizeObjectArray,
              z.array(
                z.preprocess(
                  (prompt) => normalizeObject(prompt, () => ({})),
                  z.object({
                    label: createOptionalTextSchema(''),
                    content: createOptionalTextSchema(''),
                  }),
                ),
              ),
            ),
          }),
        ),
      ),
    ),
  }),
);

export const SKILL_FILE_NAMES = [
  'plan.md',
] as const;

export type SkillFileName = (typeof SKILL_FILE_NAMES)[number];

export function getSkillFileSortIndex(filename: string) {
  return 0;
}

const skillFileSchema = z.preprocess(
  (value) => normalizeObject(value, () => ({})),
  z.object({
    filename: z.literal('plan.md'),
    content: createRequiredTextSchema(''),
  }),
);

export const Batch6GenerateFilesSchema = z.preprocess(
  (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'plan.md' in value) {
      return { files: [{ filename: 'plan.md', content: String((value as any)['plan.md']) }] };
    }
    if (Array.isArray(value)) {
      return { files: value };
    }
    return normalizeObject(value, () => ({}));
  },
  z.object({
    files: z.array(skillFileSchema).length(1),
  }),
);

export const schemaDescriptions = {
  batch_1_research_stack:
    '{ technologies: [{ name: string, docs_url: url, github_url: url, changelog_url: url, community_search_results?: [{ title, url, description }], breaking_change_search_results?: [{ title, url, description }] }] }',
  batch_2_fetch_and_read:
    '{ research: [{ technology: string, docs_content: string, github_readme: string, latest_version: string, last_commit_date: string, open_issues_count: number, recent_breaking_changes: string, repo_health_summary?: string, community_sentiment?: string, bug_report_digest?: string, sources?: [{ technology?, url, tool, title?, summary? }] }], sources?: [{ technology?, url, tool, title?, summary? }], data_quality?: { has_brave_search: boolean, has_github_token: boolean, has_context7: boolean, technologies_researched: number, urls_fetched: number, issues_found: number, model_context_window?: number, source_target_count?: number, used_full_context_window?: boolean, truncated_to_fit_context?: boolean, degraded_tools?: string[], partial_failures?: [{ tool: string, technology?: string, message: string }] } }',
  batch_3_architect:
    '{ project_name: string, project_type: string, project_summary: string, how_it_connects: string, recommended_stack: { frontend, backend, auth, database, payments, email, deploy }, data_model: [{ table, columns: [{ name, type, nullable?, notes? }], relationships: string[] }], integrations: [{ service, purpose, package_name, version }], security_surface: [{ concern, approach }], gotchas: [{ technology, issue, mitigation }] }',
  batch_4_plan_build:
    '{ project_name: string, project_type: string, prd_markdown: string, stack?: string | Record<string, unknown>, stages: [{ id, title, type, order_index, steps: [{ id, title, type, category?, objective?, why_it_matters?, risk_level?, is_gate?, is_milestone?, milestone_label?, done_when?, suggested_tools?: string[], checklist?: [{ id, label, is_required? }] }] }], edges?: [{ id, source_step_id, target_step_id, edge_type? }] }',
  batch_5_enrich_steps:
    '{ enrichments: [{ step_id: string, ai_output: string, prompts: [{ label: string, content: string }] }] }',
  batch_6_generate_files:
    '{ files: [{ filename: "plan.md", content: string }] }',
} as const;

export type Batch1ResearchStack = z.infer<typeof Batch1ResearchStackSchema>;
export type Batch2FetchAndRead = z.infer<typeof Batch2FetchAndReadSchema>;
export type Batch3Architect = z.infer<typeof Batch3ArchitectSchema>;
export type Batch4PlanBuild = z.infer<typeof Batch4PlanBuildSchema>;
export type Batch5EnrichSteps = z.infer<typeof Batch5EnrichStepsSchema>;
export type Batch6GenerateFiles = z.infer<typeof Batch6GenerateFilesSchema>;
