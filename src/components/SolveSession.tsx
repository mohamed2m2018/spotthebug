"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useProblemSolvingVoice } from "@/hooks/useProblemSolvingVoice";
import type { VoiceTranscript } from "@/hooks/useProblemSolvingVoice";
import { useAnimatedProgress } from "@/hooks/useAnimatedProgress";
import BugAvatar from "@/components/BugAvatar";
import CodeEditor from "@/components/CodeEditor";
import { recordSession } from "@/utils/recordSession";
import styles from "@/app/session/session.module.css";

interface ProblemData {
  id: string;
  title: string;
  description: string;
  topic: string;
  difficulty: string;
  language: string;
  framework: string;
  examples: { input: string; output: string; explanation: string }[];
  starterCode: string;
  functionName: string;
  referenceSolution: string;
  hint1: string;
  hint2: string;
  hint3: string;
  testCases: { input: string; expectedOutput: string }[];
  grounded?: boolean;
}

interface Message {
  role: "ai" | "user";
  text: string;
}

interface SolveSessionProps {
  skills: string[];
  difficulty: string;
  topic?: string;
  onEnd: () => void;
}

export default function SolveSession({ skills, difficulty, topic, onEnd }: SolveSessionProps) {
  const [problem, setProblem] = useState<ProblemData | null>(null);
  const [code, setCode] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [progressMessage, setProgressMessage] = useState("Finding a real-world problem with Google Search...");
  const [progressPercent, setProgressPercent] = useState(0);
  const displayPercent = useAnimatedProgress(progressPercent);
  const [timer, setTimer] = useState(1200); // 20 minutes
  const [solvedCount, setSolvedCount] = useState(0);
  const [showSolvedBanner, setShowSolvedBanner] = useState(false);
  const [started, setStarted] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [testResults, setTestResults] = useState<{ pass: boolean; input: string; expected: string; got: string }[] | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionOutput, setExecutionOutput] = useState<string | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const codeUpdateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(false);

  // ── Transcript handler ──
  const handleTranscript = useCallback((transcript: VoiceTranscript) => {
    const cleanText = transcript.text
      .replace("[PROBLEM_SOLVED]", "")
      .trim();
    if (!cleanText) return;
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === transcript.role) {
        return [...prev.slice(0, -1), { ...last, text: last.text + " " + cleanText }];
      }
      return [...prev, { role: transcript.role, text: cleanText }];
    });
  }, []);

  const handleSolved = useCallback(() => {
    setSolvedCount(prev => prev + 1);
    setShowSolvedBanner(true);
  }, []);

  const {
    isConnected, isRecording, isSpeaking, isAiMuted,
    startSession, stopSession, toggleMicrophone, toggleAiAudio,
    sendText, sendCodeUpdate,
  } = useProblemSolvingVoice({
    onTranscript: handleTranscript,
    onProblemSolved: handleSolved,
  });

  // Timer
  useEffect(() => {
    if (!started) return;
    const interval = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) { handleEnd(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [started]);

  // Auto-scroll messages
  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-start on mount
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    startSolveSession();
    return () => { stopSession(); };
  }, []);

  const handleCodeEdit = (newCode: string) => {
    setCode(newCode);
    if (codeUpdateTimerRef.current) clearTimeout(codeUpdateTimerRef.current);
    codeUpdateTimerRef.current = setTimeout(() => sendCodeUpdate(newCode), 2000);
  };

  const handleEnd = () => {
    stopSession();
    if (codeUpdateTimerRef.current) clearTimeout(codeUpdateTimerRef.current);
    // Record session to database
    const elapsed = 1200 - timer;
    recordSession({ mode: 'solve', duration: elapsed });
    setShowSummary(true);
  };

  const startSolveSession = async () => {
    setIsLoading(true);
    setProgressMessage("🔍 Finding a real-world problem...");
    try {
      const res = await fetch("/api/generate-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: skills.map(s => s.toLowerCase().replace(".", "")),
          difficulty,
          topic,
        }),
      });

      // Consume SSE stream for progress
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let problemData: ProblemData | null = null;

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
              problemData = event.problem;
              setProgressPercent(100);
            } else if (event.type === "error") {
              throw new Error(event.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue; // partial JSON
            throw e;
          }
        }
      }

      if (!problemData) throw new Error("No problem generated");

      setProblem(problemData);
      setCode(problemData.starterCode || "");
      setMessages([{ role: "ai", text: "🎙️ Voice session started! Let's solve this together." }]);

      const problemContext = `**${problemData.title}**\n\n${problemData.description}\n\nExamples:\n${problemData.examples.map((e) => `Input: ${e.input}\nOutput: ${e.output}\n${e.explanation ? `Explanation: ${e.explanation}` : ""}`).join("\n\n")}\n\nLanguage: ${problemData.language}`;

      await startSession(problemContext);
      setStarted(true);
    } catch (error) {
      console.error("Failed to start solve session:", error);
      setMessages([{ role: "ai", text: "Failed to generate problem. Try again." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const showHint = () => {
    if (!problem) return;
    const nextLevel = Math.min(hintLevel + 1, 3);
    setHintLevel(nextLevel);
    const hints = [problem.hint1, problem.hint2, problem.hint3];
    const hint = hints[nextLevel - 1];
    setMessages(prev => [...prev, { role: "ai", text: `💡 Hint ${nextLevel}: ${hint}` }]);
    sendText(`[HINT_GIVEN] The developer asked for a hint. Hint ${nextLevel}: ${hint}`);
  };

  const runCode = async () => {
    if (!problem || isExecuting) return;
    setIsExecuting(true);
    setExecutionOutput("⏳ Running code...");
    try {
      const res = await fetch("/api/execute-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language: problem.language, mode: "run", functionName: problem.functionName }),
      });
      const data = await res.json();
      if (data.error && !data.stdout && !data.stderr) {
        setExecutionOutput(`❌ Error: ${typeof data.error === "string" ? data.error : data.error.message}`);
      } else {
        let output = "";
        if (data.stdout) output += data.stdout;
        if (data.stderr) output += (output ? "\n" : "") + `⚠️ stderr:\n${data.stderr}`;
        if (data.error) output += (output ? "\n" : "") + `❌ ${data.error.name}: ${data.error.message}`;
        setExecutionOutput(output || "(no output)");
      }
    } catch (err: any) {
      setExecutionOutput(`❌ Execution failed: ${err.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const runTests = async () => {
    if (!problem || isExecuting) return;
    setIsExecuting(true);
    setExecutionOutput("⏳ Running tests...");
    setMessages(prev => [...prev, { role: "user", text: "▶️ Running tests..." }]);
    try {
      const res = await fetch("/api/execute-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          language: problem.language,
          mode: "test",
          testCases: problem.testCases,
          functionName: problem.functionName,
        }),
      });
      const data = await res.json();
      if (data.error && !data.stdout) {
        const errMsg = typeof data.error === "string" ? data.error : data.error.message;
        setExecutionOutput(`❌ Error: ${errMsg}`);
        setMessages(prev => [...prev, { role: "ai", text: `❌ Execution error: ${errMsg}` }]);
      } else {
        setExecutionOutput(data.stdout || "(no output)");
        if (data.allPassed) {
          setMessages(prev => [...prev, { role: "ai", text: "✅ All tests passed! Great work!" }]);
          sendText("[PROBLEM_SOLVED] The developer's code passed all test cases. Congratulate them!");
        } else {
          const failedTests = data.testResults?.filter((r: any) => !r.passed) || [];
          const summary = failedTests.map((r: any) => r.message).join("\n");
          setMessages(prev => [...prev, { role: "ai", text: `Some tests failed:\n${summary}` }]);
          sendText(`[TEST_RESULTS] The developer ran tests. Results:\n${data.stdout}\n\nHelp them understand what went wrong.`);
        }
      }
    } catch (err: any) {
      setExecutionOutput(`❌ Execution failed: ${err.message}`);
      setMessages(prev => [...prev, { role: "ai", text: `❌ Could not execute code: ${err.message}` }]);
    } finally {
      setIsExecuting(false);
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
          <h1 className={styles.setupTitle}>🧩 Generating challenge...</h1>
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
    return (
      <div className={styles.setupScreen}>
        <div className={styles.setupCard} style={{ maxWidth: "600px", width: "100%" }}>
          <h1 className={styles.setupTitle}>📊 Session Complete</h1>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "20px" }}>
            <div style={{ background: "rgba(34, 197, 94, 0.1)", borderLeft: "4px solid #22c55e", padding: "16px", borderRadius: "4px" }}>
              <h3 style={{ color: "#22c55e", margin: "0 0 8px 0" }}>✅ Problems Solved: {solvedCount}</h3>
            </div>
            {problem && (
              <div style={{ background: "rgba(56, 189, 248, 0.1)", borderLeft: "4px solid #38bdf8", padding: "16px", borderRadius: "4px" }}>
                <h3 style={{ color: "#38bdf8", margin: "0 0 8px 0" }}>📝 Reference Solution</h3>
                <pre style={{ margin: 0, fontSize: "0.85rem", color: "#e6edf3", whiteSpace: "pre-wrap" }}>
                  {problem.referenceSolution}
                </pre>
              </div>
            )}
            <button className={styles.endSessionBtn} onClick={onEnd} style={{ minWidth: "200px", fontSize: "16px", padding: "12px", alignSelf: "center" }}>
              Back to Menu
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.sessionPage}>
      <header className={styles.sessionHeader}>
        <nav className={styles.sessionNav}>
          <a href="/" className={styles.sessionLogo}>🧩 Spot<span className={styles.sessionLogoHighlight}>TheBug</span></a>
          <div className={styles.sessionControls}>
            {solvedCount > 0 && <span className={styles.solvedCounter}>✅ {solvedCount} solved</span>}
            <span className={styles.timer}>{Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, "0")}</span>
            <button className={styles.endSessionBtn} onClick={handleEnd}>End Session</button>
          </div>
        </nav>
      </header>

      {showSolvedBanner && (
        <div className={styles.solvedBanner}>
          <span>🎉 Problem Solved! Great work!</span>
        </div>
      )}

      <main className={styles.sessionMain}>
        {/* Left panel: Problem + Code Editor */}
        <div className={styles.codePanel}>
          <div className={styles.codePanelHeader}>
            <span className={styles.codePanelTitle}>🧩 {problem?.title}</span>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <span className={`${styles.difficultyBadge} ${problem?.difficulty === "beginner" ? styles.difficultyBeginner : styles.difficultyIntermediate}`}>{problem?.difficulty}</span>
              <span className={styles.codePanelBadge}>{problem?.topic}</span>
              {problem?.grounded && <span className={styles.codePanelBadge} title="Generated with Google Search">🌐</span>}
            </div>
          </div>

          {/* Problem description */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", maxHeight: "200px", overflow: "auto", fontSize: "0.85rem", color: "#c9d1d9", lineHeight: "1.6" }}>
            <p style={{ margin: "0 0 8px 0" }}>{problem?.description}</p>
            {problem?.examples.map((ex, i) => (
              <div key={i} style={{ background: "rgba(255,255,255,0.03)", padding: "8px 12px", borderRadius: "6px", marginBottom: "6px", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                <div><strong style={{ color: "#58a6ff" }}>Input:</strong> {ex.input}</div>
                <div><strong style={{ color: "#3fb950" }}>Output:</strong> {ex.output}</div>
                {ex.explanation && <div style={{ color: "#8b949e" }}>{ex.explanation}</div>}
              </div>
            ))}
          </div>

          {/* Code editor */}
          <div className={styles.codeContent}>
            <CodeEditor
              value={code}
              onChange={handleCodeEdit}
              language={problem?.language}
            />
          </div>

          {/* Execution output */}
          {executionOutput !== null && (
            <div style={{
              padding: "8px 12px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(0,0,0,0.5)",
              maxHeight: "150px",
              overflow: "auto",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", fontWeight: 600 }}>OUTPUT</span>
                <button
                  onClick={() => setExecutionOutput(null)}
                  style={{ background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", fontSize: "0.75rem" }}
                >
                  ✕ Close
                </button>
              </div>
              <pre style={{ margin: 0, fontSize: "0.8rem", color: "#e2e8f0", whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
                {executionOutput}
              </pre>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "8px", padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)" }}>
            <button
              onClick={runCode}
              disabled={isExecuting}
              style={{
                padding: "8px 16px", borderRadius: "8px", border: "none",
                background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "white",
                fontWeight: 600, fontSize: "0.85rem", cursor: isExecuting ? "wait" : "pointer",
                opacity: isExecuting ? 0.5 : 1,
              }}
            >
              {isExecuting ? "⏳ Running..." : "▶ Run"}
            </button>
            <button
              onClick={runTests}
              disabled={isExecuting}
              style={{
                flex: 1, padding: "8px", borderRadius: "8px", border: "none",
                background: "linear-gradient(135deg, #22c55e, #16a34a)", color: "white",
                fontWeight: 600, fontSize: "0.85rem", cursor: isExecuting ? "wait" : "pointer",
                opacity: isExecuting ? 0.5 : 1,
              }}
            >
              {isExecuting ? "⏳ Testing..." : "🧪 Run Tests"}
            </button>
            <button
              onClick={showHint}
              disabled={hintLevel >= 3}
              style={{
                padding: "8px 16px", borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)",
                color: hintLevel >= 3 ? "#555" : "#facc15", fontWeight: 600, fontSize: "0.85rem",
                cursor: hintLevel >= 3 ? "default" : "pointer",
              }}
            >
              💡 Hint ({3 - hintLevel} left)
            </button>
          </div>
        </div>

        {/* Right panel: Voice Coach */}
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
