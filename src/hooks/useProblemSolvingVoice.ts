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
  const turnHadAudioRef = useRef(false); // diag: did the current turn deliver audio?
  const audioChunkCountRef = useRef(0); // diag: audio chunks received this turn

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

  // ── Stop Session ──

  const stopSession = useCallback(() => {
    endedRef.current = true; // must be set before close() so onclose skips reconnect
    reconnectingRef.current = false;
    sessionGenRef.current++; // invalidate any in-flight session callbacks
    if (stableTimerRef.current) { clearTimeout(stableTimerRef.current); stableTimerRef.current = null; }
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
                clearCompletedSources();
                clientBufRef.current = []; // server consumed our turn → ack
                // DIAG: report whether this whole turn delivered any audio.
                traceClient.traceEvent(traceSessionIdRef.current, 'ai.turnEnd', {
                  metadata: {
                    audioReceived: turnHadAudioRef.current,
                    audioChunks: audioChunkCountRef.current,
                    ctxState: audioContextRef.current?.state ?? 'null',
                    aiMuted: aiMutedRef.current,
                  },
                });
                turnHadAudioRef.current = false;
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
             attemptReconnect();
          },
          onclose: () => {
             if (myGen !== sessionGenRef.current) return; // stale connection (e.g. old session after a goAway reconnect)
             console.log("[Solve] SDK Session closed (server-initiated)");
             if (endedRef.current) return; // intentional stop — don't reconnect
             try { traceClient.traceEvent(traceSessionIdRef.current, 'ws.close'); } catch { /* noop */ }
             attemptReconnect();
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

  // ── Auto-Reconnect ──

  const attemptReconnect = async () => {
    if (endedRef.current) { console.log("[Solve] reconnect skipped — session ended"); return; }
    if (reconnectingRef.current) { console.log("[Solve] reconnect skipped — already reconnecting"); return; }
    reconnectingRef.current = true;
    if (stableTimerRef.current) { clearTimeout(stableTimerRef.current); stableTimerRef.current = null; }
    reconnectCountRef.current++;
    const attempt = reconnectCountRef.current;

    if (attempt > MAX_RECONNECTS) {
      console.warn(`[Solve] Max reconnect attempts (${MAX_RECONNECTS}) reached — ending session`);
      stopSession();
      return;
    }

    const handle = resumptionHandleRef.current;
    if (!handle) {
      console.warn('[Solve] No resumption handle available — cannot reconnect');
      stopSession();
      return;
    }

    console.log(`[Solve] 🔄 Reconnecting (attempt ${attempt}/${MAX_RECONNECTS}) with handle: ${handle.slice(0, 20)}...`);
    setIsReconnecting(true);
    optionsRef.current.onReconnecting?.();
    sessionRef.current = null;

    try {
      const ephemeralToken = await fetchVoiceToken(modeRef.current, { resumptionHandle: handle });
      const ai = new GoogleGenAI({
        apiKey: ephemeralToken,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      traceClient.traceEvent(traceSessionIdRef.current, 'ws.reconnect', {
        metadata: { attempt, handle: handle.slice(0, 20) },
      });

      const myGen = ++sessionGenRef.current;
      const newSession = await ai.live.connect({
        model: VOICE_MODEL_PATH,
        config: {
          responseModalities: ["AUDIO"] as any,
          tools: [{ googleSearch: {} }],
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } }
          } as any,
          sessionResumption: { handle },
          contextWindowCompression: {
            triggerTokens: "200000",
            slidingWindow: { targetTokens: "100000" },
          },
        },
        callbacks: {
          onopen: () => {
            if (myGen !== sessionGenRef.current) return; // stale connection
            console.log(`[Solve] ✅ Reconnected (attempt ${attempt})`);
            traceClient.traceEvent(traceSessionIdRef.current, 'ws.reconnected', { metadata: { attempt } });
            reconnectingRef.current = false;
            setIsReconnecting(false);
            setIsConnected(true);
            // Renew the reconnect budget only after the link stays up a while,
            // so a flapping server still hits MAX_RECONNECTS instead of looping.
            stableTimerRef.current = setTimeout(() => { reconnectCountRef.current = 0; }, 30_000);
            optionsRef.current.onReconnected?.();
          },
          onmessage: async (response: any) => {
            if (myGen !== sessionGenRef.current) return; // stale connection
            try {
              const data = response;
              if (data.sessionResumptionUpdate?.newHandle) {
                resumptionHandleRef.current = data.sessionResumptionUpdate.newHandle;
              }
              if (data.goAway) {
                console.warn(`[Solve] ⚠️ GoAway — timeLeft: ${data.goAway.timeLeft} — reconnecting proactively`);
                if (!endedRef.current) attemptReconnect();
              }
              if (data.serverContent?.error) return;
              if (data.serverContent?.turnComplete) { clearCompletedSources(); clientBufRef.current = []; }
              if (data.serverContent?.interrupted) flushAudioQueue();
              if (data.serverContent?.modelTurn?.parts) {
                for (const part of data.serverContent.modelTurn.parts) {
                  if (part.inlineData?.mimeType?.startsWith("audio/pcm") || part.inlineData?.data) {
                    if (!aiMutedRef.current) playAudioChunk(part.inlineData.data);
                  }
                }
              }
              // Transcript from outputTranscription API (clean spoken text only)
              if (data.serverContent?.outputTranscription?.text) {
                const text = data.serverContent.outputTranscription.text;
                fullTranscriptRef.current += `\nCoach: ${text}`;
                optionsRef.current.onTranscript?.({ role: "ai", text });
                if (text.includes("[PROBLEM_SOLVED]")) {
                  optionsRef.current.onProblemSolved?.();
                }
              }
            } catch (e) {
              console.error("[Solve] Failed to parse SDK message (reconnect)", e);
            }
          },
          onerror: (err) => {
            if (myGen !== sessionGenRef.current) return; // stale connection
            console.error("[Solve] SDK Error (reconnect):", err);
            setIsReconnecting(false);
            if (endedRef.current) { stopSession(); return; }
            attemptReconnect();
          },
          onclose: () => {
            if (myGen !== sessionGenRef.current) return; // stale connection
            console.log(`[Solve] SDK Session closed again (server-initiated)`);
            if (endedRef.current) return; // intentional stop — don't reconnect
            attemptReconnect();
          }
        }
      });

      sessionRef.current = newSession;

      // Resend client turns the server hadn't acknowledged before the drop.
      const pending = [...clientBufRef.current];
      for (const t of pending) {
        try { newSession.sendClientContent({ turns: [{ role: "user", parts: [{ text: t }] }], turnComplete: true }); } catch { /* noop */ }
      }

    } catch (error) {
      console.error(`[Solve] Reconnect attempt ${attempt} failed:`, error);
      reconnectingRef.current = false;
      setIsReconnecting(false);
      stopSession();
    }
  };

  return {
    isConnected, isRecording, isSpeaking, isReconnecting, isAiMuted,
    startSession, stopSession, toggleMicrophone, toggleAiAudio,
    sendText, sendCodeUpdate,
  };
}
