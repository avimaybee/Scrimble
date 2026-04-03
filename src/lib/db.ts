import { auth } from './firebase';
import {
  ArchitectureDecisionRecord,
  ArchitectureReviewResponse,
  ChecklistItem,
  Edge as AppEdge,
  GenerationStreamEventEnvelopeV1,
  GenerationRuntime,
  GeneratedProjectFile,
  Plan,
  Project,
  ProjectGenerationActivity,
  ProjectGenerationBatchStartEvent,
  ProjectGenerationCheckpointEvent,
  ProjectGenerationEvent,
  ProjectGenerationInvariantEvent,
  ProjectGenerationThinking,
  ProjectGenerationStatusResponse,
  ProjectIntakeSession,
  Stage,
  Step,
  WorkflowBriefDrift,
  WorkflowUpdateActivity,
  WorkflowUpdateResult,
} from '../types';
import type {
  BuilderProfileCategory,
  BuilderProfileTool,
  ToolProficiency,
} from './builder-profile';

const API_BASE = '/api';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MESSAGE = 'This is taking longer than expected. Check your connection and try again.';

export type GenerationStreamConnectionState = 'connecting' | 'live' | 'reconnecting' | 'closed';

interface ReviewResponse {
  success: boolean;
  decision: 'approve' | 'reject';
  unlockedStepIds?: string[];
  regenerate?: boolean;
}

interface CreateProjectResponse {
  id: string;
  generation_runtime: GenerationRuntime;
}

type RuntimeNormalizedResponse = {
  success: boolean;
  generation_runtime: GenerationRuntime;
  resumedAt?: string;
  cancelledAt?: string;
  feedback_provided?: boolean;
};

interface UpdateWorkflowOptions {
  onActivity?: (activity: WorkflowUpdateActivity) => void;
}

type IntakeStartPayload = {
  description: string;
  providerId?: string;
  modelName?: string;
};

type IntakeRespondPayload = {
  message: string;
  providerId?: string;
  modelName?: string;
};

type IntakeConfirmPayload = {
  providerId?: string;
  modelName?: string;
};

export type StepEnrichmentPayload = {
  projectId: string;
  providerId?: string;
  feedback?: string;
  editedOutput?: string;
};

export class WorkflowBriefDriftError extends Error {
  drift: WorkflowBriefDrift;

  constructor(drift: WorkflowBriefDrift) {
    super(drift.message);
    this.name = 'WorkflowBriefDriftError';
    this.drift = drift;
  }
}

export class APIError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'APIError';
    this.status = status;
  }
}

type SaveUserToolPayload = {
  category: BuilderProfileCategory;
  name: string;
  proficiency?: ToolProficiency;
  notes?: string | null;
};

type UpdateUserToolPayload = {
  proficiency?: ToolProficiency;
  notes?: string | null;
};

interface StreamProjectGenerationOptions {
  signal?: AbortSignal;
  onBatchStart?: (event: ProjectGenerationBatchStartEvent) => void;
  onActivity?: (event: ProjectGenerationActivity) => void;
  onThinking?: (event: ProjectGenerationThinking) => void;
  onInvariant?: (event: ProjectGenerationInvariantEvent) => void;
  onBatchCompleted?: (event: ProjectGenerationEvent) => void;
  onCheckpoint?: (event: ProjectGenerationCheckpointEvent) => void;
  onComplete?: () => void;
  onFailed?: (event: { message: string; failureClass: GenerationRuntime['failureClass'] }) => void;
  onConnectionStateChange?: (state: GenerationStreamConnectionState) => void;
}

interface StreamStepEnrichmentOptions {
  signal?: AbortSignal;
  onOutput?: (output: string) => void;
}

interface APIRequestOptions extends RequestInit {
  timeoutMs?: number | null;
  timeoutMessage?: string;
}

