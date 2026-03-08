import { auth } from './firebase';
import { Project, Plan, Stage, Step, Edge as AppEdge, ChecklistItem } from '../types';

const API_BASE = '/api'; // Cloudflare Worker endpoint

interface ReviewResponse {
  success: boolean;
  decision: 'approve' | 'reject';
  unlockedStepIds?: string[];
  regenerate?: boolean;
}

async function fetchAPI<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }

  const token = await user.getIdToken();
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(errorBody?.error || `API error: ${response.statusText}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

export const dbService = {
  // Projects
  async getProject(id: string): Promise<Project | null> {
    return fetchAPI<Project | null>(`/projects/${id}`);
  },
  
  async getProjectsByUserId(_userId: string): Promise<Project[]> {
    return fetchAPI<Project[]>('/projects');
  },
  
  async createProject(project: Omit<Project, 'id' | 'created_at' | 'updated_at' | 'progress'>): Promise<string> {
    const data = await fetchAPI<{ id: string }>('/projects', {
      method: 'POST',
      body: JSON.stringify(project)
    });
    return data.id;
  },

  async updateProject(id: string, updates: Partial<Project>): Promise<void> {
    await fetchAPI(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
  },

  // Build Plans
  async getPlanByProjectId(projectId: string): Promise<Plan | null> {
    const plans = await fetchAPI<Plan[]>(`/plans?projectId=${projectId}`);
    return plans.length > 0 ? plans[0] : null;
  },
  
  async createPlan(plan: Omit<Plan, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const data = await fetchAPI<{ id: string }>('/plans', {
      method: 'POST',
      body: JSON.stringify(plan)
    });
    return data.id;
  },

  // Stages
  async getStagesByProjectId(projectId: string): Promise<Stage[]> {
    return fetchAPI<Stage[]>(`/stages?projectId=${projectId}`);
  },
  
  async createStage(stage: Omit<Stage, 'id' | 'created_at'>): Promise<string> {
    const data = await fetchAPI<{ id: string }>('/stages', {
      method: 'POST',
      body: JSON.stringify(stage)
    });
    return data.id;
  },

  // Steps
  async getStep(id: string): Promise<Step | null> {
    return fetchAPI<Step | null>(`/steps/${id}`);
  },

  async getStepsByProjectId(projectId: string): Promise<Step[]> {
    return fetchAPI<Step[]>(`/steps?projectId=${projectId}`);
  },
  
  async createStep(step: Omit<Step, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const data = await fetchAPI<{ id: string }>('/steps', {
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
  }): Promise<ReviewResponse> {
    return fetchAPI<ReviewResponse>(`/steps/${stepId}/review`, {
      method: 'POST',
      body: JSON.stringify(review)
    });
  },

  // Connections (Edges)
  async getEdgesByProjectId(projectId: string): Promise<AppEdge[]> {
    return fetchAPI<AppEdge[]>(`/edges?projectId=${projectId}`);
  },
  
  async createEdge(edge: Omit<AppEdge, 'id'>): Promise<string> {
    const data = await fetchAPI<{ id: string }>('/edges', {
      method: 'POST',
      body: JSON.stringify(edge)
    });
    return data.id;
  },

  // Checklist Items
  async getChecklistItemsByStepId(stepId: string): Promise<ChecklistItem[]> {
    return fetchAPI<ChecklistItem[]>(`/checklist-items?stepId=${stepId}`);
  },
  
  async createChecklistItem(item: Omit<ChecklistItem, 'id'>): Promise<string> {
    const data = await fetchAPI<{ id: string }>('/checklist-items', {
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
