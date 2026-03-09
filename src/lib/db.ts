import { auth } from './firebase';
import {
  ArchitectureDecisionRecord,
  ArchitectureReviewResponse,
  ChecklistItem,
  Edge as AppEdge,
  GeneratedProjectFile,
  Plan,
  PreferredIde,
  Project,
  ProjectGenerationActivity,
  ProjectGenerationBatchStartEvent,
  ProjectGenerationCheckpointEvent,
  ProjectGenerationEvent,
  ProjectGenerationThinking,
  ProjectGenerationStatusResponse,
  Stage,
  Step,
  WorkflowUpdateActivity,
  WorkflowUpdateResult,
} from '../types';

const API_BASE = '/api';

interface ReviewResponse {
  success: boolean;
  decision: 'approve' | 'reject';
  unlockedStepIds?: string[];
  regenerate?: boolean;
}

interface CreateProjectResponse {
  id: string;
  generation_status: Project['generation_status'];
}

interface UpdateWorkflowOptions {
  onActivity?: (activity: WorkflowUpdateActivity) => void;
}

interface StreamProjectGenerationOptions {
  signal?: AbortSignal;
  onBatchStart?: (event: ProjectGenerationBatchStartEvent) => void;
  onActivity?: (event: ProjectGenerationActivity) => void;
  onThinking?: (event: ProjectGenerationThinking) => void;
  onBatchCompleted?: (event: ProjectGenerationEvent) => void;
  onCheckpoint?: (event: ProjectGenerationCheckpointEvent) => void;
  onComplete?: () => void;
  onFailed?: (message: string) => void;
}

const generationBatchLabels: Record<ProjectGenerationBatchStartEvent['batch'], string> = {
  batch_1_research_stack: 'Identifying your stack',
  batch_2_fetch_and_read: 'Reading the docs',
  batch_3_architect: "Planning how it's built",
  batch_4_plan_build: 'Building your plan',
  batch_5_enrich_steps: 'Writing step details',
  batch_6_generate_files: 'Preparing your files',
};

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
      Authorization: `Bearer ${token}`,
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

async function fetchWithAuth(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }

  const token = await user.getIdToken();
  return fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