const generationBatchLabels: Record<ProjectGenerationBatchStartEvent['batch'], string> = {
  batch_1_research_stack: 'Identifying your stack',
  batch_2_fetch_and_read: 'Reading the docs',
  batch_3_architect: "Planning how it's built",
  batch_4_plan_build: 'Building your plan',
  batch_5_enrich_steps: 'Writing step details',
  batch_6_generate_files: 'Preparing your files',
};

type ParsedGenerationStreamEvent =
  | { kind: 'batch_start'; event: ProjectGenerationBatchStartEvent }
  | { kind: 'activity'; event: ProjectGenerationActivity }
  | { kind: 'thinking'; event: ProjectGenerationThinking }
  | { kind: 'batch_complete'; event: ProjectGenerationEvent }
  | { kind: 'checkpoint'; event: ProjectGenerationCheckpointEvent }
  | { kind: 'invariant'; event: ProjectGenerationInvariantEvent }
  | { kind: 'pipeline_complete' }
  | {
      kind: 'pipeline_failed';
      message: string;
      failureClass: GenerationRuntime['failureClass'];
    }
  | { kind: 'ignored' };

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asEventBatch(value: unknown): ProjectGenerationBatchStartEvent['batch'] | null {
  if (typeof value !== 'string') {
    return null;
  }

  return value in generationBatchLabels
    ? (value as ProjectGenerationBatchStartEvent['batch'])
    : null;
}

function parseGenerationEnvelope(value: unknown): GenerationStreamEventEnvelopeV1 | null {
  const object = asObject(value);
  if (!object) {
    return null;
  }

  if (
    object.version !== 1
    || typeof object.eventType !== 'string'
    || typeof object.projectId !== 'string'
    || typeof object.timestamp !== 'string'
  ) {
    return null;
  }

  const payload = asObject(object.payload);
  if (!payload) {
    return null;
  }

  const batch = typeof object.batch === 'string' ? object.batch : null;
  const runId = typeof object.runId === 'string' ? object.runId : null;

  return {
    version: 1,
    eventType: object.eventType as GenerationStreamEventEnvelopeV1['eventType'],
    projectId: object.projectId,
    runId,
    batch: batch as GenerationStreamEventEnvelopeV1['batch'],
    timestamp: object.timestamp,
    payload,
  };
}

function parseGenerationStreamEvent(payload: unknown): ParsedGenerationStreamEvent {
  const envelope = parseGenerationEnvelope(payload);
  if (!envelope) {
    return { kind: 'ignored' };
  }

  const eventPayload = envelope.payload;
  switch (envelope.eventType) {
    case 'batch_start': {
      const batch = asEventBatch(eventPayload.batch);
      const label = typeof eventPayload.label === 'string' ? eventPayload.label : '';
      if (!batch || !label) {
        return { kind: 'ignored' };
      }

      return {
        kind: 'batch_start',
        event: { batch, label },
      };
    }
    case 'activity': {
      const message = typeof eventPayload.message === 'string' ? eventPayload.message : '';
      if (!message) {
        return { kind: 'ignored' };
      }

      return {
        kind: 'activity',
        event: {
          icon: typeof eventPayload.icon === 'string' ? eventPayload.icon : '✦',
          message,
          timestamp: typeof eventPayload.timestamp === 'string' ? eventPayload.timestamp : envelope.timestamp,
        },
      };
    }
    case 'thinking': {
      const content = typeof eventPayload.content === 'string' ? eventPayload.content : '';
      if (!content) {
        return { kind: 'ignored' };
      }

      return {
        kind: 'thinking',
        event: {
          content,
          timestamp: envelope.timestamp,
        },
      };
    }
    case 'batch_complete': {
      const batch = asEventBatch(eventPayload.batch);
      if (!batch) {
        return { kind: 'ignored' };
      }

      return {
        kind: 'batch_complete',
        event: {
          batch,
          completed_at: envelope.timestamp,
          duration_ms: typeof eventPayload.duration_ms === 'number' ? eventPayload.duration_ms : undefined,
          message: `${generationBatchLabels[batch]} complete.`,
        },
      };
    }
    case 'checkpoint':
      if (!asObject(eventPayload.adr)) {
        return { kind: 'ignored' };
      }

      return {
        kind: 'checkpoint',
        event: {
          adr: eventPayload.adr as ArchitectureDecisionRecord,
          run_id: typeof eventPayload.run_id === 'string' ? eventPayload.run_id : undefined,
        },
      };
    case 'invariant': {
      const driftType = typeof eventPayload.drift_type === 'string' ? eventPayload.drift_type : '';
      const message = typeof eventPayload.message === 'string' ? eventPayload.message : '';
      if (!driftType || !message) {
        return { kind: 'ignored' };
      }

      return {
        kind: 'invariant',
        event: {
          drift_type: driftType,
          message,
          timestamp: typeof eventPayload.timestamp === 'string' ? eventPayload.timestamp : envelope.timestamp,
        },
      };
    }
    case 'pipeline_complete':
      return { kind: 'pipeline_complete' };
    case 'pipeline_failed':
      return {
        kind: 'pipeline_failed',
        message: typeof eventPayload.error === 'string' ? eventPayload.error : 'Project generation failed.',
        failureClass:
          eventPayload.failureClass === 'quality_gate'
          || eventPayload.failureClass === 'run_failed'
          || eventPayload.failureClass === 'stalled'
          || eventPayload.failureClass === 'cancelled'
            ? eventPayload.failureClass
            : 'run_failed',
      };
    default:
      return { kind: 'ignored' };
  }
}

