"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useHuntVoice, VoiceTranscript } from "@/hooks/useHuntVoice";
import { useAnimatedProgress } from "@/hooks/useAnimatedProgress";
import BugAvatar from "@/components/BugAvatar";
import CodeEditor from "@/components/CodeEditor";
import styles from "@/app/session/session.module.css";

interface BugData {
  id: string;
  framework: string;
  category: string;
  difficulty: string;
  title: string;
  buggyCode: string;
  language: string;
}

interface Message {
  role: "ai" | "user";
  text: string;
}

interface HuntSessionProps {
  skills: string[];
  difficulty: string;
  onEnd: () => void;
}

export default function HuntSession({ skills, difficulty, onEnd }: HuntSessionProps) {
  const [bug, setBug] = useState<BugData | null>(null);
  const [editedCode, setEditedCode] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const displayPercent = useAnimatedProgress(progressPercent);
  const [timer, setTimer] = useState(300);
  const [solvedCount, setSolvedCount] = useState(0);
  const [showSolvedBanner, setShowSolvedBanner] = useState(false);
  const [autoLoadNext, setAutoLoadNext] = useState(false);
  const [started, setStarted] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const codeUpdateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const seenBugIds = useRef<string[]>([]);
  const autoLoadRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(false); // StrictMode guard

  // ── Transcript handler ──
  const handleTranscript = useCallback((transcript: VoiceTranscript) => {
    const cleanText = transcript.text.replace("[BUG_SOLVED]", "").trim();
    if (!cleanText) return;
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === transcript.role) {
        return [...prev.slice(0, -1), { ...last, text: last.text + " " + cleanText }];
      }
      return [...prev, { role: transcript.role, text: cleanText }];
    });
  }, []);

  const handleBugSolved = useCallback(() => {
    setSolvedCount(prev => prev + 1);
    setShowSolvedBanner(true);
    if (autoLoadRef.current) clearTimeout(autoLoadRef.current);
    autoLoadRef.current = setTimeout(() => {
      setShowSolvedBanner(false);
      setAutoLoadNext(true);
    }, 3000);
  }, []);

  const {
    isConnected, isRecording, isSpeaking, isAiMuted,
    startSession, stopSession, toggleMicrophone, toggleAiAudio,
    sendText, sendCodeUpdate, postSessionReport
  } = useHuntVoice({
    onTranscript: handleTranscript,
    onBugSolved: handleBugSolved,
  });

  // Timer
  useEffect(() => {
    if (!started) return;
    const interval = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          handleEnd();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [started]);

  // Auto-scroll
  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-start session on mount (with StrictMode guard)
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    startHuntSession();

    return () => { stopSession(); };
  }, []);

  // Auto-load next bug
  useEffect(() => {
    if (!autoLoadNext) return;
    setAutoLoadNext(false);
    loadNextBug();
  }, [autoLoadNext]);

  const handleCodeEdit = (newCode: string) => {
    setEditedCode(newCode);
    if (codeUpdateTimerRef.current) clearTimeout(codeUpdateTimerRef.current);
    codeUpdateTimerRef.current = setTimeout(() => sendCodeUpdate(newCode), 2000);
  };

  const handleEnd = () => {
    stopSession();
    if (codeUpdateTimerRef.current) clearTimeout(codeUpdateTimerRef.current);
    setShowSummary(true);
  };

  const startHuntSession = async () => {
    setIsLoading(true);
    setProgressMessage("🔍 Searching for real bug patterns...");
    setProgressPercent(10);
    try {
      // Call generate-bug SSE directly for progress updates
      const genRes = await fetch("/api/generate-bug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: skills.map(s => s.toLowerCase().replace(".", "")),
          difficulty,
          excludeTopics: seenBugIds.current,
        }),
      });

      let bugData: BugData | null = null;
      const reader = genRes.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "progress") {
              setProgressMessage(event.message);
              setProgressPercent(event.percentage || 0);
            } else if (event.type === "result") {
              bugData = event.bug;
              setProgressPercent(100);
            } else if (event.type === "error") {
              throw new Error(event.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      if (!bugData) throw new Error("No bug generated");

      setBug(bugData);
      setEditedCode(bugData.buggyCode);
      seenBugIds.current.push(bugData.id);
      setMessages([{ role: "ai", text: "🎙️ Voice session started! Speak or type below." }]);

      const bugContext = `\`\`\`${bugData.language}\n${bugData.buggyCode}\n\`\`\`\nFramework: ${bugData.framework}\nCategory: ${bugData.category}`;
      await startSession(bugContext);
      setStarted(true);
    } catch (error) {
      console.error("Failed to start hunt:", error);
      setMessages([{ role: "ai", text: "Failed to connect. Try again." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadNextBug = async () => {
    setShowSolvedBanner(false);
    setIsLoading(true);
    setProgressMessage("🔍 Searching for next bug...");
    setProgressPercent(10);
    try {
      const genRes = await fetch("/api/generate-bug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: skills.map(s => s.toLowerCase().replace(".", "")),
          difficulty,
          excludeTopics: seenBugIds.current,
        }),
      });

      let bugData: BugData | null = null;
      const reader = genRes.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "progress") {
              setProgressMessage(event.message);
              setProgressPercent(event.percentage || 0);
            } else if (event.type === "result") {
              bugData = event.bug;
              setProgressPercent(100);
            } else if (event.type === "error") {
              throw new Error(event.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      if (!bugData) throw new Error("No bug generated");

      setBug(bugData);
      setEditedCode(bugData.buggyCode);
      seenBugIds.current.push(bugData.id);
      setMessages(prev => [...prev, { role: "ai", text: "🐛 New bug loaded!" }]);

      const bugContext = `\`\`\`${bugData.language}\n${bugData.buggyCode}\n\`\`\`\nFramework: ${bugData.framework}\nCategory: ${bugData.category}`;
      sendText(`[NEW_BUG] New buggy code:\n\n${bugContext}\n\nIntroduce it. Don't reveal the bug. Include [BUG_SOLVED] when they find it.`);
    } catch {
      setMessages(prev => [...prev, { role: "ai", text: "No more bugs available! Great job!" }]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = () => {
    if (!inputText.trim() || !isConnected) return;
    const userMsg = inputText.trim();
    setInputText("");
    setMessages(prev => [...prev, { role: "user", text: userMsg }]);
    sendText(userMsg);
  };

  if (isLoading && !started) {
    return (
      <div className={styles.setupScreen}>
        <div className={styles.setupCard}>
          <h1 className={styles.setupTitle}>🔍 Generating bug...</h1>
          <p className={styles.setupSubtitle}>{progressMessage}</p>
          <div className={styles.progressBarContainer}>
            <div className={styles.progressBarFill} style={{ width: `${displayPercent}%` }} />
          </div>
          <p className={styles.progressPercent}>{displayPercent}%</p>
        </div>
      </div>
    );
  }

  if (showSummary) {
    let summaryData = null;
    if (postSessionReport) {
      try {
        // the ADK returns results which contains an array, the last event is agent_response
        // We look for 'content' in the object, or assume the report might be raw json text
        const rawText = postSessionReport.results?.[postSessionReport.results.length - 1]?.content || JSON.stringify(postSessionReport);
        // Clean markdown backticks if any
        const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        summaryData = JSON.parse(cleaned);
      } catch (e) {
        console.error("Failed to parse ADK summary", e);
        // Fallback or rough parse
        summaryData = null;
      }
    }

    return (
      <div className={styles.setupScreen}>
        <div className={styles.setupCard} style={{ maxWidth: '600px', width: '100%' }}>
          <h1 className={styles.setupTitle}>📊 Post-Session AI Summary</h1>
          
          {!postSessionReport ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <div className={styles.loadingPulse} style={{ fontSize: '3rem', marginBottom: '1rem' }}>🤖</div>
              <p className={styles.setupSubtitle}>Google ADK is analyzing your session...</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '20px' }}>
              {summaryData?.bugsDetected?.length > 0 && (
                <div style={{ background: 'rgba(34, 197, 94, 0.1)', borderLeft: '4px solid #22c55e', padding: '16px', borderRadius: '4px' }}>
                  <h3 style={{ color: '#22c55e', margin: '0 0 10px 0', fontSize: '18px' }}>✅ Bugs You Found</h3>
                  <ul style={{ margin: 0, paddingLeft: '20px', color: '#fff', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {summaryData.bugsDetected.map((bug: string, i: number) => <li key={i}>{bug}</li>)}
                  </ul>
                </div>
              )}
              
              {summaryData?.improvedAreas?.length > 0 && (
                <div style={{ background: 'rgba(56, 189, 248, 0.1)', borderLeft: '4px solid #38bdf8', padding: '16px', borderRadius: '4px' }}>
                  <h3 style={{ color: '#38bdf8', margin: '0 0 10px 0', fontSize: '18px' }}>📈 Areas for Improvement</h3>
                  <ul style={{ margin: 0, paddingLeft: '20px', color: '#fff', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {summaryData.improvedAreas.map((area: string, i: number) => <li key={i}>{area}</li>)}
                  </ul>
                </div>
              )}

              {!summaryData?.bugsDetected && !summaryData?.improvedAreas && (
                <div style={{ padding: '20px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                  <p style={{ margin: 0, color: '#aaa', fontSize: '14px', whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(postSessionReport, null, 2)}
                  </p>
                </div>
              )}

              <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
                <button className={styles.endSessionBtn} onClick={onEnd} style={{ minWidth: '200px', fontSize: '16px', padding: '12px' }}>
                  Back to Menu
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.sessionPage}>
      <header className={styles.sessionHeader}>
        <nav className={styles.sessionNav}>
          <a href="/" className={styles.sessionLogo}>🐛 Spot<span className={styles.sessionLogoHighlight}>TheBug</span></a>
          <div className={styles.sessionControls}>
            {solvedCount > 0 && <span className={styles.solvedCounter}>✅ {solvedCount} solved</span>}
            <span className={styles.timer}>{Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, "0")}</span>
            <button className={styles.endSessionBtn} onClick={handleEnd}>End Session</button>
          </div>
        </nav>
      </header>

      {showSolvedBanner && (
        <div className={styles.solvedBanner}>
          <span>🎉 Bug Found! Great job!</span>
          <button className={styles.nextBugBtn} onClick={loadNextBug}>Next Bug →</button>
        </div>
      )}

      <main className={styles.sessionMain}>
        <div className={styles.codePanel}>
          <div className={styles.codePanelHeader}>
            <span className={styles.codePanelTitle}>📄 {bug?.title}</span>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <span className={`${styles.difficultyBadge} ${bug?.difficulty === "beginner" ? styles.difficultyBeginner : styles.difficultyIntermediate}`}>{bug?.difficulty}</span>
              <span className={styles.codePanelBadge}>{bug?.framework}</span>
            </div>
          </div>
          <div className={styles.codeContent}>
            <CodeEditor
              value={editedCode}
              onChange={handleCodeEdit}
              language={bug?.language}
            />
          </div>
        </div>

        <div className={styles.voicePanel}>
          <div className={styles.voicePanelHeader}>
            <span className={styles.voicePanelTitle}>🎙️ AI Coach</span>
            <span className={styles.connectionStatus}>
              <span className={`${styles.connectionDot} ${isConnected ? styles.connectionDotConnected : ""}`} />
              {isConnected ? "Connected" : "Disconnected"}
            </span>
          </div>

          <div className={styles.avatarArea}>
            <BugAvatar isSpeaking={isSpeaking} isListening={isRecording && !isSpeaking} isConnected={isConnected} />
          </div>

          <div className={styles.conversationArea} ref={conversationRef}>
            {messages.map((msg, i) => (
              <div key={i} className={`${styles.message} ${msg.role === "ai" ? styles.messageAi : styles.messageUser}`}>
                {msg.text}
              </div>
            ))}
          </div>

          <div className={styles.inputArea}>
            <div className={styles.micControls}>
              <button onClick={toggleMicrophone} className={`${styles.micBtn} ${isRecording ? styles.micBtnActive : styles.micBtnInactive}`}>
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
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendMessage()}
              />
              <button className={styles.sendBtn} onClick={sendMessage} disabled={!isConnected}>Send</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
