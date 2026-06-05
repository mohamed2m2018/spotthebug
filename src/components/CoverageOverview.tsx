"use client";

import { useState } from "react";
import { DSA_SYLLABUS, MODE_SYLLABI, SQL_PROBLEMS } from "@/config/syllabi";
import { useCovered, resetCoverage } from "@/lib/coverage";

/**
 * Coverage tracker shown on the mode-select screen — a checklist of every
 * concept per track, ticked as the learner completes them. Persists across
 * reloads and the full 2-day cram via localStorage.
 */

const TRACKS = [
  { id: "dsa", label: "🧠 Problem Solving (DSA)", items: DSA_SYLLABUS.syllabus },
  { id: "sql", label: "🗄️ SQL & Databases", items: MODE_SYLLABI.sql.syllabus },
  { id: "sql-problems", label: "📝 SQL Interview Problems", items: SQL_PROBLEMS.syllabus },
  { id: "sysdesign", label: "🏗️ Backend & System Design", items: MODE_SYLLABI.sysdesign.syllabus },
];

function TrackRow({ id, label, items }: { id: string; label: string; items: string[] }) {
  const covered = useCovered(id);
  const [open, setOpen] = useState(false);
  const done = items.filter((i) => covered.includes(i)).length;
  const pct = Math.round((done / items.length) * 100);

  return (
    <div style={{ marginBottom: "0.75rem", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: "0.6rem",
          padding: "0.7rem 0.9rem", background: "rgba(255,255,255,0.03)", border: "none",
          cursor: "pointer", color: "#e2e8f0", fontSize: "0.9rem", fontWeight: 600,
        }}
      >
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", color: "#94a3b8" }}>›</span>
        <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
        <span style={{ color: pct === 100 ? "#22c55e" : "#a78bfa", fontVariantNumeric: "tabular-nums" }}>{done}/{items.length}</span>
      </button>
      <div style={{ height: "4px", background: "rgba(255,255,255,0.06)" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "#22c55e" : "linear-gradient(90deg,#8b5cf6,#a78bfa)", transition: "width 0.3s" }} />
      </div>
      {open && (
        <div style={{ padding: "0.5rem 0.9rem 0.7rem" }}>
          {items.map((item) => {
            const isDone = covered.includes(item);
            return (
              <div key={item} style={{ display: "flex", gap: "0.5rem", padding: "0.2rem 0", fontSize: "0.82rem", color: isDone ? "#86efac" : "#94a3b8" }}>
                <span>{isDone ? "✅" : "○"}</span>
                <span>{item}</span>
              </div>
            );
          })}
          {done > 0 && (
            <button
              onClick={() => resetCoverage(id)}
              style={{ marginTop: "0.5rem", background: "none", border: "none", color: "#64748b", fontSize: "0.72rem", cursor: "pointer", textDecoration: "underline" }}
            >
              reset
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function CoverageOverview() {
  return (
    <div style={{ marginTop: "1.75rem", maxWidth: "640px", width: "100%", marginInline: "auto" }}>
      <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#cbd5e1", marginBottom: "0.75rem", letterSpacing: "0.02em" }}>
        📊 Your coverage
      </h2>
      {TRACKS.map((t) => (
        <TrackRow key={t.id} id={t.id} label={t.label} items={t.items} />
      ))}
    </div>
  );
}
