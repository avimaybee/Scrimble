import { z } from 'zod';
import { callAIText, extractJSON } from './ai';
import {
  buildProjectBriefSummary,
  projectBriefStructuredSchema,
  type ProjectBriefStructured,
  type ProjectIntakeMessage,
} from './project-briefs';
import { loadBuilderProfileContext } from './user-tools';
import type { Bindings, ProviderType } from './types';

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
  conversationTurns: number;
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
- Each question must move toward a specific gap in your understanding.
- Never ask about tools or stack they already have in their profile.
- Never ask for information you can reasonably infer.
- When you have all 7 pieces of context, respond with exactly:
  READY: {one paragraph brief summarizing what you now understand}
- Maximum 4 exchanges. If you still have gaps after 4, make reasonable assumptions and signal READY anyway.
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

Current exchange count: ${options.conversationTurns} of 4.

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
  const forcedReady = options.conversationTurns >= 4 && !parsed.ready;
  const ready = parsed.ready || parsed.agent_reply.startsWith('READY:') || forcedReady;
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
  // Minimal turn count 4 to force full brief synthesis
  return runProjectIntakeTurn({
    ...options,
    conversationTurns: 4,
  });
}
