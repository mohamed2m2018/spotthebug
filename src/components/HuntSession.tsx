"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useHuntVoice, VoiceTranscript } from "@/hooks/useHuntVoice";
import BugAvatar from "@/components/BugAvatar";
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
  const [timer, setTimer] = useState(300);
  const [solvedCount, setSolvedCount] = useState(0);
  const [showSolvedBanner, setShowSolvedBanner] = useState(false);
  const [autoLoadNext, setAutoLoadNext] = useState(false);
  const [started, setStarted] = useState(false);
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
    isConnected, isRecording, isSpeaking,
    startSession, stopSession, toggleMicrophone,
    sendText, sendCodeUpdate,
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
    onEnd();
  };

  const startHuntSession = async () => {
    setIsLoading(true);
    try {
      const bugRes = await fetch("/api/session/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          skills: skills.map(s => s.toLowerCase().replace(".", "")),
          difficulty,
          excludeIds: seenBugIds.current,
        }),
      });
      const bugData = await bugRes.json();
      if (!bugRes.ok) throw new Error(bugData.error);

      setBug(bugData.bug);
      setEditedCode(bugData.bug.buggyCode);
      seenBugIds.current.push(bugData.bug.id);
      setMessages([{ role: "ai", text: "🎙️ Voice session started! Speak or type below." }]);

      const bugContext = `\`\`\`${bugData.bug.language}\n${bugData.bug.buggyCode}\n\`\`\`\nFramework: ${bugData.bug.framework}\nCategory: ${bugData.bug.category}`;
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
    try {
      const bugRes = await fetch("/api/session/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          skills: skills.map(s => s.toLowerCase().replace(".", "")),
          difficulty,
          excludeIds: seenBugIds.current,
        }),
      });
      const bugData = await bugRes.json();
      if (!bugRes.ok) throw new Error(bugData.error);

      setBug(bugData.bug);
      setEditedCode(bugData.bug.buggyCode);
      seenBugIds.current.push(bugData.bug.id);
      setMessages(prev => [...prev, { role: "ai", text: "🐛 New bug loaded!" }]);

      const bugContext = `\`\`\`${bugData.bug.language}\n${bugData.bug.buggyCode}\n\`\`\`\nFramework: ${bugData.bug.framework}\nCategory: ${bugData.bug.category}`;
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
          <h1 className={styles.setupTitle}>🔍 Finding a bug...</h1>
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
            <textarea
              className={styles.codeEditor}
              value={editedCode}
              onChange={(e) => handleCodeEdit(e.target.value)}
              spellCheck={false}
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
                {isRecording ? "⏹ Mute" : "🎤 Unmute"}
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
