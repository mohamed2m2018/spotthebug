"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePairVoice, VoiceTranscript, PairSessionContext } from "@/hooks/usePairVoice";
import BugAvatar from "@/components/BugAvatar";
import { isDirectoryPickerSupported, pickAndReadWorkspace, WorkspaceResult } from "@/utils/workspaceReader";
import { ReviewMode, REVIEW_MODES, DEFAULT_MODE } from "@/config/reviewModes";
import styles from "@/app/session/session.module.css";

// ── Types ──

interface Message {
  role: "ai" | "user";
  text: string;
}

interface RecentProject {
  path: string;
  projectName: string;
  goal: string;
  frameworks: string[];
  lastUsed: number;
  cachedTree?: string;
}

interface PairSessionProps {
  onEnd: () => void;
}

// ── localStorage helpers ──

const RECENT_PROJECTS_KEY = "spotthebug_recent_projects";

function loadRecentProjects(): RecentProject[] {
  try {
    const data = localStorage.getItem(RECENT_PROJECTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveRecentProject(project: RecentProject) {
  const projects = loadRecentProjects().filter((p) => p.path !== project.path);
  projects.unshift({ ...project, lastUsed: Date.now() });
  localStorage.setItem(
    RECENT_PROJECTS_KEY,
    JSON.stringify(projects.slice(0, 5))
  );
}

// ── Component ──

export default function PairSession({ onEnd }: PairSessionProps) {
  // Setup state
  const [phase, setPhase] = useState<"setup" | "active">("setup");
  const [workspacePath, setWorkspacePath] = useState("");
  const [sessionGoal, setSessionGoal] = useState("");
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [isLoadingTree, setIsLoadingTree] = useState(false);
  const [treeError, setTreeError] = useState("");
  const [pickedWorkspace, setPickedWorkspace] = useState<WorkspaceResult | null>(null);
  const [supportsDirectoryPicker, setSupportsDirectoryPicker] = useState(false);
  const [selectedMode, setSelectedMode] = useState<ReviewMode>(DEFAULT_MODE);

  // Active session state
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [elapsedTime, setElapsedTime] = useState(0);
  const conversationRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pipWindowRef = useRef<Window | null>(null);

  const handleTranscript = useCallback((transcript: VoiceTranscript) => {
    const cleanText = transcript.text.trim();
    if (!cleanText) return;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === transcript.role) {
        return [
          ...prev.slice(0, -1),
          { ...last, text: last.text + " " + cleanText },
        ];
      }
      return [...prev, { role: transcript.role, text: cleanText }];
    });
  }, []);

  const {
    isConnected, isRecording, isScreenSharing, isSpeaking,
    startSession, stopSession, toggleMicrophone,
    startScreenShare, stopScreenShare, sendText,
  } = usePairVoice({ onTranscript: handleTranscript });

  // Load recent projects + check directory picker support on mount
  useEffect(() => {
    setRecentProjects(loadRecentProjects());
    setSupportsDirectoryPicker(isDirectoryPickerSupported());
  }, []);

  // Auto-scroll conversation
  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [messages]);

  // Elapsed timer
  useEffect(() => {
    if (phase !== "active") return;
    timerRef.current = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  // Cleanup PiP on unmount
  useEffect(() => {
    return () => {
      if (pipWindowRef.current) pipWindowRef.current.close();
    };
  }, []);

  // ── Fetch workspace tree (server-side fallback) ──
  const fetchWorkspaceTree = async (
    path: string
  ): Promise<WorkspaceResult | null> => {
    setIsLoadingTree(true);
    setTreeError("");
    try {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTreeError(data.error || "Failed to read workspace");
        return null;
      }
      return { tree: data.tree, projectName: data.projectName, frameworks: data.frameworks };
    } catch {
      setTreeError("Network error");
      return null;
    } finally {
      setIsLoadingTree(false);
    }
  };

  // ── Pick folder (client-side, Chromium only) ──
  const handlePickFolder = async () => {
    setIsLoadingTree(true);
    setTreeError("");
    try {
      const result = await pickAndReadWorkspace();
      setPickedWorkspace(result);
      setWorkspacePath(""); // Clear text input since we're using picker
    } catch (err) {
      // User cancelled the picker — not an error
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      console.error("[Pair] Folder pick failed:", err);
      setTreeError("Failed to read folder");
    } finally {
      setIsLoadingTree(false);
    }
  };

  // ── Start pairing ──
  const startPairing = async (context?: PairSessionContext) => {
    setPhase("active");
    setMessages([
      {
        role: "ai",
        text: "🎙️ Connecting to AI pair programmer...",
      },
    ]);

    try {
      await startSession(context);
      setMessages([
        {
          role: "ai",
          text: "🎙️ Connected! Listening... Share your screen when ready.",
        },
      ]);
    } catch (error) {
      console.error("Failed to start pair:", error);
      setMessages([{ role: "ai", text: "Failed to connect. Try again." }]);
    }
  };

  // ── Handle new project start ──
  const handleNewProjectStart = async () => {
    let context: PairSessionContext = {};

    // Use picked workspace (client-side) if available, otherwise fall back to text input (server-side)
    if (pickedWorkspace) {
      context.tree = pickedWorkspace.tree;
      context.projectName = pickedWorkspace.projectName;
      context.frameworks = pickedWorkspace.frameworks;

      saveRecentProject({
        path: `picker://${pickedWorkspace.projectName}`,
        projectName: pickedWorkspace.projectName,
        goal: sessionGoal.trim(),
        frameworks: pickedWorkspace.frameworks,
        cachedTree: pickedWorkspace.tree,
        lastUsed: Date.now(),
      });
    } else if (workspacePath.trim()) {
      const result = await fetchWorkspaceTree(workspacePath.trim());
      if (result) {
        context.tree = result.tree;
        context.projectName = result.projectName;
        context.frameworks = result.frameworks;

        saveRecentProject({
          path: workspacePath.trim(),
          projectName: result.projectName,
          goal: sessionGoal.trim(),
          frameworks: result.frameworks,
          cachedTree: result.tree,
          lastUsed: Date.now(),
        });
      } else {
        console.warn("[Pair] Workspace tree failed, continuing without it");
      }
    }

    if (sessionGoal.trim()) {
      context.goal = sessionGoal.trim();
    }

    context.mode = selectedMode;

    startPairing(Object.keys(context).length > 0 ? context : undefined);
  };

  // ── Continue recent project ──
  const handleContinueProject = async (project: RecentProject) => {
    setSessionGoal(project.goal);

    const context: PairSessionContext = {
      goal: project.goal || undefined,
      projectName: project.projectName,
      frameworks: project.frameworks,
      mode: selectedMode,
    };

    // Use cached tree if available (from picker flow), otherwise fetch from server
    if (project.cachedTree) {
      context.tree = project.cachedTree;
    } else if (!project.path.startsWith("picker://")) {
      setWorkspacePath(project.path);
      const result = await fetchWorkspaceTree(project.path);
      if (result) {
        context.tree = result.tree;
      }
    }

    // Update last used
    saveRecentProject(project);

    startPairing(context);
  };

  // ── PiP floating widget ──
  const openPipWidget = async () => {
    if (!("documentPictureInPicture" in window)) {
      alert("Picture-in-Picture not supported in this browser. Use Chrome/Edge.");
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
        width: 320,
        height: 220,
      });
      pipWindowRef.current = pipWindow;

      pipWindow.document.body.innerHTML = `
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Inter', -apple-system, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 16px; }
          .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
          .title { font-size: 14px; font-weight: 600; }
          .timer { font-size: 13px; color: #a0a0b0; font-variant-numeric: tabular-nums; }
          .status { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 12px; }
          .dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; }
          .dot.off { background: #ef4444; }
          .controls { display: flex; gap: 8px; flex-wrap: wrap; }
          button { padding: 8px 14px; border-radius: 8px; border: none; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
          .mic { background: #4ade80; color: #000; }
          .mic.muted { background: #374151; color: #9ca3af; }
          .review { background: #8b5cf6; color: #fff; }
          .end { background: #ef4444; color: #fff; }
        </style>
        <div class="header">
          <span class="title">🐛 SpotTheBug</span>
          <span class="timer" id="pip-timer">0:00</span>
        </div>
        <div class="status">
          <span class="dot" id="pip-dot"></span>
          <span id="pip-status">Connected</span>
        </div>
        <div class="controls">
          <button class="mic" id="pip-mic">🎤 Mute</button>
          <button class="review" id="pip-review">👀 Review</button>
          <button class="end" id="pip-end">⏹ End</button>
        </div>
      `;

      // Wire up PiP buttons
      pipWindow.document.getElementById("pip-mic")?.addEventListener("click", () => {
        toggleMicrophone();
      });
      pipWindow.document.getElementById("pip-review")?.addEventListener("click", () => {
        sendText("[REVIEW_NOW] Look at my screen right now. Describe exactly what you see and give me your honest review — architecture, clean code, bugs, everything.");
      });
      pipWindow.document.getElementById("pip-end")?.addEventListener("click", () => {
        handleEnd();
        pipWindow.close();
      });

      // Update PiP timer
      const pipTimer = setInterval(() => {
        const timerEl = pipWindow.document.getElementById("pip-timer");
        if (timerEl) {
          const mins = Math.floor(elapsedTime / 60);
          const secs = elapsedTime % 60;
          timerEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
        }
      }, 1000);

      pipWindow.addEventListener("pagehide", () => {
        clearInterval(pipTimer);
        pipWindowRef.current = null;
      });
    } catch (err) {
      console.error("[Pair] PiP error:", err);
    }
  };

  // ── End session ──
  const handleEnd = () => {
    stopSession();
    if (timerRef.current) clearInterval(timerRef.current);
    if (pipWindowRef.current) pipWindowRef.current.close();
    onEnd();
  };

  const sendMessage = () => {
    if (!inputText.trim() || !isConnected) return;
    const userMsg = inputText.trim();
    setInputText("");
    setMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    sendText(userMsg);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // ── SETUP PHASE ──
  if (phase === "setup") {
    return (
      <div className={styles.setupScreen}>
        <div className={styles.pairSetupContainer}>
          <h1 className={styles.setupTitle}>🤝 Pair Programming</h1>
          <p className={styles.setupSubtitle}>
            Set up your session for focused, structured code review
          </p>

          {/* Recent Projects */}
          {recentProjects.length > 0 && (
            <div className={styles.recentSection}>
              <h3 className={styles.recentTitle}>Recent Projects</h3>
              <div className={styles.recentGrid}>
                {recentProjects.map((project) => (
                  <div key={project.path} className={styles.recentCard}>
                    <div className={styles.recentCardHeader}>
                      <span className={styles.recentCardName}>
                        📁 {project.projectName}
                      </span>
                      {project.frameworks.length > 0 && (
                        <span className={styles.recentCardFramework}>
                          {project.frameworks[0]}
                        </span>
                      )}
                    </div>
                    {project.goal && (
                      <p className={styles.recentCardGoal}>{project.goal}</p>
                    )}
                    <div className={styles.recentCardActions}>
                      <button
                        className={styles.continueBtn}
                        onClick={() => handleContinueProject(project)}
                      >
                        ▶ Continue
                      </button>
                      <button
                        className={styles.editBtn}
                        onClick={() => {
                          setWorkspacePath(project.path);
                          setSessionGoal(project.goal);
                        }}
                      >
                        ✏️ Edit
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New Project Setup */}
          <div className={styles.newProjectSection}>
            {recentProjects.length > 0 && (
              <h3 className={styles.recentTitle}>New Project</h3>
            )}

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Workspace{" "}
                <span className={styles.formOptional}>(optional)</span>
              </label>

              {pickedWorkspace ? (
                /* ── Picked folder display ── */
                <div className={styles.pickedFolder}>
                  <div className={styles.pickedFolderInfo}>
                    <span className={styles.pickedFolderIcon}>📁</span>
                    <span className={styles.pickedFolderName}>
                      {pickedWorkspace.projectName}
                    </span>
                    {pickedWorkspace.frameworks.length > 0 && (
                      <div className={styles.pickedFolderFrameworks}>
                        {pickedWorkspace.frameworks.slice(0, 3).map((fw) => (
                          <span key={fw} className={styles.frameworkTag}>
                            {fw}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    className={styles.clearPickBtn}
                    onClick={() => setPickedWorkspace(null)}
                    title="Remove workspace"
                  >
                    ✕
                  </button>
                </div>
              ) : supportsDirectoryPicker ? (
                /* ── Folder picker button (Chromium) ── */
                <button
                  className={styles.pickFolderBtn}
                  onClick={handlePickFolder}
                  disabled={isLoadingTree}
                >
                  {isLoadingTree ? "Reading folder..." : "📂 Pick Folder"}
                </button>
              ) : (
                /* ── Fallback text input (Firefox/Safari) ── */
                <input
                  className={styles.formInput}
                  placeholder="/Users/you/your-project"
                  value={workspacePath}
                  onChange={(e) => setWorkspacePath(e.target.value)}
                />
              )}
              <span className={styles.formHint}>
                Reads your file tree for context. Secrets (.env, keys) are never
                read.
              </span>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                What are you working on?{" "}
                <span className={styles.formOptional}>(optional)</span>
              </label>
              <input
                className={styles.formInput}
                placeholder="e.g. Building the auth flow, fixing a bug in checkout..."
                value={sessionGoal}
                onChange={(e) => setSessionGoal(e.target.value)}
              />
              <span className={styles.formHint}>
                Helps the AI focus on your specific task
              </span>
            </div>

            {treeError && (
              <div className={styles.treeError}>⚠️ {treeError}</div>
            )}

            {/* Mode Selector */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Review Mode</label>
              <div className={styles.modeSelector}>
                {Object.values(REVIEW_MODES).map((mode) => (
                  <button
                    key={mode.id}
                    className={`${styles.modeOption} ${selectedMode === mode.id ? styles.modeOptionActive : ""}`}
                    onClick={() => setSelectedMode(mode.id)}
                  >
                    <span className={styles.modeOptionIcon}>{mode.icon}</span>
                    <div className={styles.modeOptionContent}>
                      <span className={styles.modeOptionLabel}>{mode.label}</span>
                      <span className={styles.modeOptionDesc}>{mode.description}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <button
              className={styles.startPairingBtn}
              onClick={handleNewProjectStart}
              disabled={isLoadingTree}
            >
              {isLoadingTree ? "Reading workspace..." : "🎙️ Start Pairing"}
            </button>
          </div>

          <button className={styles.backBtn} onClick={onEnd}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  // ── ACTIVE SESSION ──
  return (
    <div className={styles.sessionPage}>
      <header className={styles.sessionHeader}>
        <nav className={styles.sessionNav}>
          <a href="/" className={styles.sessionLogo}>
            🐛 Spot
            <span className={styles.sessionLogoHighlight}>TheBug</span>
          </a>
          <div className={styles.sessionControls}>
            <span className={styles.timer}>{formatTime(elapsedTime)}</span>
            {"documentPictureInPicture" in (typeof window !== "undefined" ? window : {}) && (
              <button className={styles.pipBtn} onClick={openPipWidget} title="Pop out controls">
                ⬆️ Pop Out
              </button>
            )}
            <button className={styles.endSessionBtn} onClick={handleEnd}>
              End Session
            </button>
          </div>
        </nav>
      </header>

      <main className={styles.pairMain}>
        <div className={styles.voicePanel} style={{ maxWidth: "800px", margin: "0 auto" }}>
          <div className={styles.voicePanelHeader}>
            <span className={styles.voicePanelTitle}>🤝 AI Pair Programmer</span>
            <span className={styles.connectionStatus}>
              <span className={`${styles.connectionDot} ${isConnected ? styles.connectionDotConnected : ""}`} />
              {isConnected ? "Connected" : "Disconnected"}
            </span>
          </div>

          <div className={styles.avatarArea}>
            <BugAvatar isSpeaking={isSpeaking} isListening={isRecording && !isSpeaking} isConnected={isConnected} />
          </div>

          {isScreenSharing && (
            <div className={styles.screenShareStatus}>
              <span className={styles.screenShareDot} />
              Screen sharing active — AI can see your screen
            </div>
          )}

          <div className={styles.conversationArea} ref={conversationRef}>
            {messages.map((msg, i) => (
              <div key={i} className={`${styles.message} ${msg.role === "ai" ? styles.messageAi : styles.messageUser}`}>
                {msg.text}
              </div>
            ))}
          </div>

          <div className={styles.inputArea}>
            <div className={styles.micControls}>
              <button
                onClick={toggleMicrophone}
                className={`${styles.micBtn} ${isRecording ? styles.micBtnActive : styles.micBtnInactive}`}
              >
                {isRecording ? "⏹ Mute" : "🎤 Unmute"}
              </button>
              <button
                onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                className={`${styles.micBtn} ${isScreenSharing ? styles.screenBtnActive : styles.screenBtnInactive}`}
              >
                {isScreenSharing ? "🖥️ Stop Sharing" : "🖥️ Share Screen"}
              </button>
              {isScreenSharing && (
                <button
                  onClick={() =>
                    sendText(
                      "[REVIEW_NOW] Look at my screen right now. Describe exactly what you see and give me your honest review — architecture, clean code, bugs, everything."
                    )
                  }
                  className={styles.reviewBtn}
                >
                  👀 Review This
                </button>
              )}
            </div>
            <div className={styles.inputRow}>
              <input
                className={styles.textInput}
                placeholder="Type a message..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              />
              <button className={styles.sendBtn} onClick={sendMessage} disabled={!isConnected}>
                Send
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
