import type { Batch3Architect } from './generation-schemas';
import type { Bindings, GenerationBatchName } from './types';

export type GenerationStreamEvent =
  | { type: 'batch_start'; batch: GenerationBatchName; label: string }
  | { type: 'activity'; icon: string; message: string; timestamp: string }
  | { type: 'batch_complete'; batch: GenerationBatchName; duration_ms: number }
  | { type: 'checkpoint'; adr: Batch3Architect }
  | { type: 'pipeline_complete'; project_id: string }
  | { type: 'pipeline_failed'; error: string };

type PersistedGenerationEvent = {
  id: number;
  projectId: string;
  batchName: GenerationBatchName | null;
  createdAt: string;
  event: GenerationStreamEvent;
};

type LiveGenerationListener = (event: PersistedGenerationEvent) => void;

const encoder = new TextEncoder();
const TERMINAL_EVENT_TYPES = new Set<GenerationStreamEvent['type']>(['pipeline_complete', 'pipeline_failed']);
const liveGenerationListeners = new Map<string, Set<LiveGenerationListener>>();

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

function publishLiveGenerationEvent(projectId: string, event: PersistedGenerationEvent) {
  const listeners = liveGenerationListeners.get(projectId);
  if (!listeners || listeners.size === 0) {
    return;
  }

  listeners.forEach((listener) => listener(event));
}

function formatSseEvent(event: PersistedGenerationEvent) {
  return `id: ${event.id}\nevent: ${event.event.type}\ndata: ${JSON.stringify(event.event)}\n\n`;
}

export function isTerminalGenerationEvent(event: GenerationStreamEvent) {
  return TERMINAL_EVENT_TYPES.has(event.type);
}

export function getBatchStartLabel(batchName: GenerationBatchName) {
  return batchLabels[batchName];
}

export async function persistGenerationStreamEvent(
  env: Bindings,
  payload: {
    projectId: string;
    batchName?: GenerationBatchName;
    event: GenerationStreamEvent;
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
  const bufferedEvents: PersistedGenerationEvent[] = [];
  let writeChain = Promise.resolve();

  const cleanup = () => {
    if (isClosed) {
      return;
    }

    isClosed = true;
    unsubscribe();
    if (pingInterval !== null) {
      clearInterval(pingInterval);
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

    if (!replayComplete) {
      bufferedEvents.push(event);
      return;
    }

    latestEventId = event.id;
    enqueueChunk(formatSseEvent(event));

    if (isTerminalGenerationEvent(event.event)) {
      cleanup();
    }
  };

  const unsubscribe = subscribeToLiveGenerationEvents(payload.projectId, dispatchEvent);
  payload.signal.addEventListener('abort', cleanup, { once: true });

  void (async () => {
    try {
      const replayEvents = await listPersistedGenerationEventsSince(env, payload.projectId, payload.lastEventId);

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

      bufferedEvents
        .sort((left, right) => left.id - right.id)
        .forEach((event) => {
          if (event.id <= latestEventId) {
            return;
          }

          latestEventId = event.id;
          enqueueChunk(formatSseEvent(event));

          if (isTerminalGenerationEvent(event.event)) {
            cleanup();
          }
        });

      if (isClosed) {
        return;
      }

      pingInterval = setInterval(() => {
        enqueueChunk(': ping\n\n');
      }, 20_000);
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
