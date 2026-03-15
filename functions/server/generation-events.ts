import type { Batch3Architect } from './generation-schemas';
import type { Bindings, GenerationBatchName } from './types';

export type GenerationStreamEvent =
  | { type: 'batch_start'; batch: GenerationBatchName; label: string }
  | { type: 'activity'; icon: string; message: string; timestamp: string }
  | { type: 'thinking'; content: string }
  | { type: 'batch_complete'; batch: GenerationBatchName; duration_ms: number; progress_percent: number }
  | { type: 'checkpoint'; adr: Batch3Architect; run_id?: string }
  | { type: 'pipeline_complete'; project_id: string }
  | { type: 'pipeline_failed'; error: string };

type LiveGenerationEventEnvelope = {
  id: number | null;
  projectId: string;
  batchName: GenerationBatchName | null;
  createdAt: string;
  event: GenerationStreamEvent;
};

type PersistedGenerationEvent = LiveGenerationEventEnvelope & {
  id: number;
};

type GenerationReplayContext = {
  generationStatus: string | null;
  generationRunId: string | null;
};

const encoder = new TextEncoder();
const TERMINAL_EVENT_TYPES = new Set<GenerationStreamEvent['type']>(['pipeline_complete', 'pipeline_failed']);
const EVENT_POLL_INTERVAL_MS = 2_000;

const batchLabels: Record<GenerationBatchName, string> = {
  batch_1_research_stack: 'Identifying your stack',
  batch_2_fetch_and_read: 'Reading the docs',
  batch_3_architect: 'Designing your architecture',
  batch_4_plan_build: 'Building your plan',
  batch_5_enrich_steps: 'Writing step details',
  batch_6_generate_files: 'Preparing your files',
};

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function formatRelativeDuration(status: unknown) {
  if (typeof status === 'number') {
    return `(${status})`;
  }

  if (typeof status === 'string' && status.trim()) {
    return `(${status.trim()})`;
  }

  return '';
}

function mapLegacyActivityIcon(kind: unknown) {
  switch (kind) {
    case 'fetch':
      return '🔍';
    case 'github':
      return '📦';
    case 'warning':
      return '⚠️';
    case 'architecture':
      return '🏗️';
    case 'complete':
      return '✅';
    case 'writing':
      return '📝';
    default:
      return '✦';
  }
}

function mapLegacyStoredEvent(
  eventType: string,
  payload: Record<string, unknown>,
  batchName: GenerationBatchName | null,
): GenerationStreamEvent | null {
  if (payload.type && typeof payload.type === 'string') {
    const typedPayload = payload as GenerationStreamEvent;
    if (
      typedPayload.type === 'batch_start' ||
      typedPayload.type === 'activity' ||
      typedPayload.type === 'batch_complete' ||
      typedPayload.type === 'checkpoint' ||
      typedPayload.type === 'pipeline_complete' ||
      typedPayload.type === 'pipeline_failed'
    ) {
      return typedPayload;
    }
  }

  switch (eventType) {
    case 'activity':
      return {
        type: 'activity',
        icon: mapLegacyActivityIcon(payload.kind),
        message: asText(payload.message),
        timestamp: asText(payload.timestamp, new Date().toISOString()),
      };
    case 'fetch_attempt': {
      const source = asText(payload.source, 'fetch');
      const technology = asText(payload.technology);
      const url = asText(payload.url);
      const durationMs = asNumber(payload.duration_ms);
      const statusSuffix = formatRelativeDuration(payload.status);

      return {
        type: 'activity',
        icon: source === 'github' ? '📦' : '🔍',
        message: `${source === 'github' ? 'Checking' : 'Reading'} ${technology || url} ${statusSuffix} in ${durationMs}ms`.trim(),
        timestamp: new Date().toISOString(),
      };
    }
    case 'batch_completed':
      return {
        type: 'batch_complete',
        batch: asText(payload.batch || batchName) as GenerationBatchName,
        duration_ms: asNumber(payload.duration_ms),
        progress_percent: asNumber(payload.progress_percent),
      };
    case 'review_required':
      return payload.adr
        ? {
            type: 'checkpoint',
            adr: payload.adr as Batch3Architect,
            run_id: asText(payload.run_id) || undefined,
          }
        : null;
    case 'generation_complete':
      return {
        type: 'pipeline_complete',
        project_id: asText(payload.project_id),
      };
    case 'generation_failed':
      return {
        type: 'pipeline_failed',
        error: asText(payload.error, 'Project generation failed.'),
      };
    default:
      return null;
  }
}

