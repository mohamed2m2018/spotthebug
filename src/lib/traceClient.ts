/**
 * Browser-side tracing client — batches events and sends them to /api/trace
 * which forwards them to Langfuse server-side with proper auth.
 *
 * Design: All trace calls are synchronous and non-blocking.
 * Events accumulate in a memory buffer and flush every FLUSH_INTERVAL_MS
 * in a single HTTP request. This minimizes network overhead and ensures
 * zero impact on the voice session UX.
 */

const TRACE_ENDPOINT = "/api/trace";
const FLUSH_INTERVAL_MS = 3000;

interface TraceAction {
  action: "startTrace" | "event" | "spanStart" | "spanEnd" | "endTrace";
  sessionId: string;
  name?: string;
  mode?: "pair" | "hunt";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  spanId?: string;
  userId?: string;
  timestamp: number;
}

// ── Event buffer + flush timer ──
let eventBuffer: TraceAction[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS);
}

function stopFlushTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

async function flushBuffer(): Promise<void> {
  if (eventBuffer.length === 0) return;

  // Swap buffer so new events don't interfere
  const batch = eventBuffer;
  eventBuffer = [];

  try {
    await fetch(TRACE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batch }),
    });
  } catch {
    // Tracing should never break the app — silently drop on failure
    console.warn("[traceClient] Failed to flush batch, dropping", batch.length, "events");
  }
}

function enqueue(action: TraceAction): void {
  eventBuffer.push(action);
  ensureFlushTimer();
}

// ── Public API ──

/** Generate a unique session ID for tracing */
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Create a root trace for a voice session */
export function startTrace(
  sessionId: string,
  mode: "pair" | "hunt",
  metadata?: Record<string, unknown>
): void {
  enqueue({ action: "startTrace", sessionId, mode, metadata, timestamp: Date.now() });
}

/** Log a fire-and-forget event on the current trace */
export function traceEvent(
  sessionId: string,
  name: string,
  options?: {
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
): void {
  enqueue({
    action: "event",
    sessionId,
    name,
    ...options,
    timestamp: Date.now(),
  });
}

/** Start a timed span (e.g. for tool calls) */
export function spanStart(
  sessionId: string,
  name: string,
  spanId: string,
  input?: Record<string, unknown>
): void {
  enqueue({ action: "spanStart", sessionId, name, spanId, input, timestamp: Date.now() });
}

/** End a previously started span */
export function spanEnd(
  sessionId: string,
  spanId: string,
  output?: Record<string, unknown>
): void {
  enqueue({ action: "spanEnd", sessionId, spanId, output, timestamp: Date.now() });
}

/** End the session trace — flushes immediately via sendBeacon for reliability */
export function endTrace(
  sessionId: string,
  output?: Record<string, unknown>
): void {
  // Add endTrace to the buffer
  enqueue({
    action: "endTrace",
    sessionId,
    output: output || ("session ended" as unknown as Record<string, unknown>),
    timestamp: Date.now(),
  });

  // Stop periodic flushes and flush everything now
  stopFlushTimer();

  // Use sendBeacon for reliability (survives page unload)
  const batch = eventBuffer;
  eventBuffer = [];

  if (batch.length > 0 || true) {
    // Include the buffered events we just enqueued
    const allEvents = batch;
    const payload = JSON.stringify({ batch: allEvents });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(TRACE_ENDPOINT, new Blob([payload], { type: "application/json" }));
    } else {
      fetch(TRACE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  }
}
