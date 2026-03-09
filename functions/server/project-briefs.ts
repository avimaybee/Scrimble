import { z } from 'zod';
import { normalizeBuilderProfileName } from '../../src/lib/builder-profile';
import { buildToolsContext } from './user-tools';
import type { Bindings } from './types';

export const projectBriefV1ScopeSchema = z.object({
  in: z.array(z.string().trim().min(1)).default([]),
  out: z.array(z.string().trim().min(1)).default([]),
});

export const projectBriefStackContextSchema = z.object({
  confirmed: z.array(z.string().trim().min(1)).default([]),
  existing_tools: z.array(z.string().trim().min(1)).default([]),
  open_to: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().trim().default(''),
});

export const projectBriefConstraintsSchema = z.object({
  budget: z.string().trim().default(''),
  timeline: z.string().trim().default(''),
  existing_codebase: z.string().trim().default(''),
  dependencies: z.array(z.string().trim().min(1)).default([]),
  other: z.array(z.string().trim().min(1)).default([]),
});

export const projectBriefStructuredSchema = z.object({
  what_it_is: z.string().trim().default(''),
  who_its_for: z.string().trim().default(''),
  problem_solved: z.string().trim().default(''),
  v1_scope: projectBriefV1ScopeSchema.default({ in: [], out: [] }),
  stack_context: projectBriefStackContextSchema.default({
    confirmed: [],
    existing_tools: [],
    open_to: [],
    notes: '',
  }),
  definition_done: z.string().trim().default(''),
  constraints: projectBriefConstraintsSchema.default({
    budget: '',
    timeline: '',
    existing_codebase: '',
    dependencies: [],
    other: [],
  }),
});

export type ProjectBriefStructured = z.infer<typeof projectBriefStructuredSchema>;
export type ProjectBriefV1Scope = z.infer<typeof projectBriefV1ScopeSchema>;
export type ProjectBriefStackContext = z.infer<typeof projectBriefStackContextSchema>;
export type ProjectBriefConstraints = z.infer<typeof projectBriefConstraintsSchema>;

export type ProjectIntakeMessage = {
  id: number;
  project_id: string;
  role: 'agent' | 'user';
  content: string;
  created_at: string;
};

export type StoredProjectBrief = {
  id: string;
  project_id: string;
  raw_description: string;
  enriched_brief: string;
  what_it_is: string;
  who_its_for: string;
  problem_solved: string;
  v1_scope: ProjectBriefV1Scope;
  stack_context: ProjectBriefStackContext;
  definition_done: string;
  constraints: ProjectBriefConstraints;
  future_ideas: string[];
  conversation_turns: number;
  created_at: string;
};

type ProjectBriefRow = {
  id: string;
  project_id: string;
  raw_description: string;
  enriched_brief: string;
  what_it_is: string | null;
  who_its_for: string | null;
  problem_solved: string | null;
  v1_scope: string | null;
  stack_context: string | null;
  definition_done: string | null;
  constraints: string | null;
  future_ideas: string | null;
  conversation_turns: number | null;
  created_at: string;
};

type IntakeMessageRow = {
  id: number;
  project_id: string;
  role: string;
  content: string;
  created_at: string;
};

function dedupeText(values: string[]) {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const normalized = normalizeBuilderProfileName(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(value.trim());
  }

  return deduped;
}

function parseStructuredJson<T>(value: string | null, schema: z.ZodType<T>, fallback: T) {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    const validated = schema.safeParse(parsed);
    return validated.success ? validated.data : fallback;
  } catch {
    return fallback;
  }
}

function parseProjectStackValues(stackValue?: string | null) {
  if (!stackValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(stackValue) as Record<string, unknown>;
    return dedupeText(
      Object.values(parsed)
        .flatMap((value) =>
          typeof value === 'string'
            ? [value]
            : Array.isArray(value)
              ? value.filter((entry): entry is string => typeof entry === 'string')
              : [],
        )
        .map((value) => value.trim())
        .filter(Boolean),
    );
  } catch {
    return [];
  }
}

function formatList(values: string[], fallback = 'not specified') {
  return values.length > 0 ? values.join(', ') : fallback;
}

