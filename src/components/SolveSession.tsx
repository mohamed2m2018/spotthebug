"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useProblemSolvingVoice } from "@/hooks/useProblemSolvingVoice";
import type { VoiceTranscript, SolveMode } from "@/hooks/useProblemSolvingVoice";
import { useAnimatedProgress } from "@/hooks/useAnimatedProgress";
import BugAvatar from "@/components/BugAvatar";
import CodeEditor from "@/components/CodeEditor";
import SyllabusSidebar from "@/components/SyllabusSidebar";
import { recordSession } from "@/utils/recordSession";
import { markCovered, useCovered } from "@/lib/coverage";
import { SQL_SCHEMA_DESCRIPTION } from "@/config/sqlSandbox";
import { DSA_PROBLEM_DETAILS } from "@/config/syllabi";
import AlgoVisualizer from "@/components/AlgoVisualizer";
import { saveSession, type SavedSession } from "@/lib/sessionStore";
import { appendJournal } from "@/lib/learningJournal";
import type { PredefinedProblem } from "@/config/problems";
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
  syllabus?: string[];
  syllabusIndex?: number;
  syllabusSource?: string;
  onAdvanceSyllabus?: () => void;
  onEnd: () => void;
  predefinedProblem?: PredefinedProblem;
  /** Teaching mode. "solve" = code challenge (runnable). "sql"/"sysdesign" = teaching, no code execution. */
  mode?: SolveMode;
  /** Coverage track id ("dsa" | "sql" | "sysdesign"). When set, completed syllabus concepts persist. */
  trackId?: string;
  /** Restored snapshot when resuming a saved session. */
  resumeState?: SavedSession;
}

