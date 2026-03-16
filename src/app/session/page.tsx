"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import HuntSession from "@/components/HuntSession";
import PairSession from "@/components/PairSession";
import FloatingCallPopup from "@/components/FloatingCallPopup";
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

  // ── Test popup state ──
  const [showTestInPage, setShowTestInPage] = useState(false);
  const [testMicActive, setTestMicActive] = useState(true);
  const [testTimer, setTestTimer] = useState(0);
  const testTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep timer ticking while test popup is visible
  useEffect(() => {
    if (!showTestInPage) return;
    testTimerRef.current = setInterval(() => setTestTimer(prev => prev + 1), 1000);
    return () => { if (testTimerRef.current) clearInterval(testTimerRef.current); };
  }, [showTestInPage]);

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

          {/* Experimental: test desktop floating popup */}
          <button
            id="test-pip-btn"
            onClick={async () => {
              // Hide in-page popup if it's showing from a previous test
              setShowTestInPage(false);
              if (!("documentPictureInPicture" in window)) {
                alert("Picture-in-Picture not supported. Use Chrome or Edge.");
                return;
              }
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
                  width: 320, height: 240,
                });
                pipWindow.document.body.innerHTML = `
                  <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { font-family: 'Inter', -apple-system, system-ui, sans-serif; background: #14141e; color: #e8e8f0; padding: 16px; user-select: none; }
                    .header { display: flex; align-items: center; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 14px; }
                    .title { font-size: 14px; font-weight: 600; color: #f0a04b; }
                    .status-row { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 14px; }
                    .connection { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #8b8ba3; }
                    .dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px rgba(16,185,129,0.6); animation: pd 2s ease-in-out infinite; }
                    @keyframes pd { 0%,100%{box-shadow:0 0 8px rgba(16,185,129,0.4)} 50%{box-shadow:0 0 16px rgba(16,185,129,0.8)} }
                    .timer { font-family: monospace; font-size: 14px; font-weight: 600; color: #f0a04b; padding: 2px 10px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); border-radius: 6px; font-variant-numeric: tabular-nums; }
                    .avatar { text-align: center; font-size: 32px; margin-bottom: 10px; }
                    .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #8b8ba3; margin-top: 2px; }
                    .controls { display: flex; gap: 8px; }
                    button { flex: 1; padding: 10px 0; border-radius: 10px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; }
                    .mic-on { background: linear-gradient(135deg, #ef4444, #dc2626); color: #fff; }
                    .mic-off { background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; }
                    .end { background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.25); color: #fca5a5; }
                    .back { width: 100%; margin-top: 8px; padding: 8px 0; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04); color: #8b8ba3; font-size: 12px; cursor: pointer; }
                    .back:hover { background: rgba(255,255,255,0.08); color: #e8e8f0; }
                  </style>
                  <div class="header"><span>🐛</span><span class="title">SpotTheBug</span></div>
                  <div class="avatar">🐛<div class="label" id="lbl">Listening...</div></div>
                  <div class="status-row">
                    <div class="connection"><span class="dot"></span>Connected</div>
                    <span class="timer" id="tmr">0:00</span>
                  </div>
                  <div class="controls">
                    <button class="mic-on" id="mic">⏹ Mute</button>
                    <button class="end" id="end">⏹ End</button>
                  </div>
                  <button class="back" id="back">↩ Back to Browser</button>
                `;
                let s = 0;
                const tid = setInterval(() => { s++; const e = pipWindow.document.getElementById("tmr"); if(e) e.textContent = `${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`; }, 1000);
                let m = false;
                const mb = pipWindow.document.getElementById("mic");
                mb?.addEventListener("click", () => { m=!m; if(mb){mb.textContent=m?"🎤 Unmute":"⏹ Mute"; mb.className=m?"mic-off":"mic-on";} const l=pipWindow.document.getElementById("lbl"); if(l)l.textContent=m?"Muted":"Listening..."; });
                let ended = false;
                pipWindow.document.getElementById("end")?.addEventListener("click", () => { ended = true; pipWindow.close(); });
                const ret = () => { window.focus(); };
                pipWindow.document.getElementById("back")?.addEventListener("click", ret);
                pipWindow.document.body.addEventListener("click", (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("button")) ret(); });
                pipWindow.addEventListener("pagehide", () => {
                  clearInterval(tid);
                  if (!ended) setShowTestInPage(true);
                });
              } catch (err) { console.error("PiP test:", err); }
            }}
            style={{
              marginTop: '20px',
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px dashed var(--color-border-hover)',
              background: 'rgba(255,255,255,0.03)',
              color: 'var(--color-text-muted)',
              fontSize: '0.8rem',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            🧪 Test Desktop Popup
          </button>
        </div>

        {/* In-page popup fallback when desktop popup closes */}
        {showTestInPage && (
          <FloatingCallPopup
            isConnected={true}
            isRecording={testMicActive}
            isSpeaking={false}
            elapsedTime={testTimer}
            onToggleMic={() => setTestMicActive(prev => !prev)}
            onEnd={() => { setShowTestInPage(false); setTestTimer(0); }}
            onClose={() => { setShowTestInPage(false); setTestTimer(0); }}
            onPinToDesktop={() => {
              // Re-trigger the test PiP button (needs user gesture — this IS a click)
              document.getElementById("test-pip-btn")?.click();
            }}
          />
        )}
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
