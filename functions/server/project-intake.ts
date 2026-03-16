import { z } from 'zod';
import { callAIText, extractJSON } from './ai';
import {
  buildProjectBriefSummary,
  createFallbackStructuredBrief,
  projectBriefStructuredSchema,
  type ProjectBriefStructured,
} from './project-briefs';
import { loadBuilderProfileContext } from './user-tools';
import type { Bindings, ProviderType } from './types';

const intakeQuestionSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string().trim().min(1),
  type: z.enum(['choice', 'open']),
  options: z.array(z.string().trim().min(1)).max(6).optional(),
});

const intakeQuestionResponseSchema = z.object({
  questions: z.array(intakeQuestionSchema).min(2).max(4),
});

const intakeAnswerEntrySchema = z.object({
  question_id: z.string().trim().min(1),
  question: z.string().trim().min(1),
  answer: z.string().trim().min(1),
  type: z.enum(['choice', 'open']),
});

const intakeAnswersPayloadSchema = z.object({
  questions: z.array(intakeQuestionSchema).min(1),
  answers: z.array(intakeAnswerEntrySchema),
  started_at: z.string().trim().min(1),
  completed_at: z.string().trim().optional(),
});

const intakeBriefSynthesisSchema = z.object({
  brief: projectBriefStructuredSchema,
  summary: z.string().trim().min(1),
});

type IntakeProviderContext = {
  providerType: ProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string | null;
};

export type IntakeQuestion = z.infer<typeof intakeQuestionSchema>;
export type IntakeAnswerEntry = z.infer<typeof intakeAnswerEntrySchema>;
export type IntakeAnswersPayload = z.infer<typeof intakeAnswersPayloadSchema>;

function normalizeQuestionId(value: string, fallbackIndex: number) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || `q-${fallbackIndex + 1}`;
}

function normalizeGeneratedQuestions(questions: IntakeQuestion[]) {
  const seen = new Set<string>();
  const normalized: IntakeQuestion[] = [];

  questions.forEach((question, index) => {
    const idBase = normalizeQuestionId(question.id, index);
    let id = idBase;
    let suffix = 2;

    while (seen.has(id)) {
      id = `${idBase}-${suffix}`;
      suffix += 1;
    }

    seen.add(id);
    normalized.push({
      ...question,
      id,
      options: question.type === 'choice'
        ? (question.options || []).map((option) => option.trim()).filter(Boolean).slice(0, 6)
        : undefined,
    });
  });

  return normalized.slice(0, 4);
}

function buildFallbackQuestions(rawDescription: string): IntakeQuestion[] {
  const normalized = rawDescription.toLowerCase();
  const questions: IntakeQuestion[] = [
    {
      id: 'target-user',
      text: 'Who is the primary user for this first version?',
      type: 'open',
    },
    {
      id: 'scope-priority',
      text: 'Which outcome matters most for v1?',
      type: 'open',
    },
  ];

  if (!normalized.includes('payment') && !normalized.includes('billing') && !normalized.includes('subscription')) {
    questions.push({
      id: 'monetization',
      text: 'How should this project make money in the first release?',
      type: 'choice',
      options: ['Subscription', 'One-time payment', 'Free for now'],
    });
  } else {
    questions.push({
      id: 'architecture-tradeoff',
      text: 'Which tradeoff matters more right now?',
      type: 'choice',
      options: ['Speed to launch', 'Long-term flexibility', 'Lowest running cost'],
    });
  }

  return questions;
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

function formatWorkspaceProfileSummary(builderProfile: Awaited<ReturnType<typeof loadBuilderProfileContext>>) {
  if (builderProfile.declaredTools.length === 0) {
    return 'No workspace tools saved yet.';
  }

  return builderProfile.declaredTools
    .map((tool) => `${tool.category}: ${tool.name}`)
    .join(', ');
}

export function createIntakeAnswersPayload(questions: IntakeQuestion[]): IntakeAnswersPayload {
  return {
    questions: normalizeGeneratedQuestions(questions),
    answers: [],
    started_at: new Date().toISOString(),
  };
}

export function parseIntakeAnswersPayload(input: unknown): IntakeAnswersPayload | null {
  if (!input) {
    return null;
  }

  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return null;
    }
  }

  const parsed = intakeAnswersPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function getNextIntakeQuestion(payload: IntakeAnswersPayload): IntakeQuestion | null {
  const answeredIds = new Set(payload.answers.map((entry) => entry.question_id));
  return payload.questions.find((question) => !answeredIds.has(question.id)) || null;
}

export function recordIntakeAnswer(
  payload: IntakeAnswersPayload,
  question: IntakeQuestion,
  answer: string,
): IntakeAnswersPayload {
  const trimmedAnswer = answer.trim();
  const remainingAnswers = payload.answers.filter((entry) => entry.question_id !== question.id);

  return {
    ...payload,
    answers: [
      ...remainingAnswers,
      {
        question_id: question.id,
        question: question.text,
        answer: trimmedAnswer,
        type: question.type,
      },
    ],
  };
}

