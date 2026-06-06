"use client";

import { useEffect, useMemo, useState } from "react";
import type { TraceResult } from "@/lib/jsTracer";

/**
 * Step-through execution visualizer. Scrub the recorded trace to watch memory
 * variables and loop counters change line by line — the whole algorithm laid out.
 */
export default function AlgoVisualizer({
  code,
  result,
  onClose,
}: {
  code: string;
  result: TraceResult;
  onClose: () => void;
}) {
  const { steps, logs, error, truncated } = result;
  const [idx, setIdx] = useState(0);
  const last = Math.max(0, steps.length - 1);

  useEffect(() => { setIdx(0); }, [result]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIdx((i) => Math.min(last, i + 1));
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last]);

  const codeLines = useMemo(() => code.split("\n"), [code]);
  const cur = steps[idx];
  const prev = idx > 0 ? steps[idx - 1] : undefined;

  if (error && steps.length === 0) {
    return (
      <Shell onClose={onClose}>
        <div style={{ color: "#fca5a5", fontSize: "0.85rem", padding: "0.5rem" }}>
          ⚠️ Can&apos;t visualize this code: {error}
          <div style={{ color: "#94a3b8", marginTop: "0.4rem" }}>
            Tip: write a normal function and call it (e.g. <code>console.log(twoSum([2,7,11,15], 9))</code>). Async/DOM code isn&apos;t supported.
          </div>
        </div>
      </Shell>
    );
  }
  if (steps.length === 0) {
    return (
      <Shell onClose={onClose}>
        <div style={{ color: "#94a3b8", fontSize: "0.85rem", padding: "0.5rem" }}>
          No steps recorded. Make sure your function is actually called (e.g. a <code>console.log(fn(...))</code> at the end).
        </div>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose}>
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.6rem" }}>
        <button onClick={() => setIdx(0)} style={btn} title="First">⏮</button>
        <button onClick={() => setIdx((i) => Math.max(0, i - 1))} style={btn} title="Prev (←)">◀</button>
        <button onClick={() => setIdx((i) => Math.min(last, i + 1))} style={btn} title="Next (→)">▶</button>
        <button onClick={() => setIdx(last)} style={btn} title="Last">⏭</button>
        <input
          type="range" min={0} max={last} value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
          style={{ flex: 1, accentColor: "#22c55e" }}
        />
        <span style={{ color: "#cbd5e1", fontSize: "0.8rem", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          step {idx + 1} / {steps.length}{truncated ? "+" : ""}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: "0.75rem", minHeight: 0 }}>
        {/* Code with current line highlighted */}
        <div style={{ background: "#0b1020", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, overflow: "auto", maxHeight: 280, fontFamily: "monospace", fontSize: "0.78rem" }}>
          {codeLines.map((ln, i) => {
            const n = i + 1;
            const active = cur && cur.line === n;
            return (
              <div key={n} style={{
                display: "flex", gap: "0.6rem", padding: "0 0.5rem",
                background: active ? "rgba(34,197,94,0.18)" : "transparent",
                borderLeft: active ? "3px solid #22c55e" : "3px solid transparent",
                whiteSpace: "pre",
              }}>
                <span style={{ color: "#475569", width: 22, textAlign: "right", userSelect: "none" }}>{n}</span>
                <span style={{ color: active ? "#e2fbe8" : "#cbd5e1" }}>{ln || " "}</span>
              </div>
            );
          })}
        </div>

        {/* Memory variables */}
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "#86efac", fontWeight: 700, fontSize: "0.78rem", marginBottom: "0.35rem" }}>🧠 Memory (line {cur?.line})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", maxHeight: 252, overflow: "auto" }}>
            {Object.keys(cur?.vars || {}).length === 0 && (
              <div style={{ color: "#64748b", fontSize: "0.8rem" }}>(no variables in scope yet)</div>
            )}
            {Object.entries(cur?.vars || {}).map(([name, val]) => {
              const changed = prev && JSON.stringify(prev.vars[name]) !== JSON.stringify(val);
              return (
                <div key={name} style={{
                  border: `1px solid ${changed ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.08)"}`,
                  background: changed ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.03)",
                  borderRadius: 6, padding: "0.35rem 0.5rem",
                }}>
                  <span style={{ color: "#fbbf24", fontFamily: "monospace", fontSize: "0.78rem" }}>{name}</span>
                  <span style={{ color: "#64748b" }}> = </span>
                  <ValueView v={val} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Output / logs */}
      {logs.length > 0 && (
        <div style={{ marginTop: "0.6rem" }}>
          <div style={{ color: "#93c5fd", fontWeight: 700, fontSize: "0.75rem", marginBottom: "0.25rem" }}>🖨️ Output</div>
          <pre style={{ margin: 0, color: "#cbd5e1", fontSize: "0.78rem", whiteSpace: "pre-wrap", maxHeight: 90, overflow: "auto" }}>{logs.join("\n")}</pre>
        </div>
      )}
      {error && <div style={{ color: "#fca5a5", fontSize: "0.78rem", marginTop: "0.4rem" }}>Runtime error: {error}</div>}
      {truncated && <div style={{ color: "#fbbf24", fontSize: "0.75rem", marginTop: "0.3rem" }}>Trace capped at {steps.length} steps (loop too long to record fully).</div>}
    </Shell>
  );
}

function ValueView({ v }: { v: unknown }) {
  if (Array.isArray(v)) {
    return (
      <span style={{ display: "inline-flex", gap: 3, flexWrap: "wrap", verticalAlign: "middle" }}>
        {v.map((x, i) => (
          <span key={i} style={{ border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, padding: "0 0.25rem", fontFamily: "monospace", fontSize: "0.72rem", color: "#e2e8f0", background: "rgba(255,255,255,0.04)" }}>
            {typeof x === "object" ? JSON.stringify(x) : String(x)}
          </span>
        ))}
        {v.length === 0 && <span style={{ color: "#64748b", fontFamily: "monospace", fontSize: "0.75rem" }}>[]</span>}
      </span>
    );
  }
  const s = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
  return <span style={{ color: "#e2e8f0", fontFamily: "monospace", fontSize: "0.78rem", wordBreak: "break-all" }}>{s}</span>;
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ border: "1px solid rgba(34,197,94,0.25)", borderRadius: 10, background: "rgba(8,12,22,0.95)", padding: "0.7rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <div style={{ color: "#86efac", fontWeight: 700, fontSize: "0.85rem" }}>🎞️ Algorithm Visualizer</div>
        <button onClick={onClose} style={{ ...btn, padding: "0.15rem 0.5rem" }}>✕ Close</button>
      </div>
      {children}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#e2e8f0",
  borderRadius: 6,
  padding: "0.25rem 0.55rem",
  cursor: "pointer",
  fontSize: "0.8rem",
};
