"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  fetchVoiceToken, arrayBufferToBase64,
  downsampleTo16k, float32ToInt16,
} from "@/lib/voiceUtils";
import { GoogleGenAI } from "@google/genai";
import type { Session } from "@google/genai";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { buildSolveIntroPrompt, buildSqlIntroPrompt, buildSysdesignIntroPrompt, SOLVE_INTRO_FALLBACK, SOLVE_VOICE_SYSTEM_PROMPT } from "@/config/prompts";
import { VOICE_MODEL_PATH, VOICE_NAME } from "@/config/voiceModel";
import * as traceClient from "@/lib/traceClient";

export type SolveMode = "solve" | "sql" | "sysdesign";

const INTRO_BUILDERS: Record<SolveMode, (ctx: string) => string> = {
  solve: buildSolveIntroPrompt,
  sql: buildSqlIntroPrompt,
  sysdesign: buildSysdesignIntroPrompt,
};

export interface VoiceTranscript {
  role: "user" | "ai";
  text: string;
}

interface UseProblemSolvingVoiceOptions {
  /** Which teaching mode this session runs. Drives the system prompt + intro. Default "solve". */
  mode?: SolveMode;
  /** Returns the current editor code + recent transcript, replayed on a FRESH
   * reconnect (no server-side context) so the coach continues seamlessly. */
  getResumeContext?: () => { code: string; messages: { role: "ai" | "user"; text: string }[] };
  onTranscript?: (t: VoiceTranscript) => void;
  onProblemSolved?: () => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
}

export interface UseProblemSolvingVoiceReturn {
  isConnected: boolean;
  isRecording: boolean;
  isSpeaking: boolean;
  isReconnecting: boolean;
  isAiMuted: boolean;
  startSession: (problemContext?: string) => Promise<void>;
  stopSession: () => void;
  toggleMicrophone: () => void;
  toggleAiAudio: () => void;
  sendText: (text: string) => void;
  sendCodeUpdate: (code: string) => void;
}