function parseStoredGenerationEvent(row: Record<string, unknown>): PersistedGenerationEvent | null {
  const payloadText = asText(row.payload, '{}');
  const eventType = asText(row.event_type);
  const batchName = asText(row.batch_name) || null;

  try {
    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    const event = mapLegacyStoredEvent(eventType, payload, batchName as GenerationBatchName | null);
    if (!event) {
      return null;
    }

    return {
      id: asNumber(row.id),
      projectId: asText(row.project_id),
      batchName: (batchName as GenerationBatchName | null) || null,
      createdAt: asText(row.created_at, new Date().toISOString()),
      event,
    };
  } catch {
    return null;
  }
}

async function loadGenerationReplayContext(env: Bindings, projectId: string): Promise<GenerationReplayContext> {
  const project = await env.DB.prepare(`
    SELECT generation_status, generation_run_id
    FROM projects
    WHERE id = ?
  `)
    .bind(projectId)
    .first();
  const projectRow = (project as Record<string, unknown> | null) ?? null;

  return {
    generationStatus: asText(projectRow?.generation_status) || null,
    generationRunId: asText(projectRow?.generation_run_id) || null,
  };
}

function shouldReplayPersistedEvent(event: PersistedGenerationEvent, replayContext: GenerationReplayContext) {
  if (event.event.type !== 'checkpoint') {
    return true;
  }

  if (replayContext.generationStatus !== 'awaiting_review') {
    return false;
  }

  return !(
    event.event.run_id &&
    replayContext.generationRunId &&
    event.event.run_id !== replayContext.generationRunId
  );
}

// In-memory live listeners removed: the pipeline runs in a separate Worker
// (scrimble-consumer / Durable Object) so in-memory pub/sub never reaches
// the Pages SSE endpoint.  All event delivery now goes through D1 polling.

function formatSseEvent(event: LiveGenerationEventEnvelope) {
  const idLine = event.id === null ? '' : `id: ${event.id}\n`;
  return `${idLine}event: ${event.event.type}\ndata: ${JSON.stringify(event.event)}\n\n`;
}

export function isTerminalGenerationEvent(event: GenerationStreamEvent) {
  return TERMINAL_EVENT_TYPES.has(event.type);
}

export function getBatchStartLabel(batchName: GenerationBatchName) {
  return batchLabels[batchName];
}

// D1-based thinking state removed — thinking deltas are transient and should
// not be written to the database.  The frontend receives them as activity
// events instead (see createThrottledThinkingEmitter below).

export async function resetGenerationThinkingState(
  _env: Bindings,
  _projectId: string,
  _batchName: GenerationBatchName | null,
) {
  // No-op: thinking state is no longer persisted to D1.
}


export async function appendGenerationThinkingDelta(
  _env: Bindings,
  _payload: {
    projectId: string;
    batchName: GenerationBatchName;
    content: string;
  },
) {
  // No-op: thinking deltas are no longer persisted to D1.
}

type Subscriber = (projectId: string, eventEnvelope: { id: number | null, event: GenerationStreamEvent }) => void;
const subscribers = new Set<Subscriber>();

export function subscribeToGenerationEvents(fn: Subscriber) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function publish(projectId: string, eventEnvelope: { id: number | null, event: GenerationStreamEvent }) {
  for (const sub of subscribers) {
    try {
      sub(projectId, eventEnvelope);
    } catch (e) {
      console.error('[GENERATION_EVENTS] Error in subscriber', e);
    }
  }
}

export async function persistGenerationStreamEvent(
  env: Bindings,
  payload: {
    projectId: string;
    batchName?: GenerationBatchName;
    event: Exclude<GenerationStreamEvent, { type: 'thinking' }>;
  },
) {
  const result = await env.DB.prepare(`
    INSERT INTO project_generation_events (project_id, event_type, batch_name, payload)
    VALUES (?, ?, ?, ?)
  `)
    .bind(
      payload.projectId,
      payload.event.type,
      payload.batchName || null,
      JSON.stringify(payload.event),
    )
    .run();

  const persisted = {
    id: asNumber(result.meta?.last_row_id),
    projectId: payload.projectId,
    batchName: payload.batchName || null,
    createdAt: new Date().toISOString(),
    event: payload.event,
  } satisfies PersistedGenerationEvent;
  
  publish(payload.projectId, persisted);

  return persisted;
}

export function emitTransientGenerationStreamEvent(payload: {
  projectId: string;
  batchName?: GenerationBatchName;
  event: Extract<GenerationStreamEvent, { type: 'thinking' }>;
}) {
  publish(payload.projectId, { id: null, event: payload.event });
}

