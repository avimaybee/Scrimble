import type { Batch3Architect } from './generation-schemas';
import type { Bindings, GenerationBatchName } from './types';

export type GenerationStreamEvent =
  | { type: 'batch_start'; batch: GenerationBatchName; label: string }
  | { type: 'activity'; icon: string; message: string; timestamp: string }
  | { type: 'thinking'; content: string }
  | { type: 'batch_complete'; batch: GenerationBatchName; duration_ms: number }
  | { type: 'checkpoint'; adr: Batch3Architect }
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

type LiveGenerationListener = (event: LiveGenerationEventEnvelope) => void;
type GenerationThinkingState = {
  batchName: GenerationBatchName | null;
  content: string;
  sequence: number;
};

const encoder = new TextEncoder();
const TERMINAL_EVENT_TYPES = new Set<GenerationStreamEvent['type']>(['pipeline_complete', 'pipeline_failed']);
const liveGenerationListeners = new Map<string, Set<LiveGenerationListener>>();
const EVENT_POLL_INTERVAL_MS = 750;
let ensureThinkingTablePromise: Promise<void> | null = null;

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
      };
    case 'review_required':
      return payload.adr ? { type: 'checkpoint', adr: payload.adr as Batch3Architect } : null;
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

function subscribeToLiveGenerationEvents(projectId: string, listener: LiveGenerationListener) {
  const listeners = liveGenerationListeners.get(projectId) || new Set<LiveGenerationListener>();
  listeners.add(listener);
  liveGenerationListeners.set(projectId, listeners);

  return () => {
    const currentListeners = liveGenerationListeners.get(projectId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      liveGenerationListeners.delete(projectId);
    }
  };
}

function publishLiveGenerationEvent(projectId: string, event: LiveGenerationEventEnvelope) {
  const listeners = liveGenerationListeners.get(projectId);
  if (!listeners || listeners.size === 0) {
    return;
  }

  listeners.forEach((listener) => listener(event));
}

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

