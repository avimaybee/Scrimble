import { Project, Plan, Stage, Step, Edge as AppEdge, ChecklistItem } from '../types';

const API_BASE = '/api'; // Cloudflare Worker endpoint

async function fetchAPI(endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export const dbService = {
  // Projects
  async getProject(id: string): Promise<Project | null> {
    return fetchAPI(`/projects/${id}`);
  },
  
  async getProjectsByUserId(userId: string): Promise<Project[]> {
    return fetchAPI(`/projects?userId=${userId}`);
  },
  
  async createProject(project: Omit<Project, 'id' | 'created_at' | 'updated_at' | 'progress'>): Promise<string> {
    const data = await fetchAPI('/projects', {
      method: 'POST',
      body: JSON.stringify(project)
    });
    return data.id;
  },

  // Build Plans
  async getPlanByProjectId(projectId: string): Promise<Plan | null> {
    const plans = await fetchAPI(`/plans?projectId=${projectId}`);
    return plans.length > 0 ? plans[0] : null;
  },
  
  async createPlan(plan: Omit<Plan, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const data = await fetchAPI('/plans', {
      method: 'POST',
      body: JSON.stringify(plan)
    });
    return data.id;
  },

  // Stages
  async getStagesByProjectId(projectId: string): Promise<Stage[]> {
    return fetchAPI(`/stages?projectId=${projectId}`);
  },
  
  async createStage(stage: Omit<Stage, 'id' | 'created_at'>): Promise<string> {
    const data = await fetchAPI('/stages', {
      method: 'POST',
      body: JSON.stringify(stage)
    });
    return data.id;
  },

  // Steps
  async getStep(id: string): Promise<Step | null> {
    return fetchAPI(`/steps/${id}`);
  },

  async getStepsByProjectId(projectId: string): Promise<Step[]> {
    return fetchAPI(`/steps?projectId=${projectId}`);
  },
  
  async createStep(step: Omit<Step, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const data = await fetchAPI('/steps', {
      method: 'POST',
      body: JSON.stringify(step)
    });
    return data.id;
  },
  
  async updateStep(id: string, updates: Partial<Step>): Promise<void> {
    await fetchAPI(`/steps/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
  },
  
  async deleteStep(id: string): Promise<void> {
    await fetchAPI(`/steps/${id}`, {
      method: 'DELETE'
    });
  },

  async submitReview(stepId: string, review: { 
    decision: 'approve' | 'reject', 
    feedback?: string, 
    edited_output?: string 
  }): Promise<void> {
    await fetchAPI(`/steps/${stepId}/review`, {
      method: 'POST',
      body: JSON.stringify(review)
    });
  },

  // Connections (Edges)
  async getEdgesByProjectId(projectId: string): Promise<AppEdge[]> {
    return fetchAPI(`/edges?projectId=${projectId}`);
  },
  
  async createEdge(edge: Omit<AppEdge, 'id'>): Promise<string> {
    const data = await fetchAPI('/edges', {
      method: 'POST',
      body: JSON.stringify(edge)
    });
    return data.id;
  },

  // Checklist Items
  async getChecklistItemsByStepId(stepId: string): Promise<ChecklistItem[]> {
    return fetchAPI(`/checklist-items?stepId=${stepId}`);
  },
  
  async createChecklistItem(item: Omit<ChecklistItem, 'id'>): Promise<string> {
    const data = await fetchAPI('/checklist-items', {
      method: 'POST',
      body: JSON.stringify(item)
    });
    return data.id;
  },
  
  async toggleChecklistItem(id: string, completed: boolean): Promise<void> {
    await fetchAPI(`/checklist-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        is_completed: completed,
        completed_at: completed ? new Date().toISOString() : null
      })
    });
  },
  
  async applyPlanDiff(diff: any, projectId: string): Promise<void> {
    await fetchAPI(`/projects/${projectId}/plan-diff`, {
      method: 'POST',
      body: JSON.stringify(diff)
    });
  }
};
