"use client";

import { useState, useRef, useCallback } from "react";
import {
  fetchVoiceToken, arrayBufferToBase64,
  downsampleTo16k, float32ToInt16,
} from "@/lib/voiceUtils";
import { GoogleGenAI } from "@google/genai";
import type { Session } from "@google/genai";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { buildSolveIntroPrompt, SOLVE_INTRO_FALLBACK } from "@/config/prompts";
import * as traceClient from "@/lib/traceClient";

export interface VoiceTranscript {
  role: "user" | "ai";
  text: string;
}

interface UseProblemSolvingVoiceOptions {
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

  const sessionRef = useRef<Session | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

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
  const MAX_RECONNECTS = 2;

  // ── AI Mute (pause AI audio output) ──
  const aiMutedRef = useRef(false);

  // ── Text / Code Sending ──

  const sendText = useCallback((text: string) => {
    if (!sessionRef.current) return;
    
    fullTranscriptRef.current += `\nDeveloper: ${text}`;
    
    sessionRef.current.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: true,
    });
  }, []);

  const sendCodeUpdate = useCallback((code: string) => {
    sendText(`[CODE_UPDATE] The developer edited their solution:\n\`\`\`\n${code}\n\`\`\``);
  }, [sendText]);

  // ── Stop Session ──

  const stopSession = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
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
      sessionRef.current = null;
    }
    fullTranscriptRef.current = "";

    try {
      const ephemeralToken = await fetchVoiceToken("solve");
      
      const ai = new GoogleGenAI({
        apiKey: ephemeralToken,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      // ── Start session trace ──
      traceSessionIdRef.current = traceClient.generateSessionId();
      traceClient.startTrace(traceSessionIdRef.current, "solve", {
        hasProblemContext: !!problemContext,
      });

      // Helper: start mic + send problem context
      const startMicAndContext = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          });
          streamRef.current = stream;
          setIsRecording(true);

          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          audioContextRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const processor = ctx.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;
          source.connect(processor);
          processor.connect(ctx.destination);
          const nativeSampleRate = ctx.sampleRate;

          processor.onaudioprocess = (e) => {
            if (!sessionRef.current) return;
            const inputData = downsampleTo16k(e.inputBuffer.getChannelData(0), nativeSampleRate);
            const pcm16 = float32ToInt16(inputData);
            const base64Audio = arrayBufferToBase64(pcm16.buffer as ArrayBuffer);
            try {
              sessionRef.current.sendRealtimeInput({ audio: { mimeType: "audio/pcm;rate=16000", data: base64Audio } });
            } catch {
              sessionRef.current = null;
            }
          };

          // Send problem context
          const introText = problemContext
            ? buildSolveIntroPrompt(problemContext)
            : SOLVE_INTRO_FALLBACK;

          sessionRef.current?.sendClientContent({
            turns: [{ role: "user", parts: [{ text: introText }] }],
            turnComplete: true,
          });
        } catch (micError) {
          console.error("[Solve] Microphone error:", micError);
          stopSession();
        }
      };

      const session = await ai.live.connect({
        model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: ["AUDIO"] as any,
          systemInstruction: "You are a patient coding coach. Your top priority is respecting the developer's thinking time. When they are silent, they are thinking — wait for them to speak. Keep every response to 2-3 sentences max. Ask only one question at a time, then wait. Guide with questions only, never write code or reveal solutions. Match their energy — if they are quiet and focused, be brief. Only speak when spoken to, or when acknowledging their code updates.",
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }
          } as any,
          sessionResumption: {},
          contextWindowCompression: {
            triggerTokens: "200000",
            slidingWindow: { targetTokens: "100000" },
          },
        },
        callbacks: {
          onopen: () => {
            console.log("[Solve] ✅ SDK Session Setup complete, starting mic...");
            traceClient.traceEvent(traceSessionIdRef.current, 'ws.open');
            setIsConnected(true);
            traceClient.traceEvent(traceSessionIdRef.current, 'ws.setupComplete');
            startMicAndContext();
          },
          onmessage: async (response: any) => {
            try {
              const data = response;

              // Store session resumption updates
              if (data.sessionResumptionUpdate?.newHandle) {
                resumptionHandleRef.current = data.sessionResumptionUpdate.newHandle;
              }

              // GoAway warning
              if (data.goAway) {
                console.warn(`[Solve] ⚠️ GoAway received — timeLeft: ${data.goAway.timeLeft}`);
                traceClient.traceEvent(traceSessionIdRef.current, 'ws.goAway', {
                  metadata: { timeLeft: data.goAway.timeLeft },
                });
              }

              if (data.serverContent?.error) {
                 console.error("[Solve] ❌ SDK Server error:", JSON.stringify(data.serverContent.error));
                 return;
              }

              if (data.serverContent?.turnComplete) {
                clearCompletedSources();
              }

              if (data.serverContent?.interrupted) {
                flushAudioQueue();
                traceClient.traceEvent(traceSessionIdRef.current, 'ai.interrupted');
              }

              // Audio chunks
              if (data.serverContent?.modelTurn?.parts) {
                for (const part of data.serverContent.modelTurn.parts) {
                  if (part.inlineData?.mimeType?.startsWith("audio/pcm") || part.inlineData?.data) {
                    if (!aiMutedRef.current) playAudioChunk(part.inlineData.data);
                  }
                }
              }

              // AI transcript — only surface spoken text, not thinking tokens.
              if (data.serverContent?.modelTurn?.parts) {
                 const parts = data.serverContent.modelTurn.parts;
                 const hasAudio = parts.some((p: any) => p.inlineData?.data || p.inlineData?.mimeType?.startsWith("audio/pcm"));

                 if (hasAudio) {
                   for (const part of parts) {
                     if (part.text) {
                       const text = part.text;
                       fullTranscriptRef.current += `\nCoach: ${text}`;
                       traceClient.traceEvent(traceSessionIdRef.current, 'ai.transcript', { output: { text } });
                       optionsRef.current.onTranscript?.({ role: "ai", text });
                       if (text.includes("[PROBLEM_SOLVED]")) {
                         traceClient.traceEvent(traceSessionIdRef.current, 'solve.problem.solved');
                         optionsRef.current.onProblemSolved?.();
                       }
                     }
                   }
                 }
              }

            } catch (e) {
              console.error("[Solve] Failed to parse SDK message", e);
            }
          },
          onerror: (err) => {
             console.error("[Solve] SDK Error:", err);
             stopSession();
          },
          onclose: () => {
             console.log("[Solve] SDK Session closed (server-initiated)");
             traceClient.traceEvent(traceSessionIdRef.current, 'ws.close');
             attemptReconnect();
          }
        }
      });
      
      sessionRef.current = session;
      problemContextRef.current = problemContext;
      reconnectCountRef.current = 0;

    } catch (error) {
      console.error("[Solve] Failed to start:", error);
      throw error;
    }
  };

  // ── Auto-Reconnect ──

  const attemptReconnect = async () => {
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
      const ephemeralToken = await fetchVoiceToken("solve", { resumptionHandle: handle });
      const ai = new GoogleGenAI({
        apiKey: ephemeralToken,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      traceClient.traceEvent(traceSessionIdRef.current, 'ws.reconnect', {
        metadata: { attempt, handle: handle.slice(0, 20) },
      });

      const newSession = await ai.live.connect({
        model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: ["AUDIO"] as any,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }
          } as any,
          sessionResumption: { handle },
          contextWindowCompression: {
            triggerTokens: "200000",
            slidingWindow: { targetTokens: "100000" },
          },
        },
        callbacks: {
          onopen: () => {
            console.log(`[Solve] ✅ Reconnected (attempt ${attempt})`);
            traceClient.traceEvent(traceSessionIdRef.current, 'ws.reconnected', { metadata: { attempt } });
            setIsReconnecting(false);
            setIsConnected(true);
            optionsRef.current.onReconnected?.();
          },
          onmessage: async (response: any) => {
            try {
              const data = response;
              if (data.sessionResumptionUpdate?.newHandle) {
                resumptionHandleRef.current = data.sessionResumptionUpdate.newHandle;
              }
              if (data.goAway) {
                console.warn(`[Solve] ⚠️ GoAway received — timeLeft: ${data.goAway.timeLeft}`);
              }
              if (data.serverContent?.error) return;
              if (data.serverContent?.turnComplete) clearCompletedSources();
              if (data.serverContent?.interrupted) flushAudioQueue();
              if (data.serverContent?.modelTurn?.parts) {
                const parts = data.serverContent.modelTurn.parts;
                const hasAudio = parts.some((p: any) => p.inlineData?.data || p.inlineData?.mimeType?.startsWith("audio/pcm"));
                for (const part of parts) {
                  if (part.inlineData?.mimeType?.startsWith("audio/pcm") || part.inlineData?.data) {
                    if (!aiMutedRef.current) playAudioChunk(part.inlineData.data);
                  }
                }
                if (hasAudio) {
                  for (const part of parts) {
                    if (part.text) {
                      fullTranscriptRef.current += `\nCoach: ${part.text}`;
                      optionsRef.current.onTranscript?.({ role: "ai", text: part.text });
                      if (part.text.includes("[PROBLEM_SOLVED]")) {
                        optionsRef.current.onProblemSolved?.();
                      }
                    }
                  }
                }
              }
            } catch (e) {
              console.error("[Solve] Failed to parse SDK message (reconnect)", e);
            }
          },
          onerror: (err) => {
            console.error("[Solve] SDK Error (reconnect):", err);
            setIsReconnecting(false);
            stopSession();
          },
          onclose: () => {
            console.log(`[Solve] SDK Session closed again (server-initiated)`);
            attemptReconnect();
          }
        }
      });

      sessionRef.current = newSession;

    } catch (error) {
      console.error(`[Solve] Reconnect attempt ${attempt} failed:`, error);
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