function formatIntakeAnswersForPrompt(payload: IntakeAnswersPayload) {
  if (payload.answers.length === 0) {
    return 'No clarifying answers yet.';
  }

  return payload.answers
    .map((entry, index) => `${index + 1}. ${entry.question}\nAnswer: ${entry.answer}`)
    .join('\n\n');
}

export async function generateClarifyingQuestions(options: {
  userId: string;
  env: Bindings;
  rawDescription: string;
  provider: IntakeProviderContext;
  onThinking?: (delta: string) => Promise<void> | void;
}) {
  const builderProfile = await loadBuilderProfileContext(options.userId, options.env);
  const profileSummary = formatWorkspaceProfileSummary(builderProfile);

  try {
    const { text } = await callAIText({
      providerType: options.provider.providerType,
      apiKey: options.provider.apiKey,
      model: options.provider.model,
      baseUrl: options.provider.baseUrl,
      role: 'fast',
      onReasoningDelta: options.onThinking,
      system: `You are generating clarifying questions for a software project planning tool.
Ask only what you need to know. The user is intelligent and technical - do not ask obvious things or things you can infer.

Return JSON only:
{ "questions": [{ "id": string, "text": string, "type": "choice" | "open", "options"?: string[] }] }`,
      prompt: `User's project description:
${options.rawDescription}

User's workspace profile (tools they already use):
${profileSummary}

Generate 2-4 clarifying questions that would most improve the plan quality.

Rules:
- Never ask about tools they've already listed in their profile.
- Never ask obvious questions answerable from the description.
- Focus on: ambiguous scope, key architectural decisions with real tradeoffs, monetisation if not clear, target user if not clear.
- Ask one thing per question.
- Keep each question under 20 words.
- For choice questions, include 2-4 options.`,
    });

    const parsedContent = JSON.parse(extractJSON(text));
    const validated = intakeQuestionResponseSchema.safeParse(parsedContent);
    if (!validated.success) {
      throw new Error(validated.error.message);
    }

    const normalized = normalizeGeneratedQuestions(validated.data.questions);
    if (normalized.length < 2) {
      throw new Error('Not enough valid clarifying questions.');
    }

    return normalized;
  } catch {
    return buildFallbackQuestions(options.rawDescription);
  }
}

export async function synthesizeIntakeBrief(options: {
  userId: string;
  env: Bindings;
  rawDescription: string;
  intakeAnswers: IntakeAnswersPayload;
  provider: IntakeProviderContext;
  onThinking?: (delta: string) => Promise<void> | void;
}) {
  const builderProfile = await loadBuilderProfileContext(options.userId, options.env);
  const toolsContext = builderProfile.toolsContext;
  const profileSummary = formatWorkspaceProfileSummary(builderProfile);
  const intakeAnswersSummary = formatIntakeAnswersForPrompt(options.intakeAnswers);

  try {
    const { text } = await callAIText({
      providerType: options.provider.providerType,
      apiKey: options.provider.apiKey,
      model: options.provider.model,
      baseUrl: options.provider.baseUrl,
      role: 'fast',
      onReasoningDelta: options.onThinking,
      system: `You are Scrimble's intake synthesizer. Convert project intake details into a structured brief.
Return JSON only in this shape:
{
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
  "summary": string
}`,
      prompt: `Project description:
${options.rawDescription}

Workspace profile:
${profileSummary}

Clarifying answers:
${intakeAnswersSummary}

Write concise, concrete brief fields. Keep assumptions explicit and practical.`,
    });

    const parsedContent = JSON.parse(extractJSON(text));
    const validated = intakeBriefSynthesisSchema.safeParse(parsedContent);
    if (!validated.success) {
      throw new Error(validated.error.message);
    }

    return {
      structuredBrief: mergeProfileTools(
        validated.data.brief,
        builderProfile.declaredTools.map((tool) => tool.name),
      ),
      summary: validated.data.summary,
      toolsContext,
    };
  } catch {
    const fallbackStructuredBrief = mergeProfileTools(
      createFallbackStructuredBrief(options.rawDescription, {
        existingTools: builderProfile.declaredTools.map((tool) => tool.name),
      }),
      builderProfile.declaredTools.map((tool) => tool.name),
    );

    return {
      structuredBrief: fallbackStructuredBrief,
      summary: buildProjectBriefSummary({
        raw_description: options.rawDescription,
        what_it_is: fallbackStructuredBrief.what_it_is,
        who_its_for: fallbackStructuredBrief.who_its_for,
        problem_solved: fallbackStructuredBrief.problem_solved,
        v1_scope: fallbackStructuredBrief.v1_scope,
        definition_done: fallbackStructuredBrief.definition_done,
        constraints: fallbackStructuredBrief.constraints,
      }),
      toolsContext,
    };
  }
}