export const dbService = {
  async getProject(id: string): Promise<Project | null> {
    return fetchAPI<Project | null>(`/projects/${id}`);
  },

  async getProjectsByUserId(_userId: string): Promise<Project[]> {
    return fetchAPI<Project[]>('/projects');
  },

  async createProject(project: { description: string; providerId?: string }): Promise<CreateProjectResponse> {
    return fetchAPI<CreateProjectResponse>('/projects', {
      method: 'POST',
      body: JSON.stringify(project),
    });
  },

  async updateProject(id: string, updates: Partial<Project>): Promise<void> {
    await fetchAPI(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async getProjectGenerationStatus(projectId: string): Promise<ProjectGenerationStatusResponse> {
    return fetchAPI<ProjectGenerationStatusResponse>(`/projects/${projectId}/status`);
  },

  async getGeneratedFiles(projectId: string): Promise<GeneratedProjectFile[]> {
    return fetchAPI<GeneratedProjectFile[]>(`/projects/${projectId}/generated-files`);
  },

  async getArchitectureReview(projectId: string): Promise<ArchitectureReviewResponse> {
    return fetchAPI<ArchitectureReviewResponse>(`/projects/${projectId}/architecture-review`);
  },

  async approveArchitectureReview(projectId: string, feedback: string, preferredIde: PreferredIde): Promise<{
    success: boolean;
    generation_status: Project['generation_status'];
    feedback_provided: boolean;
    preferred_ide: PreferredIde;
  }> {
    return fetchAPI<{
      success: boolean;
      generation_status: Project['generation_status'];
      feedback_provided: boolean;
      preferred_ide: PreferredIde;
    }>(`/projects/${projectId}/architecture-review`, {
      method: 'POST',
      body: JSON.stringify({ feedback, preferredIde }),
    });
  },

  async downloadSkillFiles(projectId: string): Promise<void> {
    const response = await fetchWithAuth(`/projects/${projectId}/skill-files`, {
      method: 'GET',
      headers: {
        Accept: 'application/zip',
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(errorBody?.error || `Skill files download failed: ${response.statusText}`);
    }

    const blob = await response.blob();
    const contentDisposition = response.headers.get('Content-Disposition') || '';
    const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
    const filename = filenameMatch?.[1] || `scrimble-${projectId}-ai-files.zip`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  },

  async streamProjectGeneration(projectId: string, options: StreamProjectGenerationOptions = {}): Promise<void> {
    let lastEventId = 0;
    let reachedTerminalEvent = false;

    while (!options.signal?.aborted && !reachedTerminalEvent) {
      try {
        const response = await fetchWithAuth(`/projects/${projectId}/generation-stream`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(lastEventId > 0 ? { 'Last-Event-ID': `${lastEventId}` } : {}),
          },
          signal: options.signal,
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(errorBody?.error || `Generation stream error: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Generation stream did not return a readable body.');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = 'message';
        let currentData: string[] = [];
        let currentEventId = lastEventId;

        const dispatchCurrentEvent = () => {
          if (currentData.length === 0) {
            currentEvent = 'message';
            currentEventId = lastEventId;
            return;
          }

          const payload = currentData.join('\n');
          currentData = [];

          try {
            const parsed = JSON.parse(payload) as Record<string, unknown>;
            lastEventId = currentEventId || lastEventId;

            if (currentEvent === 'batch_start' && typeof parsed.batch === 'string' && typeof parsed.label === 'string') {
              options.onBatchStart?.({
                batch: parsed.batch as ProjectGenerationBatchStartEvent['batch'],
                label: parsed.label,
              });
            }

            if (currentEvent === 'activity' && typeof parsed.message === 'string' && typeof parsed.timestamp === 'string') {
              options.onActivity?.({
                icon: typeof parsed.icon === 'string' ? parsed.icon : '✦',
                message: parsed.message,
                timestamp: parsed.timestamp,
              });
            }

            if (currentEvent === 'thinking' && typeof parsed.content === 'string') {
              options.onThinking?.({
                content: parsed.content,
                timestamp: new Date().toISOString(),
              });
            }

            if (currentEvent === 'batch_complete' && typeof parsed.batch === 'string') {
              const batch = parsed.batch as ProjectGenerationEvent['batch'];
              options.onBatchCompleted?.({
                batch,
                completed_at: new Date().toISOString(),
                duration_ms: typeof parsed.duration_ms === 'number' ? parsed.duration_ms : undefined,
                message: `${generationBatchLabels[batch]} complete.`,
              });
            }

            if (currentEvent === 'checkpoint' && parsed.adr && typeof parsed.adr === 'object') {
              options.onCheckpoint?.({
                adr: parsed.adr as ArchitectureDecisionRecord,
              });
            }

            if (currentEvent === 'pipeline_complete') {
              reachedTerminalEvent = true;
              options.onComplete?.();
            }

            if (currentEvent === 'pipeline_failed') {
              reachedTerminalEvent = true;
              options.onFailed?.(
                typeof parsed.error === 'string' ? parsed.error : 'Project generation failed.',
              );
            }
          } catch {
            if (currentEvent === 'pipeline_failed') {
              reachedTerminalEvent = true;
              options.onFailed?.('Project generation failed.');
            }
          } finally {
            currentEvent = 'message';
            currentEventId = lastEventId;
          }
        };

        while (!options.signal?.aborted && !reachedTerminalEvent) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n');
          buffer = chunks.pop() || '';

          for (const rawLine of chunks) {
            const line = rawLine.replace(/\r$/, '');

            if (!line) {
              dispatchCurrentEvent();
              continue;
            }

            if (line.startsWith(':')) {
              continue;
            }

            if (line.startsWith('id:')) {
              const parsedId = Number(line.slice(3).trim());
              if (Number.isFinite(parsedId)) {
                currentEventId = parsedId;
              }
              continue;
            }

            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim() || 'message';
              continue;
            }

            if (line.startsWith('data:')) {
              currentData.push(line.slice(5).trimStart());
            }
          }
        }

        if (currentData.length > 0) {
          dispatchCurrentEvent();
        }
      } catch (error) {
        if (options.signal?.aborted) {
          return;
        }

        if (error instanceof Error && (
          error.message.startsWith('Generation stream error:')
          || error.message === 'Generation stream did not return a readable body.'
        )) {
          throw error;
        }
      }

      if (!options.signal?.aborted && !reachedTerminalEvent) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  },

  async getPlanByProjectId(projectId: string): Promise<Plan | null> {
    const plans = await fetchAPI<Plan[]>(`/plans?projectId=${projectId}`);
    return plans.length > 0 ? plans[0] : null;
  },

  async createPlan(plan: Omit<Plan, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const data = await fetchAPI<{ id: string }>('/plans', {
      method: 'POST',
      body: JSON.stringify(plan),
    });
    return data.id;
  },

  async getStagesByProjectId(projectId: string): Promise<Stage[]> {
    return fetchAPI<Stage[]>(`/stages?projectId=${projectId}`);
  },

  async createStage(stage: Omit<Stage, 'id' | 'created_at'>): Promise<string> {
    const data = await fetchAPI<{ id: string }>('/stages', {
      method: 'POST',
      body: JSON.stringify(stage),
    });
    return data.id;
  },

  async getStep(id: string): Promise<Step | null> {
    return fetchAPI<Step | null>(`/steps/${id}`);
  },

  async getStepsByProjectId(projectId: string): Promise<Step[]> {
    return fetchAPI<Step[]>(`/steps?projectId=${projectId}`);
  },

  async createStep(step: Omit<Step, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const data = await fetchAPI<{ id: string }>('/steps', {
      method: 'POST',
      body: JSON.stringify(step),
    });
    return data.id;
  },

  async updateStep(id: string, updates: Partial<Step>): Promise<void> {
    await fetchAPI(`/steps/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async deleteStep(id: string): Promise<void> {
    await fetchAPI(`/steps/${id}`, {
      method: 'DELETE',
    });
  },

  async submitReview(
    stepId: string,
    review: {
      decision: 'approve' | 'reject';
      feedback?: string;
      edited_output?: string;
    },
  ): Promise<ReviewResponse> {
    return fetchAPI<ReviewResponse>(`/steps/${stepId}/review`, {
      method: 'POST',
      body: JSON.stringify(review),
    });
  },

  async getEdgesByProjectId(projectId: string): Promise<AppEdge[]> {
    return fetchAPI<AppEdge[]>(`/edges?projectId=${projectId}`);
  },

  async createEdge(edge: Omit<AppEdge, 'id'>): Promise<string> {
    const data = await fetchAPI<{ id: string }>('/edges', {
      method: 'POST',
      body: JSON.stringify(edge),
    });
    return data.id;
  },

  async getChecklistItemsByStepId(stepId: string): Promise<ChecklistItem[]> {
    return fetchAPI<ChecklistItem[]>(`/checklist-items?stepId=${stepId}`);
  },

  async createChecklistItem(item: Omit<ChecklistItem, 'id'>): Promise<string> {
    const data = await fetchAPI<{ id: string }>('/checklist-items', {
      method: 'POST',
      body: JSON.stringify(item),
    });
    return data.id;
  },

  async toggleChecklistItem(id: string, completed: boolean): Promise<void> {
    await fetchAPI(`/checklist-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        is_completed: completed,
        completed_at: completed ? new Date().toISOString() : null,
      }),
    });
  },

  async applyPlanDiff(diff: unknown, projectId: string): Promise<void> {
    await fetchAPI(`/projects/${projectId}/plan-diff`, {
      method: 'POST',
      body: JSON.stringify(diff),
    });
  },

  async updateWorkflow(
    workflowId: string,
    payload: { message: string; providerId?: string },
    options: UpdateWorkflowOptions = {},
  ): Promise<WorkflowUpdateResult> {
    const response = await fetchWithAuth(`/workflows/${workflowId}/update`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        Accept: 'text/event-stream',
      },
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(errorBody?.error || 'Failed to update the workflow.');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Workflow update did not return a readable body.');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = 'message';
    let currentData: string[] = [];
    let finalResult: WorkflowUpdateResult | null = null;

    const dispatchCurrentEvent = () => {
      if (currentData.length === 0) {
        currentEvent = 'message';
        return;
      }

      const payloadText = currentData.join('\n');
      currentData = [];

      try {
        const parsed = JSON.parse(payloadText) as Record<string, unknown>;

        if (currentEvent === 'activity' && typeof parsed.message === 'string') {
          options.onActivity?.({
            icon: typeof parsed.icon === 'string' ? parsed.icon : '✦',
            message: parsed.message,
            timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString(),
          });
        }

        if (currentEvent === 'complete' && typeof parsed.summary === 'string') {
          finalResult = {
            summary: parsed.summary,
            updated_steps:
              typeof parsed.updated_steps === 'number' && Number.isFinite(parsed.updated_steps)
                ? parsed.updated_steps
                : 0,
          };
        }

        if (currentEvent === 'error') {
          throw new Error(
            typeof parsed.error === 'string' ? parsed.error : 'Failed to update the workflow.',
          );
        }
      } finally {
        currentEvent = 'message';
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n');
      buffer = chunks.pop() || '';

      for (const rawLine of chunks) {
        const line = rawLine.replace(/\r$/, '');

        if (!line) {
          dispatchCurrentEvent();
          continue;
        }

        if (line.startsWith(':')) {
          continue;
        }

        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim() || 'message';
          continue;
        }

        if (line.startsWith('data:')) {
          currentData.push(line.slice(5).trimStart());
        }
      }
    }

    if (currentData.length > 0) {
      dispatchCurrentEvent();
    }

    if (!finalResult) {
      throw new Error('Workflow update did not return a completion payload.');
    }

    return finalResult;
  },
};