function normalizeProject(project: Project): Project {
  return project;
}

function normalizeProjectStatus(status: ProjectGenerationStatusResponse): ProjectGenerationStatusResponse {
  return status;
}

function normalizeIntakeSession(session: ProjectIntakeSession): ProjectIntakeSession {
  const latestThinking = [...session.messages]
    .reverse()
    .find(
      (message) =>
        message.role === 'agent'
        && message.content.startsWith('[thinking] ')
        && message.content.replace('[thinking] ', '').trim().length > 0,
    );

  return {
    ...session,
    messages: session.messages.filter((message) => !message.content.startsWith('[thinking] ')),
    agent_thinking: latestThinking
      ? latestThinking.content.replace('[thinking] ', '').trim()
      : session.agent_thinking?.trim() || undefined,
  };
}

function extractStepEnrichmentStreamText(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') {
    return '';
  }

  const value = parsed as {
    choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
    content?: Array<{ text?: string }>;
    delta?: { text?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  if (value.choices?.[0]?.delta?.content) {
    return value.choices[0].delta.content;
  }

  if (value.choices?.[0]?.message?.content) {
    return value.choices[0].message.content;
  }

  if (value.content?.[0]?.text) {
    return value.content[0].text;
  }

  if (value.delta?.text) {
    return value.delta.text;
  }

  if (value.candidates?.[0]?.content?.parts?.[0]?.text) {
    return value.candidates[0].content.parts[0].text;
  }

  return '';
}

function withoutClientTimeout(options: APIRequestOptions = {}): APIRequestOptions {
  return {
    timeoutMs: null,
    ...options,
  };
}

async function fetchAPI<T>(endpoint: string, options: APIRequestOptions = {}): Promise<T> {
  const response = await fetchWithAuth(endpoint, options);

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

async function fetchWithAuth(endpoint: string, options: APIRequestOptions = {}): Promise<Response> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Your session expired. Sign in again to keep going.');
  }

  const {
    headers,
    signal,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    timeoutMessage = DEFAULT_REQUEST_TIMEOUT_MESSAGE,
    ...requestInit
  } = options;
  const token = await user.getIdToken();
  const controller = new AbortController();
  let didTimeout = false;
  let timeoutId: number | null = null;
  if (typeof timeoutMs === 'number' && timeoutMs > 0) {
    timeoutId = window.setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);
  }
  const abortListener = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', abortListener, { once: true });
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...requestInit,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 401) {
        throw new APIError('Your session expired. Sign in again to keep going.', 401);
      }

      if (response.status >= 500) {
        throw new APIError(errorBody?.error || "Something's off on our end. Give it a second.", response.status);
      }

      throw new APIError(errorBody?.error || `API error: ${response.statusText}`, response.status);
    }

    return response;
  } catch (error) {
    if (signal?.aborted && !didTimeout) {
      throw error;
    }

    if (didTimeout) {
      throw new Error(timeoutMessage);
    }

    throw error instanceof Error
      ? error
      : new Error('Something went wrong while talking to Scrimble.');
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
    signal?.removeEventListener('abort', abortListener);
  }
}

