import type { Batch3Architect, Batch7Verification } from './generation-schemas';
import type { Bindings, GenerationBatchName } from './types';
import { warn } from './logger';

export type GenerationStreamEvent =
  | { type: 'batch_start'; batch: GenerationBatchName; label: string }
  | { type: 'activity'; icon: string; message: string; timestamp: string }
  | { type: 'thinking'; content: string }
  | { type: 'batch_complete'; batch: GenerationBatchName; duration_ms: number; progress_percent: number }
  | { type: 'checkpoint'; adr: Batch3Architect; run_id?: string }
  | { type: 'verification_review_required'; report: Batch7Verification; run_id: string }
  | { type: 'pipeline_complete'; project_id: string }
  | { type: 'pipeline_failed'; error: string; failureClass?: string }
  | { type: 'invariant'; drift_type: string; message: string; timestamp: string };

type PersistedGenerationEventType = GenerationStreamEvent['type'];

export type GenerationEventEnvelopeV1 = {
  version: 1;
  eventType: PersistedGenerationEventType;
  projectId: string;
  runId: string | null;
  batch: GenerationBatchName | null;
  timestamp: string;
  payload: Record<string, unknown>;
};

type PersistedGenerationStreamEvent = GenerationStreamEvent;

type LiveGenerationEventRecord = {
  id: number | null;
  projectId: string;
  runId: string | null;
  batchName: GenerationBatchName | null;
  createdAt: string;
  event: PersistedGenerationStreamEvent;
};

type PersistedGenerationEvent = LiveGenerationEventRecord & {
  id: number;
};

const encoder = new TextEncoder();
const TERMINAL_EVENT_TYPES = new Set<GenerationStreamEvent['type']>(['pipeline_complete', 'pipeline_failed']);
const EVENT_POLL_INTERVAL_MS = 2_000;
const GENERATION_EVENT_VERSION = 1 as const;
const SSE_EVENT_NAME = 'generation_event';
const THINKING_EVENT_WINDOW_SIZE = 60;
const ACTIVE_THINKING_RUN_STATUSES = new Set(['queued', 'running', 'awaiting_review', 'approved', 'awaiting_verification_review']);

/**
 * Legacy event support flag.
 * When true, allows parsing of unversioned events stored before V1 envelope migration.
 * Can be disabled once all legacy events are migrated or expired.
 */
const LEGACY_EVENT_SUPPORT = true;

