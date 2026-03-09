import {
  getBuilderProfileDocsTopic,
  getBuilderProfileResearchUrls,
  getPrimaryCodingEnvironmentName,
  isBuilderProfileResearchCategory,
  normalizeBuilderProfileName,
  type BuilderProfileCategory,
  type BuilderProfileTool,
  type ToolProficiency,
} from '../../src/lib/builder-profile';
import type { Bindings } from './types';

export type DeclaredResearchTool = BuilderProfileTool & {
  docs_url: string;
  changelog_url: string;
  github_url: string;
  docs_topic: string;
};

type UserToolRow = {
  id: string;
  user_id: string;
  category: string;
  name: string;
  proficiency: string | null;
  notes: string | null;
  created_at: string;
};

function normalizeProficiency(value: string | null): ToolProficiency {
  switch (value) {
    case 'learning':
    case 'expert':
      return value;
    case 'comfortable':
    default:
      return 'comfortable';
  }
}

function mapUserToolRow(row: UserToolRow): BuilderProfileTool {
  return {
    id: row.id,
    user_id: row.user_id,
    category: row.category as BuilderProfileCategory,
    name: row.name,
    proficiency: normalizeProficiency(row.proficiency),
    notes: row.notes,
    created_at: row.created_at,
  };
}

function buildToolsContextFromRows(tools: BuilderProfileTool[]) {
  if (!tools.length) {
    return '';
  }

  const codingEnv = tools.filter((tool) => tool.category === 'coding_environment');
  const aiTools = tools.filter((tool) => tool.category === 'ai_assistants');
  const infra = tools.filter((tool) =>
    ['backend_hosting', 'database', 'auth', 'payments'].includes(tool.category),
  );
  const learning = tools.filter((tool) => tool.proficiency === 'learning');
  const expert = tools.filter((tool) => tool.proficiency === 'expert');

  return `
BUILDER PROFILE — use this to make every output specific to this person:

Primary coding environment: ${codingEnv.map((tool) => tool.name).join(', ') || 'not specified'}
AI tools they use: ${aiTools.map((tool) => tool.name).join(', ') || 'not specified'}
Infrastructure they have access to: ${infra.map((tool) => `${tool.name}${tool.notes ? ` (${tool.notes})` : ''}`).join(', ') || 'not specified'}

Proficiency notes:
- Still learning: ${learning.map((tool) => tool.name).join(', ') || 'none'}
- Expert in: ${expert.map((tool) => tool.name).join(', ') || 'none'}

CRITICAL INSTRUCTIONS based on this profile:
- Write every prompt in this plan specifically for ${codingEnv[0]?.name || 'their coding tool'} — use its exact UI terminology, not generic instructions
- Never suggest alternatives to tools they already have — they have these, use them
- For tools marked as "learning", add extra context and beginner gotchas
- For tools marked as "expert", skip the basics and go straight to the advanced patterns
- Research targets for batch 2: prioritize fetching docs/changelogs/issues for ${infra.slice(0, 4).map((tool) => tool.name).join(', ') || 'their declared infrastructure tools'}
`.trim();
}

export async function listUserTools(
  env: Bindings,
  userId: string,
  orderBy: 'category_name' | 'created' = 'created',
) {
  const orderClause =
    orderBy === 'category_name'
      ? 'ORDER BY category ASC, name COLLATE NOCASE ASC'
      : 'ORDER BY category ASC, created_at ASC, name COLLATE NOCASE ASC';

  const result = await env.DB.prepare(`
    SELECT id, user_id, category, name, proficiency, notes, created_at
    FROM user_tools
    WHERE user_id = ?
    ${orderClause}
  `)
    .bind(userId)
    .all();

  return (result.results as UserToolRow[]).map(mapUserToolRow);
}

export async function buildToolsContext(userId: string, env: Bindings): Promise<string> {
  const tools = await listUserTools(env, userId, 'category_name');
  return buildToolsContextFromRows(tools);
}

export async function getUserDeclaredTools(userId: string, env: Bindings): Promise<DeclaredResearchTool[]> {
  const tools = await listUserTools(env, userId);
  return tools
    .filter((tool) => isBuilderProfileResearchCategory(tool.category))
    .map((tool) => {
      const researchUrls = getBuilderProfileResearchUrls(tool.name);
      return {
        ...tool,
        docs_url: researchUrls.docsUrl,
        changelog_url: researchUrls.changelogUrl,
        github_url: researchUrls.githubUrl,
        docs_topic: getBuilderProfileDocsTopic(tool.category, tool.name),
      };
    });
}

