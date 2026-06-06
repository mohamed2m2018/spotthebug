"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import HuntSession from "@/components/HuntSession";
import PairSession from "@/components/PairSession";
import SolveSession from "@/components/SolveSession";
import { PREDEFINED_PROBLEMS, PROBLEM_CATEGORIES, getProblemById, type PredefinedProblem } from "@/config/problems";
import { MODE_SYLLABI, DSA_SYLLABUS, SQL_PROBLEMS, type ModeSyllabus } from "@/config/syllabi";
import CoverageOverview from "@/components/CoverageOverview";
import { getCovered } from "@/lib/coverage";
import { useSavedSessions, removeSession, type SavedSession } from "@/lib/sessionStore";
import { generateStudyGuide } from "@/lib/studyGuide";

import styles from "./session.module.css";

const DIFFICULTY_LEVELS = [
  { value: "beginner", label: "🟢 Beginner" },
  { value: "intermediate", label: "🟡 Intermediate" },
  { value: "advanced", label: "🔴 Advanced" },
];

type SessionMode = "hunt" | "pair" | "solve" | "sql" | "sysdesign" | "explain";

interface SyllabusData {
  syllabus: string[];
  source: string;
  description: string;
}

export default function SessionPage() {
  const { status } = useSession();
  const router = useRouter();

  const [phase, setPhase] = useState<"select" | "setup" | "active">("select");
  const [mode, setMode] = useState<SessionMode | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState("beginner");
  const [selectedTopic, setSelectedTopic] = useState<string | undefined>(undefined);
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [selectedFramework, setSelectedFramework] = useState("");

  // Syllabus state
  const [syllabusData, setSyllabusData] = useState<SyllabusData | null>(null);
  const [syllabusIndex, setSyllabusIndex] = useState(0);
  const [isSyllabusLoading, setIsSyllabusLoading] = useState(false);
  const [syllabusError, setSyllabusError] = useState<string | null>(null);

  // Predefined problem selection (solve mode)
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  const [showProblemPicker, setShowProblemPicker] = useState(false);

  // Coverage track for curated crash-course modes (null = no tracking)
  const [trackId, setTrackId] = useState<string | null>(null);
  // Resume support
  const [resumeState, setResumeState] = useState<SavedSession | null>(null);
  const savedSessions = useSavedSessions();

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  if (status === "loading") return null;

  // ── Helpers ──
  const resetSyllabus = () => {
    setSyllabusData(null);
    setSyllabusIndex(0);
    setSyllabusError(null);
  };

  const resetSetup = () => {
    setSelectedTopic(undefined);
    setSelectedLanguage("");
    setSelectedFramework("");
    setSelectedProblemId(null);
    setShowProblemPicker(false);
    setTrackId(null);
    setResumeState(null);
    resetSyllabus();
  };

  const handleStartClick = (modeType: "hunt" | "solve") => {
    // Always auto-generate syllabus if they haven't manually generated one
    if (!syllabusData) {
      handleGenerateSyllabus(modeType);
    } else {
      setPhase("active");
    }
  };

  const handleGenerateSyllabus = async (currentMode: SessionMode) => {
    const effectiveTopic = selectedTopic?.trim() || selectedFramework?.trim() || selectedLanguage?.trim();
    if (!effectiveTopic) return;
    setIsSyllabusLoading(true);
    setSyllabusError(null);
    setSyllabusData(null);
    try {
      const res = await fetch("/api/generate-syllabus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: effectiveTopic,
          mode: currentMode,
          difficulty: selectedDifficulty,
          framework: [selectedLanguage, selectedFramework].filter(Boolean).join(" using "),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed");
      setSyllabusData(data);
      setSyllabusIndex(0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate syllabus";
      setSyllabusError(msg);
    } finally {
      setIsSyllabusLoading(false);
    }
  };

  const handleAdvanceSyllabus = () => {
    setSyllabusIndex(prev => prev + 1);
  };

  // Crash-course modes launch straight into a curated, interview-crucial
  // syllabus — no setup form. Each topic generates a teaching problem and the
  // coach teaches the full depth around it.
  const startCuratedMode = (m: SessionMode, s: ModeSyllabus, tid: string) => {
    setMode(m);
    resetSetup();
    setTrackId(tid);
    setSyllabusData({ syllabus: s.syllabus, source: s.source, description: s.description });
    setSyllabusIndex(0);
    setPhase("setup"); // show topic picker first
  };

  // Resume a previously saved session: restore mode, syllabus position, and the
  // saved code/transcript, then jump straight into the active session.
  const resumeSaved = (s: SavedSession) => {
    const syl = s.trackId === "dsa" ? DSA_SYLLABUS : s.trackId === "sql-problems" ? SQL_PROBLEMS : s.trackId === "sql" ? MODE_SYLLABI.sql : MODE_SYLLABI.sysdesign;
    resetSetup();
    setMode(s.mode);
    setTrackId(s.trackId ?? null);
    setSyllabusData({ syllabus: syl.syllabus, source: syl.source, description: syl.description });
    setSyllabusIndex(s.syllabusIndex);
    setResumeState(s);
    setPhase("active");
  };

  // Current topic: syllabus item if active, otherwise free-text topic
  const activeTopic = syllabusData
    ? syllabusData.syllabus[syllabusIndex]
    : selectedTopic;

  // Skills array for API compatibility — built from language/framework inputs
  const activeSkills = [selectedLanguage, selectedFramework].filter(Boolean);

  // ── Mode Selection ──
  if (phase === "select") {
    return (
      <div className={styles.setupScreen}>
        <div className={styles.modeSelectCard}>
          <h1 className={styles.setupTitle}>🐛 Choose Your Mode</h1>
          <p className={styles.setupSubtitle}>How do you want to level up today?</p>
          {savedSessions.length > 0 && (
            <div style={{ margin: "0 auto 1.25rem", maxWidth: "640px", textAlign: "left" }}>
              <div style={{ color: "#86efac", fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.5rem" }}>⏯️ Saved sessions — resume any</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: "220px", overflowY: "auto" }}>
                {savedSessions.map((s) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.55rem 0.8rem", borderRadius: "10px", border: "1px solid rgba(34,197,94,0.25)", background: "rgba(34,197,94,0.06)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "#e2e8f0", fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.topicLabel}</div>
                      <div style={{ color: "#64748b", fontSize: "0.72rem" }}>{new Date(s.savedAt).toLocaleString()} · {s.trackId}</div>
                    </div>
                    <button onClick={() => resumeSaved(s)} style={{ padding: "0.4rem 0.9rem", borderRadius: "8px", border: "none", background: "#22c55e", color: "#0b0b0b", fontWeight: 700, cursor: "pointer" }}>Resume</button>
                    <button onClick={() => removeSession(s.id)} style={{ padding: "0.4rem 0.6rem", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#94a3b8", cursor: "pointer" }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className={styles.modeGrid}>
            <button
              className={styles.modeCard}
              onClick={() => { setMode("pair"); setPhase("active"); }}
            >
              <span className={styles.modeIcon}>🤝</span>
              <span className={styles.modeLabel}>Pair with AI</span>
              <span className={styles.modeDesc}>Share your screen and get real-time voice code review</span>
            </button>
            <button
              className={styles.modeCard}
              onClick={() => { setMode("solve"); resetSetup(); setPhase("setup"); }}
            >
              <span className={styles.modeIcon}>🧩</span>
              <span className={styles.modeLabel}>Problem Solve</span>
              <span className={styles.modeDesc}>Tackle coding challenges with AI-grounded coaching</span>
            </button>
            <button
              className={styles.modeCard}
              onClick={() => { setMode("solve"); resetSetup(); setSelectedProblemId(null); setShowProblemPicker(true); setPhase("setup"); }}
            >
              <span className={styles.modeIcon}>📋</span>
              <span className={styles.modeLabel}>LeetCode Curate</span>
              <span className={styles.modeDesc}>Practice 20 curated LeetCode problems with a voice coach</span>
            </button>
            <button
              className={styles.modeCard}
              onClick={() => { setMode("hunt"); resetSetup(); setPhase("setup"); }}
            >
              <span className={styles.modeIcon}>🔍</span>
              <span className={styles.modeLabel}>Bug Hunt</span>
              <span className={styles.modeDesc}>Find bugs in the built-in code editor with AI voice coaching</span>
            </button>
            <button
              className={styles.modeCard}
              onClick={() => startCuratedMode("solve", DSA_SYLLABUS, "dsa")}
            >
              <span className={styles.modeIcon}>🧠</span>
              <span className={styles.modeLabel}>DSA Crash Course</span>
              <span className={styles.modeDesc}>Every core problem-solving pattern, one problem each — the coach teaches the full depth (cue, variations, complexity, follow-ups)</span>
            </button>
            <button
              className={styles.modeCard}
              onClick={() => startCuratedMode("sql", MODE_SYLLABI.sql, "sql")}
            >
              <span className={styles.modeIcon}>🗄️</span>
              <span className={styles.modeLabel}>SQL &amp; Databases</span>
              <span className={styles.modeDesc}>Learn queries, design & concepts (joins, windows, indexing, transactions, concurrency) through a curated interview syllabus</span>
            </button>
            <button
              className={styles.modeCard}
              onClick={() => startCuratedMode("sql", SQL_PROBLEMS, "sql-problems")}
            >
              <span className={styles.modeIcon}>📝</span>
              <span className={styles.modeLabel}>SQL Interview Problems</span>
              <span className={styles.modeDesc}>10 high-yield, most-asked SQL problems (2nd-highest salary, top-N per group, anti-joins, pivot, windows, gaps-and-islands, median, dedup) — each runnable, coach teaches the pattern + variants</span>
            </button>
            <button
              className={styles.modeCard}
              onClick={() => startCuratedMode("sysdesign", MODE_SYLLABI.sysdesign, "sysdesign")}
            >
              <span className={styles.modeIcon}>🏗️</span>
              <span className={styles.modeLabel}>Backend &amp; System Design</span>
              <span className={styles.modeDesc}>Learn backend concepts through design problems — Kafka, Redis, concurrency, memory leaks, sharding, OOD & recommenders at scale</span>
            </button>
            <button
              className={styles.modeCard}
              onClick={() => { setMode("explain"); resetSetup(); setSelectedTopic(undefined); setPhase("setup"); }}
            >
              <span className={styles.modeIcon}>📖</span>
              <span className={styles.modeLabel}>Explain a Topic</span>
              <span className={styles.modeDesc}>Type ANY topic (e.g. JWT, event loop, B-tree indexes, CAP) and the coach explains it step by step in voice</span>
            </button>
          </div>
          <CoverageOverview />
        </div>
      </div>
    );
  }

  // ── Shared Setup UI (used by both Hunt and Solve) ──
  const renderSetupForm = (modeType: "hunt" | "solve") => {
    const hasTopic = !!selectedTopic?.trim();
    const canStart = hasTopic || selectedLanguage.trim() || selectedFramework.trim();
    const title = modeType === "hunt" ? "🔍 Bug Hunt Setup" : "🧩 Problem Setup";
    const startLabel = isSyllabusLoading 
      ? "⏳ Generating Syllabus…" 
      : modeType === "hunt" ? "📚 Start Hunt" : "📚 Start Challenge";

    return (
      <div className={styles.setupScreen}>
        <div className={styles.setupCard}>
          <h1 className={styles.setupTitle}>{title}</h1>

          {/* Topic — primary input */}
          <p className={styles.setupSubtitle}>What do you want to practice?</p>
          <div className={styles.topicInputWrapper}>
            <input
              type="text"
              className={styles.topicInput}
              placeholder="e.g. React Hooks, Binary Trees, SQL Joins…"
              value={selectedTopic || ""}
              onChange={(e) => { setSelectedTopic(e.target.value || undefined); resetSyllabus(); }}
              autoFocus
            />
            <button
              className={styles.syllabusBtn}
              onClick={() => handleGenerateSyllabus(modeType)}
              disabled={!canStart || isSyllabusLoading}
              title="Generate a structured syllabus based on real books/courses"
            >
              {isSyllabusLoading ? "⏳ Generating…" : "📚 Syllabus"}
            </button>
          </div>

          {modeType === "solve" && (
            <button
              onClick={() => { setShowProblemPicker(true); }}
              style={{
                width: "100%", marginTop: "0.75rem", padding: "0.75rem",
                borderRadius: "10px", border: "1px dashed rgba(139,92,246,0.4)",
                background: "rgba(139,92,246,0.06)", color: "#a78bfa",
                fontSize: "0.9rem", fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
              }}
            >
              📋 Or pick from 20 LeetCode problems →
            </button>
          )}

          {syllabusError && <p className={styles.validationHint}>⚠ {syllabusError}</p>}

          {syllabusData && (
            <div className={styles.syllabusList}>
              <div className={styles.syllabusHeader}>
                <span className={styles.syllabusTitle}>📚 Syllabus</span>
                <span className={styles.syllabusSource}>Based on: {syllabusData.source}</span>
              </div>
              <p className={styles.syllabusDescription}>{syllabusData.description}</p>
              <ol className={styles.syllabusItems}>
                {syllabusData.syllabus.map((item, i) => (
                  <li key={i} className={`${styles.syllabusItem} ${i === 0 ? styles.syllabusItemActive : ""}`}>
                    <span className={styles.syllabusItemNum}>{i + 1}</span>
                    <span className={styles.syllabusItemText}>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Language & Framework — secondary inputs */}
          <div className={styles.optionalRow}>
            <div className={styles.optionalField}>
              <label className={styles.optionalLabel}>Language (optional)</label>
              <input
                type="text"
                className={styles.optionalInput}
                placeholder="e.g. Python, Go, TypeScript…"
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
              />
            </div>
            <div className={styles.optionalField}>
              <label className={styles.optionalLabel}>Framework (optional)</label>
              <input
                type="text"
                className={styles.optionalInput}
                placeholder="e.g. React, Django, Spring…"
                value={selectedFramework}
                onChange={(e) => setSelectedFramework(e.target.value)}
              />
            </div>
          </div>

          {/* Difficulty */}
          <p className={styles.setupSubtitle}>Your level</p>
          <div className={styles.skillsGrid}>
            {DIFFICULTY_LEVELS.map((level) => (
              <button
                key={level.value}
                className={`${styles.skillChip} ${selectedDifficulty === level.value ? styles.skillChipActive : ""}`}
                onClick={() => setSelectedDifficulty(level.value)}
              >
                {level.label}
              </button>
            ))}
          </div>

          <div className={styles.setupActions}>
            <button className={styles.backBtn} onClick={() => setPhase("select")}>← Back</button>
            <button
              className={`${styles.startBtn} btn btn-primary`}
              onClick={() => handleStartClick(modeType)}
              disabled={!canStart || isSyllabusLoading}
            >
              {startLabel}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Curated crash-course topic picker (DSA / SQL / Backend) ──
  if (phase === "setup" && trackId && syllabusData) {
    const covered = getCovered(trackId);
    const titleMap: Record<string, string> = {
      dsa: "🧠 DSA Crash Course",
      sql: "🗄️ SQL & Databases",
      sysdesign: "🏗️ Backend & System Design",
    };
    return (
      <div className={styles.setupScreen}>
        <div className={styles.setupCard}>
          <h1 className={styles.setupTitle}>{titleMap[trackId] || "Pick a Topic"}</h1>
          <p className={styles.setupSubtitle}>
            Pick a topic to start — {covered.length}/{syllabusData.syllabus.length} done. (It auto-advances from here.)
          </p>
          <ol style={{ listStyle: "none", padding: 0, margin: "0 0 1rem 0", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {syllabusData.syllabus.map((item, i) => {
              const done = covered.includes(item);
              return (
                <li key={i}>
                  <button
                    onClick={() => { setSyllabusIndex(i); setPhase("active"); }}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: "0.6rem",
                      padding: "0.6rem 0.8rem", borderRadius: "8px",
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: done ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.03)",
                      color: "#e2e8f0", fontSize: "0.85rem", cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <span style={{ color: done ? "#22c55e" : "#64748b", fontVariantNumeric: "tabular-nums", minWidth: "1.4rem" }}>
                      {done ? "✅" : `${i + 1}.`}
                    </span>
                    <span>{item}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <button
            onClick={() => generateStudyGuide(trackId, syllabusData.syllabus).catch((e) => console.error(e))}
            style={{ width: "100%", marginBottom: "0.75rem", padding: "0.7rem", borderRadius: "10px", border: "1px solid rgba(139,92,246,0.4)", background: "rgba(139,92,246,0.08)", color: "#c4b5fd", fontWeight: 700, cursor: "pointer" }}
          >
            📄 Generate Study Guide (PDF) — cheat-sheet + your mistakes & questions
          </button>
          <div className={styles.setupActions}>
            <button className={styles.backBtn} onClick={() => { setPhase("select"); setMode(null); setTrackId(null); }}>← Back</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Hunt Setup ──
  if (phase === "setup" && mode === "hunt") return renderSetupForm("hunt");

  // ── Explain-a-Topic Setup (free text) ──
  if (phase === "setup" && mode === "explain") {
    const canStart = !!selectedTopic?.trim();
    return (
      <div className={styles.setupScreen}>
        <div className={styles.setupCard}>
          <h1 className={styles.setupTitle}>📖 Explain a Topic</h1>
          <p className={styles.setupSubtitle}>اكتب أي موضوع وهشرحهولك خطوة بخطوة بالصوت</p>
          <textarea
            value={selectedTopic || ""}
            onChange={(e) => setSelectedTopic(e.target.value || undefined)}
            placeholder="مثال: إزاي الـ JWT بيشتغل؟ · event loop في JavaScript · B-tree indexes · TCP vs UDP · CAP theorem"
            dir="auto"
            rows={3}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canStart) setPhase("active"); }}
            style={{ width: "100%", padding: "0.75rem", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.04)", color: "#e2e8f0", fontSize: "0.95rem", resize: "vertical", marginBottom: "1rem", fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button
              onClick={() => { if (canStart) setPhase("active"); }}
              disabled={!canStart}
              style={{ flex: 1, padding: "0.75rem", borderRadius: 10, border: "none", background: canStart ? "linear-gradient(135deg,#22c55e,#16a34a)" : "rgba(255,255,255,0.08)", color: canStart ? "#06240f" : "#64748b", fontWeight: 700, cursor: canStart ? "pointer" : "not-allowed" }}
            >
              ▶ Start Explaining
            </button>
            <button
              onClick={() => { setPhase("select"); setMode(null); setSelectedTopic(undefined); }}
              style={{ padding: "0.75rem 1rem", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#94a3b8", cursor: "pointer" }}
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Solve Setup with Problem Picker ──
  if (phase === "setup" && mode === "solve") {
    if (showProblemPicker) {
      const canStartPicker = !!selectedProblemId;
      return (
        <div className={styles.setupScreen}>
          <div className={styles.setupCard}>
            <h1 className={styles.setupTitle}>🧩 Pick a Problem</h1>
            <p className={styles.setupSubtitle}>Choose from 20 curated LeetCode problems</p>

            {PROBLEM_CATEGORIES.map((dayGroup) => (
              <div key={dayGroup.day} style={{ marginBottom: "1.5rem" }}>
                <h3 style={{ color: "#a78bfa", fontSize: "0.9rem", fontWeight: 700, marginBottom: "0.5rem", letterSpacing: "0.05em" }}>
                  {dayGroup.label}
                </h3>
                {dayGroup.categories.map((cat) => (
                  <div key={cat.name} style={{ marginBottom: "0.75rem" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.35rem" }}>
                      {cat.name}
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      {cat.problemIds.map((pid) => {
                        const prob = getProblemById(pid)!;
                        const isSelected = selectedProblemId === pid;
                        const diffColor = prob.difficulty === "beginner" ? "#22c55e" : prob.difficulty === "intermediate" ? "#eab308" : "#ef4444";
                        return (
                          <button
                            key={pid}
                            onClick={() => setSelectedProblemId(pid)}
                            style={{
                              display: "flex", alignItems: "center", gap: "0.4rem",
                              padding: "0.4rem 0.7rem", borderRadius: "8px",
                              border: isSelected ? "2px solid #8b5cf6" : "1px solid rgba(255,255,255,0.1)",
                              background: isSelected ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.03)",
                              cursor: "pointer", transition: "all 0.15s ease",
                              color: isSelected ? "#c4b5fd" : "#cbd5e1",
                            }}
                          >
                            <span style={{
                              width: "6px", height: "6px", borderRadius: "50%",
                              background: diffColor, flexShrink: 0,
                            }} />
                            <span style={{ fontSize: "0.82rem", fontWeight: isSelected ? 600 : 400 }}>
                              {prob.leetcodeNumber}. {prob.title}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {selectedProblemId && (() => {
              const prob = getProblemById(selectedProblemId)!;
              return (
                <div style={{
                  background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.2)",
                  borderRadius: "10px", padding: "1rem", marginTop: "0.5rem", marginBottom: "1rem",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                    <span style={{ fontSize: "0.75rem", padding: "0.15rem 0.5rem", borderRadius: "4px",
                      background: prob.difficulty === "beginner" ? "rgba(34,197,94,0.15)" : prob.difficulty === "intermediate" ? "rgba(234,179,8,0.15)" : "rgba(239,68,68,0.15)",
                      color: prob.difficulty === "beginner" ? "#22c55e" : prob.difficulty === "intermediate" ? "#eab308" : "#ef4444",
                      fontWeight: 600, textTransform: "capitalize" }}>
                      {prob.difficulty}
                    </span>
                    <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>{prob.category}</span>
                  </div>
                  <p style={{ fontSize: "0.85rem", color: "#e2e8f0", lineHeight: 1.5 }}>
                    {prob.description.slice(0, 180)}{prob.description.length > 180 ? "…" : ""}
                  </p>
                </div>
              );
            })()}

            <div className={styles.setupActions}>
              <button className={styles.backBtn} onClick={() => setShowProblemPicker(false)}>← Custom Topic</button>
              <button
                className={`${styles.startBtn} btn btn-primary`}
                onClick={() => setPhase("active")}
                disabled={!canStartPicker}
              >
                🚀 Start Problem
              </button>
            </div>
          </div>
        </div>
      );
    }
    return renderSetupForm("solve");
  }

  // ── Active Sessions ──
  if (phase === "active" && mode === "hunt") {
    return (
      <HuntSession
        skills={activeSkills}
        difficulty={selectedDifficulty}
        topic={activeTopic}
        syllabus={syllabusData?.syllabus}
        syllabusIndex={syllabusData ? syllabusIndex : undefined}
        syllabusSource={syllabusData?.source}
        onAdvanceSyllabus={syllabusData ? handleAdvanceSyllabus : undefined}
        onEnd={() => { setPhase("select"); setMode(null); }}
      />
    );
  }

  if (phase === "active" && mode === "pair") {
    return (
      <PairSession
        onEnd={() => { setPhase("select"); setMode(null); }}
      />
    );
  }

  if (phase === "active" && mode === "solve") {
    const predefinedProblem = selectedProblemId ? getProblemById(selectedProblemId) : undefined;
    return (
      <SolveSession
        skills={activeSkills}
        difficulty={selectedDifficulty}
        topic={activeTopic}
        syllabus={syllabusData?.syllabus}
        syllabusIndex={syllabusData ? syllabusIndex : undefined}
        syllabusSource={syllabusData?.source}
        onAdvanceSyllabus={syllabusData ? handleAdvanceSyllabus : undefined}
        onEnd={() => { setPhase("select"); setMode(null); setResumeState(null); }}
        predefinedProblem={predefinedProblem}
        trackId={trackId ?? undefined}
        resumeState={resumeState ?? undefined}
      />
    );
  }

  // SQL & Backend/System-Design teaching modes (reuse SolveSession, no code execution)
  if (phase === "active" && (mode === "sql" || mode === "sysdesign")) {
    return (
      <SolveSession
        mode={mode}
        skills={activeSkills}
        difficulty={selectedDifficulty}
        topic={activeTopic}
        syllabus={syllabusData?.syllabus}
        syllabusIndex={syllabusData ? syllabusIndex : undefined}
        syllabusSource={syllabusData?.source}
        onAdvanceSyllabus={syllabusData ? handleAdvanceSyllabus : undefined}
        onEnd={() => { setPhase("select"); setMode(null); setResumeState(null); }}
        trackId={trackId ?? undefined}
        resumeState={resumeState ?? undefined}
      />
    );
  }

  if (phase === "active" && mode === "explain") {
    return (
      <SolveSession
        mode="explain"
        skills={[]}
        difficulty={selectedDifficulty}
        topic={selectedTopic}
        onEnd={() => { setPhase("select"); setMode(null); setResumeState(null); setSelectedTopic(undefined); }}
        resumeState={resumeState ?? undefined}
      />
    );
  }

  return null;
}