const batchLabels: Record<GenerationBatchName, string> = {
  batch_1_research_stack: 'Identifying your stack',
  batch_2_fetch_and_read: 'Reading the docs',
  batch_3_architect: 'Designing your architecture',
  batch_4_plan_build: 'Building your plan',
  batch_5_enrich_steps: 'Writing step details',
  batch_6_generate_files: 'Preparing your files',
  batch_7_verify: 'Verifying consistency',
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

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function eventPayloadFromStreamEvent(event: PersistedGenerationStreamEvent): Record<string, unknown> {
  switch (event.type) {
    case 'batch_start':
      return {
        batch: event.batch,
        label: event.label,
      };
    case 'activity':
      return {
        icon: event.icon,
        message: event.message,
        timestamp: event.timestamp,
      };
    case 'thinking':
      return {
        content: event.content,
      };
    case 'batch_complete':
      return {
        batch: event.batch,
        duration_ms: event.duration_ms,
        progress_percent: event.progress_percent,
      };
    case 'checkpoint':
      return {
        adr: event.adr,
        run_id: event.run_id ?? null,
      };
    case 'verification_review_required':
      return {
        report: event.report,
        run_id: event.run_id,
      };
    case 'pipeline_complete':
      return {
        project_id: event.project_id,
      };
    case 'pipeline_failed':
      return {
        error: event.error,
        failureClass: event.failureClass ?? null,
      };
    case 'invariant':
      return {
        drift_type: event.drift_type,
        message: event.message,
        timestamp: event.timestamp,
      };
  }
}

function streamEventFromEnvelope(envelope: GenerationEventEnvelopeV1): PersistedGenerationStreamEvent | null {
  switch (envelope.eventType) {
    case 'batch_start': {
      const batch = optionalText(envelope.payload.batch) as GenerationBatchName | null;
      const label = asText(envelope.payload.label);
      if (!batch || !label) {
        return null;
      }

      return {
        type: 'batch_start',
        batch,
        label,
      };
    }
    case 'activity': {
      const message = asText(envelope.payload.message);
      const timestamp = asText(envelope.payload.timestamp, envelope.timestamp);
      if (!message) {
        return null;
      }

      return {
        type: 'activity',
        icon: asText(envelope.payload.icon, '✦'),
        message,
        timestamp,
      };
    }
    case 'thinking': {
      const content = asText(envelope.payload.content);
      if (!content) {
        return null;
      }

      return {
        type: 'thinking',
        content,
      };
    }
    case 'batch_complete': {
      const batch = optionalText(envelope.payload.batch) as GenerationBatchName | null;
      if (!batch) {
        return null;
      }

      return {
        type: 'batch_complete',
        batch,
        duration_ms: asNumber(envelope.payload.duration_ms, 0),
        progress_percent: asNumber(envelope.payload.progress_percent, 0),
      };
    }
    case 'checkpoint':
      if (!envelope.payload.adr || typeof envelope.payload.adr !== 'object') {
        return null;
      }
      return {
        type: 'checkpoint',
        adr: envelope.payload.adr as Batch3Architect,
        run_id: optionalText(envelope.payload.run_id) || undefined,
      };
    case 'verification_review_required':
      if (!envelope.payload.report || typeof envelope.payload.report !== 'object') {
        return null;
      }
      return {
        type: 'verification_review_required',
        report: envelope.payload.report as Batch7Verification,
        run_id: asText(envelope.payload.run_id),
      };
    case 'pipeline_complete':
      return {
        type: 'pipeline_complete',
        project_id: asText(envelope.payload.project_id, envelope.projectId),
      };
    case 'pipeline_failed':
      return {
        type: 'pipeline_failed',
        error: asText(envelope.payload.error, 'Project generation failed.'),
        failureClass: optionalText(envelope.payload.failureClass) || undefined,
      };
    case 'invariant':
      return {
        type: 'invariant',
        drift_type: asText(envelope.payload.drift_type),
        message: asText(envelope.payload.message),
        timestamp: asText(envelope.payload.timestamp, envelope.timestamp),
      };
    default:
      return null;
  }
}

function isGenerationEventEnvelopeV1(value: unknown): value is GenerationEventEnvelopeV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.version === GENERATION_EVENT_VERSION
    && typeof candidate.eventType === 'string'
    && typeof candidate.projectId === 'string'
    && typeof candidate.timestamp === 'string'
    && candidate.payload !== null
    && typeof candidate.payload === 'object'
    && !Array.isArray(candidate.payload);
}

/**
 * Legacy event mapper — only used when LEGACY_EVENT_SUPPORT is enabled.
 * Handles unversioned events stored before V1 envelope migration.
 */
function mapLegacyStoredEvent(payload: Record<string, unknown>): PersistedGenerationStreamEvent | null {
  if (!LEGACY_EVENT_SUPPORT) {
    return null;
  }

  if (!payload.type || typeof payload.type !== 'string') {
    return null;
  }

  const typedPayload = payload as GenerationStreamEvent;
  if (
    typedPayload.type === 'batch_start'
    || typedPayload.type === 'activity'
    || typedPayload.type === 'thinking'
    || typedPayload.type === 'batch_complete'
    || typedPayload.type === 'checkpoint'
    || typedPayload.type === 'verification_review_required'
    || typedPayload.type === 'pipeline_complete'
    || typedPayload.type === 'pipeline_failed'
    || typedPayload.type === 'invariant'
  ) {
    return typedPayload;
  }

  return null;
}

