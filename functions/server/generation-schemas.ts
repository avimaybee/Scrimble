import { z } from 'zod';

const urlSchema = z.string().url();

export const Batch1ResearchStackSchema = z.object({
  technologies: z.array(
    z.object({
      name: z.string().min(1),
      docs_url: urlSchema,
      github_url: urlSchema,
      changelog_url: urlSchema,
    }),
  ),
});

export const Batch2FetchAndReadSchema = z.object({
  research: z.array(
    z.object({
      technology: z.string().min(1),
      docs_content: z.string(),
      github_readme: z.string(),
      latest_version: z.string(),
      last_commit_date: z.string(),
      open_issues_count: z.number().int().nonnegative(),
      recent_breaking_changes: z.string(),
    }),
  ),
});

export const Batch3ArchitectSchema = z.object({
  project_name: z.string().min(1),
  project_type: z.string().min(1),
  recommended_stack: z.object({
    frontend: z.string().min(1),
    backend: z.string().min(1),
    auth: z.string().min(1),
    database: z.string().min(1),
    payments: z.string().min(1),
    email: z.string().min(1),
    deploy: z.string().min(1),
  }),
  data_model: z.array(
    z.object({
      table: z.string().min(1),
      columns: z.array(
        z.object({
          name: z.string().min(1),
          type: z.string().min(1),
          nullable: z.boolean().optional().default(false),
          notes: z.string().optional().default(''),
        }),
      ),
      relationships: z.array(z.string()).optional().default([]),
    }),
  ),
  integrations: z.array(
    z.object({
      service: z.string().min(1),
      purpose: z.string().min(1),
      package_name: z.string().min(1),
      version: z.string().min(1),
    }),
  ),
  security_surface: z.array(
    z.object({
      concern: z.string().min(1),
      approach: z.string().min(1),
    }),
  ),
  gotchas: z.array(
    z.object({
      technology: z.string().min(1),
      issue: z.string().min(1),
      mitigation: z.string().min(1),
    }),
  ),
});

const checklistItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  is_required: z.boolean().optional().default(false),
});

const planStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  category: z.string().optional().default(''),
  objective: z.string().optional().default(''),
  why_it_matters: z.string().optional().default(''),
  risk_level: z.string().optional().default('low'),
  is_gate: z.boolean().optional().default(false),
  done_when: z.string().optional().default(''),
  suggested_tools: z.array(z.string()).optional().default([]),
  checklist: z.array(checklistItemSchema).optional().default([]),
});

export const Batch4PlanBuildSchema = z.object({
  project_name: z.string().optional().default('Untitled Project'),
  project_type: z.string().optional().default('other'),
  stack: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().default(''),
  stages: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      type: z.string(),
      order_index: z.number().default(0),
      steps: z.array(planStepSchema),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      source_step_id: z.string(),
      target_step_id: z.string(),
      edge_type: z.string().optional().default('default'),
    }),
  ).optional().default([]),
});

export const Batch5EnrichStepsSchema = z.object({
  enrichments: z.array(
    z.object({
      step_id: z.string(),
      ai_output: z.string(),
      prompts: z.array(
        z.object({
          label: z.string(),
          content: z.string(),
        }),
      ),
    }),
  ),
});

export const SKILL_FILE_NAMES = [
  '.cursor/rules/scrimble-project.mdc',
  'CLAUDE.md',
  '.github/copilot-instructions.md',
  '.windsurfrules',
  'scrimble-context.md',
  'scrimble-mcp.json',
] as const;

const skillFileSchema = z.object({
  filename: z.enum(SKILL_FILE_NAMES),
  content: z.string().min(1),
});

export const Batch6GenerateFilesSchema = z.object({
  files: z
    .array(skillFileSchema)
    .length(SKILL_FILE_NAMES.length)
    .superRefine((files, ctx) => {
      const seen = new Set<string>();

      files.forEach((file, index) => {
        if (seen.has(file.filename)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate generated file: ${file.filename}`,
            path: [index, 'filename'],
          });
          return;
        }

        seen.add(file.filename);
      });

      SKILL_FILE_NAMES.forEach((filename) => {
        if (!seen.has(filename)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Missing required generated file: ${filename}`,
          });
        }
      });
    }),
});

export const schemaDescriptions = {
  batch_1_research_stack:
    '{ technologies: [{ name: string, docs_url: url, github_url: url, changelog_url: url }] }',
  batch_2_fetch_and_read:
    '{ research: [{ technology: string, docs_content: string, github_readme: string, latest_version: string, last_commit_date: string, open_issues_count: number, recent_breaking_changes: string }] }',
  batch_3_architect:
    '{ project_name: string, project_type: string, recommended_stack: { frontend, backend, auth, database, payments, email, deploy }, data_model: [{ table, columns: [{ name, type, nullable?, notes? }], relationships: string[] }], integrations: [{ service, purpose, package_name, version }], security_surface: [{ concern, approach }], gotchas: [{ technology, issue, mitigation }] }',
  batch_4_plan_build:
    '{ project_name?: string, project_type?: string, stack?: string | Record<string, unknown>, stages: [{ id, title, type, order_index, steps: [{ id, title, type, category?, objective?, why_it_matters?, risk_level?, is_gate?, done_when?, suggested_tools?: string[], checklist?: [{ id, label, is_required? }] }] }], edges?: [{ id, source_step_id, target_step_id, edge_type? }] }',
  batch_5_enrich_steps:
    '{ enrichments: [{ step_id: string, ai_output: string, prompts: [{ label: string, content: string }] }] }',
  batch_6_generate_files:
    `{ files: [{ filename: one of ${SKILL_FILE_NAMES.join(' | ')}, content: string }] }`,
} as const;

export type Batch1ResearchStack = z.infer<typeof Batch1ResearchStackSchema>;
export type Batch2FetchAndRead = z.infer<typeof Batch2FetchAndReadSchema>;
export type Batch3Architect = z.infer<typeof Batch3ArchitectSchema>;
export type Batch4PlanBuild = z.infer<typeof Batch4PlanBuildSchema>;
export type Batch5EnrichSteps = z.infer<typeof Batch5EnrichStepsSchema>;
export type Batch6GenerateFiles = z.infer<typeof Batch6GenerateFilesSchema>;
export type SkillFileName = (typeof SKILL_FILE_NAMES)[number];