export function createThrottledThinkingEmitter(
  _env: Bindings,
  projectId: string,
  batchName: GenerationBatchName,
  flushIntervalMs = 150,
) {
  let buffer = '';
  let lastFlush = Date.now();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const flushNow = () => {
    if (!buffer) return;
    emitTransientGenerationStreamEvent({
      projectId,
      batchName,
      event: { type: 'thinking', content: buffer },
    });
    buffer = '';
    lastFlush = Date.now();
  };

  return {
    onReasoningDelta: (delta: string) => {
      buffer += delta;
      
      const now = Date.now();
      if (now - lastFlush >= flushIntervalMs) {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        flushNow();
      } else if (!timeoutId) {
        timeoutId = setTimeout(() => {
          timeoutId = null;
          flushNow();
        }, flushIntervalMs - (now - lastFlush));
      }
    },
    flush: async () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      flushNow();
    },
  };
}

export async function listPersistedGenerationEventsSince(env: Bindings, projectId: string, lastEventId: number) {
  const rows = await env.DB.prepare(`
    SELECT id, project_id, event_type, batch_name, payload, created_at
    FROM project_generation_events
    WHERE project_id = ? AND id > ?
    ORDER BY id ASC
  `)
    .bind(projectId, lastEventId)
    .all();

  return (rows.results as Array<Record<string, unknown>>)
    .map(parseStoredGenerationEvent)
    .filter((event): event is PersistedGenerationEvent => Boolean(event));
}

export function createGenerationSseStream(
  env: Bindings,
  payload: {
    projectId: string;
    lastEventId: number;
    signal: AbortSignal;
  },
) {
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  let isClosed = false;
  let latestEventId = payload.lastEventId;
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let writeChain = Promise.resolve();
  let pollInFlight = false;

  const cleanup = () => {
    if (isClosed) {
      return;
    }

    isClosed = true;
    if (pingInterval !== null) {
      clearInterval(pingInterval);
    }
    if (pollInterval !== null) {
      clearInterval(pollInterval);
    }

    void writeChain.finally(async () => {
      try {
        await writer.close();
      } catch {
        // Ignore close errors from aborted streams.
      }
    });
  };

  const enqueueChunk = (chunk: string) => {
    if (isClosed) {
      return;
    }

    writeChain = writeChain
      .then(() => writer.write(encoder.encode(chunk)))
      .catch(() => {
        cleanup();
      });
  };

  const dispatchEvent = (event: PersistedGenerationEvent) => {
    if (event.id <= latestEventId) {
      return;
    }

    latestEventId = event.id;
    enqueueChunk(formatSseEvent(event));

    if (isTerminalGenerationEvent(event.event)) {
      cleanup();
    }
  };

  payload.signal.addEventListener('abort', cleanup, { once: true });

  const pollForNewEvents = async () => {
    if (isClosed || pollInFlight) {
      return;
    }

    pollInFlight = true;

    try {
      const persistedEvents = await listPersistedGenerationEventsSince(
        env,
        payload.projectId,
        latestEventId,
      );

      for (const event of persistedEvents) {
        dispatchEvent(event);
      }
    } catch (error) {
      console.warn('[generation-stream-poll-failed]', {
        projectId: payload.projectId,
        error: error instanceof Error ? error.message : 'Unknown polling error',
      });
    } finally {
      pollInFlight = false;
    }
  };

  // Bootstrap: replay persisted events, then start polling
  void (async () => {
    try {
      const replayContext = await loadGenerationReplayContext(env, payload.projectId);
      const replayEvents = await listPersistedGenerationEventsSince(
        env,
        payload.projectId,
        payload.lastEventId,
      );

      for (const event of replayEvents) {
        latestEventId = Math.max(latestEventId, event.id);
        if (!shouldReplayPersistedEvent(event, replayContext)) {
          continue;
        }

        enqueueChunk(formatSseEvent(event));

        if (isTerminalGenerationEvent(event.event)) {
          cleanup();
          return;
        }
      }

      if (isClosed) {
        return;
      }

      // Keep-alive pings every 20s
      pingInterval = setInterval(() => {
        enqueueChunk(': ping\n\n');
      }, 20_000);

      // Poll for new D1 events at a steady interval
      void pollForNewEvents();
      pollInterval = setInterval(() => {
        void pollForNewEvents();
      }, EVENT_POLL_INTERVAL_MS);
    } catch (error) {
      console.warn('[generation-stream-open-failed]', {
        projectId: payload.projectId,
        error: error instanceof Error ? error.message : 'Unknown replay error',
      });
      cleanup();
    }
  })();

  return stream.readable;
}