export default function SolveSession({
  skills, difficulty, topic,
  syllabus, syllabusIndex = 0, syllabusSource,
  onAdvanceSyllabus, onEnd, predefinedProblem,
  mode = "solve", trackId, resumeState,
}: SolveSessionProps) {
  // Non-solve modes are teaching sessions. SQL runs against a SQLite sandbox.
  const isCodingMode = mode === "solve";
  const isSqlMode = mode === "sql";
  const editorLanguage = mode === "sql" ? "sql" : (mode === "sysdesign" || mode === "explain") ? "plaintext" : undefined;
  // Persisted coverage for this track (live-updating, survives reloads/days).
  const completedConcepts = useCovered(trackId ?? "");
  const [problem, setProblem] = useState<ProblemData | null>(null);
  const [code, setCode] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [progressMessage, setProgressMessage] = useState("Finding a real-world problem with Google Search...");
  const [progressPercent, setProgressPercent] = useState(0);
  const displayPercent = useAnimatedProgress(progressPercent);
  const [timer, setTimer] = useState(0);
  const [solvedCount, setSolvedCount] = useState(0);
  const [showSolvedBanner, setShowSolvedBanner] = useState(false);
  const [started, setStarted] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [testResults, setTestResults] = useState<{ pass: boolean; input: string; expected: string; got: string }[] | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionOutput, setExecutionOutput] = useState<string | null>(null);
  const [visTrace, setVisTrace] = useState<import("@/lib/jsTracer").TraceResult | null>(null);
  const [isVisualizing, setIsVisualizing] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const codeUpdateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastCodeUpdateAtRef = useRef(0);
  const messagesRef = useRef<Message[]>([]);
  const problemRef = useRef<ProblemData | null>(null);
  const explainMaterialRef = useRef("");
  const codeRef = useRef("");
  const lastSentCodeRef = useRef(""); // last code snapshot the coach received
  const sessionIdRef = useRef<string>(resumeState?.id ?? "");
  const ensureSessionId = () => {
    if (!sessionIdRef.current) {
      sessionIdRef.current = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `s_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    }
    return sessionIdRef.current;
  };

  // Save this topic's transcript to the learning journal (for the study guide).
  const journalCurrent = useCallback(() => {
    if (!trackId || !problemRef.current || messagesRef.current.length <= 1) return;
    const transcript = messagesRef.current
      .map(m => `${m.role === "ai" ? "Coach" : "Developer"}: ${m.text}`)
      .join("\n");
    appendJournal(trackId, problemRef.current.title, transcript);
  }, [trackId]);
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

  const isSyllabusComplete = syllabus && syllabusIndex >= syllabus.length - 1;

  const handleSolved = useCallback(() => {
    // Solving does NOT disrupt the session — it just keeps going. We only mark
    // the concept covered + show a brief banner. (Previously this restarted the
    // session for the next topic, which closed the socket → reconnect loop →
    // offline.) The learner picks the next topic when ready.
    setSolvedCount(prev => prev + 1);
    setShowSolvedBanner(true);
    journalCurrent();
    if (trackId && syllabus && syllabus[syllabusIndex]) {
      markCovered(trackId, syllabus[syllabusIndex]);
    }
    setTimeout(() => setShowSolvedBanner(false), 4000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syllabus, syllabusIndex, trackId]);

  const {
    isConnected, isRecording, isSpeaking, isAiMuted,
    startSession, stopSession, toggleMicrophone, toggleAiAudio,
    sendText, sendCodeUpdate,
  } = useProblemSolvingVoice({
    mode,
    getResumeContext: () => ({ code: codeRef.current, messages: messagesRef.current }),
    getExplainMaterial: () => explainMaterialRef.current,
    onTranscript: handleTranscript,
    onProblemSolved: handleSolved,
  });

  // Timer — counts up (open-ended)
  useEffect(() => {
    if (!started) return;
    const interval = setInterval(() => {
      setTimer(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [started]);

  // Auto-scroll messages
  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [messages]);

  // Keep refs in sync for journaling at end/advance (avoid stale closures).
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { problemRef.current = problem; }, [problem]);
  useEffect(() => { codeRef.current = code; }, [code]);

  // Autosave curated-session snapshot so it can be resumed later.
  useEffect(() => {
    if (!trackId || !problem || !started) return;
    saveSession({
      id: ensureSessionId(),
      mode, trackId, syllabusIndex,
      topicLabel: problem.title,
      code, messages,
      savedAt: Date.now(),
    });
  }, [trackId, problem, started, mode, syllabusIndex, code, messages]);

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
    // Stay silent while they're typing. Only nudge the coach after 10s of no
    // edits, and at most once every 45s so it doesn't interrupt frequently.
    codeUpdateTimerRef.current = setTimeout(() => {
      const now = Date.now();
      if (now - lastCodeUpdateAtRef.current < 45000) return;
      lastCodeUpdateAtRef.current = now;
      lastSentCodeRef.current = newCode;
      sendCodeUpdate(newCode);
    }, 10000);
  };

  const handleEnd = () => {
    journalCurrent(); // save transcript for the study guide
    stopSession();
    if (codeUpdateTimerRef.current) clearTimeout(codeUpdateTimerRef.current);
    // Record session to database
    const elapsed = timer;
    recordSession({ mode: 'solve', duration: elapsed });
    setShowSummary(true);
  };

  const startSolveSession = async () => {
    // If a predefined problem was selected, use it directly without API call
    if (predefinedProblem) {
      const problemData: ProblemData = {
        id: predefinedProblem.id,
        title: predefinedProblem.title,
        description: predefinedProblem.description,
        topic: predefinedProblem.category,
        difficulty: predefinedProblem.difficulty,
        language: predefinedProblem.language,
        framework: "",
        examples: predefinedProblem.examples,
        starterCode: predefinedProblem.starterCode,
        functionName: predefinedProblem.functionName,
        referenceSolution: predefinedProblem.referenceSolution,
        hint1: predefinedProblem.hint1,
        hint2: predefinedProblem.hint2,
        hint3: predefinedProblem.hint3,
        testCases: predefinedProblem.testCases,
        grounded: false,
      };

      setProblem(problemData);
      setCode(problemData.starterCode || "");
      setMessages([{ role: "ai", text: "📋 LeetCode problem loaded! Let's solve this together." }]);
      setProgressPercent(100);

      const problemContext = `**${problemData.title}** (LeetCode #${predefinedProblem.leetcodeNumber})\n\n${problemData.description}\n\nExamples:\n${problemData.examples.map((e) => "Input: " + e.input + "\nOutput: " + e.output + (e.explanation ? "\nExplanation: " + e.explanation : "")).join("\n\n")}\n\nLanguage: ${problemData.language}`;

      try {
        await startSession(problemContext);
        setStarted(true);
      } catch (error) {
        console.error("Failed to start voice session:", error);
        setMessages([{ role: "ai", text: "Voice session failed to start. You can still solve the problem — use the hint button for guidance." }]);
        setStarted(true);
      }
      setIsLoading(false);
      return;
    }

    // EXPLAIN mode: the learner typed a free topic — the coach just explains it.
    // No editor execution; the scratchpad is for the learner's own notes.
    if (mode === "explain") {
      // The material can be LARGE (a pasted article/notes). It's baked into the
      // token's locked system instruction (via getExplainMaterial) so the spoken
      // first turn stays short and reliably produces audio. The panel/header show
      // a short label only.
      const material = (topic || "").trim();
      explainMaterialRef.current = material;
      const label = material
        ? (material.split("\n")[0].slice(0, 80) + (material.length > 80 ? "…" : ""))
        : "هذا الموضوع";
      const resuming = !!(resumeState && resumeState.messages?.length);
      const problemData: ProblemData = {
        id: `explain-${ensureSessionId()}`,
        title: label,
        description: material.length > 120
          ? `📖 المدرّس بيشرحلك النص ده خطوة بخطوة:\n\n${material}`
          : "📖 المدرّس بيشرحلك الموضوع ده خطوة بخطوة. تقدر تكتب ملاحظاتك في المساحة دي.",
        topic: label, difficulty, language: "plaintext", framework: "",
        examples: [], starterCode: "", functionName: "", referenceSolution: "",
        hint1: "", hint2: "", hint3: "", testCases: [], grounded: false,
      };
      setProblem(problemData);
      setCode(resuming ? (resumeState!.code || "") : "");
      setMessages(resuming ? resumeState!.messages : [{ role: "ai", text: "Session started! Let's learn this together." }]);
      const lastAiSaid = resuming
        ? [...resumeState!.messages].reverse()
            .map((m) => (m.role === "ai" ? m.text.replace(/\[[A-Z_]+\]/g, "").trim() : ""))
            .find((x) => x && !x.startsWith("Session started"))
        : "";
      const recapNote = lastAiSaid ? ` آخر نقطة وقفنا عندها: "${lastAiSaid.slice(0, 160)}".` : "";
      // Keep the FIRST turn short (material is in the system instruction).
      const problemContext = resuming
        ? `CONTINUING SESSION — جلسة مكمّلة.${recapNote} كمّل من النقطة اللي بعدها، ومتبدأش من الأول.`
        : "__EXPLAIN_MATERIAL__";
      try {
        await startSession(problemContext);
        setStarted(true);
      } catch (error) {
        console.error("Failed to start session:", error);
        setMessages([{ role: "ai", text: "Voice session failed to start. Try again." }]);
        setStarted(true);
      }
      setIsLoading(false);
      return;
    }

    // Curated crash-course modes (DSA / SQL / Backend): the fixed syllabus topic
    // IS the lesson — the coach teaches it directly. No on-the-fly generation.
    if (trackId && syllabus && syllabus.length > 0) {
      const conceptTopic = syllabus[syllabusIndex] ?? topic ?? "this topic";
      // DSA track: the syllabus item is a concrete LeetCode problem — show its
      // statement in the panel and a function stub in the editor.
      const dsaDetail = trackId === "dsa" ? DSA_PROBLEM_DETAILS[syllabusIndex] : undefined;
      const starter =
        mode === "sysdesign"
          ? "// Design scratchpad — not runnable code.\n// 1) Classes / data model:\n\n\n// 2) Algorithm & scaling (in words):\n\n"
          : mode === "sql"
          ? "-- Scratchpad — write your queries here\n"
          : dsaDetail
          ? dsaDetail.starter
          : "// Scratchpad — try your solution here\n";
      const problemData: ProblemData = {
        id: `${trackId}-${syllabusIndex}`,
        title: dsaDetail ? dsaDetail.name : conceptTopic,
        description:
          mode === "sysdesign"
            ? "Design topic — sketch your classes / data model, then explain the algorithm and how it scales. The coach teaches this concept."
            : mode === "sql"
            ? `Write queries in the editor and hit Run — they execute against this practice database.\n\n${SQL_SCHEMA_DESCRIPTION}`
            : dsaDetail
            ? dsaDetail.statement
            : "Problem-solving pattern — the coach teaches this pattern and walks you through a problem.",
        topic: conceptTopic,
        difficulty,
        language: editorLanguage ?? "javascript",
        framework: "",
        examples: [],
        starterCode: starter,
        functionName: "",
        referenceSolution: "",
        hint1: "", hint2: "", hint3: "",
        testCases: [],
        grounded: false,
      };
      setProblem(problemData);
      // Mark the syllabus item covered as soon as the learner ENTERS it (not only
      // on [PROBLEM_SOLVED]) — entering a topic checks it off the tracker.
      if (trackId) markCovered(trackId, conceptTopic);
      const resuming = !!(resumeState && resumeState.messages?.length);
      setCode(resuming ? (resumeState!.code || starter) : starter);
      setMessages(resuming ? resumeState!.messages : [{ role: "ai", text: "Session started! Let's learn this together." }]);
      // CORE FIX: keep the first turn SHORT. A long intro turn reliably makes the
      // native-audio model reply text-only (no audio) — proven in prod: the long
      // intro = silent, the short reconnect turn = audio. So the intro now carries
      // ONLY the topic (short); the builder wraps it in a short Arabic "start"
      // line, and ALL teaching rules already live in the locked system prompt.
      // RESUME passes a CONTINUING marker + one-line recap so it continues instead
      // of re-greeting/re-teaching.
      const shortTopic = dsaDetail ? dsaDetail.name : conceptTopic;
      const lastAiSaid = resuming
        ? [...resumeState!.messages].reverse()
            .map((m) => (m.role === "ai" ? m.text.replace(/\[[A-Z_]+\]/g, "").trim() : ""))
            .find((t) => t && !t.startsWith("Session started"))
        : "";
      const recapNote = lastAiSaid ? ` آخر نقطة وقفنا عندها: "${lastAiSaid.slice(0, 160)}".` : "";
      const problemContext = resuming
        ? `CONTINUING SESSION — جلسة مكمّلة. الموضوع: **${shortTopic}**.${recapNote} كمّل من النقطة اللي بعدها، ومتبدأش من الأول.`
        : shortTopic;
      try {
        await startSession(problemContext);
        setStarted(true);
        // Leave lastSentCodeRef empty so the developer's FIRST question after
        // resume carries the current editor code (combined into one turn) — the
        // coach then sees what they wrote without a separate, clipping turn.
      } catch (error) {
        console.error("Failed to start session:", error);
        setMessages([{ role: "ai", text: "Voice session failed to start. Try again." }]);
        setStarted(true);
      }
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setProgressMessage("🔍 Finding a real-world problem...");
    try {
      const currentTopic = syllabus ? syllabus[syllabusIndex] : topic;
      const res = await fetch("/api/generate-problem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: skills.map(s => s.toLowerCase().replace(".", "")),
          difficulty,
          topic: currentTopic,
          mode,
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
      setCode(
        mode === "sysdesign"
          ? "// Design scratchpad — not runnable code.\n// 1) Classes / data model:\n\n\n// 2) Algorithm & scaling (in words):\n\n"
          : (problemData.starterCode || "")
      );
      setMessages([{ role: "ai", text: "🎙️ Session started! Let's learn this together." }]);

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
    // Curated/teaching topics have no canned hints — ask the coach for one live.
    if (!problem.hint1) {
      setMessages(prev => [...prev, { role: "user", text: "💡 I need a hint" }]);
      sendText("[HINT_REQUEST] The developer asked for a hint. Give one small Socratic hint that nudges them to the next step without revealing the full answer.");
      return;
    }
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

  // Step-through visualizer: instrument + run the JS in the editor and record a
  // trace of memory vars + loops at each line. Babel is loaded lazily (only here).
  const visualize = async () => {
    if (isVisualizing) return;
    setIsVisualizing(true);
    setExecutionOutput(null);
    try {
      const [{ traceJs }, BabelMod] = await Promise.all([
        import("@/lib/jsTracer"),
        import("@babel/standalone"),
      ]);
      const Babel = (BabelMod as unknown as { default?: unknown }).default ?? BabelMod;
      const result = traceJs(Babel, codeRef.current || "");
      setVisTrace(result);
    } catch (e) {
      setVisTrace({ steps: [], logs: [], truncated: false, error: (e as Error).message });
    } finally {
      setIsVisualizing(false);
    }
  };

  const runSql = async () => {
    if (isExecuting) return;
    setIsExecuting(true);
    setExecutionOutput("⏳ Running query...");
    try {
      const res = await fetch("/api/execute-sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: code, sessionId: ensureSessionId() }),
      });
      const data = await res.json();
      if (data.error) {
        setExecutionOutput(`❌ ${data.error}`);
      } else if (data.rows) {
        const cols: string[] = data.columns || [];
        const header = cols.join(" | ");
        const sep = cols.map(() => "---").join(" | ");
        const body = data.rows
          .map((r: Record<string, unknown>) => cols.map((c) => (r[c] === null ? "NULL" : String(r[c]))).join(" | "))
          .join("\n");
        const note = data.truncated ? `\n… (${data.rowCount} rows, showing first 200)` : `\n(${data.rowCount} row${data.rowCount === 1 ? "" : "s"})`;
        setExecutionOutput(data.rows.length ? `${header}\n${sep}\n${body}${note}` : "(0 rows)");
      } else {
        setExecutionOutput(data.message || "(done)");
      }
    } catch (err: any) {
      setExecutionOutput(`❌ Query failed: ${err.message}`);
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
    // Attach the current editor code IN THE SAME turn (not a separate message)
    // so the coach sees it without a second turn that would clip its reply.
    if (code.trim() && code !== lastSentCodeRef.current) {
      lastSentCodeRef.current = code;
      const c = code.length > 1500 ? code.slice(0, 1500) + "\n… (truncated)" : code;
      sendText(`[CODE_UPDATE] My current code:\n\`\`\`\n${c}\n\`\`\`\n\nQuestion: ${userMsg}`);
    } else {
      sendText(userMsg);
    }
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
          <h1 className={styles.setupTitle}>
            {syllabus && isSyllabusComplete ? "🎓 Syllabus Complete!" : "📊 Session Complete"}
          </h1>

          {syllabus && isSyllabusComplete && (
            <div className={styles.syllabusCompleteCard}>
              <p className={styles.syllabusCompleteText}>
                You completed all <strong>{syllabus.length} topics</strong> in the syllabus!
              </p>
              {syllabusSource && (
                <p className={styles.syllabusSource} style={{ marginTop: '4px' }}>
                  Based on: {syllabusSource}
                </p>
              )}
              <div style={{ display: 'flex', gap: '24px', justifyContent: 'center', marginTop: '12px' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                  ⏱ {Math.floor(timer / 60)}:{(timer % 60).toString().padStart(2, '0')} total
                </span>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                  🧩 {solvedCount} problem{solvedCount !== 1 ? 's' : ''} solved
                </span>
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "20px" }}>
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
          <span>
            {syllabus
              ? isSyllabusComplete
                ? "🎉 All done! Finishing syllabus…"
                : `🎉 Problem Solved! Loading topic ${syllabusIndex + 2} of ${syllabus.length}…`
              : "🎉 Problem Solved! Great work!"}
          </span>
        </div>
      )}

      <div className={styles.sessionBody}>
        {(syllabus || predefinedProblem) && (
          <SyllabusSidebar
            syllabus={syllabus}
            currentIndex={syllabusIndex}
            problemIds={predefinedProblem ? [predefinedProblem.id] : undefined}
            currentProblemId={predefinedProblem?.id}
            solvedProblemIds={solvedCount > 0 && predefinedProblem ? [predefinedProblem.id] : []}
            completedConcepts={completedConcepts}
          />
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
            <p style={{ margin: "0 0 8px 0", whiteSpace: "pre-wrap" }}>{problem?.description}</p>
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
              language={editorLanguage ?? problem?.language}
              noValidation={!isCodingMode}
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

          {/* Step-through algorithm visualizer */}
          {visTrace && (
            <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.5)" }}>
              <AlgoVisualizer code={codeRef.current || ""} result={visTrace} onClose={() => setVisTrace(null)} />
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "8px", padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)" }}>
            {(isCodingMode || isSqlMode) && (
              <button
                onClick={isSqlMode ? runSql : runCode}
                disabled={isExecuting}
                style={{
                  padding: "8px 16px", borderRadius: "8px", border: "none",
                  background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "white",
                  fontWeight: 600, fontSize: "0.85rem", cursor: isExecuting ? "wait" : "pointer",
                  opacity: isExecuting ? 0.5 : 1,
                }}
              >
                {isExecuting ? "⏳ Running..." : isSqlMode ? "▶ Run Query" : "▶ Run"}
              </button>
            )}
            {isCodingMode && (
              <button
                onClick={visualize}
                disabled={isVisualizing}
                title="Step through your code: watch variables & loops change line by line"
                style={{
                  padding: "8px 16px", borderRadius: "8px", border: "none",
                  background: "linear-gradient(135deg, #a855f7, #7c3aed)", color: "white",
                  fontWeight: 600, fontSize: "0.85rem", cursor: isVisualizing ? "wait" : "pointer",
                  opacity: isVisualizing ? 0.5 : 1,
                }}
              >
                {isVisualizing ? "⏳ Tracing..." : "🎞️ Visualize"}
              </button>
            )}
            {isCodingMode && (problem?.testCases?.length ?? 0) > 0 && (
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
            )}
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
              <div key={i} dir="auto" className={`${styles.message} ${msg.role === "ai" ? styles.messageAi : styles.messageUser}`}>
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
                dir="auto"
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
    </div>
  );
}