export const dbService = {
  async getProject(id: string): Promise<Project | null> {
    const project = await fetchAPI<Project | null>(`/projects/${id}`);
    return project ? normalizeProject(project) : null;
  },

  async resumeProjectGeneration(id: string, options: { description?: string; providerId?: string } = {}): Promise<{ success: boolean; generation_runtime: GenerationRuntime; resumedAt?: string }> {
    const response = await fetchAPI<RuntimeNormalizedResponse>(`/projects/${id}/resume`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
    return response;
  },

  async nudgeProjectGeneration(id: string): Promise<{ success: boolean; message: string; nudgedAt?: string }> {
    return fetchAPI(`/projects/${id}/nudge`, {
      method: 'POST',
    });
  },

  async cancelProjectGeneration(id: string): Promise<{ success: boolean; generation_runtime: GenerationRuntime; cancelledAt?: string }> {
    const response = await fetchAPI<RuntimeNormalizedResponse>(`/projects/${id}/cancel`, {
      method: 'POST',
    });
    return response;
  },

  async getProjectsByUserId(): Promise<Project[]> {
    const projects = await fetchAPI<Project[]>('/projects');
    return projects.map(normalizeProject);
  },

  async createProject(project: { description: string; providerId?: string }): Promise<CreateProjectResponse> {
    const response = await fetchAPI<CreateProjectResponse>('/projects', {
      method: 'POST',
      body: JSON.stringify(project),
    });
    return response;
  },

  async updateProject(id: string, updates: Partial<Project>): Promise<void> {
    await fetchAPI(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async getProjectGenerationStatus(projectId: string): Promise<ProjectGenerationStatusResponse> {
    const status = await fetchAPI<ProjectGenerationStatusResponse>(`/projects/${projectId}/status`);
    return normalizeProjectStatus(status);
  },

  async startProjectIntake(payload: IntakeStartPayload): Promise<ProjectIntakeSession> {
    const session = await fetchAPI<ProjectIntakeSession>('/intake/start', withoutClientTimeout({
      method: 'POST',
      body: JSON.stringify(payload),
    }));
    return normalizeIntakeSession(session);
  },

  async respondToProjectIntake(projectId: string, payload: IntakeRespondPayload): Promise<ProjectIntakeSession> {
    const session = await fetchAPI<ProjectIntakeSession>(`/intake/${projectId}/respond`, withoutClientTimeout({
      method: 'POST',
      body: JSON.stringify(payload),
    }));
    return normalizeIntakeSession(session);
  },

  async confirmProjectIntake(projectId: string, payload: IntakeConfirmPayload = {}): Promise<{
    success: boolean;
    project_id: string;
    generation_runtime: GenerationRuntime;
  }> {
    const response = await fetchAPI<{
      success: boolean;
      project_id: string;
      generation_runtime: GenerationRuntime;
    }>(`/intake/${projectId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return response;
  },

  async getProjectIntake(projectId: string): Promise<ProjectIntakeSession> {
    const session = await fetchAPI<ProjectIntakeSession>(`/intake/${projectId}/brief`);
    return normalizeIntakeSession(session);
  },

  async getGeneratedFiles(projectId: string): Promise<GeneratedProjectFile[]> {
    return fetchAPI<GeneratedProjectFile[]>(`/projects/${projectId}/generated-files`);
  },

  async getArchitectureReview(projectId: string): Promise<ArchitectureReviewResponse> {
    return fetchAPI<ArchitectureReviewResponse>(`/projects/${projectId}/architecture-review`);
  },

  async approveArchitectureReview(projectId: string, feedback: string, preferredIde = ''): Promise<{
    success: boolean;
    generation_runtime: GenerationRuntime;
    feedback_provided: boolean;
  }> {
    const response = await fetchAPI<RuntimeNormalizedResponse>(`/projects/${projectId}/approve`, withoutClientTimeout({
      method: 'POST',
      body: JSON.stringify({ feedback, preferredIde }),
    }));
    return {
      ...response,
      feedback_provided: Boolean(response.feedback_provided),
    };
  },

  async downloadSkillFiles(projectId: string): Promise<void> {
    const response = await fetchWithAuth(`/projects/${projectId}/skill-files`, {
      method: 'GET',
      headers: {
        Accept: 'text/markdown',
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(errorBody?.error || `Plan download failed: ${response.statusText}`);
    }

    const blob = await response.blob();
    const contentDisposition = response.headers.get('Content-Disposition') || '';
    const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
    const filename = filenameMatch?.[1] || `plan-${projectId}.md`;
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
    const seenEventIds = new Set<number>();
    let hasEstablishedConnection = false;
    let reconnectDelay = 2000;
    const MAX_RECONNECT_DELAY = 30_000;
    const MAX_RECONNECT_DURATION = 5 * 60_000;
    let firstReconnectAt: number | null = null;

    while (!options.signal?.aborted && !reachedTerminalEvent) {
      options.onConnectionStateChange?.(hasEstablishedConnection ? 'reconnecting' : 'connecting');

      try {
        const response = await fetchWithAuth(`/projects/${projectId}/generation-stream`, withoutClientTimeout({
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(lastEventId > 0 ? { 'Last-Event-ID': `${lastEventId}` } : {}),
          },
          signal: options.signal,
        }));

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(errorBody?.error || `Generation stream error: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Generation stream did not return a readable body.');
        }

        hasEstablishedConnection = true;
        reconnectDelay = 2000;
        firstReconnectAt = null;
        options.onConnectionStateChange?.('live');

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
            const parsed = parseGenerationStreamEvent(JSON.parse(payload));
            const persistedEventId = currentEventId > 0 ? currentEventId : null;
            if (persistedEventId !== null) {
              if (seenEventIds.has(persistedEventId)) {
                return;
              }

              seenEventIds.add(persistedEventId);
              lastEventId = persistedEventId;
            }

            switch (parsed.kind) {
              case 'batch_start':
                options.onBatchStart?.(parsed.event);
                return;
              case 'activity':
                options.onActivity?.(parsed.event);
                return;
              case 'thinking':
                options.onThinking?.(parsed.event);
                return;
              case 'batch_complete':
                options.onBatchCompleted?.(parsed.event);
                return;
              case 'checkpoint':
                options.onCheckpoint?.(parsed.event);
                return;
              case 'invariant':
                options.onInvariant?.(parsed.event);
                return;
              case 'pipeline_complete':
                reachedTerminalEvent = true;
                options.onComplete?.();
                return;
              case 'pipeline_failed':
                reachedTerminalEvent = true;
                options.onFailed?.({
                  message: parsed.message,
                  failureClass: parsed.failureClass,
                });
                return;
              case 'ignored':
              default:
                return;
            }
          } catch {
            if (currentEvent === 'pipeline_failed') {
              reachedTerminalEvent = true;
              options.onFailed?.({
                message: 'Project generation failed.',
                failureClass: 'run_failed',
              });
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
          options.onConnectionStateChange?.('closed');
          return;
        }

        if (error instanceof Error && (
          error.message.startsWith('Generation stream error:')
          || error.message === 'Generation stream did not return a readable body.'
        )) {
          throw error;
        }

        options.onConnectionStateChange?.('reconnecting');
      }

      if (!options.signal?.aborted && !reachedTerminalEvent) {
        // Exponential backoff with max duration cap
        if (firstReconnectAt === null) {
          firstReconnectAt = Date.now();
        }

        if (Date.now() - firstReconnectAt > MAX_RECONNECT_DURATION) {
          options.onConnectionStateChange?.('closed');
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, reconnectDelay));
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      }
    }

    options.onConnectionStateChange?.('closed');
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

  async streamStepEnrichment(
    stepId: string,
    payload: StepEnrichmentPayload,
    options: StreamStepEnrichmentOptions = {},
  ): Promise<string> {
    const response = await fetchWithAuth(`/steps/${stepId}/enrich`, withoutClientTimeout({
      method: 'POST',
      body: JSON.stringify(payload),
      signal: options.signal,
      headers: {
        Accept: 'text/event-stream',
      },
    }));

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Step enrichment did not return a readable stream.');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullOutput = '';

    const appendOutput = (nextChunk: string) => {
      if (!nextChunk) {
        return;
      }

      fullOutput += nextChunk;
      options.onOutput?.(fullOutput);
    };

    const processLine = (line: string) => {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith(':')) {
        return;
      }

      const data = trimmedLine.startsWith('data:') ? trimmedLine.slice(5).trimStart() : trimmedLine;
      if (!data || data === '[DONE]') {
        return;
      }

      try {
        appendOutput(extractStepEnrichmentStreamText(JSON.parse(data)));
      } catch {
        if (!trimmedLine.startsWith('data:')) {
          appendOutput(data);
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        processLine(rawLine.replace(/\r$/, ''));
      }
    }

    if (buffer.trim()) {
      processLine(buffer.replace(/\r$/, ''));
    }

    return fullOutput;
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

  async updateChecklistItem(id: string, updates: Partial<Omit<ChecklistItem, 'id' | 'step_id'>>): Promise<void> {
    await fetchAPI(`/checklist-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
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
    payload: { message: string; providerId?: string; driftResolution?: 'apply_now' | 'save_for_later' },
    options: UpdateWorkflowOptions = {},
  ): Promise<WorkflowUpdateResult> {
    const response = await fetchWithAuth(`/workflows/${workflowId}/update`, withoutClientTimeout({
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        Accept: 'text/event-stream',
      },
    }));

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: string;
        error_code?: string;
        drift?: WorkflowBriefDrift;
      } | null;
      if (errorBody?.error_code === 'brief_drift' && errorBody.drift) {
        throw new WorkflowBriefDriftError(errorBody.drift);
      }
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
          if (parsed.error_code === 'brief_drift' && parsed.drift && typeof parsed.drift === 'object') {
            throw new WorkflowBriefDriftError(parsed.drift as WorkflowBriefDrift);
          }

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

  async deleteProject(projectId: string): Promise<void> {
    await fetchAPI<void>(`/projects/${projectId}`, {
      method: 'DELETE',
    });
  },

  async getUserTools(): Promise<BuilderProfileTool[]> {
    return fetchAPI<BuilderProfileTool[]>('/settings/user-tools');
  },

  async saveUserTool(payload: SaveUserToolPayload): Promise<BuilderProfileTool> {
    return fetchAPI<BuilderProfileTool>('/settings/user-tools', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async updateUserTool(id: string, payload: UpdateUserToolPayload): Promise<BuilderProfileTool> {
    return fetchAPI<BuilderProfileTool>(`/settings/user-tools/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async deleteUserTool(id: string): Promise<void> {
    await fetchAPI<void>(`/settings/user-tools/${id}`, {
      method: 'DELETE',
    });
  },
};