async function ensureGenerationThinkingTable(env: Bindings) {
  if (!ensureThinkingTablePromise) {
    ensureThinkingTablePromise = env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS project_generation_live_state (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        batch_name TEXT,
        content TEXT NOT NULL DEFAULT '',
        sequence INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `)
      .run()
      .then(() => undefined)
      .catch((error: unknown) => {
        ensureThinkingTablePromise = null;
        throw error;
      });
  }

  return ensureThinkingTablePromise;
}

async function loadGenerationThinkingState(env: Bindings, projectId: string) {
  await ensureGenerationThinkingTable(env);
  const row = await env.DB.prepare(`
    SELECT batch_name, content, sequence
    FROM project_generation_live_state
    WHERE project_id = ?
  `)
    .bind(projectId)
    .first();

  if (!row) {
    return null;
  }

  return {
    batchName: (asText(row.batch_name) || null) as GenerationBatchName | null,
    content: asText(row.content),
    sequence: asNumber(row.sequence),
  } satisfies GenerationThinkingState;
}

export async function resetGenerationThinkingState(
  env: Bindings,
  projectId: string,
  batchName: GenerationBatchName | null,
) {
  await ensureGenerationThinkingTable(env);
  await env.DB.prepare('DELETE FROM project_generation_live_state WHERE project_id = ?').bind(projectId).run();
}


export async function appendGenerationThinkingDelta(
  env: Bindings,
  payload: {
    projectId: string;
    batchName: GenerationBatchName;
    content: string;
  },
) {
  await ensureGenerationThinkingTable(env);
  await env.DB.prepare(`
    INSERT INTO project_generation_live_state (project_id, batch_name, content, sequence, updated_at)
    VALUES (?, ?, ?, 1, datetime('now'))
    ON CONFLICT(project_id) DO UPDATE SET
      batch_name = excluded.batch_name,
      content = CASE
        WHEN project_generation_live_state.batch_name = excluded.batch_name
          THEN project_generation_live_state.content || excluded.content
        ELSE excluded.content
      END,
      sequence = CASE
        WHEN project_generation_live_state.batch_name = excluded.batch_name
          THEN project_generation_live_state.sequence + 1
        ELSE 1
      END,
      updated_at = datetime('now')
  `)
    .bind(payload.projectId, payload.batchName, payload.content)
    .run();
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

  const persistedEvent: PersistedGenerationEvent = {
    id: asNumber(result.meta?.last_row_id),
    projectId: payload.projectId,
    batchName: payload.batchName || null,
    createdAt: new Date().toISOString(),
    event: payload.event,
  };

  publishLiveGenerationEvent(payload.projectId, persistedEvent);
  return persistedEvent;
}

export function emitTransientGenerationStreamEvent(payload: {
  projectId: string;
  batchName?: GenerationBatchName;
  event: Extract<GenerationStreamEvent, { type: 'thinking' }>;
}) {
  const transientEvent: LiveGenerationEventEnvelope = {
    id: null,
    projectId: payload.projectId,
    batchName: payload.batchName || null,
    createdAt: new Date().toISOString(),
    event: payload.event,
  };

  publishLiveGenerationEvent(payload.projectId, transientEvent);
  return transientEvent;
}

export function createThrottledThinkingEmitter(
  env: Bindings,
  projectId: string,
  batchName: GenerationBatchName,
  flushIntervalMs = 1000,
) {
  let buffer = '';
  let flushTimeout: ReturnType<typeof setTimeout> | null = null;
  let activeFlushPromise: Promise<void> | null = null;

  const flushBuffer = async () => {
    if (flushTimeout !== null) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }

    const currentBuffer = buffer;
    if (!currentBuffer) {
      return;
    }

    // Capture the flush promise so we can safely await it at the end
    activeFlushPromise = (async () => {
      try {
        await appendGenerationThinkingDelta(env, {
          projectId,
          batchName,
          content: currentBuffer,
        });
        // Only clear from the buffer what we successfully wrote,
        // in case the buffer grew while we were writing (though we re-slice below)
      } catch (error) {
        console.warn('[createThrottledThinkingEmitter] Failed to flush thinking delta to D1:', error);
      }
    })();

    await activeFlushPromise;
    // Remove the executed portion from the buffer
    buffer = buffer.slice(currentBuffer.length);
    activeFlushPromise = null;
  };

  return {
    onReasoningDelta: (delta: string) => {
      // 1. Immediately emit a transient event for connected frontend clients
      emitTransientGenerationStreamEvent({
        projectId,
        batchName,
        event: { type: 'thinking', content: delta },
      });

      // 2. Buffer for D1 writing
      buffer += delta;

      // 3. Schedule flush
      if (flushTimeout === null && !activeFlushPromise) {
        flushTimeout = setTimeout(() => {
          void flushBuffer();
        }, flushIntervalMs);
      }
    },
    flush: async () => {
      // Wait for any ongoing flush, then do one last flush
      if (activeFlushPromise) {
        await activeFlushPromise;
      }
      if (buffer) {
        await flushBuffer();
      }
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
  let replayComplete = false;
  let latestEventId = payload.lastEventId;
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  const bufferedEvents: LiveGenerationEventEnvelope[] = [];
  let writeChain = Promise.resolve();
  let latestThinkingState: GenerationThinkingState = {
    batchName: null,
    content: '',
    sequence: 0,
  };
  let pollInFlight = false;

  const cleanup = () => {
    if (isClosed) {
      return;
    }

    isClosed = true;
    unsubscribe();
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

  const dispatchEvent = (event: LiveGenerationEventEnvelope) => {
    if (event.id !== null && event.id <= latestEventId) {
      return;
    }

    if (!replayComplete) {
      bufferedEvents.push(event);
      return;
    }

    if (event.id !== null) {
      latestEventId = event.id;
    }

    if (event.event.type === 'batch_start') {
      latestThinkingState = {
        batchName: event.event.batch,
        content: '',
        sequence: 0,
      };
    } else if (event.event.type === 'thinking') {
      if (latestThinkingState.batchName !== event.batchName) {
        latestThinkingState = {
          batchName: event.batchName,
          content: '',
          sequence: 0,
        };
      }

      latestThinkingState = {
        ...latestThinkingState,
        content: `${latestThinkingState.content}${event.event.content}`,
        sequence: latestThinkingState.sequence + 1,
      };
    } else if (event.event.type === 'batch_complete' || isTerminalGenerationEvent(event.event)) {
      latestThinkingState = {
        batchName: event.batchName,
        content: '',
        sequence: 0,
      };
    }

    enqueueChunk(formatSseEvent(event));

    if (isTerminalGenerationEvent(event.event)) {
      cleanup();
    }
  };

  const unsubscribe = subscribeToLiveGenerationEvents(payload.projectId, dispatchEvent);
  payload.signal.addEventListener('abort', cleanup, { once: true });

  const pollForNewEvents = async () => {
    if (isClosed || pollInFlight) {
      return;
    }

    pollInFlight = true;

    try {
      const [persistedEvents, thinkingState] = await Promise.all([
        listPersistedGenerationEventsSince(env, payload.projectId, latestEventId),
        loadGenerationThinkingState(env, payload.projectId),
      ]);

      for (const event of persistedEvents) {
        dispatchEvent(event);
      }

      if (!thinkingState) {
        latestThinkingState = {
          batchName: null,
          content: '',
          sequence: 0,
        };
        return;
      }

      const batchChanged = thinkingState.batchName !== latestThinkingState.batchName;
      const sequenceReset = thinkingState.sequence < latestThinkingState.sequence;
      const contentReset = thinkingState.content.length < latestThinkingState.content.length;

      if (batchChanged || sequenceReset || contentReset) {
        latestThinkingState = thinkingState;
        return;
      }

      if (
        thinkingState.sequence > latestThinkingState.sequence &&
        thinkingState.content.length > latestThinkingState.content.length
      ) {
        const delta = thinkingState.content.slice(latestThinkingState.content.length);
        latestThinkingState = thinkingState;

        if (delta) {
          dispatchEvent({
            id: null,
            projectId: payload.projectId,
            batchName: thinkingState.batchName,
            createdAt: new Date().toISOString(),
            event: {
              type: 'thinking',
              content: delta,
            },
          });
        }
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

  void (async () => {
    try {
      const replayEvents = await listPersistedGenerationEventsSince(env, payload.projectId, payload.lastEventId);
      const initialThinkingState = await loadGenerationThinkingState(env, payload.projectId);
      if (initialThinkingState) {
        latestThinkingState = initialThinkingState;
      }

      for (const event of replayEvents) {
        latestEventId = Math.max(latestEventId, event.id);
        enqueueChunk(formatSseEvent(event));

        if (isTerminalGenerationEvent(event.event)) {
          replayComplete = true;
          cleanup();
          return;
        }
      }

      replayComplete = true;

      bufferedEvents.forEach((event) => {
        dispatchEvent(event);
      });

      if (isClosed) {
        return;
      }

      pingInterval = setInterval(() => {
        enqueueChunk(': ping\n\n');
      }, 20_000);
      pollInterval = setInterval(() => {
        void pollForNewEvents();
      }, EVENT_POLL_INTERVAL_MS);
    } catch {
      enqueueChunk(
        `event: pipeline_failed\ndata: ${JSON.stringify({
          type: 'pipeline_failed',
          error: 'Failed to open the live generation stream.',
        } satisfies GenerationStreamEvent)}\n\n`,
      );
      cleanup();
    }
  })();

  return stream.readable;
}