export function buildGenerationEventEnvelope(payload: {
  projectId: string;
  runId?: string | null;
  batchName?: GenerationBatchName | null;
  timestamp?: string;
  event: PersistedGenerationStreamEvent;
}): GenerationEventEnvelopeV1 {
  return {
    version: GENERATION_EVENT_VERSION,
    eventType: payload.event.type,
    projectId: payload.projectId,
    runId: payload.runId ?? null,
    batch: payload.batchName ?? null,
    timestamp: payload.timestamp ?? new Date().toISOString(),
    payload: eventPayloadFromStreamEvent(payload.event),
  };
}

function parseStoredGenerationEvent(row: Record<string, unknown>): PersistedGenerationEvent | null {
  const payloadText = asText(row.payload, '{}');
  const batchName = asText(row.batch_name) || null;

  try {
    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    const canonicalEnvelope = isGenerationEventEnvelopeV1(payload)
      ? payload
      : null;
    const event = canonicalEnvelope
      ? streamEventFromEnvelope(canonicalEnvelope)
      : mapLegacyStoredEvent(payload);
    if (!event) {
      return null;
    }

    return {
      id: asNumber(row.id),
      projectId: canonicalEnvelope?.projectId || asText(row.project_id),
      runId: canonicalEnvelope?.runId || optionalText((payload as Record<string, unknown>).run_id),
      batchName: (canonicalEnvelope?.batch || batchName) as GenerationBatchName | null,
      createdAt: canonicalEnvelope?.timestamp || asText(row.created_at, new Date().toISOString()),
      event,
    };
  } catch {
    return null;
  }
}

// In-memory listeners are runtime-local only. Pages SSE delivery is driven by
// persisted D1 events because generation runs in a separate worker runtime.