function formatStackContext(stackContext: ProjectBriefStackContext) {
  const segments = [
    `Confirmed: ${formatList(stackContext.confirmed)}`,
    `Already have: ${formatList(stackContext.existing_tools)}`,
    `Open to: ${formatList(stackContext.open_to)}`,
  ];

  if (stackContext.notes) {
    segments.push(`Notes: ${stackContext.notes}`);
  }

  return segments.join(' ');
}

function formatConstraints(constraints: ProjectBriefConstraints) {
  const segments: string[] = [];

  if (constraints.timeline) {
    segments.push(`Timeline: ${constraints.timeline}`);
  }

  if (constraints.budget) {
    segments.push(`Budget: ${constraints.budget}`);
  }

  if (constraints.existing_codebase) {
    segments.push(`Existing codebase: ${constraints.existing_codebase}`);
  }

  if (constraints.dependencies.length > 0) {
    segments.push(`Dependencies: ${constraints.dependencies.join(', ')}`);
  }

  if (constraints.other.length > 0) {
    segments.push(`Other: ${constraints.other.join(', ')}`);
  }

  return segments.length > 0 ? segments.join(' ') : 'No hard constraints confirmed yet.';
}

function buildStructuredBriefPrompt(brief: ProjectBriefStructured, rawDescription: string, toolsContext: string) {
  return [
    'PROJECT BRIEF - read this before doing anything else:',
    '',
    `What it is: ${brief.what_it_is || rawDescription || 'Not confirmed yet.'}`,
    `Who it's for: ${brief.who_its_for || 'Not confirmed yet.'}`,
    `Problem it solves: ${brief.problem_solved || 'Not confirmed yet.'}`,
    'V1 scope:',
    `  IN: ${formatList(brief.v1_scope.in, 'Not confirmed yet.')}`,
    `  OUT: ${formatList(brief.v1_scope.out, 'Nothing explicitly out yet.')}`,
    `Stack confirmed: ${formatStackContext(brief.stack_context)}`,
    `Done when: ${brief.definition_done || 'Not confirmed yet.'}`,
    `Constraints: ${formatConstraints(brief.constraints)}`,
    '',
    "Builder's tools profile:",
    toolsContext || 'not specified',
    '',
    'This brief was produced through a direct conversation with the builder.',
    'Every decision you make must be consistent with this brief.',
    'Do not suggest tools outside the confirmed stack.',
    'Do not add features outside the V1 scope.',
    'Research targets for batch 2 must include the confirmed stack tools above everything else.',
  ].join('\n');
}

export function buildProjectBriefSummary(brief: Pick<
  StoredProjectBrief,
  | 'raw_description'
  | 'what_it_is'
  | 'who_its_for'
  | 'problem_solved'
  | 'definition_done'
  | 'v1_scope'
  | 'constraints'
>) {
  const lead = brief.what_it_is || brief.raw_description || 'This project';
  const audience = brief.who_its_for ? ` for ${brief.who_its_for}` : '';
  const problem = brief.problem_solved ? ` It solves ${brief.problem_solved}.` : '';
  const scope =
    brief.v1_scope.in.length > 0
      ? ` Version one is focused on ${brief.v1_scope.in.join(', ')}.`
      : '';
  const doneWhen = brief.definition_done ? ` It's done when ${brief.definition_done}.` : '';
  const constraints = formatConstraints(brief.constraints);
  const constraintsSentence =
    constraints !== 'No hard constraints confirmed yet.' ? ` Constraints: ${constraints}` : '';

  return `${lead}${audience}.${problem}${scope}${doneWhen}${constraintsSentence}`.replace(/\s+/g, ' ').trim();
}

export function createFallbackStructuredBrief(
  rawDescription: string,
  options?: {
    stackValue?: string | null;
    existingTools?: string[];
  },
): ProjectBriefStructured {
  const existingTools = dedupeText([...(options?.existingTools || []), ...parseProjectStackValues(options?.stackValue)]);

  return {
    what_it_is: rawDescription,
    who_its_for: '',
    problem_solved: '',
    v1_scope: {
      in: [],
      out: [],
    },
    stack_context: {
      confirmed: [],
      existing_tools: existingTools,
      open_to: [],
      notes: '',
    },
    definition_done: '',
    constraints: {
      budget: '',
      timeline: '',
      existing_codebase: '',
      dependencies: [],
      other: [],
    },
  };
}

