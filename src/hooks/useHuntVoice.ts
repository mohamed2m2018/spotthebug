"use client";

import { useState, useRef, useCallback } from "react";
import {
  fetchVoiceToken, arrayBufferToBase64,
  downsampleTo16k, float32ToInt16,
} from "@/lib/voiceUtils";
import { GoogleGenAI } from "@google/genai";
import type { Session } from "@google/genai";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { buildHuntIntroPrompt, HUNT_INTRO_FALLBACK, HUNT_VOICE_SYSTEM_PROMPT } from "@/config/prompts";
import * as traceClient from "@/lib/traceClient";

export interface VoiceTranscript {
  role: "user" | "ai";
  text: string;
}

interface UseHuntVoiceOptions {
  onTranscript?: (t: VoiceTranscript) => void;
  onBugSolved?: () => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
}

export interface UseHuntVoiceReturn {
  isConnected: boolean;
  isRecording: boolean;
  isScreenSharing: boolean;
  isSpeaking: boolean;
  isReconnecting: boolean;
  isAiMuted: boolean;
  startSession: (bugContext?: string) => Promise<void>;
  stopSession: () => void;
  toggleMicrophone: () => void;
  toggleAiAudio: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  sendText: (text: string) => void;
  sendCodeUpdate: (code: string) => void;
  postSessionReport: any;
}

