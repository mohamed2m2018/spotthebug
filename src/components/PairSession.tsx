"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePairVoice, VoiceTranscript, PairSessionContext } from "@/hooks/usePairVoice";
import BugAvatar from "@/components/BugAvatar";
import { isDirectoryPickerSupported, pickAndReadWorkspace, WorkspaceResult } from "@/utils/workspaceReader";
import { isGitRepo, getChangedFiles, GitChangedFile } from "@/utils/gitDiff";
import type { ReviewFinding } from "@/config/prompts";
import * as traceClient from "@/lib/traceClient";
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

  // Git diff & review state
  const [changedFiles, setChangedFiles] = useState<GitChangedFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [isDetectingGit, setIsDetectingGit] = useState(false);
  const [gitProgress, setGitProgress] = useState('');
  const [hasGit, setHasGit] = useState(false);
  const [reviewFindings, setReviewFindings] = useState<ReviewFinding[] | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewProgress, setReviewProgress] = useState('');
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
    isConnected, isRecording, isScreenSharing, isSpeaking,
    startSession, stopSession, toggleMicrophone,
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
    let progressInterval: ReturnType<typeof setInterval> | undefined;

    try {
      const filesToReview = changedFiles
        .filter(f => selectedFiles.includes(f.filePath) && f.content)
        .map(f => ({
          path: f.filePath,
          content: f.content!,
          originalContent: f.originalContent || undefined,
          language: f.filePath.split('.').pop() || 'text',
        }));

      // Cycle progress messages while the API call is pending
      const progressMessages = [
        '🔍 Sending code for review...',
        '🌐 Searching best practices & documentation...',
        '📋 Analyzing code patterns...',
        '🔎 Cross-referencing with industry standards...',
        '📝 Structuring review findings...',
      ];
      let msgIndex = 0;
      setReviewProgress(progressMessages[0]);
      progressInterval = setInterval(() => {
        msgIndex++;
        if (msgIndex < progressMessages.length) {
          setReviewProgress(progressMessages[msgIndex]);
        }
      }, 4000);

      const res = await fetch('/api/review-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filesToReview, goal: sessionGoal.trim() || undefined }),
      });

      if (!res.ok) throw new Error('Review API failed');
      const data = await res.json();
      setReviewFindings(data.findings || []);
      setReviewTool(data.tool || 'unknown');

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
      if (progressInterval) clearInterval(progressInterval);
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
    // Step 1: Get screen share FIRST — mandatory
    let screenStream: MediaStream;
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: false,
      });
    } catch {
      // User cancelled the screen share dialog
      setTreeError("🖥️ Screen sharing is required for pair programming. Please share your screen to start.");
      return;
    }

    // Step 2: Screen share granted — now connect
    setPhase("active");
    setMessages([{ role: "ai", text: "🎤 Connecting..." }]);

    try {
      await startSession({ ...context, screenStream });
      // Don't show "Connected" message — let the AI's first audio response
      // (after seeing the screen) naturally confirm the connection
    } catch (error) {
      console.error("Failed to start pair:", error);
      screenStream.getTracks().forEach(t => t.stop());
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

                {/* Run Review Button */}
                {!reviewFindings && (
                  <button
                    className={styles.pickFolderBtn}
                    onClick={handleRunReview}
                    disabled={isReviewing || selectedFiles.length === 0}
                    style={{ marginTop: '10px', width: '100%' }}
                  >
                    {isReviewing
                      ? (reviewProgress || '🔍 Preparing review...')
                      : `🔍 Analyze Changes Before Call (${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''})`}
                  </button>
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
