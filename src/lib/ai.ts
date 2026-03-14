import { auth } from './firebase';
import { z } from 'zod';
import { toast } from 'sonner';

export type AIProviderType = 'gemini' | 'anthropic' | 'openai' | 'custom' | 'openrouter' | 'groq';

export interface AIProvider {
  id: string;
  name: string;
  provider: AIProviderType;
  base_url?: string;
  model?: string;
  is_default: boolean;
  masked_key?: string;
}

const DiffChecklistItemSchema = z.object({
  label: z.string(),
  is_required: z.boolean().optional().default(false),
});

export const PlanDiffSchema = z.object({
  summary: z.string(),
  changes: z.array(z.discriminatedUnion('action', [
    z.object({
      action: z.literal('update_step'),
      step_id: z.string(),
      updates: z.object({
        title: z.string().optional(),
        objective: z.string().optional(),
        why_it_matters: z.string().optional(),
        suggested_tools: z.array(z.string()).optional(),
        checklist: z.array(DiffChecklistItemSchema).optional(),
        done_when: z.string().optional(),
      }),
    }),
    z.object({
      action: z.literal('add_step'),
      stage_id: z.string(),
      step: z.object({
        title: z.string(),
        type: z.string().optional().default('task'),
        risk_level: z.string().optional().default('low'),
        objective: z.string().optional(),
        why_it_matters: z.string().optional(),
        suggested_tools: z.array(z.string()).optional(),
        checklist: z.array(DiffChecklistItemSchema).optional(),
        done_when: z.string().optional(),
      }),
    }),
    z.object({
      action: z.literal('remove_step'),
      step_id: z.string(),
    }),
  ])),
});

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function getAIProviders(): Promise<AIProvider[]> {
  const user = auth.currentUser;
  if (!user) return [];
  const token = await user.getIdToken();
  const response = await fetch('/api/ai/providers', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!response.ok) return [];
  return (await response.json()) as AIProvider[];
}

export async function saveAIProvider(data: {
  name: string;
  provider: AIProviderType;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  isDefault?: boolean;
}) {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');
  const token = await user.getIdToken();
  const response = await fetch('/api/ai/providers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to save provider');
  }
  return response.json();
}

export async function deleteAIProvider(providerId: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');

  const token = await user.getIdToken();
  const response = await fetch(`/api/ai/providers/${providerId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to remove provider');
  }

  return response.json();
}

export async function callAIProxy(params: {
  system: string;
  prompt: string;
  projectId?: string;
  stepId?: string;
  providerId?: string;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');

  const token = await user.getIdToken();

  const response = await fetch('/api/ai/proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      providerId: params.providerId,
      system: params.system,
      prompt: params.prompt,
      projectId: params.projectId,
      stepId: params.stepId
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Your AI provider isn't responding. Try again shortly." }));
    const message = err.error || "Your AI provider isn't responding. Try again shortly.";
    toast.error(message);
    throw new Error(message);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('AI provider stream is unavailable right now. Please try again.');
  }
  const decoder = new TextDecoder();
  let result = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.choices?.[0]?.delta?.content) {
            result += parsed.choices[0].delta.content;
          } else if (parsed.content?.[0]?.text) {
            result += parsed.content[0].text;
          } else if (parsed.candidates?.[0]?.content?.parts?.[0]?.text) {
            result += parsed.candidates[0].content.parts[0].text;
          }
        } catch (e) {}
      } else if (line.trim() && !line.startsWith(':')) {
        result += line;
      }
    }
  }

  return result;
}

export async function testAIProvider(providerId: string): Promise<boolean> {
  try {
    const result = await callAIProxy({
      providerId,
      system: 'You are a connection tester.',
      prompt: 'Respond with exactly "OK" and nothing else.'
    });
    return result.trim().toUpperCase().includes('OK');
  } catch (error) {
    console.error('Connection test failed:', error);
    return false;
  }
}

export type AIDiff = z.infer<typeof PlanDiffSchema>;

export const updatePlan = async (
  planSummary: unknown[],
  techStack: string,
  updateMessage: string,
  providerId?: string,
): Promise<AIDiff> => {
  const systemPrompt = `You are Scrimble's plan adapter. Output a JSON diff based on the request.
  Return ONLY valid JSON with shape:
  {
    "summary": string,
    "changes": [
      { "action": "update_step", "step_id": string, "updates": { "title"?: string, "objective"?: string, "why_it_matters"?: string, "suggested_tools"?: string[], "checklist"?: [{ "label": string, "is_required"?: boolean }], "done_when"?: string } }
      | { "action": "add_step", "stage_id": string, "step": { "title": string, "type"?: string, "risk_level"?: string, "objective"?: string, "why_it_matters"?: string, "suggested_tools"?: string[], "checklist"?: [{ "label": string, "is_required"?: boolean }], "done_when"?: string } }
      | { "action": "remove_step", "step_id": string }
    ]
  }`;
  const userPrompt = `Update plan for: ${updateMessage}. Current stack: ${techStack}. Plan: ${JSON.stringify(planSummary)}`;

  const result = await callAIProxy({
    providerId,
    system: systemPrompt,
    prompt: userPrompt
  });

  try {
    const parsed = JSON.parse(result);
    const validated = PlanDiffSchema.safeParse(parsed);
    if (!validated.success) {
      console.error('Plan update validation failed:', validated.error);
      console.log('Raw AI Response:', result);
      throw new Error('Something went wrong preparing your plan update. Try again.');
    }
    return validated.data;
  } catch (e) {
    if (e instanceof Error && e.message.includes('preparing your plan update')) throw e;
    console.error('Plan update parsing error:', e);
    console.log('Raw AI Response:', result);
    throw new Error('Something went wrong preparing your plan update. Try again.');
  }
};
