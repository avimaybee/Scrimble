import { auth } from './firebase';

export interface ProviderKeys {
  gemini?: string;
  openai?: string;
  anthropic?: string;
  custom?: string;
  modal?: string;
}

export const getKeys = (): ProviderKeys => {
  const stored = localStorage.getItem('scrimble_keys');
  return stored ? JSON.parse(stored) : {};
};

export const saveKeys = (keys: ProviderKeys) => {
  localStorage.setItem('scrimble_keys', JSON.stringify(keys));
};

export async function callAIProxy(params: {
  system: string;
  prompt: string;
  projectId?: string;
  stepId?: string;
  providerId?: string;
}) {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');

  const token = await user.getIdToken();
  let targetProviderId = params.providerId || localStorage.getItem('scrimble_default_provider_id');

  if (!targetProviderId) {
    throw new Error('No AI provider selected. Please configure a provider in Settings.');
  }

  const response = await fetch('/api/ai/proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      providerId: targetProviderId,
      system: params.system,
      prompt: params.prompt,
      projectId: params.projectId,
      stepId: params.stepId
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'AI Proxy Error');
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

export const generatePlan = async (prompt: string): Promise<any> => {
  const systemPrompt = `You are Scrimble, an expert AI project architect. Generate a step-by-step build plan in JSON format.`;
  const result = await callAIProxy({
    system: systemPrompt,
    prompt: prompt
  });
  return JSON.parse(result);
};

export const getStepDetails = async (stepData: any, projectData: any): Promise<any> => {
  const systemPrompt = `You are Scrimble's agentic specialist. Produce actionable guidance for a single project step in JSON format.`;
  const userPrompt = `Get details for: ${stepData.title} in ${projectData.name}. Stack: ${projectData.stack}`;
  
  const result = await callAIProxy({
    system: systemPrompt,
    prompt: userPrompt,
    projectId: projectData.id,
    stepId: stepData.id
  });
  
  const parsed = JSON.parse(result);
  return {
    ai_output: parsed.ai_output || null,
    prompts: parsed.prompts ? JSON.stringify(parsed.prompts) : null
  };
};

export const updatePlan = async (planSummary: any, techStack: string, updateMessage: string): Promise<any> => {
  const systemPrompt = `You are Scrimble's plan adapter. Output a JSON diff of what should change based on the request.`;
  const userPrompt = `Update plan for: ${updateMessage}. Current stack: ${techStack}. Plan: ${JSON.stringify(planSummary)}`;

  const result = await callAIProxy({
    system: systemPrompt,
    prompt: userPrompt
  });

  return JSON.parse(result);
};