export function useProblemSolvingVoice(options: UseProblemSolvingVoiceOptions = {}): UseProblemSolvingVoiceReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isAiMuted, setIsAiMuted] = useState(false);

  const fullTranscriptRef = useRef<string>("");

  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Mode is stable for a session; keep in a ref so reconnect closures see it.
  const modeRef = useRef<SolveMode>(options.mode ?? "solve");
  modeRef.current = options.mode ?? "solve";

  const sessionRef = useRef<Session | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // Set true on intentional stop so the SDK's onclose doesn't auto-reconnect.
  const endedRef = useRef(false);
  // Resets the reconnect budget once a reconnected session proves stable.
  const stableTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Guards against concurrent reconnects (onerror + onclose both firing).
  const reconnectingRef = useRef(false);
  // Each live connection gets a generation id; callbacks from a stale connection
  // (e.g. the old session closing after a proactive goAway reconnect) are ignored.
  const sessionGenRef = useRef(0);
  const failuresRef = useRef(0); // consecutive reconnect failures → backoff + handle fallback
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const connOpenedAtRef = useRef(0); // performance.now() when the current connection opened (0 = not yet)
  const lastCloseCodeRef = useRef(0); // WS close code of the connection that just dropped (1007 = invalid arg → resume is hopeless, go fresh)
  const turnHadAudioRef = useRef(false); // did the current turn deliver audio?
  const turnHadTranscriptRef = useRef(false); // did the current turn deliver transcript?
  const audioChunkCountRef = useRef(0); // diag: audio chunks received this turn
  const voiceRetryCountRef = useRef(0); // consecutive nudges on a text-only streak (capped)
  const MAX_VOICE_RETRIES = 3;
  // A session can get STUCK in text-only mode from its very first turn (no audio
  // ever). In-session nudges never recover it — only a brand-new session does.
  const sessionHadAudioRef = useRef(false); // has THIS session produced any audio at all?
  const hardRestartsRef = useRef(0);        // fresh-session restarts triggered by a stuck-text-only session
  const MAX_HARD_RESTARTS = 2;
  // Watchdog: gemini-3.1-flash-live can go SILENT after a text turn — no audio AND
  // no turnComplete, no error (google-gemini/cookbook#1226). The turnComplete-based
  // retry can't fire there, so a timer re-nudges if no audio arrives in time.
  const audioWatchdogRef = useRef<NodeJS.Timeout | null>(null);
  const AUDIO_WATCHDOG_MS = 8000; // longer than typical first-response latency, so a slow start isn't mistaken for a freeze
  // Reassigned each render; called via ref so sendTurn (a stable useCallback) can
  // invoke it without a dependency cycle.
  const armWatchdogRef = useRef<() => void>(() => {});
  // Text-only-turn recovery (shared by the primary + reconnect message handlers).
  const textOnlyRecoveryRef = useRef<() => void>(() => {});
  const clearWatchdog = () => { if (audioWatchdogRef.current) { clearTimeout(audioWatchdogRef.current); audioWatchdogRef.current = null; } };

  const {
    playAudioChunk, flushAudioQueue, clearCompletedSources,
    isSpeaking, audioContextRef,
  } = useAudioPlayback("[Solve]");

  // ── Tracing session ID ──
  const traceSessionIdRef = useRef<string>("");

  // ── Session Resumption ──
  const resumptionHandleRef = useRef<string | undefined>(undefined);
  const problemContextRef = useRef<string | undefined>(undefined);
  const reconnectCountRef = useRef(0);
  const MAX_RECONNECTS = 5;

  // ── AI Mute (pause AI audio output) ──
  const aiMutedRef = useRef(false);

  // Safety: kill the session + audio if the page is hidden or closed, so the
  // voice never keeps talking after the user leaves.
  useEffect(() => {
    const stop = () => {
      endedRef.current = true;
      sessionGenRef.current++;
      try { sessionRef.current?.close(); } catch { /* noop */ }
      sessionRef.current = null;
      flushAudioQueue();
      try { audioContextRef.current?.close(); } catch { /* noop */ }
      audioContextRef.current = null;
    };
    window.addEventListener("pagehide", stop);
    return () => window.removeEventListener("pagehide", stop);
  }, [flushAudioQueue, audioContextRef]);

  // Reconnect the instant the network comes back (after an offline gap).
  useEffect(() => {
    const onOnline = () => {
      if (endedRef.current || sessionRef.current || !traceSessionIdRef.current) return;
      failuresRef.current = 0;
      scheduleReconnect();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Text / Code Sending ──

  // Buffer of client turns not yet acknowledged by the server (cleared on the
  // server's turnComplete). On reconnect we resend these so a message sent right
  // at a connection drop isn't lost.
  const clientBufRef = useRef<string[]>([]);
  const sendTurn = useCallback((text: string, session?: Session | null) => {
    clientBufRef.current.push(text);
    if (clientBufRef.current.length > 10) clientBufRef.current.shift();
    const s = session ?? sessionRef.current;
    try {
      s?.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: true });
      armWatchdogRef.current(); // expect an audio reply; nudge if it never comes
    } catch { /* session closing */ }
  }, []);

  const sendText = useCallback((text: string) => {
    if (!sessionRef.current) return;
    fullTranscriptRef.current += `\nDeveloper: ${text}`;
    sendTurn(text);
  }, [sendTurn]);

  const sendCodeUpdate = useCallback((code: string) => {
    // Cap the code so a big editor can't make this turn large enough to trigger
    // the model's text-only (no-audio) response.
    const c = code.length > 1500 ? code.slice(0, 1500) + "\n… (truncated)" : code;
    sendText(`[CODE_UPDATE] Current code:\n\`\`\`\n${c}\n\`\`\``);
  }, [sendText]);

  // Watchdog body (reassigned every render so it sees current refs). Fires if a
  // sent turn produced no audio within the window — covers the silent-no-turnComplete
  // failure the turnComplete-based retry can't catch.
  armWatchdogRef.current = () => {
    clearWatchdog();
    audioWatchdogRef.current = setTimeout(() => {
      audioWatchdogRef.current = null;
      if (endedRef.current || aiMutedRef.current) return;
      // Only nudge on a TRUE freeze — NOTHING came back. If audio OR transcript
      // arrived, the model is responding (maybe just slow); nudging here injects a
      // phantom "continue" that the model answers with "تمام…" as if replying.
      if (turnHadAudioRef.current || turnHadTranscriptRef.current) {
        console.log(`[Solve] ⏰ watchdog: not firing (audio=${turnHadAudioRef.current} transcript=${turnHadTranscriptRef.current})`);
        return;
      }
      if (voiceRetryCountRef.current >= MAX_VOICE_RETRIES) return; // give up after cap
      voiceRetryCountRef.current++;
      console.log(`[Solve] ⏰ watchdog: true freeze (no audio/transcript) → nudge #${voiceRetryCountRef.current}`);
      try { traceClient.traceEvent(traceSessionIdRef.current, 'ai.voiceWatchdog', { metadata: { attempt: voiceRetryCountRef.current } }); } catch { /* noop */ }
      try {
        sessionRef.current?.sendClientContent({ turns: [{ role: "user", parts: [{ text: "اتفضل كمّل." }] }], turnComplete: true });
      } catch { /* session closing */ }
      armWatchdogRef.current(); // keep watching until audio flows or cap is hit
    }, AUDIO_WATCHDOG_MS);
  };

  // ── Stop Session ──

  const stopSession = useCallback(() => {
    endedRef.current = true; // must be set before close() so onclose skips reconnect
    reconnectingRef.current = false;
    sessionGenRef.current++; // invalidate any in-flight session callbacks
    failuresRef.current = 0;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    if (stableTimerRef.current) { clearTimeout(stableTimerRef.current); stableTimerRef.current = null; }
    clearWatchdog();
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    try { sessionRef.current?.close(); } catch { /* already closed */ }
    sessionRef.current = null;
    setIsConnected(false);
    setIsRecording(false);
    flushAudioQueue();

    if (traceSessionIdRef.current) {
      traceClient.endTrace(traceSessionIdRef.current);
      traceSessionIdRef.current = "";
    }

    fullTranscriptRef.current = "";
  }, [flushAudioQueue]);

  // ── Toggle Microphone ──

  const toggleMicrophone = useCallback(() => {
    const stream = streamRef.current;
    const session = sessionRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (track) {
      const newEnabled = !track.enabled;
      track.enabled = newEnabled;
      setIsRecording(newEnabled);

      if (!newEnabled && session) {
        try {
          session.sendRealtimeInput({ audioStreamEnd: true });
          console.log("[Solve] 🔇 Sent audioStreamEnd (mic muted)");
        } catch { /* session may be closing */ }
      }
    }
  }, []);

  // ── Toggle AI Audio (pause/resume AI speech) ──

  const toggleAiAudio = useCallback(() => {
    const next = !aiMutedRef.current;
    aiMutedRef.current = next;
    setIsAiMuted(next);
    try { traceClient.traceEvent(traceSessionIdRef.current, next ? 'ai.audioPaused' : 'ai.audioResumed'); } catch { /* noop */ }
    if (next) {
      flushAudioQueue();
      console.log("[Solve] ⏸️ AI audio paused");
    } else {
      console.log("[Solve] ▶️ AI audio resumed");
    }
  }, [flushAudioQueue]);

  // ── Start Session ──

  const startSession = async (problemContext?: string) => {
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch { /* already closed */ }
      sessionRef.current = null;
    }
    endedRef.current = false;
    reconnectingRef.current = false;
    reconnectCountRef.current = 0;
    clientBufRef.current = [];
    voiceRetryCountRef.current = 0;
    sessionHadAudioRef.current = false;
    hardRestartsRef.current = 0;
    turnHadTranscriptRef.current = false;
    fullTranscriptRef.current = "";

    try {
      const ephemeralToken = await fetchVoiceToken(modeRef.current);

      const ai = new GoogleGenAI({
        apiKey: ephemeralToken,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      // ── Start session trace ──
      traceSessionIdRef.current = traceClient.generateSessionId();
      traceClient.startTrace(traceSessionIdRef.current, modeRef.current, {
        hasProblemContext: !!problemContext,
      });

      // Helper: start mic + send problem context
      // Accept session as param to avoid race condition (onopen fires before sessionRef is set)
      const startMicAndContext = async (liveSession: Session) => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          });
          streamRef.current = stream;
          // Muted by default — the developer unmutes to speak.
          stream.getAudioTracks().forEach(t => { t.enabled = false; });
          setIsRecording(false);
          console.log('[Solve] 🎤 Mic acquired (muted by default)');
          traceClient.traceEvent(traceSessionIdRef.current, 'mic.acquired', { metadata: { mutedByDefault: true } });

          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          audioContextRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const processor = ctx.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;
          source.connect(processor);
          processor.connect(ctx.destination);
          const nativeSampleRate = ctx.sampleRate;

          processor.onaudioprocess = (e) => {
            const activeSession = sessionRef.current || liveSession;
            if (!activeSession) return;
            // Muted → send nothing (don't stream silence, which the server can
            // still VAD-flag and turn into a spurious interrupt that drops audio).
            const micTrack = streamRef.current?.getAudioTracks()[0];
            if (micTrack && !micTrack.enabled) return;
            const inputData = downsampleTo16k(e.inputBuffer.getChannelData(0), nativeSampleRate);
            const pcm16 = float32ToInt16(inputData);
            const base64Audio = arrayBufferToBase64(pcm16.buffer as ArrayBuffer);
            try {
              activeSession.sendRealtimeInput({ audio: { mimeType: "audio/pcm;rate=16000", data: base64Audio } });
            } catch {
              sessionRef.current = null;
            }
          };

          // Send problem context — use liveSession directly (ref not set yet)
          const introText = problemContext
            ? INTRO_BUILDERS[modeRef.current](problemContext)
            : SOLVE_INTRO_FALLBACK;

          console.log('[Solve] 📝 Sending intro context to session');
          traceClient.traceEvent(traceSessionIdRef.current, 'session.introSent', { metadata: { len: introText.length } });
          sendTurn(introText, liveSession);
        } catch (micError) {
          console.error("[Solve] Microphone error:", micError);
          try { traceClient.traceEvent(traceSessionIdRef.current, 'mic.error', { metadata: { msg: String((micError as any)?.message || micError).slice(0, 200) } }); } catch { /* noop */ }
          stopSession();
        }
      };

      // Resolve pattern: onopen fires BEFORE ai.live.connect() resolves,
      // so `session` variable is in temporal dead zone.
      let resolveSession: (s: Session) => void;
      const sessionReady = new Promise<Session>((r) => { resolveSession = r; });

      const myGen = ++sessionGenRef.current;
      const session = await ai.live.connect({
        model: VOICE_MODEL_PATH,
        config: {
          responseModalities: ["AUDIO"] as any,
          systemInstruction: SOLVE_VOICE_SYSTEM_PROMPT,
          tools: [{ googleSearch: {} }],
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } }
          } as any,
          sessionResumption: {},
          contextWindowCompression: {
            triggerTokens: "200000",
            slidingWindow: { targetTokens: "100000" },
          },
        },
        callbacks: {
          onopen: async () => {
            if (myGen !== sessionGenRef.current) return; // stale connection
            console.log("[Solve] ✅ SDK Session opened — starting mic");
            connOpenedAtRef.current = performance.now();
            lastCloseCodeRef.current = 0;
            // The dev StrictMode mount/unmount cycle can leave endedRef=true via
            // the cleanup's stopSession; the live session is genuinely open here,
            // so clear it — otherwise every reconnect is silently blocked.
            endedRef.current = false;
            reconnectingRef.current = false;
            traceClient.traceEvent(traceSessionIdRef.current, 'ws.open');
            setIsConnected(true);
            traceClient.traceEvent(traceSessionIdRef.current, 'ws.setupComplete');
            const liveSession = await sessionReady;
            startMicAndContext(liveSession);
          },
          onmessage: async (response: any) => {
            if (myGen !== sessionGenRef.current) return; // stale connection
            try {
              const data = response;

              // Store session resumption updates
              if (data.sessionResumptionUpdate?.newHandle) {
                resumptionHandleRef.current = data.sessionResumptionUpdate.newHandle;
              }

              // GoAway → server will close soon (connection limit). Reconnect
              // PROACTIVELY now (with the resumption handle) for a seamless handoff
              // instead of waiting for the drop.
              if (data.goAway) {
                console.warn(`[Solve] ⚠️ GoAway — timeLeft: ${data.goAway.timeLeft} — reconnecting proactively`);
                try { traceClient.traceEvent(traceSessionIdRef.current, 'ws.goAway', { metadata: { timeLeft: data.goAway.timeLeft } }); } catch { /* noop */ }
                if (!endedRef.current) attemptReconnect();
              }

              if (data.serverContent?.error) {
                 console.error("[Solve] ❌ SDK Server error:", JSON.stringify(data.serverContent.error));
                 return;
              }

              if (data.serverContent?.generationComplete) {
                traceClient.traceEvent(traceSessionIdRef.current, 'ai.generationComplete');
              }

              if (data.serverContent?.turnComplete) {
                clearWatchdog(); // turn ended cleanly; retry below re-arms if text-only
                clearCompletedSources();
                clientBufRef.current = []; // server consumed our turn → ack
                traceClient.traceEvent(traceSessionIdRef.current, 'ai.turnEnd', {
                  metadata: {
                    audioReceived: turnHadAudioRef.current,
                    audioChunks: audioChunkCountRef.current,
                    ctxState: audioContextRef.current?.state ?? 'null',
                    aiMuted: aiMutedRef.current,
                  },
                });
                // Voice-reliability: gemini-3.1 intermittently returns a turn
                // text-only (transcript, no audio). Nudge with a NEUTRAL "continue"
                // (no mention of voice/audio, else the coach narrates ABOUT the
                // audio instead of resuming the lesson). Retry up to MAX times per
                // text-only streak — a single retry can itself come back text-only,
                // which left the session permanently silent before.
                console.log(`[Solve] 🏁 turnEnd audio=${turnHadAudioRef.current} transcript=${turnHadTranscriptRef.current} chunks=${audioChunkCountRef.current}`);
                textOnlyRecoveryRef.current();
                turnHadAudioRef.current = false;
                turnHadTranscriptRef.current = false;
                audioChunkCountRef.current = 0;
              }

              if (data.serverContent?.interrupted) {
                flushAudioQueue();
                traceClient.traceEvent(traceSessionIdRef.current, 'ai.interrupted');
              }

              // Audio chunks
              if (data.serverContent?.modelTurn?.parts) {
                for (const part of data.serverContent.modelTurn.parts) {
                  if (part.inlineData?.mimeType?.startsWith("audio/pcm") || part.inlineData?.data) {
                    audioChunkCountRef.current++;
                    if (!turnHadAudioRef.current) {
                      turnHadAudioRef.current = true;
                      sessionHadAudioRef.current = true; // this session can speak
                      hardRestartsRef.current = 0;       // healthy again → allow future restarts
                      clearWatchdog(); // audio is flowing → cancel the nudge timer
                      traceClient.traceEvent(traceSessionIdRef.current, 'ai.audioStart', {
                        metadata: { ctxState: audioContextRef.current?.state ?? 'null', aiMuted: aiMutedRef.current },
                      });
                    }
                    if (!aiMutedRef.current) playAudioChunk(part.inlineData.data);
                  } else if (part.text) {
                    // DIAG: model emitted TEXT in modelTurn (not audio) — record it.
                    traceClient.traceEvent(traceSessionIdRef.current, 'ai.modelText', { metadata: { len: part.text.length } });
                  }
                }
              }

              // AI transcript — use outputTranscription API (clean spoken text only)
              if (data.serverContent?.outputTranscription?.text) {
                const text = data.serverContent.outputTranscription.text;
                turnHadTranscriptRef.current = true;
                fullTranscriptRef.current += `\nCoach: ${text}`;
                traceClient.traceEvent(traceSessionIdRef.current, 'ai.transcript', { metadata: { len: text.length } });
                optionsRef.current.onTranscript?.({ role: "ai", text });
                if (text.includes("[PROBLEM_SOLVED]")) {
                  traceClient.traceEvent(traceSessionIdRef.current, 'solve.problem.solved');
                  optionsRef.current.onProblemSolved?.();
                }
              }

              // DIAG: any serverContent shape we didn't handle above.
              if (data.serverContent && !data.serverContent.modelTurn && !data.serverContent.outputTranscription
                  && !data.serverContent.turnComplete && !data.serverContent.generationComplete
                  && !data.serverContent.interrupted) {
                traceClient.traceEvent(traceSessionIdRef.current, 'ai.otherMsg', { metadata: { keys: Object.keys(data.serverContent) } });
              }

            } catch (e) {
              console.error("[Solve] Failed to parse SDK message", e);
            }
          },
          onerror: (err) => {
             if (myGen !== sessionGenRef.current) return; // stale connection
             console.error("[Solve] SDK Error:", err);
             try { traceClient.traceEvent(traceSessionIdRef.current, 'ws.error', { metadata: { msg: String((err as any)?.message || err).slice(0, 200) } }); } catch { /* noop */ }
             if (endedRef.current) { stopSession(); return; }
             // The connection-limit drop often surfaces as an error, not a clean
             // close — try to resume rather than killing the session.
             reconnectingRef.current = false;
             scheduleReconnect();
          },
          onclose: (e: any) => {
             if (myGen !== sessionGenRef.current) return; // stale connection (e.g. old session after a goAway reconnect)
             console.log(`[Solve] SDK Session closed (server-initiated) code=${e?.code} reason=${e?.reason || ''}`);
             lastCloseCodeRef.current = e?.code ?? 0;
             if (endedRef.current) return; // intentional stop — don't reconnect
             try { traceClient.traceEvent(traceSessionIdRef.current, 'ws.close', { metadata: { code: e?.code, reason: String(e?.reason || '').slice(0, 120) } }); } catch { /* noop */ }
             reconnectingRef.current = false;
             scheduleReconnect();
          }
        }
      });
      
      sessionRef.current = session;
      resolveSession!(session);
      problemContextRef.current = problemContext;
      reconnectCountRef.current = 0;

    } catch (error) {
      console.error("[Solve] Failed to start:", error);
      throw error;
    }
  };

  // ── Auto-Reconnect — never give up while there's a session + internet ──

  const scheduleReconnect = () => {
    if (endedRef.current || reconnectingRef.current || reconnectTimerRef.current) return;
    const f = failuresRef.current;
    // Exp backoff capped at 30s. Sustained closes (e.g. 1011 rate-limit) must NOT
    // be hammered — backing off lets the limit clear so a session can finally stick.
    const delay = f === 0 ? 0 : Math.min(30000, 800 * Math.pow(2, Math.min(f, 6)));
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      attemptReconnect();
    }, delay);
  };

  const attemptReconnect = async () => {
    if (endedRef.current || reconnectingRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return; // offline → wait for 'online'
    reconnectingRef.current = true;
    if (stableTimerRef.current) { clearTimeout(stableTimerRef.current); stableTimerRef.current = null; }

    // After repeated failures the resumption handle may be terminal — fall back
    // to a FRESH session (no handle) so we always recover. Also: a 1007 close
    // ("invalid argument", a server-side native-audio glitch) makes the session
    // unresumable — resuming it just 1007s again — so skip straight to fresh.
    const closedBad1007 = lastCloseCodeRef.current === 1007;
    const handle = (resumptionHandleRef.current && failuresRef.current < 3 && !closedBad1007)
      ? resumptionHandleRef.current : undefined;
    if (closedBad1007) resumptionHandleRef.current = undefined;
    console.log(`[Solve] 🔄 Reconnecting (failures=${failuresRef.current}, ${handle ? 'resume' : 'fresh'})`);
    traceClient.traceEvent(traceSessionIdRef.current, 'ws.reconnect', { metadata: { failures: failuresRef.current, kind: handle ? 'resume' : 'fresh' } });
    setIsReconnecting(true);
    optionsRef.current.onReconnecting?.();

    // Close the OLD session before opening a new one. Otherwise (e.g. proactive
    // goAway reconnect) its socket lingers and the server kills the new resume as
    // a duplicate. Bump the gen FIRST so the old session's onclose is stale (no
    // double reconnect).
    const oldSession = sessionRef.current;
    sessionRef.current = null;
    const myGen = ++sessionGenRef.current;
    try { oldSession?.close?.(); } catch { /* already closed */ }
    connOpenedAtRef.current = 0;
    // Was the session we're replacing STUCK (never spoke)? If so the new fresh
    // session should re-send the short TOPIC intro; otherwise (mid-session drop)
    // it should just continue without re-greeting. Capture BEFORE resetting.
    const recoveringFromStuck = !sessionHadAudioRef.current;
    sessionHadAudioRef.current = false; // new WS — must prove it can speak (else hard-restart)

    const onDrop = () => {
      if (myGen !== sessionGenRef.current) return; // stale
      reconnectingRef.current = false;
      // A session that died can't be allowed to later reset the failure counter,
      // or backoff never grows and we hammer a rate-limited endpoint.
      if (stableTimerRef.current) { clearTimeout(stableTimerRef.current); stableTimerRef.current = null; }
      if (endedRef.current) return;
      const opened = connOpenedAtRef.current > 0;
      const elapsed = opened ? performance.now() - connOpenedAtRef.current : 0;
      // A resume that never opened, or died within 10s of opening, means the
      // handle is terminal — drop it so the next attempt is FRESH (history replay
      // restores context). Still back off: instant retries trip rate-limiting and
      // the server then closes even fresh sessions in ~1-2s (a self-feeding storm).
      if (handle && (!opened || elapsed < 10000)) {
        console.warn("[Solve] resume handle terminal — dropping, next attempt fresh");
        resumptionHandleRef.current = undefined;
      }
      failuresRef.current++;
      scheduleReconnect();
    };

    try {
      const ephemeralToken = await fetchVoiceToken(modeRef.current, handle ? { resumptionHandle: handle } : {});
      const ai = new GoogleGenAI({ apiKey: ephemeralToken, httpOptions: { apiVersion: 'v1alpha' } });

      const newSession = await ai.live.connect({
        model: VOICE_MODEL_PATH,
        config: {
          responseModalities: ["AUDIO"] as any,
          tools: [{ googleSearch: {} }],
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } } } as any,
          sessionResumption: handle ? { handle } : {},
          contextWindowCompression: { triggerTokens: "200000", slidingWindow: { targetTokens: "100000" } },
        },
        callbacks: {
          onopen: () => {
            if (myGen !== sessionGenRef.current) return;
            console.log('[Solve] ✅ Reconnected');
            connOpenedAtRef.current = performance.now();
            lastCloseCodeRef.current = 0;
            traceClient.traceEvent(traceSessionIdRef.current, 'ws.reconnected', { metadata: { kind: handle ? 'resume' : 'fresh' } });
            reconnectingRef.current = false;
            setIsReconnecting(false);
            setIsConnected(true);
            // Reset the failure counter once the link proves stable.
            stableTimerRef.current = setTimeout(() => { failuresRef.current = 0; }, 15_000);
            optionsRef.current.onReconnected?.();
          },
          onmessage: async (response: any) => {
            if (myGen !== sessionGenRef.current) return;
            try {
              const data = response;
              if (data.sessionResumptionUpdate?.newHandle) resumptionHandleRef.current = data.sessionResumptionUpdate.newHandle;
              if (data.goAway) { console.warn(`[Solve] ⚠️ GoAway timeLeft ${data.goAway.timeLeft}`); if (!endedRef.current) attemptReconnect(); }
              if (data.serverContent?.error) return;
              if (data.serverContent?.interrupted) flushAudioQueue();
              if (data.serverContent?.modelTurn?.parts) {
                for (const part of data.serverContent.modelTurn.parts) {
                  if (part.inlineData?.mimeType?.startsWith("audio/pcm") || part.inlineData?.data) {
                    audioChunkCountRef.current++;
                    if (!turnHadAudioRef.current) { turnHadAudioRef.current = true; sessionHadAudioRef.current = true; hardRestartsRef.current = 0; clearWatchdog(); }
                    if (!aiMutedRef.current) playAudioChunk(part.inlineData.data);
                  }
                }
              }
              if (data.serverContent?.outputTranscription?.text) {
                const text = data.serverContent.outputTranscription.text;
                turnHadTranscriptRef.current = true;
                fullTranscriptRef.current += `\nCoach: ${text}`;
                optionsRef.current.onTranscript?.({ role: "ai", text });
                if (text.includes("[PROBLEM_SOLVED]")) optionsRef.current.onProblemSolved?.();
              }
              // Same audio-reliability guard as the primary session: a reconnected
              // session can also return a turn text-only — nudge to recover voice.
              if (data.serverContent?.turnComplete) {
                clearWatchdog();
                clearCompletedSources();
                clientBufRef.current = [];
                traceClient.traceEvent(traceSessionIdRef.current, 'ai.turnEnd', {
                  metadata: { audioReceived: turnHadAudioRef.current, audioChunks: audioChunkCountRef.current, phase: 'reconnect' },
                });
                console.log(`[Solve] 🏁 turnEnd(reconnect) audio=${turnHadAudioRef.current} transcript=${turnHadTranscriptRef.current} chunks=${audioChunkCountRef.current}`);
                textOnlyRecoveryRef.current();
                turnHadAudioRef.current = false;
                turnHadTranscriptRef.current = false;
                audioChunkCountRef.current = 0;
              }
            } catch (e) {
              console.error("[Solve] Failed to parse SDK message (reconnect)", e);
            }
          },
          onerror: (err) => {
            if (myGen !== sessionGenRef.current) return;
            console.error("[Solve] SDK Error (reconnect):", err);
            onDrop();
          },
          onclose: (e: any) => {
            if (myGen !== sessionGenRef.current) return;
            console.log(`[Solve] SDK Session closed (reconnect) code=${e?.code} reason=${e?.reason || ''}`);
            lastCloseCodeRef.current = e?.code ?? 0;
            try { traceClient.traceEvent(traceSessionIdRef.current, 'ws.close', { metadata: { code: e?.code, reason: String(e?.reason || '').slice(0, 120), phase: 'reconnect' } }); } catch { /* noop */ }
            onDrop();
          },
        },
      });

      sessionRef.current = newSession;

      if (handle) {
        // Resume kept server-side context — just resend unacknowledged turns.
        for (const t of [...clientBufRef.current]) {
          try { newSession.sendClientContent({ turns: [{ role: "user", parts: [{ text: t }] }], turnComplete: true }); } catch { /* noop */ }
        }
      } else {
        // FRESH session (no server context). Keep the turn SHORT — a long turn
        // makes the model reply text-only. NEVER send role:"model" turns (Live API
        // rejects them → close 1007).
        try {
          if (recoveringFromStuck) {
            // The replaced session never spoke (stuck text-only from the start).
            // Re-send the SHORT topic intro — proven to reliably get audio.
            const intro = INTRO_BUILDERS[modeRef.current](problemContextRef.current || "");
            newSession.sendClientContent({ turns: [{ role: "user", parts: [{ text: intro }] }], turnComplete: true });
          } else {
            // Mid-session drop (it had been speaking). Continue WITHOUT re-greeting;
            // short recap only (no big code block → keep it audio-reliable).
            const ctx = optionsRef.current.getResumeContext?.();
            const histLines = (ctx?.messages || []).slice(-4)
              .map((m) => {
                const text = m.text.replace(/\[[A-Z_]+\]/g, "").trim().slice(0, 160);
                return text ? `${m.role === "ai" ? "المدرّس" : "أنا"}: ${text}` : "";
              })
              .filter(Boolean)
              .join("\n")
              .slice(-700);
            const recap = histLines ? `سياق سريع:\n${histLines}\n\n` : "";
            newSession.sendClientContent({
              turns: [{ role: "user", parts: [{ text: `${recap}كمّل بالعربي من اللي وقفنا عنده، من غير ترحيب ومن غير ما تبدأ من الأول.` }] }],
              turnComplete: true,
            });
          }
        } catch { /* noop */ }
      }
    } catch (error) {
      console.error('[Solve] Reconnect failed (will retry):', error);
      reconnectingRef.current = false;
      setIsReconnecting(false);
      if (!endedRef.current) { failuresRef.current++; scheduleReconnect(); }
    }
  };

  // Recovery for a turn that came back text-only (transcript, no audio). Shared by
  // the primary + reconnect handlers.
  //  - If the session NEVER produced audio (stuck in text-only mode from the start),
  //    in-session nudges are useless — only a brand-new session recovers. Restart fresh.
  //  - Otherwise it's a mid-session blip → nudge to continue (capped).
  textOnlyRecoveryRef.current = () => {
    if (turnHadAudioRef.current) { voiceRetryCountRef.current = 0; return; }
    if (!turnHadTranscriptRef.current || aiMutedRef.current || endedRef.current) return;
    if (!sessionHadAudioRef.current && hardRestartsRef.current < MAX_HARD_RESTARTS) {
      hardRestartsRef.current++;
      voiceRetryCountRef.current = 0;
      console.log(`[Solve] ♻️ stuck text-only from session start → fresh restart #${hardRestartsRef.current}`);
      try { traceClient.traceEvent(traceSessionIdRef.current, 'ai.hardRestart', { metadata: { n: hardRestartsRef.current } }); } catch { /* noop */ }
      resumptionHandleRef.current = undefined; // force a brand-new session (resume can't fix a stuck one)
      attemptReconnect();
      return;
    }
    if (voiceRetryCountRef.current < MAX_VOICE_RETRIES) {
      voiceRetryCountRef.current++;
      console.log(`[Solve] 🔁 text-only turn → voiceRetry nudge #${voiceRetryCountRef.current}`);
      try { traceClient.traceEvent(traceSessionIdRef.current, 'ai.voiceRetry', { metadata: { attempt: voiceRetryCountRef.current } }); } catch { /* noop */ }
      sendTurn("اتفضل كمّل.");
      return;
    }
    console.log(`[Solve] ⚠️ text-only: nudges + restarts exhausted — staying silent`);
  };

  return {
    isConnected, isRecording, isSpeaking, isReconnecting, isAiMuted,
    startSession, stopSession, toggleMicrophone, toggleAiAudio,
    sendText, sendCodeUpdate,
  };
}
