"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import HuntSession from "@/components/HuntSession";
import PairSession from "@/components/PairSession";
import styles from "./session.module.css";

const AVAILABLE_SKILLS = ["React", "Node.js", "TypeScript", "Python"];
const DIFFICULTY_LEVELS = [
  { value: "beginner", label: "🟢 Beginner" },
  { value: "intermediate", label: "🟡 Intermediate" },
  { value: "advanced", label: "🔴 Advanced" },
];

type SessionMode = "hunt" | "pair";

export default function SessionPage() {
  const { status } = useSession();
  const router = useRouter();

  const [phase, setPhase] = useState<"select" | "setup" | "active">("select");
  const [mode, setMode] = useState<SessionMode | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(["React"]);
  const [selectedDifficulty, setSelectedDifficulty] = useState("beginner");

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

  return null;
}
