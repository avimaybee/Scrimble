import { z } from 'zod';
import { callAIText, extractJSON } from '@scrimble/core';
import {
  buildProjectBriefSummary,
  projectBriefStructuredSchema,
  type ProjectBriefStructured,
  type ProjectIntakeMessage,
} from '@scrimble/core';
import { loadBuilderProfileContext } from '@scrimble/core';
import type { Bindings, ProviderType } from '@scrimble/core';

function normalizeIntakeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => (typeof entry === 'string' ? [entry.trim()] : []))
    .filter(Boolean);
}

const intakeAgentResponseSchema = z.object({
  ready: z.boolean().catch(false),
  agent_reply: z.string().trim().min(1),
  brief: projectBriefStructuredSchema,
  missing_context: z.preprocess(
    normalizeIntakeStringList,
    z.array(z.string().trim().min(1)),
  ),
});

type IntakeProviderContext = {
  providerType: ProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string | null;
};

function formatTranscript(messages: ProjectIntakeMessage[]) {
  return messages
    .map((message) => `${message.role === 'agent' ? 'Agent' : 'Builder'}: ${message.content}`)
    .join('\n\n');
}

function mergeProfileTools(brief: ProjectBriefStructured, toolNames: string[]) {
  const seen = new Set<string>();
  const existingTools: string[] = [];

  for (const value of [...brief.stack_context.existing_tools, ...toolNames]) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    existingTools.push(value.trim());
  }

  return {
    ...brief,
    stack_context: {
      ...brief.stack_context,
      existing_tools: existingTools,
    },
  };
}

function parseIntakeAgentResponse(rawText: string) {
  const parsedContent = JSON.parse(extractJSON(rawText));
  const validated = intakeAgentResponseSchema.safeParse(parsedContent);
  if (!validated.success) {
    throw new Error(`Failed to parse intake response: ${validated.error.message}`);
  }

  return validated.data;
}

export async function runProjectIntakeTurn(options: {
  userId: string;
  env: Bindings;
  rawDescription: string;
  messages: ProjectIntakeMessage[];
  provider: IntakeProviderContext;
  onThinking?: (delta: string) => Promise<void> | void;
  stepId?: string;
  projectId?: string;
}) {
  const builderProfile = await loadBuilderProfileContext(options.userId, options.env);
  const systemPrompt = `You are Scrimble's project intake agent. Your job is to understand what the builder wants to create well enough that a research pipeline can fetch the exact right documentation, libraries, and community knowledge before building their plan.

Builder profile (what they already have):
${builderProfile.toolsContext || 'not specified'}

Their initial description:
${options.rawDescription}

RULES:
- Ask ONE focused question per message. Never a list of questions.
- Each question must close a specific gap in your understanding.
- Never ask about tools or stack they already have in their profile.
- Never ask for information you can reasonably infer.
- Refuse to assume missing details. If the builder is vague (for example: "build an app", "create a project"), ask concrete follow-ups instead of guessing.
- For vague descriptions, clarify in this order until the answers are concrete:
  1) Who the user is and what context they are in.
  2) The core user workflow and exact outcome the product must deliver.
  3) V1 scope boundaries (must-have in scope vs explicitly out of scope).
  4) Non-negotiable constraints (timeline, budget, existing codebase, required integrations/dependencies, compliance/security limits).
- If the builder says "you decide" or "anything works", still ask for minimum boundaries before continuing.
- Only mark ready when the brief is concrete enough to build without guessing.
- When ready, respond with exactly:
  READY: {one paragraph brief summarizing what you now understand}
- Tone: direct, warm, curious. Like a smart colleague who genuinely wants to understand before diving in.
- Never use bullet points. Never use forms. Just conversation.

Return ONLY valid JSON in this shape:
{
  "ready": boolean,
  "agent_reply": string,
  "brief": {
    "what_it_is": string,
    "who_its_for": string,
    "problem_solved": string,
    "v1_scope": { "in": string[], "out": string[] },
    "stack_context": {
      "confirmed": string[],
      "existing_tools": string[],
      "open_to": string[],
      "notes": string
    },
    "definition_done": string,
    "constraints": {
      "budget": string,
      "timeline": string,
      "existing_codebase": string,
      "dependencies": string[],
      "other": string[]
    }
  },
  "missing_context": string[]
}

When ready is true, agent_reply must start with "READY: ".
When ready is false, agent_reply must be exactly one focused conversational question.`;

  const prompt = `Conversation so far:
  ${formatTranscript(options.messages)}
  
  Update the structured brief from the full conversation, not just the last message.`;

  const { text } = await callAIText({
    providerType: options.provider.providerType,
    apiKey: options.provider.apiKey,
    model: options.provider.model,
    baseUrl: options.provider.baseUrl,
    role: 'fast',
    system: systemPrompt,
    prompt,
    onReasoningDelta: options.onThinking,
  });

  const parsed = parseIntakeAgentResponse(text);
  const structuredBrief = mergeProfileTools(
    parsed.brief,
    builderProfile.declaredTools.map((tool) => tool.name),
  );
  const ready = parsed.ready || parsed.agent_reply.startsWith('READY:');
  const readySummary = buildProjectBriefSummary({
    raw_description: options.rawDescription,
    what_it_is: structuredBrief.what_it_is,
    who_its_for: structuredBrief.who_its_for,
    problem_solved: structuredBrief.problem_solved,
    v1_scope: structuredBrief.v1_scope,
    definition_done: structuredBrief.definition_done,
    constraints: structuredBrief.constraints,
  });

  return {
    ready,
    agentReply: ready
      ? parsed.agent_reply.startsWith('READY:')
        ? parsed.agent_reply
        : `READY: ${readySummary}`
      : parsed.agent_reply,
    structuredBrief,
    toolsContext: builderProfile.toolsContext,
    missingContext: parsed.missing_context,
  };
}

export async function synthesizeFullBrief(options: {
  userId: string;
  env: Bindings;
  rawDescription: string;
  messages: ProjectIntakeMessage[];
  provider: IntakeProviderContext;
  onThinking?: (delta: string) => Promise<void> | void;
}) {
  return runProjectIntakeTurn(options);
}