export function useHuntVoice(options: UseHuntVoiceOptions = {}): UseHuntVoiceReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isAiMuted, setIsAiMuted] = useState(false);
  const [postSessionReport, setPostSessionReport] = useState<any>(null);

  const fullTranscriptRef = useRef<string>("");

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const sessionRef = useRef<Session | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const screenIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const {
    playAudioChunk, flushAudioQueue, clearCompletedSources,
    isSpeaking, audioContextRef,
  } = useAudioPlayback("[Hunt]");

  // ── Tracing session ID ──
  const traceSessionIdRef = useRef<string>("");

  // ── Session Resumption ──
  const resumptionHandleRef = useRef<string | undefined>(undefined);
  const bugContextRef = useRef<string | undefined>(undefined);
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
    console.log(`[Hunt] 📝 sendCodeUpdate fired — ${code.length} chars, session active: ${!!sessionRef.current}`);
    sendText(`[CODE_UPDATE] The developer edited their code in the editor. Here is the COMPLETE current code:\n\`\`\`\n${code}\n\`\`\`\nReview the changes and respond.`);
  }, [sendText]);

  // ── Automatic Page Capture (no permission dialog) ──

  const stopPageCapture = useCallback(() => {
    if (screenIntervalRef.current) {
      clearInterval(screenIntervalRef.current);
      screenIntervalRef.current = null;
    }
    setIsScreenSharing(false);
    console.log('[Hunt] 📹 Page capture stopped');
  }, []);

  const startPageCapture = useCallback(async () => {
    if (!sessionRef.current) return;
    const html2canvas = (await import('html2canvas')).default;
    setIsScreenSharing(true);
    console.log('[Hunt] 📹 Starting automatic page capture at 1fps');

    screenIntervalRef.current = setInterval(async () => {
      if (!sessionRef.current) return;
      try {
        const canvas = await html2canvas(document.body, {
          scale: 0.5, // half resolution for performance
          logging: false,
          useCORS: true,
          width: window.innerWidth,
          height: window.innerHeight,
        });
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        const base64Data = dataUrl.split(',')[1];
        sessionRef.current.sendRealtimeInput({ video: { mimeType: 'image/jpeg', data: base64Data } });
      } catch {
        // Silently skip frames on error
      }
    }, 2000); // 1 frame every 2 seconds for performance
  }, []);

  // ── Stop Session ──

  const stopSession = useCallback(() => {
    stopPageCapture();
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

    if (fullTranscriptRef.current) {
      const transcript = fullTranscriptRef.current;
      fullTranscriptRef.current = ""; // Reset for next session

      // Timeout: if ADK takes longer than 20s, show error state
      const timeoutId = setTimeout(() => {
        setPostSessionReport({ error: "Summary timed out. Your session data is safe." });
      }, 20_000);

      // Send the session transcript to our ADK backend for evaluation
      fetch('/api/summarize-session', {
        method: 'POST',
        body: JSON.stringify({ transcript }),
        headers: { 'Content-Type': 'application/json' }
      })
      .then(res => {
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        return res.json();
      })
      .then(data => {
        clearTimeout(timeoutId);
        setPostSessionReport(data);
      })
      .catch(err => {
        clearTimeout(timeoutId);
        console.error("[Hunt] Failed to get session summary:", err);
        setPostSessionReport({ error: err.message || "Failed to generate summary" });
      });
    }
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

      // Tell server to flush cached audio when muting
      if (!newEnabled && session) {
        try {
          session.sendRealtimeInput({ audioStreamEnd: true });
          console.log("[Hunt] 🔇 Sent audioStreamEnd (mic muted)");
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
      console.log("[Hunt] ⏸️ AI audio paused");
    } else {
      console.log("[Hunt] ▶️ AI audio resumed");
    }
  }, [flushAudioQueue]);

  // ── Start Session ──

  const startSession = async (bugContext?: string) => {
    // Clean up any existing connection first
    if (sessionRef.current) {
      sessionRef.current = null;
    }
    setPostSessionReport(null);
    fullTranscriptRef.current = "";

    try {
      const ephemeralToken = await fetchVoiceToken("hunt");
      
      // Initialize the official Google GenAI SDK using the ephemeral token
      const ai = new GoogleGenAI({
        apiKey: ephemeralToken,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      // ── Start session trace ──
      traceSessionIdRef.current = traceClient.generateSessionId();
      traceClient.startTrace(traceSessionIdRef.current, "hunt", {
        hasBugContext: !!bugContext,
      });

      // Helper: start mic + send bug context (called after setupComplete)
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

          // Send bug context
          const introText = bugContext
            ? buildHuntIntroPrompt(bugContext)
            : HUNT_INTRO_FALLBACK;

          sessionRef.current?.sendClientContent({
            turns: [{ role: "user", parts: [{ text: introText }] }],
            turnComplete: true,
          });
        } catch (micError) {
          console.error("[Hunt] Microphone error:", micError);
          stopSession();
        }
      };

      const session = await ai.live.connect({
        model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: ["AUDIO"] as any,
          systemInstruction: HUNT_VOICE_SYSTEM_PROMPT,
          tools: [{ googleSearch: {} }],
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
            console.log("[Hunt] ✅ SDK Session Setup complete, starting mic...");
            traceClient.traceEvent(traceSessionIdRef.current, 'ws.open');
            setIsConnected(true);
            traceClient.traceEvent(traceSessionIdRef.current, 'ws.setupComplete');
            startMicAndContext();
            startPageCapture();
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
                console.warn(`[Hunt] ⚠️ GoAway received — timeLeft: ${data.goAway.timeLeft}`);
                traceClient.traceEvent(traceSessionIdRef.current, 'ws.goAway', {
                  metadata: { timeLeft: data.goAway.timeLeft },
                });
              }

              if (data.serverContent?.error) {
                 console.error("[Hunt] ❌ SDK Server error:", JSON.stringify(data.serverContent.error));
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
                   // The SDK abstracts the message structure, the audio data comes back as part.inlineData
                  if (part.inlineData?.mimeType?.startsWith("audio/pcm") || part.inlineData?.data) {
                    if (!aiMutedRef.current) playAudioChunk(part.inlineData.data);
                  }
                }
              }

              // AI transcript — only surface spoken text, not thinking tokens.
              // Native audio model emits text-only parts as internal reasoning.
              // We only show text that accompanies audio output (actual speech).
              if (data.serverContent?.modelTurn?.parts) {
                 const parts = data.serverContent.modelTurn.parts;
                 const hasAudio = parts.some((p: any) => p.inlineData?.data || p.inlineData?.mimeType?.startsWith("audio/pcm"));

                 // Only surface text when this turn also contains audio (spoken transcript)
                 if (hasAudio) {
                   for (const part of parts) {
                     if (part.text) {
                       const text = part.text;
                       fullTranscriptRef.current += `\nCoach: ${text}`;
                       traceClient.traceEvent(traceSessionIdRef.current, 'ai.transcript', { output: { text } });
                       optionsRef.current.onTranscript?.({ role: "ai", text });
                       if (text.includes("[BUG_SOLVED]") || text.includes("[PROBLEM_SOLVED]")) {
                         traceClient.traceEvent(traceSessionIdRef.current, 'hunt.bug.solved');
                         optionsRef.current.onBugSolved?.();
                       }
                     }
                   }
                 }
              }

            } catch (e) {
              console.error("[Hunt] Failed to parse SDK message", e);
            }
          },
          onerror: (err) => {
             console.error("[Hunt] SDK Error:", err);
             stopSession();
          },
          onclose: () => {
             console.log("[Hunt] SDK Session closed (server-initiated)");
             traceClient.traceEvent(traceSessionIdRef.current, 'ws.close');
             attemptReconnect();
          }
        }
      });
      
      sessionRef.current = session;
      bugContextRef.current = bugContext;
      reconnectCountRef.current = 0;

    } catch (error) {
      console.error("[Hunt] Failed to start:", error);
      throw error;
    }
  };

  // ── Auto-Reconnect ──

  const attemptReconnect = async () => {
    reconnectCountRef.current++;
    const attempt = reconnectCountRef.current;

    if (attempt > MAX_RECONNECTS) {
      console.warn(`[Hunt] Max reconnect attempts (${MAX_RECONNECTS}) reached — ending session`);
      stopSession();
      return;
    }

    const handle = resumptionHandleRef.current;
    if (!handle) {
      console.warn('[Hunt] No resumption handle available — cannot reconnect');
      stopSession();
      return;
    }

    console.log(`[Hunt] 🔄 Reconnecting (attempt ${attempt}/${MAX_RECONNECTS}) with handle: ${handle.slice(0, 20)}...`);
    setIsReconnecting(true);
    optionsRef.current.onReconnecting?.();
    sessionRef.current = null;

    try {
      const ephemeralToken = await fetchVoiceToken("hunt", { resumptionHandle: handle });
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
          systemInstruction: HUNT_VOICE_SYSTEM_PROMPT,
          tools: [{ googleSearch: {} }],
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
            console.log(`[Hunt] ✅ Reconnected (attempt ${attempt})`);
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
                console.warn(`[Hunt] ⚠️ GoAway received — timeLeft: ${data.goAway.timeLeft}`);
              }
              if (data.serverContent?.error) return;
              if (data.serverContent?.turnComplete) clearCompletedSources();
              if (data.serverContent?.interrupted) flushAudioQueue();
              if (data.serverContent?.modelTurn?.parts) {
                for (const part of data.serverContent.modelTurn.parts) {
                  if (part.inlineData?.mimeType?.startsWith("audio/pcm") || part.inlineData?.data) {
                    if (!aiMutedRef.current) playAudioChunk(part.inlineData.data);
                  }
                  if (part.text) {
                    fullTranscriptRef.current += `\nCoach: ${part.text}`;
                    optionsRef.current.onTranscript?.({ role: "ai", text: part.text });
                    if (part.text.includes("[BUG_SOLVED]")) {
                      optionsRef.current.onBugSolved?.();
                    }
                  }
                }
              }
            } catch (e) {
              console.error("[Hunt] Failed to parse SDK message (reconnect)", e);
            }
          },
          onerror: (err) => {
            console.error("[Hunt] SDK Error (reconnect):", err);
            setIsReconnecting(false);
            stopSession();
          },
          onclose: () => {
            console.log(`[Hunt] SDK Session closed again (server-initiated)`);
            attemptReconnect();
          }
        }
      });

      sessionRef.current = newSession;

    } catch (error) {
      console.error(`[Hunt] Reconnect attempt ${attempt} failed:`, error);
      setIsReconnecting(false);
      stopSession();
    }
  };

  return {
    isConnected, isRecording, isScreenSharing, isSpeaking, isReconnecting, isAiMuted,
    startSession, stopSession, toggleMicrophone, toggleAiAudio,
    startScreenShare: startPageCapture, stopScreenShare: stopPageCapture,
    sendText, sendCodeUpdate, postSessionReport
  };
}