function mapBriefRow(row: ProjectBriefRow): StoredProjectBrief {
  return {
    id: row.id,
    project_id: row.project_id,
    raw_description: row.raw_description,
    enriched_brief: row.enriched_brief,
    what_it_is: row.what_it_is || '',
    who_its_for: row.who_its_for || '',
    problem_solved: row.problem_solved || '',
    v1_scope: parseStructuredJson(row.v1_scope, projectBriefV1ScopeSchema, { in: [], out: [] }),
    stack_context: parseStructuredJson(row.stack_context, projectBriefStackContextSchema, {
      confirmed: [],
      existing_tools: [],
      open_to: [],
      notes: '',
    }),
    definition_done: row.definition_done || '',
    constraints: parseStructuredJson(row.constraints, projectBriefConstraintsSchema, {
      budget: '',
      timeline: '',
      existing_codebase: '',
      dependencies: [],
      other: [],
    }),
    future_ideas: parseStructuredJson(row.future_ideas, z.array(z.string()), []),
    conversation_turns: typeof row.conversation_turns === 'number' ? row.conversation_turns : 0,
    created_at: row.created_at,
  };
}

function mapIntakeMessageRow(row: IntakeMessageRow): ProjectIntakeMessage {
  return {
    id: row.id,
    project_id: row.project_id,
    role: row.role === 'agent' ? 'agent' : 'user',
    content: row.content,
    created_at: row.created_at,
  };
}

export function appendProjectBriefSystemPrompt(systemPrompt: string, briefPrompt: string) {
  return briefPrompt ? `${briefPrompt}\n\n${systemPrompt}` : systemPrompt;
}

export async function listProjectIntakeMessages(env: Bindings, projectId: string) {
  const result = await env.DB.prepare(`
    SELECT id, project_id, role, content, created_at
    FROM project_intake_messages
    WHERE project_id = ?
    ORDER BY id ASC
  `)
    .bind(projectId)
    .all();

  return (result.results as IntakeMessageRow[]).map(mapIntakeMessageRow);
}

export async function appendProjectIntakeMessage(
  env: Bindings,
  projectId: string,
  role: ProjectIntakeMessage['role'],
  content: string,
) {
  await env.DB.prepare(`
    INSERT INTO project_intake_messages (project_id, role, content)
    VALUES (?, ?, ?)
  `)
    .bind(projectId, role, content.trim())
    .run();

  const inserted = await env.DB.prepare(`
    SELECT id, project_id, role, content, created_at
    FROM project_intake_messages
    WHERE project_id = ?
    ORDER BY id DESC
    LIMIT 1
  `)
    .bind(projectId)
    .first();

  return mapIntakeMessageRow(inserted as IntakeMessageRow);
}

export async function getProjectBrief(env: Bindings, projectId: string) {
  const row = await env.DB.prepare(`
    SELECT id, project_id, raw_description, enriched_brief, what_it_is, who_its_for, problem_solved,
           v1_scope, stack_context, definition_done, constraints, future_ideas, conversation_turns, created_at
    FROM project_briefs
    WHERE project_id = ?
    LIMIT 1
  `)
    .bind(projectId)
    .first();

  return row ? mapBriefRow(row as ProjectBriefRow) : null;
}

