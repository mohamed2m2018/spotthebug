"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePairVoice, VoiceTranscript, PairSessionContext } from "@/hooks/usePairVoice";
import BugAvatar from "@/components/BugAvatar";
import FloatingCallPopup from "@/components/FloatingCallPopup";
import { isDirectoryPickerSupported, pickAndReadWorkspace, WorkspaceResult } from "@/utils/workspaceReader";
import { isGitRepo, getChangedFiles, GitChangedFile } from "@/utils/gitDiff";
import type { ReviewFinding } from "@/config/prompts";
import * as traceClient from "@/lib/traceClient";
import { recordSession } from "@/utils/recordSession";
import styles from "@/app/session/session.module.css";

interface Message {
  role: "ai" | "user";
  text: string;
}

interface PairSessionProps {
  onEnd: () => void;
}

// ── Component ──

export default function PairSession({ onEnd }: PairSessionProps) {
  // Setup state
  const [phase, setPhase] = useState<"setup" | "active" | "ended">("setup");
  const [sessionGoal, setSessionGoal] = useState("");
  const [isLoadingTree, setIsLoadingTree] = useState(false);
  const [treeError, setTreeError] = useState("");
  const [pickedWorkspace, setPickedWorkspace] = useState<WorkspaceResult | null>(null);
  const [supportsDirectoryPicker, setSupportsDirectoryPicker] = useState(false);
  const [readingFile, setReadingFile] = useState<string | null>(null);
  const [showFloatingPopup, setShowFloatingPopup] = useState(false);

  // Git diff & review state
  const [changedFiles, setChangedFiles] = useState<GitChangedFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [isDetectingGit, setIsDetectingGit] = useState(false);
  const [gitProgress, setGitProgress] = useState('');
  const [hasGit, setHasGit] = useState(false);
  const [reviewFindings, setReviewFindings] = useState<ReviewFinding[] | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewProgress, setReviewProgress] = useState('');
  const [reviewStep, setReviewStep] = useState(0);
  const [reviewTool, setReviewTool] = useState<string>("");

  // Active session state
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [elapsedTime, setElapsedTime] = useState(0);
  const conversationRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pipWindowRef = useRef<Window | null>(null);

  // Transcript callback — no-op since we don't display transcripts in the UI.
  // The native-audio model's text output is internal reasoning (thinking text),
  // not the actual spoken content. Showing it would confuse users.
  const handleTranscript = useCallback((_transcript: VoiceTranscript) => {
    // Intentionally not added to messages — UI shouldn't show AI thinking text
  }, []);

  // Use ref to break circular dependency: handleScreenShareEnd needs stopSession,
  // but stopSession comes from usePairVoice which takes handleScreenShareEnd as option
  const stopSessionRef = useRef<(() => void) | null>(null);

  const handleScreenShareEnd = useCallback(() => {
    stopSessionRef.current?.();
    if (timerRef.current) clearInterval(timerRef.current);
    if (pipWindowRef.current) pipWindowRef.current.close();
    setPhase("ended");
  }, []);

  const handleFileRead = useCallback((filePath: string) => {
    setReadingFile(filePath);
    setMessages((prev) => [...prev, { role: "ai", text: `📖 Reading ${filePath}...` }]);
    // Clear after 3 seconds
    setTimeout(() => setReadingFile(null), 3000);
  }, []);

  const {
    isConnected, isRecording, isScreenSharing, isSpeaking, isAiMuted,
    startSession, stopSession, toggleMicrophone, toggleAiAudio,
    startScreenShare, stopScreenShare, sendText,
  } = usePairVoice({
    onTranscript: handleTranscript,
    onScreenShareEnd: handleScreenShareEnd,
    onFileRead: handleFileRead,
  });

  // Populate ref after hook runs
  stopSessionRef.current = stopSession;

  // Check directory picker support on mount
  useEffect(() => {
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

  // ── Pick folder (client-side, Chromium only) ──
  const handlePickFolder = async () => {
    setIsLoadingTree(true);
    setTreeError("");
    try {
      const result = await pickAndReadWorkspace();
      setPickedWorkspace(result);

      // Auto-detect git changes
      setIsDetectingGit(true);
      try {
        const isGit = await isGitRepo(result.dirHandle);
        console.log('[Pair] isGitRepo:', isGit);
        setHasGit(isGit);
        if (isGit) {
          const files = await getChangedFiles(result.dirHandle, setGitProgress);
          console.log('[Pair] Changed files found:', files.length, files.map(f => `${f.status} ${f.filePath}`));
          setChangedFiles(files);
          // Auto-select all changed files
          setSelectedFiles(files.map(f => f.filePath));
          if (files.length === 0) {
            console.log('[Pair] Git repo detected but no uncommitted changes');
          }
        }
      } catch (gitErr) {
        console.error("[Pair] Git detection failed:", gitErr);
        setTreeError(`⚠️ Could not scan git changes: ${gitErr instanceof Error ? gitErr.message : 'Unknown error'}. You can still start the session without code analysis.`);
      } finally {
        setIsDetectingGit(false);
      }
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

  // ── Run code review ──
  const handleRunReview = async () => {
    if (selectedFiles.length === 0 || !pickedWorkspace) return;
    setIsReviewing(true);
    setTreeError("");

    const reviewTraceId = traceClient.generateSessionId();
    traceClient.startTrace(reviewTraceId, "pair", {
      phase: 'codeReview',
      filesCount: selectedFiles.length,
      projectName: pickedWorkspace.projectName,
    });
    traceClient.traceEvent(reviewTraceId, 'codeReview.start', {
      input: { selectedFiles, goal: sessionGoal.trim() || undefined },
    });

    // Start progress before the try so it's accessible in finally


    try {
      const filesToReview = changedFiles
        .filter(f => selectedFiles.includes(f.filePath) && f.content)
        .map(f => ({
          path: f.filePath,
          content: f.content!,
          originalContent: f.originalContent || undefined,
          language: f.filePath.split('.').pop() || 'text',
        }));

      // Diagnostic: show which files have originalContent for diff scoping
      console.log('[Review] Files being sent to review API:');
      for (const f of filesToReview) {
        const hasOrig = !!f.originalContent;
        console.log(`  ${hasOrig ? '✅' : '⚠️ FULL FILE'} ${f.path} (content: ${f.content.length}, original: ${f.originalContent?.length ?? 'MISSING'})`);
      }

      // Stream real progress from SSE response
      setReviewProgress('🔍 Sending code for review...');
      setReviewStep(0);

      const res = await fetch('/api/review-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filesToReview, goal: sessionGoal.trim() || undefined }),
      });

      if (!res.ok) throw new Error('Review API failed');

      // Read SSE stream for real-time progress
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let data: { findings?: unknown[]; tool?: string; riskScore?: number; summary?: string } | null = null;

      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // keep incomplete last chunk

          for (const line of lines) {
            const match = line.match(/^data: (.+)$/m);
            if (!match) continue;
            try {
              const event = JSON.parse(match[1]);
              if (event.type === 'progress') {
                setReviewProgress(event.message);
                // Map progress message to step number for the progress bar
                if (event.message.includes('Analyzing')) setReviewStep(1);
                else if (event.message.includes('Validating')) setReviewStep(2);
                else if (event.message.includes('Structuring')) setReviewStep(3);
              } else if (event.type === 'result') {
                data = event;
              } else if (event.type === 'error') {
                throw new Error(event.error);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue; // skip malformed JSON
              throw e;
            }
          }
        }
      }

      if (data) {
        setReviewFindings((data.findings as typeof reviewFindings) || []);
        setReviewTool(data.tool || 'unknown');
      } else {
        throw new Error('No review result received');
      }

      traceClient.traceEvent(reviewTraceId, 'codeReview.complete', {
        output: {
          findingsCount: (data.findings || []).length,
          riskScore: data.riskScore,
          summary: data.summary,
          tool: data.tool,
        },
      });
    } catch (err) {
      console.error("[Pair] Code review failed:", err);
      setTreeError("Code review failed. You can still start the session without it.");
      setReviewFindings([]);

      traceClient.traceEvent(reviewTraceId, 'codeReview.error', {
        metadata: { error: String(err) },
      });
    } finally {
      setReviewStep(0);
      setReviewProgress('');
      setIsReviewing(false);
      traceClient.endTrace(reviewTraceId);
    }
  };

  // ── Toggle file selection ──
  const toggleFileSelection = (filePath: string) => {
    setSelectedFiles(prev =>
      prev.includes(filePath)
        ? prev.filter(f => f !== filePath)
        : [...prev, filePath]
    );
    // Reset review if file selection changes
    setReviewFindings(null);
  };

  // ── Start pairing ──
  const startPairing = async (context: PairSessionContext) => {
    // Step 1: Open desktop popup FIRST — must happen during user gesture
    // (documentPictureInPicture requires transient user activation)
    if ("documentPictureInPicture" in window) {
      try {
        await openDesktopPopup();
      } catch (err) {
        console.warn("[Pair] Could not open desktop popup, using in-page fallback:", err);
      }
    }

    // Step 2: Get screen share — mandatory
    let screenStream: MediaStream;
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: false,
      });
    } catch {
      // User cancelled the screen share dialog — close PiP if opened
      if (pipWindowRef.current) pipWindowRef.current.close();
      setTreeError("🖥️ Screen sharing is required for pair programming. Please share your screen to start.");
      return;
    }

    // Step 3: Screen share granted — now connect
    setPhase("active");
    if (!pipWindowRef.current) {
      // PiP wasn't opened (unsupported browser) — show in-page popup
      setShowFloatingPopup(true);
    }
    setMessages([{ role: "ai", text: "🎤 Connecting..." }]);

    try {
      await startSession({ ...context, screenStream });
      // Don't show "Connected" message — let the AI's first audio response
      // (after seeing the screen) naturally confirm the connection
    } catch (error) {
      console.error("Failed to start pair:", error);
      screenStream.getTracks().forEach(t => t.stop());
      if (pipWindowRef.current) pipWindowRef.current.close();
      setMessages([{ role: "ai", text: "Failed to connect. Try again." }]);
    }
  };

  // ── Handle project start ──
  const handleNewProjectStart = async () => {
    if (!pickedWorkspace) {
      setTreeError("Please pick a workspace folder first.");
      return;
    }

    const context: PairSessionContext = {
      tree: pickedWorkspace.tree,
      projectName: pickedWorkspace.projectName,
      frameworks: pickedWorkspace.frameworks,
      dirHandle: pickedWorkspace.dirHandle,
    };

    if (sessionGoal.trim()) {
      context.goal = sessionGoal.trim();
    }

    // Inject review findings if available
    if (reviewFindings && selectedFiles.length > 0) {
      context.reviewFindings = reviewFindings;
      context.selectedFiles = selectedFiles;
    }

    startPairing(context);
  };

  // ── PiP Desktop Widget (always-on-top OS window) ──
  const openDesktopPopup = async () => {
    if (!("documentPictureInPicture" in window)) {
      alert("Picture-in-Picture not supported in this browser. Use Chrome/Edge.");
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
        width: 320,
        height: 240,
      });
      pipWindowRef.current = pipWindow;
      // Hide in-page popup while desktop popup is open
      setShowFloatingPopup(false);

      pipWindow.document.body.innerHTML = `
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Inter', -apple-system, system-ui, sans-serif;
            background: #14141e;
            color: #e8e8f0;
            padding: 16px;
            user-select: none;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            margin-bottom: 14px;
          }
          .header-left { display: flex; align-items: center; gap: 8px; }
          .title { font-size: 14px; font-weight: 600; color: #f0a04b; }
          .status-row {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            margin-bottom: 14px;
          }
          .connection {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: #8b8ba3;
          }
          .dot {
            width: 8px; height: 8px;
            border-radius: 50%;
            background: #10b981;
            box-shadow: 0 0 8px rgba(16,185,129,0.6);
            animation: pulseDot 2s ease-in-out infinite;
          }
          @keyframes pulseDot {
            0%, 100% { box-shadow: 0 0 8px rgba(16,185,129,0.4); }
            50% { box-shadow: 0 0 16px rgba(16,185,129,0.8); }
          }
          .timer {
            font-family: 'Fira Code', monospace;
            font-size: 14px;
            font-weight: 600;
            color: #f0a04b;
            padding: 2px 10px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 6px;
            font-variant-numeric: tabular-nums;
          }
          .avatar-area {
            text-align: center;
            font-size: 32px;
            margin-bottom: 10px;
          }
          .avatar-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #8b8ba3;
            margin-top: 2px;
          }
          .controls { display: flex; gap: 8px; }
          button {
            flex: 1;
            padding: 10px 0;
            border-radius: 10px;
            border: none;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
          }
          .mic-active {
            background: linear-gradient(135deg, #ef4444, #dc2626);
            color: #fff;
            box-shadow: 0 0 12px rgba(239,68,68,0.25);
          }
          .mic-inactive {
            background: linear-gradient(135deg, #22c55e, #16a34a);
            color: #fff;
          }
          .end-btn {
            background: rgba(239,68,68,0.12);
            border: 1px solid rgba(239,68,68,0.25);
            color: #fca5a5;
          }
          .end-btn:hover {
            background: rgba(239,68,68,0.2);
            color: #fff;
          }
          .back-btn {
            width: 100%;
            margin-top: 8px;
            padding: 8px 0;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.1);
            background: rgba(255,255,255,0.04);
            color: #8b8ba3;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s;
          }
          .back-btn:hover {
            background: rgba(255,255,255,0.08);
            color: #e8e8f0;
            border-color: rgba(255,255,255,0.2);
          }
        </style>
        <div class="header">
          <div class="header-left">
            <span>🐛</span>
            <span class="title">SpotTheBug</span>
          </div>
        </div>
        <div class="avatar-area">
          🐛
          <div class="avatar-label" id="pip-avatar-label">Listening...</div>
        </div>
        <div class="status-row">
          <div class="connection">
            <span class="dot"></span>
            Connected
          </div>
          <span class="timer" id="pip-timer">0:00</span>
        </div>
        <div class="controls">
          <button class="mic-active" id="pip-mic">⏹ Mute</button>
          <button class="mic-active" id="pip-pause-ai">⏸️ Pause AI</button>
          <button class="end-btn" id="pip-end">⏹ End</button>
        </div>
        <button class="back-btn" id="pip-back">↩ Back to Browser</button>
      `;

      // ── Self-updating timer (owns its own counter — no stale closure) ──
      let pipSeconds = elapsedTime;
      const pipTimerInterval = setInterval(() => {
        pipSeconds++;
        const timerEl = pipWindow.document.getElementById("pip-timer");
        if (timerEl) {
          const mins = Math.floor(pipSeconds / 60);
          const secs = pipSeconds % 60;
          timerEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
        }
      }, 1000);

      // ── Mic toggle with reactive button UI ──
      let pipMicMuted = false;
      const micBtn = pipWindow.document.getElementById("pip-mic");
      micBtn?.addEventListener("click", () => {
        toggleMicrophone();
        pipMicMuted = !pipMicMuted;
        if (micBtn) {
          micBtn.textContent = pipMicMuted ? "🎤 Unmute" : "⏹ Mute";
          micBtn.className = pipMicMuted ? "mic-inactive" : "mic-active";
        }
        const label = pipWindow.document.getElementById("pip-avatar-label");
        if (label) label.textContent = pipMicMuted ? "Muted" : "Listening...";
      });

      // ── Pause AI toggle with reactive button UI ──
      let pipAiMuted = false;
      const pauseAiBtn = pipWindow.document.getElementById("pip-pause-ai");
      pauseAiBtn?.addEventListener("click", () => {
        toggleAiAudio();
        pipAiMuted = !pipAiMuted;
        if (pauseAiBtn) {
          pauseAiBtn.textContent = pipAiMuted ? "▶️ Resume AI" : "⏸️ Pause AI";
          pauseAiBtn.className = pipAiMuted ? "mic-inactive" : "mic-active";
        }
      });

      // ── End session (full close — no in-page fallback) ──
      let endedViaButton = false;
      pipWindow.document.getElementById("pip-end")?.addEventListener("click", () => {
        endedViaButton = true;
        handleEnd();
        pipWindow.close();
      });

      // ── Back to browser — focus parent window but keep PiP alive ──
      const returnToBrowser = () => { window.focus(); };
      pipWindow.document.getElementById("pip-back")?.addEventListener("click", returnToBrowser);
      pipWindow.document.body.addEventListener("click", (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest("button")) returnToBrowser();
      });

      // ── Cleanup when PiP window is closed ──
      pipWindow.addEventListener("pagehide", () => {
        clearInterval(pipTimerInterval);
        pipWindowRef.current = null;
        // Only show in-page popup if PiP was closed via OS × button, not End
        if (!endedViaButton) {
          setShowFloatingPopup(true);
        }
      });
    } catch (err) {
      console.error("[Pair] Desktop PiP error:", err);
    }
  };

  // ── End session ──
  const handleEnd = () => {
    stopSession();
    if (timerRef.current) clearInterval(timerRef.current);
    if (pipWindowRef.current) pipWindowRef.current.close();
    // Record session to database
    recordSession({ mode: 'pair', duration: elapsedTime });
    setPhase("ended");
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

          {/* Workspace Setup */}
          <div className={styles.newProjectSection}>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Workspace
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
                <p className={styles.formHint}>
                  ⚠️ Your browser doesn&apos;t support folder picking. Please use Chrome or Edge.
                </p>
              )}
              <span className={styles.formHint}>
                Required. Gives the AI access to read your files accurately.
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

            {/* Git Changed Files */}
            {pickedWorkspace && hasGit && changedFiles.length > 0 && (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  Changed Files
                  <span className={styles.formOptional}>
                    ({changedFiles.length} file{changedFiles.length > 1 ? 's' : ''} changed)
                  </span>
                </label>
                <div style={{
                  maxHeight: '200px',
                  overflowY: 'auto',
                  borderRadius: '8px',
                  border: '1px solid var(--border-primary, rgba(255,255,255,0.1))',
                  background: 'var(--bg-tertiary, rgba(0,0,0,0.2))',
                }}>
                  {changedFiles.map((file) => (
                    <label
                      key={file.filePath}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 14px',
                        cursor: 'pointer',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <input
                        type="checkbox"
                        checked={selectedFiles.includes(file.filePath)}
                        onChange={() => toggleFileSelection(file.filePath)}
                        style={{ accentColor: '#4ade80', width: '16px', height: '16px' }}
                      />
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: file.status === 'added' ? 'rgba(74,222,128,0.15)' : file.status === 'deleted' ? 'rgba(239,68,68,0.15)' : 'rgba(250,204,21,0.15)',
                        color: file.status === 'added' ? '#4ade80' : file.status === 'deleted' ? '#ef4444' : '#facc15',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}>
                        {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}
                      </span>
                      <span style={{ fontSize: '13px', fontFamily: 'monospace', opacity: 0.9 }}>
                        {file.filePath}
                      </span>
                    </label>
                  ))}
                </div>

                {/* Run Review Button + Progress Bar */}
                {!reviewFindings && (
                  <div style={{ marginTop: '10px' }}>
                    <button
                      className={styles.pickFolderBtn}
                      onClick={handleRunReview}
                      disabled={isReviewing || selectedFiles.length === 0}
                      style={{ width: '100%' }}
                    >
                      {isReviewing
                        ? (reviewProgress || '🔍 Preparing review...')
                        : `🔍 Analyze Changes Before Call (${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''})`}
                    </button>

                    {/* Progress bar — visible only during review */}
                    {isReviewing && (
                      <div className={styles.reviewProgressContainer}>
                        <div className={styles.reviewProgressBar}>
                          <div
                            className={styles.reviewProgressFill}
                            style={{ width: `${Math.max(5, (reviewStep / 3) * 100)}%` }}
                          />
                        </div>
                        <div className={styles.reviewProgressMeta}>
                          <span className={styles.reviewProgressLabel}>
                            Step {reviewStep}/3
                          </span>
                          <span className={styles.reviewProgressPercent}>
                            {Math.round((reviewStep / 3) * 100)}%
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Analysis complete — brief confirmation */}
                {reviewFindings && (
                  <div style={{
                    marginTop: '10px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: 'rgba(74,222,128,0.08)',
                    border: '1px solid rgba(74,222,128,0.2)',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}>
                    ✅ Analysis complete — ready to start
                  </div>
                )}

                <span className={styles.formHint}>
                  Your AI partner will discuss findings with you during the call
                </span>
              </div>
            )}

            {/* Git detection in progress */}
            {isDetectingGit && (
              <div style={{ padding: '12px', textAlign: 'center', opacity: 0.7, fontSize: '13px' }}>
                🔍 {gitProgress || 'Detecting git changes...'}
              </div>
            )}

            {/* No git or no changes */}
            {pickedWorkspace && !isDetectingGit && hasGit && changedFiles.length === 0 && (
              <div style={{ padding: '12px', opacity: 0.6, fontSize: '13px' }}>
                ✅ No uncommitted changes detected. The AI will review your code live via screen share.
              </div>
            )}


            <button
              className={styles.startPairingBtn}
              onClick={handleNewProjectStart}
              disabled={
                isLoadingTree ||
                !pickedWorkspace ||
                isReviewing ||
                isDetectingGit ||
                (hasGit && changedFiles.length > 0 && !reviewFindings)
              }
            >
              {isLoadingTree
                ? "Reading workspace..."
                : isDetectingGit
                  ? "🔍 Detecting changes..."
                  : isReviewing
                    ? "🔍 Reviewing code..."
                    : !pickedWorkspace
                      ? "📂 Pick a Workspace First"
                      : (hasGit && changedFiles.length > 0 && !reviewFindings)
                        ? "⚠️ Run Analysis First"
                        : reviewFindings
                          ? `🎤 Start Pairing (${reviewFindings.length} issues to discuss)`
                          : "🎤 Start Pairing"}
            </button>
          </div>

          <button className={styles.backBtn} onClick={onEnd}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  // ── ENDED PHASE — Session Summary ──
  if (phase === "ended") {
    return (
      <div className={styles.setupScreen}>
        <div className={styles.pairSetupContainer}>
          <h1 className={styles.setupTitle}>✅ Session Complete</h1>
          <p className={styles.setupSubtitle}>
            Here&apos;s a summary of your pair programming session
          </p>

          <div className={styles.newProjectSection}>
            {/* Session stats */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
              marginBottom: '20px',
            }}>
              <div style={{
                padding: '16px',
                borderRadius: '12px',
                background: 'var(--bg-tertiary, rgba(0,0,0,0.2))',
                border: '1px solid var(--border-primary, rgba(255,255,255,0.1))',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '24px', fontWeight: 700 }}>{formatTime(elapsedTime)}</div>
                <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '4px' }}>Session Duration</div>
              </div>
              <div style={{
                padding: '16px',
                borderRadius: '12px',
                background: 'var(--bg-tertiary, rgba(0,0,0,0.2))',
                border: '1px solid var(--border-primary, rgba(255,255,255,0.1))',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '24px', fontWeight: 700 }}>{selectedFiles.length || '—'}</div>
                <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '4px' }}>Files Reviewed</div>
              </div>
            </div>

            {/* Review findings summary */}
            {reviewFindings && reviewFindings.length > 0 && (
              <div style={{
                padding: '14px',
                borderRadius: '10px',
                background: 'rgba(250,204,21,0.06)',
                border: '1px solid rgba(250,204,21,0.15)',
                marginBottom: '16px',
              }}>
                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '10px' }}>
                  📋 Pre-Analysis Findings ({reviewFindings.length})
                </div>
                <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                  {reviewFindings.slice(0, 5).map((f, i) => (
                    <div key={i} style={{ marginBottom: '6px', opacity: 0.85 }}>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        padding: '1px 5px',
                        borderRadius: '3px',
                        marginRight: '6px',
                        background: f.severity === 'ERROR' ? 'rgba(239,68,68,0.15)' : f.severity === 'WARNING' ? 'rgba(250,204,21,0.15)' : 'rgba(74,222,128,0.15)',
                        color: f.severity === 'ERROR' ? '#ef4444' : f.severity === 'WARNING' ? '#facc15' : '#4ade80',
                      }}>{f.severity}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{f.file}:{f.line}</span>
                      <span style={{ marginLeft: '6px' }}>— {f.message}</span>
                    </div>
                  ))}
                  {reviewFindings.length > 5 && (
                    <div style={{ opacity: 0.5, fontSize: '12px' }}>
                      +{reviewFindings.length - 5} more findings
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Goal reminder */}
            {sessionGoal && (
              <div style={{
                padding: '12px 14px',
                borderRadius: '8px',
                background: 'var(--bg-tertiary, rgba(0,0,0,0.2))',
                border: '1px solid var(--border-primary, rgba(255,255,255,0.1))',
                marginBottom: '16px',
                fontSize: '13px',
              }}>
                <strong>Goal:</strong> {sessionGoal}
              </div>
            )}

            {/* Copyable IDE fix prompt */}
            {reviewFindings && reviewFindings.length > 0 && (() => {
              const prompt = `Fix the following issues found during code review:\n\n${reviewFindings.map((f, i) =>
                `${i + 1}. [${f.severity}] ${f.file}:${f.line}\n   Issue: ${f.message}${f.suggestedFix ? `\n   Suggested fix: ${f.suggestedFix}` : ''}`
              ).join('\n\n')}`;

              return (
                <div style={{
                  marginBottom: '16px',
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px',
                  }}>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>
                      🛠️ Fix Prompt — paste in your IDE
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(prompt);
                        const btn = document.getElementById('copy-prompt-btn');
                        if (btn) { btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000); }
                      }}
                      id="copy-prompt-btn"
                      style={{
                        padding: '4px 12px',
                        borderRadius: '6px',
                        border: '1px solid rgba(255,255,255,0.15)',
                        background: 'rgba(255,255,255,0.05)',
                        color: 'inherit',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      📋 Copy
                    </button>
                  </div>
                  <pre style={{
                    padding: '14px',
                    borderRadius: '10px',
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid var(--border-primary, rgba(255,255,255,0.1))',
                    fontSize: '12px',
                    lineHeight: '1.5',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    margin: 0,
                    fontFamily: 'monospace',
                  }}>
                    {prompt}
                  </pre>
                </div>
              );
            })()}

            <button
              className={styles.startPairingBtn}
              onClick={onEnd}
            >
              ← Back to Home
            </button>
          </div>
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
              <button className={styles.pipBtn} onClick={openDesktopPopup} title="Pop out controls">
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
                {isRecording ? "⏹ Mute" : "🎙 Unmute"}
              </button>
              <button onClick={toggleAiAudio} className={`${styles.micBtn} ${isAiMuted ? styles.micBtnInactive : styles.micBtnActive}`}>
                {isAiMuted ? "▶️ Resume AI" : "⏸️ Pause AI"}
              </button>
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

      {/* Floating call popup */}
      {showFloatingPopup && (
        <FloatingCallPopup
          isConnected={isConnected}
          isRecording={isRecording}
          isSpeaking={isSpeaking}
          elapsedTime={elapsedTime}
          onToggleMic={toggleMicrophone}
          onEnd={handleEnd}
          onClose={() => setShowFloatingPopup(false)}
          onPinToDesktop={openDesktopPopup}
        />
      )}
    </div>
  );
}
