import { auth } from './firebase';
import { z } from 'zod';
import { toast } from 'sonner';

export type AIProviderType = 'gemini' | 'anthropic' | 'openai' | 'custom' | 'openrouter' | 'groq';

export interface AIModel {
  id: string;
  provider_id: string;
  name: string;
}

export interface AIProvider {
  id: string;
  name: string;
  provider: AIProviderType;
  base_url?: string;
  model?: string; // deprecated, keeping for backward compatibility in some views if needed
  models: AIModel[];
  masked_key?: string;
}

export interface AIModelRoles {
  fast_model_provider_id: string | null;
  fast_model_name: string | null;
  deep_model_provider_id: string | null;
  deep_model_name: string | null;
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

export async function getAIModelRoles(): Promise<AIModelRoles> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }

  const token = await user.getIdToken();
  const response = await fetch('/api/settings/model-roles', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to load model roles.' }));
    throw new Error(err.error || 'Failed to load model roles.');
  }

  const payload = await response.json() as Partial<AIModelRoles>;
  return {
    fast_model_provider_id: payload.fast_model_provider_id || null,
    fast_model_name: payload.fast_model_name || null,
    deep_model_provider_id: payload.deep_model_provider_id || null,
    deep_model_name: payload.deep_model_name || null,
  };
}

export async function saveAIModelRoles(payload: AIModelRoles): Promise<AIModelRoles> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }

  const token = await user.getIdToken();
  const response = await fetch('/api/settings/model-roles', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to save model roles.' }));
    throw new Error(err.error || 'Failed to save model roles.');
  }

  const body = await response.json() as Partial<AIModelRoles>;
  return {
    fast_model_provider_id: body.fast_model_provider_id || null,
    fast_model_name: body.fast_model_name || null,
    deep_model_provider_id: body.deep_model_provider_id || null,
    deep_model_name: body.deep_model_name || null,
  };
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

export async function addAIModel(providerId: string, modelName: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');

  const token = await user.getIdToken();
  const response = await fetch(`/api/ai/providers/${providerId}/models`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: modelName }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to add model');
  }

  return response.json();
}

export async function deleteAIModel(providerId: string, modelId: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');

  const token = await user.getIdToken();
  const response = await fetch(`/api/ai/providers/${providerId}/models/${modelId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to remove model');
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
    const err = await response.json().catch(() => ({ message: "Your AI provider isn't responding. Try again shortly." }));
    const message = err.message || err.error || "Your AI provider isn't responding. Try again shortly.";
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
