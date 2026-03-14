"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePairVoice, VoiceTranscript } from "@/hooks/usePairVoice";
import BugAvatar from "@/components/BugAvatar";
import styles from "@/app/session/session.module.css";

interface Message {
  role: "ai" | "user";
  text: string;
}

interface PairSessionProps {
  onEnd: () => void;
}

export default function PairSession({ onEnd }: PairSessionProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [started, setStarted] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false); // StrictMode guard

  const handleTranscript = useCallback((transcript: VoiceTranscript) => {
    const cleanText = transcript.text.trim();
    if (!cleanText) return;
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === transcript.role) {
        return [...prev.slice(0, -1), { ...last, text: last.text + " " + cleanText }];
      }
      return [...prev, { role: transcript.role, text: cleanText }];
    });
  }, []);

  const {
    isConnected, isRecording, isScreenSharing, isSpeaking,
    startSession, stopSession, toggleMicrophone,
    startScreenShare, stopScreenShare, sendText,
  } = usePairVoice({ onTranscript: handleTranscript });

  // Auto-scroll
  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-start session on mount (with StrictMode guard)
  useEffect(() => {
    if (startedRef.current) return; // Skip StrictMode double-run
    startedRef.current = true;
    startPairSession();

    return () => { stopSession(); }; // Cleanup on unmount
  }, []);

  const startPairSession = async () => {
    try {
      setMessages([{ role: "ai", text: "🎙️ Pair programming session started! Click 'Share Screen' to let me see your code." }]);
      await startSession();
      setStarted(true);
    } catch (error) {
      console.error("Failed to start pair:", error);
      setMessages([{ role: "ai", text: "Failed to connect. Try again." }]);
    }
  };

  const handleEnd = () => {
    stopSession();
    onEnd();
  };

  const sendMessage = () => {
    if (!inputText.trim() || !isConnected) return;
    const userMsg = inputText.trim();
    setInputText("");
    setMessages(prev => [...prev, { role: "user", text: userMsg }]);
    sendText(userMsg);
  };

  if (!started) {
    return (
      <div className={styles.setupScreen}>
        <div className={styles.setupCard}>
          <h1 className={styles.setupTitle}>🔌 Connecting...</h1>
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
            <button className={styles.endSessionBtn} onClick={handleEnd}>End Session</button>
          </div>
        </nav>
      </header>

      <main className={styles.pairMain}>
        {/* Full-width voice panel for pair mode */}
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

          {/* Screen share status */}
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
              <button onClick={toggleMicrophone} className={`${styles.micBtn} ${isRecording ? styles.micBtnActive : styles.micBtnInactive}`}>
                {isRecording ? "⏹ Mute" : "🎤 Unmute"}
              </button>
              <button
                onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                className={`${styles.micBtn} ${isScreenSharing ? styles.screenBtnActive : styles.screenBtnInactive}`}
              >
                {isScreenSharing ? "🖥️ Stop Sharing" : "🖥️ Share Screen"}
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