function formatSseEvent(event: LiveGenerationEventRecord) {
  const idLine = event.id === null ? '' : `id: ${event.id}\n`;
  const envelope = buildGenerationEventEnvelope({
    projectId: event.projectId,
    runId: event.runId,
    batchName: event.batchName,
    timestamp: event.createdAt,
    event: event.event,
  });
  return `${idLine}event: ${SSE_EVENT_NAME}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

export function isTerminalGenerationEvent(event: GenerationStreamEvent) {
  return TERMINAL_EVENT_TYPES.has(event.type);
}

export function getBatchStartLabel(batchName: GenerationBatchName) {
  return batchLabels[batchName];
}

export async function resetGenerationThinkingState(
  env: Bindings,
  projectId: string,
  _batchName: GenerationBatchName | null,
) {
  await env.DB.prepare(`
    DELETE FROM project_generation_events
    WHERE project_id = ? AND event_type = 'thinking'
  `)
    .bind(projectId)
    .run();
}


export async function appendGenerationThinkingDelta(
  env: Bindings,
  payload: {
    projectId: string;
    runId?: string | null;
    batchName: GenerationBatchName;
    content: string;
  },
) {
  const content = payload.content.trim();
  if (!content) {
    return;
  }

  await persistGenerationStreamEvent(env, {
    projectId: payload.projectId,
    runId: payload.runId ?? null,
    batchName: payload.batchName,
    event: {
      type: 'thinking',
      content,
    },
  });

  await env.DB.prepare(`
    DELETE FROM project_generation_events
    WHERE id IN (
      SELECT id
      FROM project_generation_events
      WHERE project_id = ? AND event_type = 'thinking'
      ORDER BY id DESC
      LIMIT -1 OFFSET ?
    )
  `)
    .bind(payload.projectId, THINKING_EVENT_WINDOW_SIZE)
    .run();
}

export async function persistGenerationStreamEvent(
  env: Bindings,
  payload: {
    projectId: string;
    runId?: string | null;
    batchName?: GenerationBatchName;
    event: GenerationStreamEvent;
  },
) {
  const createdAt = new Date().toISOString();
  const envelope = buildGenerationEventEnvelope({
    projectId: payload.projectId,
    runId: payload.runId ?? null,
    batchName: payload.batchName || null,
    timestamp: createdAt,
    event: payload.event,
  });

  const result = await env.DB.prepare(`
    INSERT INTO project_generation_events (project_id, event_type, batch_name, payload)
    VALUES (?, ?, ?, ?)
  `)
    .bind(
      payload.projectId,
      envelope.eventType,
      envelope.batch,
      JSON.stringify(envelope),
    )
    .run();

  return {
    id: asNumber(result.meta?.last_row_id),
    projectId: payload.projectId,
    runId: payload.runId ?? null,
    batchName: payload.batchName || null,
    createdAt,
    event: payload.event,
  } satisfies PersistedGenerationEvent;
}

export function emitTransientGenerationStreamEvent(payload: {
  projectId: string;
  batchName?: GenerationBatchName;
  event: Extract<GenerationStreamEvent, { type: 'thinking' }>;
}) {
  void payload;
}

export function createThrottledThinkingEmitter(
  env: Bindings,
  projectId: string,
  runId: string,
  batchName: GenerationBatchName,
  flushIntervalMs = 150,
) {
  let buffer = '';
  let lastFlush = Date.now();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let persistChain = Promise.resolve();

  const queueThinkingPersistence = (content: string) => {
    persistChain = persistChain
      .then(() =>
        appendGenerationThinkingDelta(env, {
          projectId,
          runId,
          batchName,
          content,
        }),
      )
      .catch((error) => {
        logStreamWarning('generation-thinking-persist-failed', {
          projectId,
          runId,
          batchName,
          error: error instanceof Error ? error.message : 'Unknown persistence error',
        });
      });
  };

  const flushNow = () => {
    if (!buffer) return;
    const nextChunk = buffer;
    buffer = '';
    lastFlush = Date.now();
    queueThinkingPersistence(nextChunk);
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
      await persistChain;
    },
  };
}

async function resolveActiveThinkingRunId(env: Bindings, projectId: string) {
  const row = await env.DB.prepare(`
    SELECT p.current_generation_run_id AS run_id, gr.lifecycle_status AS run_status
    FROM projects p
    LEFT JOIN generation_runs gr ON gr.id = p.current_generation_run_id
    WHERE p.id = ?
    LIMIT 1
  `)
    .bind(projectId)
    .first() as Record<string, unknown> | null;

  const runId = optionalText(row?.run_id);
  const runStatus = asText(row?.run_status, '').toLowerCase();
  if (!runId || !ACTIVE_THINKING_RUN_STATUSES.has(runStatus)) {
    return null;
  }

  return runId;
}

export async function listPersistedGenerationEventsSince(
  env: Bindings,
  projectId: string,
  lastEventId: number,
  options: { activeThinkingRunId?: string | null } = {},
) {
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
    .filter((event): event is PersistedGenerationEvent => {
      if (!event) {
        return false;
      }

      if (event.event.type !== 'thinking') {
        return true;
      }

      return Boolean(
        options.activeThinkingRunId
        && event.runId
        && event.runId === options.activeThinkingRunId,
      );
    });
}

function logStreamWarning(message: string, payload: Record<string, unknown>) {
  warn('generation-events', message, payload);
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
      const activeThinkingRunId = await resolveActiveThinkingRunId(env, payload.projectId);
      const persistedEvents = await listPersistedGenerationEventsSince(
        env,
        payload.projectId,
        latestEventId,
        { activeThinkingRunId },
      );

      for (const event of persistedEvents) {
        dispatchEvent(event);
      }
    } catch (error) {
      logStreamWarning('generation-stream-poll-failed', {
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
      const activeThinkingRunId = await resolveActiveThinkingRunId(env, payload.projectId);
      const replayEvents = await listPersistedGenerationEventsSince(
        env,
        payload.projectId,
        payload.lastEventId,
        { activeThinkingRunId },
      );

      for (const event of replayEvents) {
        latestEventId = Math.max(latestEventId, event.id);
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
      logStreamWarning('generation-stream-open-failed', {
        projectId: payload.projectId,
        error: error instanceof Error ? error.message : 'Unknown replay error',
      });
      cleanup();
    }
  })();

  return stream.readable;
}
