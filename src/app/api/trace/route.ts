import { NextRequest, NextResponse } from "next/server";
import { getLangfuseServer } from "@/lib/langfuse";
import type { LangfuseTraceClient, LangfuseSpanClient } from "langfuse";

/**
 * POST /api/trace
 *
 * Server-side tracing proxy — receives batched trace events from the browser
 * and forwards them to Langfuse using the server SDK (which has both keys).
 *
 * The browser buffers events and flushes them every ~3s in a single request,
 * so this endpoint processes an array of actions per call.
 */

// ── Active traces & spans (keyed by sessionId) ──
const activeTraces = new Map<string, LangfuseTraceClient>();
const activeSpans = new Map<string, LangfuseSpanClient>();

// Auto-cleanup stale traces after 30 minutes
const TRACE_TTL_MS = 30 * 60 * 1000;
const traceTimestamps = new Map<string, number>();

function cleanupStaleTraces() {
  const now = Date.now();
  for (const [id, ts] of traceTimestamps) {
    if (now - ts > TRACE_TTL_MS) {
      activeTraces.delete(id);
      // Clean up any spans belonging to this session
      for (const key of activeSpans.keys()) {
        if (key.startsWith(`${id}:`)) activeSpans.delete(key);
      }
      traceTimestamps.delete(id);
    }
  }
}

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
  timestamp?: number;
}

function processAction(langfuse: ReturnType<typeof getLangfuseServer>, action: TraceAction): void {
  const { sessionId } = action;

  switch (action.action) {
    case "startTrace": {
      const trace = langfuse.trace({
        name: `${action.mode || "unknown"}.session`,
        sessionId,
        userId: action.userId,
        metadata: {
          mode: action.mode,
          ...action.metadata,
        },
      });
      activeTraces.set(sessionId, trace);
      traceTimestamps.set(sessionId, Date.now());
      break;
    }

    case "event": {
      const trace = activeTraces.get(sessionId);
      if (!trace) return; // Silently skip if no active trace
      traceTimestamps.set(sessionId, Date.now());
      trace.event({
        name: action.name || "unknown",
        input: action.input,
        output: action.output,
        metadata: action.metadata,
      });
      break;
    }

    case "spanStart": {
      const trace = activeTraces.get(sessionId);
      if (!trace) return;
      traceTimestamps.set(sessionId, Date.now());
      const spanId = action.spanId || `span_${Date.now()}`;
      const span = trace.span({
        name: action.name || "unknown",
        input: action.input,
        metadata: action.metadata,
      });
      activeSpans.set(`${sessionId}:${spanId}`, span);
      break;
    }

    case "spanEnd": {
      const spanKey = `${sessionId}:${action.spanId}`;
      const span = activeSpans.get(spanKey);
      if (span) {
        span.end({ output: action.output });
        activeSpans.delete(spanKey);
      }
      break;
    }

    case "endTrace": {
      const trace = activeTraces.get(sessionId);
      if (trace) {
        trace.update({ output: action.output || "session ended" });
        activeTraces.delete(sessionId);
        for (const key of activeSpans.keys()) {
          if (key.startsWith(`${sessionId}:`)) activeSpans.delete(key);
        }
        traceTimestamps.delete(sessionId);
      }
      break;
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const langfuse = getLangfuseServer();

    // Periodic cleanup of stale traces
    cleanupStaleTraces();

    // Handle batched events (primary path)
    const actions: TraceAction[] = body.batch || [body];

    let needsFlush = false;
    for (const action of actions) {
      if (!action.sessionId || !action.action) continue;
      processAction(langfuse, action);
      if (action.action === "endTrace") needsFlush = true;
    }

    // Only flush on session end — otherwise let Langfuse SDK batch internally
    if (needsFlush) {
      await langfuse.flushAsync();
    }

    return NextResponse.json({ ok: true, processed: actions.length });
  } catch (error) {
    console.error("[/api/trace] Error:", error);
    return NextResponse.json(
      { error: "Internal tracing error" },
      { status: 500 }
    );
  }
}