export async function upsertProjectBrief(
  env: Bindings,
  payload: {
    projectId: string;
    rawDescription: string;
    structuredBrief: ProjectBriefStructured;
    toolsContext: string;
    conversationTurns: number;
    futureIdeas?: string[];
  },
) {
  const existing = await getProjectBrief(env, payload.projectId);
  const id = existing?.id || crypto.randomUUID();
  const futureIdeas = dedupeText([...(existing?.future_ideas || []), ...(payload.futureIdeas || [])]);
  const enrichedBrief = buildStructuredBriefPrompt(payload.structuredBrief, payload.rawDescription, payload.toolsContext);

  await env.DB.prepare(`
    INSERT INTO project_briefs (
      id, project_id, raw_description, enriched_brief, what_it_is, who_its_for, problem_solved,
      v1_scope, stack_context, definition_done, constraints, future_ideas, conversation_turns
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      raw_description = excluded.raw_description,
      enriched_brief = excluded.enriched_brief,
      what_it_is = excluded.what_it_is,
      who_its_for = excluded.who_its_for,
      problem_solved = excluded.problem_solved,
      v1_scope = excluded.v1_scope,
      stack_context = excluded.stack_context,
      definition_done = excluded.definition_done,
      constraints = excluded.constraints,
      future_ideas = excluded.future_ideas,
      conversation_turns = excluded.conversation_turns
  `)
    .bind(
      id,
      payload.projectId,
      payload.rawDescription,
      enrichedBrief,
      payload.structuredBrief.what_it_is || null,
      payload.structuredBrief.who_its_for || null,
      payload.structuredBrief.problem_solved || null,
      JSON.stringify(payload.structuredBrief.v1_scope),
      JSON.stringify(payload.structuredBrief.stack_context),
      payload.structuredBrief.definition_done || null,
      JSON.stringify(payload.structuredBrief.constraints),
      JSON.stringify(futureIdeas),
      payload.conversationTurns,
    )
    .run();

  const updated = await getProjectBrief(env, payload.projectId);
  if (!updated) {
    throw new Error('Project brief could not be saved.');
  }

  return updated;
}

export async function addFutureIdeasToProjectBrief(
  env: Bindings,
  projectId: string,
  ideas: string[],
) {
  const existing = await getProjectBrief(env, projectId);
  if (!existing) {
    return null;
  }

  return upsertProjectBrief(env, {
    projectId,
    rawDescription: existing.raw_description,
    structuredBrief: {
      what_it_is: existing.what_it_is,
      who_its_for: existing.who_its_for,
      problem_solved: existing.problem_solved,
      v1_scope: existing.v1_scope,
      stack_context: existing.stack_context,
      definition_done: existing.definition_done,
      constraints: existing.constraints,
    },
    toolsContext: existing.enriched_brief.includes("Builder's tools profile:")
      ? existing.enriched_brief.split("Builder's tools profile:\n")[1]?.split('\n\n')[0] || ''
      : '',
    conversationTurns: existing.conversation_turns,
    futureIdeas: [...existing.future_ideas, ...ideas],
  });
}

export async function loadProjectBriefContext(
  env: Bindings,
  projectId: string,
  userId: string,
  fallback?: {
    rawDescription?: string;
    projectStack?: string | null;
    existingTools?: string[];
  },
) {
  const toolsContext = await buildToolsContext(userId, env);
  const brief = await getProjectBrief(env, projectId);
  const effectiveStructured = brief
    ? {
        what_it_is: brief.what_it_is,
        who_its_for: brief.who_its_for,
        problem_solved: brief.problem_solved,
        v1_scope: brief.v1_scope,
        stack_context: brief.stack_context,
        definition_done: brief.definition_done,
        constraints: brief.constraints,
      }
    : createFallbackStructuredBrief(fallback?.rawDescription || '', {
        stackValue: fallback?.projectStack,
        existingTools: fallback?.existingTools,
      });
  const rawDescription = brief?.raw_description || fallback?.rawDescription || '';
  const effectiveBrief = brief || {
    id: '',
    project_id: projectId,
    raw_description: rawDescription,
    enriched_brief: buildStructuredBriefPrompt(effectiveStructured, rawDescription, toolsContext),
    what_it_is: effectiveStructured.what_it_is,
    who_its_for: effectiveStructured.who_its_for,
    problem_solved: effectiveStructured.problem_solved,
    v1_scope: effectiveStructured.v1_scope,
    stack_context: effectiveStructured.stack_context,
    definition_done: effectiveStructured.definition_done,
    constraints: effectiveStructured.constraints,
    future_ideas: [],
    conversation_turns: 0,
    created_at: '',
  };

  return {
    brief,
    effectiveBrief,
    toolsContext,
    promptContext: buildStructuredBriefPrompt(effectiveStructured, rawDescription, toolsContext),
    summary: buildProjectBriefSummary(effectiveBrief),
    confirmedStackTools: dedupeText([
      ...effectiveStructured.stack_context.confirmed,
      ...effectiveStructured.stack_context.existing_tools,
      ...parseProjectStackValues(fallback?.projectStack),
    ]),
    futureIdeas: effectiveBrief.future_ideas,
  };
}
