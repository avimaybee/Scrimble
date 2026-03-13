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

// Zod Schemas for AI Validation
export const ChecklistItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  is_required: z.boolean().default(false)
});

export const PlanSchema = z.object({
  project_name: z.string().optional().default('Untitled Project'),
  project_type: z.string().optional().default('other'),
  stack: z.union([z.string(), z.record(z.string(), z.any())]).optional().default(''),
  stages: z.array(z.object({
    id: z.string(),
    title: z.string(),
    type: z.string(),
    order_index: z.number().default(0),
    steps: z.array(z.object({
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
      checklist: z.array(ChecklistItemSchema).optional().default([])
    }))
  })),
  edges: z.array(z.object({
    id: z.string(),
    source_step_id: z.string(),
    target_step_id: z.string(),
    edge_type: z.string().optional().default('default')
  })).optional().default([])
});

export const StepDetailSchema = z.object({
  ai_output: z.string(),
  prompts: z.array(z.object({
    label: z.string(),
    content: z.string()
  })).optional().default([])
});

export const PlanDiffSchema = z.object({
  summary: z.string(),
  changes: z.array(z.object({
    action: z.enum(['add', 'update', 'delete']),
    step_id: z.string().optional(),
    stage_id: z.string().optional(),
    updates: z.any().optional(),
    step: z.any().optional()
  }))
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
    const err = await response.json().catch(() => ({ message: "Your AI provider isn't responding. Try again shortly." }));
    const message = err.message || "Your AI provider isn't responding. Try again shortly.";
    toast.error(message);
    throw new Error(message);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let result = '';

  while (true) {
    const { done, value } = await reader!.read();
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

export type AIStep = z.infer<typeof PlanSchema>['stages'][number]['steps'][number];
export type AIStage = z.infer<typeof PlanSchema>['stages'][number];
export type AIEdge = z.infer<typeof PlanSchema>['edges'][number];
export type AIPlan = z.infer<typeof PlanSchema>;
export type AIDiff = z.infer<typeof PlanDiffSchema>;

export const generatePlan = async (prompt: string): Promise<AIPlan> => {
  const systemPrompt = `You are Scrimble, an expert AI project architect. Generate a step-by-step build plan in JSON format.
  Return an object with { stages: Stage[], steps: Step[], edges: Edge[] }.
  Each step can have a 'checklist' array of { id, label, is_required }.`;

  const result = await callAIProxy({
    system: systemPrompt,
    prompt: prompt
  });
  
  try {
    const parsed = JSON.parse(result);
    const validated = PlanSchema.safeParse(parsed);
    if (!validated.success) {
      console.error('Plan validation failed:', validated.error);
      console.log('Raw AI Response:', result);
      throw new Error('Something went wrong preparing your plan. Try again.');
    }
    return validated.data;
  } catch (e) {
    if (e instanceof Error && e.message.includes('preparing your plan')) throw e;
    console.error('Plan parsing error:', e);
    console.log('Raw AI Response:', result);
    throw new Error('Something went wrong preparing your plan. Try again.');
  }
};

export const getStepDetails = async (stepData: { id: string; title: string }, projectData: { id: string; name: string; stack: string }): Promise<{ ai_output: string; prompts: string }> => {
  const systemPrompt = `You are Scrimble's agentic specialist. Produce actionable guidance for a single project step in JSON format.
  Return { ai_output: string, prompts: [{ label, content }] }.`;
  const userPrompt = `Get details for: ${stepData.title} in ${projectData.name}. Stack: ${projectData.stack}`;
  
  const result = await callAIProxy({
    system: systemPrompt,
    prompt: userPrompt,
    projectId: projectData.id,
    stepId: stepData.id
  });
  
  try {
    const parsed = JSON.parse(result);
    const validated = StepDetailSchema.safeParse(parsed);
    if (!validated.success) {
      console.error('Step detail validation failed:', validated.error);
      console.log('Raw AI Response:', result);
      throw new Error('Something went wrong preparing step details. Try again.');
    }
    
    const data = validated.data;
    return {
      ai_output: data.ai_output,
      prompts: JSON.stringify(data.prompts)
    };
  } catch (e) {
    if (e instanceof Error && e.message.includes('preparing step details')) throw e;
    console.error('Step detail parsing error:', e);
    console.log('Raw AI Response:', result);
    throw new Error('Something went wrong preparing step details. Try again.');
  }
};

export const updatePlan = async (planSummary: any[], techStack: string, updateMessage: string): Promise<AIDiff> => {
  const systemPrompt = `You are Scrimble's plan adapter. Output a JSON diff of what should change based on the request.
  Return { summary: string, changes: [{ action, step_id?, stage_id?, updates?, step? }] }.`;
  const userPrompt = `Update plan for: ${updateMessage}. Current stack: ${techStack}. Plan: ${JSON.stringify(planSummary)}`;

  const result = await callAIProxy({
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