export async function loadBuilderProfileContext(userId: string, env: Bindings) {
  const tools = await listUserTools(env, userId);
  return {
    tools,
    toolsContext: buildToolsContextFromRows(
      [...tools].sort((left, right) =>
        left.category === right.category
          ? left.name.localeCompare(right.name)
          : left.category.localeCompare(right.category),
      ),
    ),
    declaredTools: tools
      .filter((tool) => isBuilderProfileResearchCategory(tool.category))
      .map((tool) => {
        const researchUrls = getBuilderProfileResearchUrls(tool.name);
        return {
          ...tool,
          docs_url: researchUrls.docsUrl,
          changelog_url: researchUrls.changelogUrl,
          github_url: researchUrls.githubUrl,
          docs_topic: getBuilderProfileDocsTopic(tool.category, tool.name),
        };
      }),
    primaryCodingEnvironment: getPrimaryCodingEnvironmentName(tools),
  };
}

export function appendBuilderProfileSystemPrompt(systemPrompt: string, toolsContext: string) {
  return toolsContext ? `${systemPrompt}\n\n${toolsContext}` : systemPrompt;
}

export function buildSkillFileProfileInstructions(primaryCodingEnvironment: string | null) {
  const normalized = primaryCodingEnvironment
    ? normalizeBuilderProfileName(primaryCodingEnvironment)
    : '';

  switch (normalized) {
    case 'cursor':
      return 'Treat .cursor/rules/scrimble-project.mdc as the primary artifact and make its composer instructions the most detailed.';
    case 'windsurf':
      return 'Treat .windsurfrules as the primary artifact and make its Cascade instructions the most detailed.';
    case 'claude code':
      return 'Treat CLAUDE.md as the primary artifact and make its Claude Code workflow guidance the most detailed.';
    case 'vs code':
      return 'Make .github/copilot-instructions.md especially specific to VS Code and GitHub Copilot.';
    default:
      return '';
  }
}

export async function upsertUserTool(
  env: Bindings,
  userId: string,
  payload: {
    category: BuilderProfileCategory;
    name: string;
    proficiency: ToolProficiency;
    notes?: string | null;
  },
) {
  const normalizedName = payload.name.trim();
  const notes = payload.notes?.trim() || null;

  const existing = await env.DB.prepare(`
    SELECT id
    FROM user_tools
    WHERE user_id = ? AND category = ? AND lower(name) = lower(?)
    LIMIT 1
  `)
    .bind(userId, payload.category, normalizedName)
    .first();

  if (existing?.id) {
    await env.DB.prepare(`
      UPDATE user_tools
      SET proficiency = ?, notes = ?
      WHERE id = ? AND user_id = ?
    `)
      .bind(payload.proficiency, notes, existing.id, userId)
      .run();

    const updated = await env.DB.prepare(`
      SELECT id, user_id, category, name, proficiency, notes, created_at
      FROM user_tools
      WHERE id = ? AND user_id = ?
    `)
      .bind(existing.id, userId)
      .first();

    return updated ? mapUserToolRow(updated as UserToolRow) : null;
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO user_tools (id, user_id, category, name, proficiency, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
    .bind(id, userId, payload.category, normalizedName, payload.proficiency, notes)
    .run();

  return {
    id,
    user_id: userId,
    category: payload.category,
    name: normalizedName,
    proficiency: payload.proficiency,
    notes,
    created_at: new Date().toISOString(),
  } satisfies BuilderProfileTool;
}

export async function updateUserTool(
  env: Bindings,
  userId: string,
  toolId: string,
  payload: {
    proficiency?: ToolProficiency;
    notes?: string | null;
  },
) {
  const existing = await env.DB.prepare(`
    SELECT id, user_id, category, name, proficiency, notes, created_at
    FROM user_tools
    WHERE id = ? AND user_id = ?
  `)
    .bind(toolId, userId)
    .first();

  if (!existing) {
    return null;
  }

  const current = mapUserToolRow(existing as UserToolRow);
  const notes = payload.notes === undefined ? current.notes : payload.notes?.trim() || null;
  const proficiency = payload.proficiency || current.proficiency;

  await env.DB.prepare(`
    UPDATE user_tools
    SET proficiency = ?, notes = ?
    WHERE id = ? AND user_id = ?
  `)
    .bind(proficiency, notes, toolId, userId)
    .run();

  return {
    ...current,
    proficiency,
    notes,
  } satisfies BuilderProfileTool;
}

export async function deleteUserTool(env: Bindings, userId: string, toolId: string) {
  const existing = await env.DB.prepare(`
    SELECT id
    FROM user_tools
    WHERE id = ? AND user_id = ?
  `)
    .bind(toolId, userId)
    .first();

  if (!existing) {
    return false;
  }

  await env.DB.prepare('DELETE FROM user_tools WHERE id = ? AND user_id = ?')
    .bind(toolId, userId)
    .run();

  return true;
}
