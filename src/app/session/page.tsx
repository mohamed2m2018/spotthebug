"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import HuntSession from "@/components/HuntSession";
import PairSession from "@/components/PairSession";
import SolveSession from "@/components/SolveSession";

import styles from "./session.module.css";

const AVAILABLE_SKILLS = ["React", "Node.js", "TypeScript", "Python"];
const SOLVE_LANGUAGES = ["JavaScript", "Python", "Java", "Go", "Rust", "C++"];
const DIFFICULTY_LEVELS = [
  { value: "beginner", label: "🟢 Beginner" },
  { value: "intermediate", label: "🟡 Intermediate" },
  { value: "advanced", label: "🔴 Advanced" },
];

const PROBLEM_TOPICS = [
  "Arrays & Strings", "Objects & Maps", "Async/Await",
  "Recursion", "Algorithms", "Error Handling",
  "API Design", "Functional Programming",
];

type SessionMode = "hunt" | "pair" | "solve";

export default function SessionPage() {
  const { status } = useSession();
  const router = useRouter();

  const [phase, setPhase] = useState<"select" | "setup" | "active">("select");
  const [mode, setMode] = useState<SessionMode | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(["React"]);
  const [selectedDifficulty, setSelectedDifficulty] = useState("beginner");
  const [selectedTopic, setSelectedTopic] = useState<string | undefined>(undefined);



  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  if (status === "loading") return null;

  // ── Mode Selection ──
  if (phase === "select") {
    return (
      <div className={styles.setupScreen}>
        <div className={styles.modeSelectCard}>
          <h1 className={styles.setupTitle}>🐛 Choose Your Mode</h1>
          <p className={styles.setupSubtitle}>How do you want to level up today?</p>
          <div className={styles.modeGrid}>
            <button
              className={styles.modeCard}
              onClick={() => { setMode("hunt"); setPhase("setup"); }}
            >
              <span className={styles.modeIcon}>🔍</span>
              <span className={styles.modeLabel}>Bug Hunt</span>
              <span className={styles.modeDesc}>Find bugs in curated code snippets with AI coaching</span>
            </button>
            <button
              className={styles.modeCard}
              onClick={() => { setMode("pair"); setPhase("active"); }}
            >
              <span className={styles.modeIcon}>🤝</span>
              <span className={styles.modeLabel}>Pair with AI</span>
              <span className={styles.modeDesc}>Share your screen and get real-time code review</span>
            </button>
            <button
              className={styles.modeCard}
              onClick={() => { setMode("solve"); setSelectedSkills([]); setPhase("setup"); }}
            >
              <span className={styles.modeIcon}>🧩</span>
              <span className={styles.modeLabel}>Problem Solve</span>
              <span className={styles.modeDesc}>Tackle coding challenges with AI-grounded coaching</span>
            </button>
          </div>

        </div>
      </div>
    );
  }

  // ── Hunt Setup (skills + difficulty) ──
  if (phase === "setup" && mode === "hunt") {
    return (
      <div className={styles.setupScreen}>
        <div className={styles.setupCard}>
          <h1 className={styles.setupTitle}>🔍 Bug Hunt Setup</h1>
          <p className={styles.setupSubtitle}>Select frameworks</p>
          <div className={styles.skillsGrid}>
            {AVAILABLE_SKILLS.map((skill) => (
              <button
                key={skill}
                className={`${styles.skillChip} ${selectedSkills.includes(skill) ? styles.skillChipActive : ""}`}
                onClick={() => setSelectedSkills(prev => prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill])}
              >
                {skill}
              </button>
            ))}
          </div>
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
          {selectedSkills.length === 0 && (
            <p className={styles.validationHint}>⚠ Select at least one framework to continue</p>
          )}
          <div className={styles.setupActions}>
            <button className={styles.backBtn} onClick={() => setPhase("select")}>← Back</button>
            <button
              className={`${styles.startBtn} btn btn-primary`}
              onClick={() => setPhase("active")}
              disabled={selectedSkills.length === 0}
            >
              🎙️ Start Hunt
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Active Sessions ──
  if (phase === "active" && mode === "hunt") {
    return (
      <HuntSession
        skills={selectedSkills}
        difficulty={selectedDifficulty}
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

  // ── Solve Setup ──
  if (phase === "setup" && mode === "solve") {
    return (
      <div className={styles.setupScreen}>
        <div className={styles.setupCard}>
          <h1 className={styles.setupTitle}>🧩 Problem Setup</h1>
          <p className={styles.setupSubtitle}>Select language</p>
          <div className={styles.skillsGrid}>
            {SOLVE_LANGUAGES.map((lang) => (
              <button
                key={lang}
                className={`${styles.skillChip} ${selectedSkills.includes(lang) ? styles.skillChipActive : ""}`}
                onClick={() => setSelectedSkills(prev => prev.includes(lang) ? prev.filter(s => s !== lang) : [...prev, lang])}
              >
                {lang}
              </button>
            ))}
          </div>
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
          <p className={styles.setupSubtitle}>Topic (optional)</p>
          <div className={styles.skillsGrid}>
            {PROBLEM_TOPICS.map((t) => (
              <button
                key={t}
                className={`${styles.skillChip} ${selectedTopic === t ? styles.skillChipActive : ""}`}
                onClick={() => setSelectedTopic(prev => prev === t ? undefined : t)}
              >
                {t}
              </button>
            ))}
          </div>
          {selectedSkills.length === 0 && (
            <p className={styles.validationHint}>⚠ Select at least one language to continue</p>
          )}
          <div className={styles.setupActions}>
            <button className={styles.backBtn} onClick={() => setPhase("select")}>← Back</button>
            <button
              className={`${styles.startBtn} btn btn-primary`}
              onClick={() => setPhase("active")}
              disabled={selectedSkills.length === 0}
            >
              🧩 Start Challenge
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "active" && mode === "solve") {
    return (
      <SolveSession
        skills={selectedSkills}
        difficulty={selectedDifficulty}
        topic={selectedTopic}
        onEnd={() => { setPhase("select"); setMode(null); }}
      />
    );
  }

  return null;
}
