"use client";

import { useState, useRef, useCallback } from "react";
import {
  fetchVoiceToken,
  arrayBufferToBase64,
  downsampleTo16k,
  float32ToInt16,
} from "@/lib/voiceUtils";
import { GoogleGenAI } from "@google/genai";
import type { Session } from "@google/genai";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { buildGroundedInstruction, PAIR_GREETING_PROMPT, PAIR_VOICE_SYSTEM_PROMPT } from "@/config/prompts";
import type { ReviewFinding } from "@/config/prompts";
import { readFileFromHandle } from "@/utils/workspaceReader";
import * as traceClient from "@/lib/traceClient";

export interface VoiceTranscript {
  role: "user" | "ai";
  text: string;
}

export interface PairSessionContext {
  tree?: string;
  goal?: string;
  projectName?: string;
  frameworks?: string[];
  dirHandle?: FileSystemDirectoryHandle;
  screenStream?: MediaStream;
  reviewFindings?: ReviewFinding[];
  selectedFiles?: string[];
  /** Pre-fetched ephemeral token — skips token fetch if provided */
  preAuthToken?: string;
}

interface UsePairVoiceOptions {
  onTranscript?: (t: VoiceTranscript) => void;
  onScreenShareEnd?: () => void;
  onFileRead?: (filePath: string) => void;
  onConnected?: () => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
}

export interface UsePairVoiceReturn {
  isConnected: boolean;
  isRecording: boolean;
  isScreenSharing: boolean;
  isSpeaking: boolean;
  isReconnecting: boolean;
  isAiMuted: boolean;
  startSession: (context?: PairSessionContext) => Promise<void>;
  stopSession: () => void;
  toggleMicrophone: () => void;
  toggleAiAudio: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  sendText: (text: string) => void;
}

export function usePairVoice(options: UsePairVoiceOptions = {}): UsePairVoiceReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isAiMuted, setIsAiMuted] = useState(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const sessionRef = useRef<Session | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const firstFrameSentRef = useRef(false);
  const onFirstFrameRef = useRef<(() => void) | null>(null);

  const {
    playAudioChunk, flushAudioQueue, clearCompletedSources,
    isSpeaking, audioContextRef,
  } = useAudioPlayback("[Pair]");

  // ── Diagnostic counters ──
  const frameCountRef = useRef(0);
  const micChunkCountRef = useRef(0);

  // ── Tracing session ID ──
  const traceSessionIdRef = useRef<string>("");

  // ── Session Resumption ──
  const resumptionHandleRef = useRef<string | undefined>(undefined);
  const sessionContextRef = useRef<PairSessionContext | undefined>(undefined);
  const reconnectCountRef = useRef(0);
  const MAX_RECONNECTS = 2;

  // ── AI Mute (pause AI audio output) ──
  const aiMutedRef = useRef(false);

  // ── Text Sending ──

  const sendText = useCallback((text: string) => {
    if (!sessionRef.current) return;
    sessionRef.current.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: true,
    });
  }, []);

  // ── Screen Share ──

  const stopScreenShare = useCallback(() => {
    if (screenIntervalRef.current) {
      clearInterval(screenIntervalRef.current);
      screenIntervalRef.current = null;
    }
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    setIsScreenSharing(false);
  }, []);

  // Shared screen capture setup — works with any MediaStream
  const setupScreenCapture = useCallback((screenStream: MediaStream) => {
    screenStreamRef.current = screenStream;
    setIsScreenSharing(true);

    const video = document.createElement('video');
    video.srcObject = screenStream;
    video.play();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    // Capture frames at 1fps
    firstFrameSentRef.current = false;
    screenIntervalRef.current = setInterval(() => {
      if (!sessionRef.current) {
        console.warn('[Pair] 📹 Frame skipped — Session not active');
        return;
      }
      if (video.videoWidth === 0) {
        console.warn('[Pair] 📹 Frame skipped — video not ready');
        return;
      }

      frameCountRef.current++;
      const frameNum = frameCountRef.current;

      const maxDim = 1536;
      const scale = Math.min(maxDim / video.videoWidth, maxDim / video.videoHeight, 1);
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/jpeg', 1.0);
      const base64Data = dataUrl.split(',')[1];
      const sizeKB = Math.round(base64Data.length / 1024);

      // Trace event (fire-and-forget)
      traceClient.traceEvent(traceSessionIdRef.current, 'screen.frame', {
        metadata: { frameNum, width: canvas.width, height: canvas.height, sizeKB },
      });

      // Send screen frame — guard against WebSocket closing between check and send
      try {
        sessionRef.current.sendRealtimeInput({ video: { mimeType: "image/jpeg", data: base64Data } });
      } catch {
        console.warn('[Pair] 📹 Frame send failed — session closed, stopping capture');
        stopScreenShare();
        return;
      }

      // First frame sent — fire callback so greeting is sent AFTER AI has screen
      if (!firstFrameSentRef.current) {
        firstFrameSentRef.current = true;
        traceClient.traceEvent(traceSessionIdRef.current, 'screen.firstFrame');
        onFirstFrameRef.current?.();
        onFirstFrameRef.current = null;
      }
    }, 1000);

    // Handle user stopping share via browser UI
    screenStream.getVideoTracks()[0].addEventListener('ended', () => {
      stopScreenShare();
      optionsRef.current.onScreenShareEnd?.();
    });
  }, [sendText, stopScreenShare]);

  const startScreenShare = useCallback(async () => {
    if (!sessionRef.current) return;

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: false,
      });
      setupScreenCapture(screenStream);
    } catch (err) {
      console.error('[Pair] Screen share error:', err);
      setIsScreenSharing(false);
    }
  }, [setupScreenCapture]);

  // ── Stop Session ──

  const stopSession = useCallback(() => {
    stopScreenShare();
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    
    // Close SDK session
    sessionRef.current = null;
    setIsConnected(false);
    setIsRecording(false);
    flushAudioQueue();

    // End trace (uses sendBeacon for reliability)
    if (traceSessionIdRef.current) {
      traceClient.endTrace(traceSessionIdRef.current);
      traceSessionIdRef.current = "";
    }
  }, [stopScreenShare, flushAudioQueue]);

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
          console.log("[Pair] 🔇 Sent audioStreamEnd (mic muted)");
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
      console.log("[Pair] ⏸️ AI audio paused");
    } else {
      console.log("[Pair] ▶️ AI audio resumed");
    }
  }, [flushAudioQueue]);

  // ── Start Session ──

  const startSession = async (context?: PairSessionContext) => {
    // Clean up any existing connection first
    if (sessionRef.current) {
      sessionRef.current = null;
    }

    try {
      // Use pre-fetched token if available (overlapped with screen share dialog),
      // otherwise fetch now (fallback for reconnects or direct calls)
      const ephemeralToken = context?.preAuthToken || await fetchVoiceToken("pair", {
        reviewFindings: context?.reviewFindings || undefined,
        selectedFiles: context?.selectedFiles || undefined,
        goal: context?.goal || undefined,
      });
      
      // Initialize the official Google GenAI SDK using the ephemeral token
      const ai = new GoogleGenAI({
        apiKey: ephemeralToken,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      // ── Start session trace ──
      traceSessionIdRef.current = traceClient.generateSessionId();
      traceClient.startTrace(traceSessionIdRef.current, "pair", {
        selectedMode: 'critic',
        projectName: context?.projectName,
        frameworks: context?.frameworks,
        hasWorkspace: !!context?.dirHandle,
        hasScreenStream: !!context?.screenStream,
        hasReviewFindings: !!(context?.reviewFindings?.length),
        reviewFindingsCount: context?.reviewFindings?.length || 0,
        selectedFilesCount: context?.selectedFiles?.length || 0,
        goal: context?.goal,
      });

      // Start mic config
      const startMic = async () => {
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
            micChunkCountRef.current++;
            // Log every 50th mic chunk to avoid spam
            if (micChunkCountRef.current % 50 === 0) {
              console.log(`[Pair] 🎤 Mic chunk #${micChunkCountRef.current} sent — ${pcm16.length} samples`);
            }
            
            // Send mic audio — guard against WebSocket closing between null check and send
            try {
              sessionRef.current.sendRealtimeInput({ audio: { mimeType: "audio/pcm;rate=16000", data: base64Audio } });
            } catch {
              // Session WebSocket closed — stop sending (stopSession will clean up fully)
              sessionRef.current = null;
            }
          };

          // Start screen capture FIRST — AI must see screen before speaking
          if (context?.screenStream) {
            // Register callback: send greeting only AFTER first frame is sent
            onFirstFrameRef.current = () => {
              const greetingPrompt = PAIR_GREETING_PROMPT;
              console.log(`[Pair] 📋 GREETING PROMPT (after first frame):\n${greetingPrompt}`);
              sessionRef.current?.sendClientContent({
                turns: [{ role: "user", parts: [{ text: greetingPrompt }] }],
                turnComplete: true,
              });
            };
            setupScreenCapture(context.screenStream);
          } else {
            // No screen stream — send greeting immediately (fallback)
            const greetingPrompt = PAIR_GREETING_PROMPT;
            console.log(`[Pair] 📋 GREETING PROMPT (no screen):\n${greetingPrompt}`);
            sessionRef.current?.sendClientContent({
              turns: [{ role: "user", parts: [{ text: greetingPrompt }] }],
              turnComplete: true,
            });
          }

        } catch (micError) {
          console.error("[Pair] Microphone error:", micError);
          stopSession();
        }
      };

      // Build system instruction: use grounded version (with review findings) if available,
      // otherwise use the base PAIR_VOICE_SYSTEM_PROMPT directly
      const systemInstruction = (context?.reviewFindings && context?.selectedFiles)
        ? buildGroundedInstruction(context.reviewFindings, context.selectedFiles, context?.goal)
        : PAIR_VOICE_SYSTEM_PROMPT;
      
      // Build tools array: readFile + Google Search grounding
      const toolDeclarations: any[] = [];
      
      // Always add Google Search for documentation grounding
      toolDeclarations.push({ googleSearch: {} });
      
      // Add readFile tool if workspace is available
      if (context?.dirHandle) {
        toolDeclarations.push({
          functionDeclarations: [{
            name: "readFile",
            description: "Read the full contents of a file from the developer's workspace. Use this when you see a file open on screen and want to review its code accurately. Also use it when the developer asks you to review a specific file.",
            parameters: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Relative path from the workspace root, e.g. src/hooks/usePairVoice.ts"
                }
              },
              required: ["filePath"]
            }
          }]
        });
      }

      // Ensure model format fits LiveClient requirements
      let sessionMessageCount = 0;
      
      const session = await ai.live.connect({
        model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: ["AUDIO"] as any,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }
          } as any,
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          tools: toolDeclarations.length > 0 ? toolDeclarations : undefined,
          sessionResumption: {},
          contextWindowCompression: {
            triggerTokens: "200000",
            slidingWindow: { targetTokens: "100000" },
          },
        },
        callbacks: {
          onopen: () => {
            console.log("[Pair] ✅ SDK Session Setup complete, starting mic...");
            traceClient.traceEvent(traceSessionIdRef.current, 'ws.open', {
              input: { systemInstruction },
              metadata: {
                systemInstructionLength: systemInstruction.length,
                hasReviewFindings: !!(context?.reviewFindings?.length),
                reviewFindingsCount: context?.reviewFindings?.length || 0,
                hasScreenStream: !!context?.screenStream,
                toolCount: toolDeclarations.length,
                usedGroundedInstruction: systemInstruction.includes('CONTEXT YOU ALREADY KNOW'),
              },
            });
            setIsConnected(true);
            traceClient.traceEvent(traceSessionIdRef.current, 'ws.setupComplete');
            startMic();
            optionsRef.current.onConnected?.();
          },
          onmessage: async (response: any) => {
            try {
              sessionMessageCount++;
              const data = response; 

              // Store session resumption updates
              if (data.sessionResumptionUpdate?.newHandle) {
                resumptionHandleRef.current = data.sessionResumptionUpdate.newHandle;
              }

              // GoAway warning — server will close soon
              if (data.goAway) {
                console.warn(`[Pair] ⚠️ GoAway received — timeLeft: ${data.goAway.timeLeft}`);
                traceClient.traceEvent(traceSessionIdRef.current, 'ws.goAway', {
                  metadata: { timeLeft: data.goAway.timeLeft },
                });
              }
              
              if (data.serverContent?.error) {
                console.error("[Pair] ❌ SDK Server error:", JSON.stringify(data.serverContent.error));
                return;
              }

              // ── Tool Call (readFile) ──
              if (data.serverContent?.modelTurn?.parts) {
                // Ignore normally here since we check toolCall below, but standard data comes here
              }

              if (data.serverContent?.toolCall?.functionCalls) {
                const toolNames = data.serverContent.toolCall.functionCalls.map((fc: { name: string; args?: Record<string, unknown> }) => ({ name: fc.name, args: fc.args }));
                traceClient.traceEvent(traceSessionIdRef.current, 'tool.call.received', {
                  input: { functions: toolNames },
                });

                const functionResponses: any[] = [];

                for (const fc of data.serverContent.toolCall.functionCalls) {
                  const toolSpanId = `tool_${fc.id || Date.now()}`;
                  traceClient.spanStart(traceSessionIdRef.current, `tool.${fc.name}`, toolSpanId, {
                    filePath: fc.args?.filePath, toolCallId: fc.id,
                  });

                  if (fc.name === 'readFile' && context?.dirHandle) {
                    const filePath = fc.args?.filePath as string;
                    console.log(`[Pair] 📖 AI requesting file: "${filePath}" from workspace "${context.dirHandle.name}"`);
                    optionsRef.current.onFileRead?.(filePath);

                    try {
                      const result = await readFileFromHandle(context.dirHandle, filePath);

                      if (result.content) {
                        traceClient.spanEnd(traceSessionIdRef.current, toolSpanId, { success: true, charCount: result.content.length });
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: { content: result.content }
                        });
                      } else {
                        traceClient.spanEnd(traceSessionIdRef.current, toolSpanId, { success: false, error: result.error });
                        functionResponses.push({
                          id: fc.id,
                          name: fc.name,
                          response: { error: result.error }
                        });
                      }
                    } catch (readErr) {
                      const errMsg = readErr instanceof Error ? `${readErr.name}: ${readErr.message}` : String(readErr);
                      console.error(`[Pair] 📖 ❌ readFileFromHandle threw for "${filePath}":`, readErr);
                      traceClient.spanEnd(traceSessionIdRef.current, toolSpanId, { success: false, error: errMsg });
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { error: `Exception reading file: ${errMsg}` }
                      });
                    }
                  } else if (fc.name === 'readFile' && !context?.dirHandle) {
                    console.error(`[Pair] 📖 ❌ readFile called but NO dirHandle!`);
                    traceClient.spanEnd(traceSessionIdRef.current, toolSpanId, { success: false, error: 'No workspace folder' });
                    functionResponses.push({
                      id: fc.id,
                      name: fc.name,
                      response: { error: 'No workspace folder was provided. The readFile tool is unavailable.' }
                    });
                  } else {
                    console.warn(`[Pair] 🔧 Unknown function called: ${fc.name}`);
                    traceClient.spanEnd(traceSessionIdRef.current, toolSpanId, { success: false, error: `Unknown function: ${fc.name}` });
                    functionResponses.push({
                      id: fc.id,
                      name: fc.name,
                      response: { error: `Unknown function: ${fc.name}` }
                    });
                  }
                }

                // Send tool responses back via SDK
                console.log(`[Pair] 🔧 Sending SDK tool response`);
                sessionRef.current?.sendToolResponse({ functionResponses });
                return;
              }

              // Turn complete
              if (data.serverContent?.turnComplete) {
                clearCompletedSources();
                console.log(`[Pair] 🔄 Turn complete`);
              }

              // Interrupted (user spoke while AI was talking)
              if (data.serverContent?.interrupted) {
                flushAudioQueue();
                traceClient.traceEvent(traceSessionIdRef.current, 'ai.interrupted', {
                  metadata: { micChunks: micChunkCountRef.current, frames: frameCountRef.current },
                });
              }

              // Audio chunks
              if (data.serverContent?.modelTurn?.parts) {
                let audioPartsCount = 0;
                for (const part of data.serverContent.modelTurn.parts) {
                  // The SDK abstracts the message structure, the audio data comes back as part.inlineData
                  if (part.inlineData?.mimeType?.startsWith("audio/pcm") || part.inlineData?.data) {
                    audioPartsCount++;
                    // Decode base64 to arraybuffer if needed (SDK returns string data)
                    if (!aiMutedRef.current) playAudioChunk(part.inlineData.data);
                  }
                }
              }

              // AI transcript
              if (data.serverContent?.modelTurn?.parts) {
                 for (const part of data.serverContent.modelTurn.parts) {
                    if (part.text) {
                      traceClient.traceEvent(traceSessionIdRef.current, 'ai.transcript', {
                        output: { text: part.text },
                      });
                      optionsRef.current.onTranscript?.({ role: "ai", text: part.text });
                    }
                 }
              }

            } catch (e) {
              console.error("[Pair] Failed to parse SDK message", e);
            }
          },
          onerror: (err) => {
             console.error("[Pair] SDK Error:", err);
             stopSession();
          },
           onclose: () => {
              console.log(`[Pair] SDK Session closed (server-initiated)`);
              traceClient.traceEvent(traceSessionIdRef.current, 'ws.close', { metadata: { source: "sdk" } });
              // Attempt reconnect instead of killing the session
              attemptReconnect();
           }
        }
      });
      
      sessionRef.current = session;
      sessionContextRef.current = context;
      reconnectCountRef.current = 0;

    } catch (error) {
      console.error("[Pair] Failed to start:", error);
      throw error;
    }
  };

  // ── Auto-Reconnect ──

  const attemptReconnect = async () => {
    reconnectCountRef.current++;
    const attempt = reconnectCountRef.current;

    if (attempt > MAX_RECONNECTS) {
      console.warn(`[Pair] Max reconnect attempts (${MAX_RECONNECTS}) reached — ending session`);
      stopSession();
      return;
    }

    const handle = resumptionHandleRef.current;
    if (!handle) {
      console.warn('[Pair] No resumption handle available — cannot reconnect');
      stopSession();
      return;
    }

    console.log(`[Pair] 🔄 Reconnecting (attempt ${attempt}/${MAX_RECONNECTS}) with handle: ${handle.slice(0, 20)}...`);
    setIsReconnecting(true);
    optionsRef.current.onReconnecting?.();

    // Null the old session so mic/screen pause (guards check sessionRef)
    sessionRef.current = null;

    try {
      const ctx = sessionContextRef.current;

      // Get a new ephemeral token with the resumption handle
      const ephemeralToken = await fetchVoiceToken("pair", {
        reviewFindings: ctx?.reviewFindings || undefined,
        selectedFiles: ctx?.selectedFiles || undefined,
        goal: ctx?.goal || undefined,
        resumptionHandle: handle,
      });

      const ai = new GoogleGenAI({
        apiKey: ephemeralToken,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      traceClient.traceEvent(traceSessionIdRef.current, 'ws.reconnect', {
        metadata: { attempt, handle: handle.slice(0, 20) },
      });

      // Build same system instruction as original session
      const systemInstruction = (ctx?.reviewFindings && ctx?.selectedFiles)
        ? buildGroundedInstruction(ctx.reviewFindings, ctx.selectedFiles, ctx?.goal)
        : PAIR_VOICE_SYSTEM_PROMPT;

      // Build same tools
      const toolDeclarations: any[] = [{ googleSearch: {} }];
      if (ctx?.dirHandle) {
        toolDeclarations.push({
          functionDeclarations: [{
            name: "readFile",
            description: "Read the full contents of a file from the developer's workspace.",
            parameters: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Relative path from the workspace root, e.g. src/hooks/usePairVoice.ts"
                }
              },
              required: ["filePath"]
            }
          }]
        });
      }

      const newSession = await ai.live.connect({
        model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: ["AUDIO"] as any,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }
          } as any,
          systemInstruction: { parts: [{ text: systemInstruction }] },
          tools: toolDeclarations.length > 0 ? toolDeclarations : undefined,
          sessionResumption: {
            handle,
          },
          contextWindowCompression: {
            triggerTokens: "200000",
            slidingWindow: { targetTokens: "100000" },
          },
        },
        callbacks: {
          onopen: () => {
            console.log(`[Pair] ✅ Reconnected (attempt ${attempt})`);
            traceClient.traceEvent(traceSessionIdRef.current, 'ws.reconnected', { metadata: { attempt } });
            setIsReconnecting(false);
            setIsConnected(true);
            optionsRef.current.onReconnected?.();
          },
          // Reuse the same message handler — it's the same for reconnects
          onmessage: async (response: any) => {
            try {
              const data = response;

              // Store session resumption updates
              if (data.sessionResumptionUpdate?.newHandle) {
                resumptionHandleRef.current = data.sessionResumptionUpdate.newHandle;
              }

              // GoAway warning
              if (data.goAway) {
                console.warn(`[Pair] ⚠️ GoAway received — timeLeft: ${data.goAway.timeLeft}`);
                traceClient.traceEvent(traceSessionIdRef.current, 'ws.goAway', {
                  metadata: { timeLeft: data.goAway.timeLeft },
                });
              }

              if (data.serverContent?.error) {
                console.error("[Pair] ❌ SDK Server error:", JSON.stringify(data.serverContent.error));
                return;
              }

              if (data.serverContent?.toolCall?.functionCalls) {
                const functionResponses: any[] = [];
                for (const fc of data.serverContent.toolCall.functionCalls) {
                  if (fc.name === 'readFile' && ctx?.dirHandle) {
                    try {
                      const result = await readFileFromHandle(ctx.dirHandle, fc.args?.filePath as string);
                      functionResponses.push({ id: fc.id, name: fc.name, response: result.content ? { content: result.content } : { error: result.error } });
                    } catch (readErr) {
                      functionResponses.push({ id: fc.id, name: fc.name, response: { error: String(readErr) } });
                    }
                  } else {
                    functionResponses.push({ id: fc.id, name: fc.name, response: { error: `Unknown function or no workspace: ${fc.name}` } });
                  }
                }
                sessionRef.current?.sendToolResponse({ functionResponses });
                return;
              }

              if (data.serverContent?.turnComplete) clearCompletedSources();
              if (data.serverContent?.interrupted) flushAudioQueue();

              if (data.serverContent?.modelTurn?.parts) {
                for (const part of data.serverContent.modelTurn.parts) {
                  if (part.inlineData?.mimeType?.startsWith("audio/pcm") || part.inlineData?.data) {
                    if (!aiMutedRef.current) playAudioChunk(part.inlineData.data);
                  }
                  if (part.text) {
                    optionsRef.current.onTranscript?.({ role: "ai", text: part.text });
                  }
                }
              }
            } catch (e) {
              console.error("[Pair] Failed to parse SDK message (reconnect)", e);
            }
          },
          onerror: (err) => {
            console.error("[Pair] SDK Error (reconnect):", err);
            setIsReconnecting(false);
            stopSession();
          },
          onclose: () => {
            console.log(`[Pair] SDK Session closed again (server-initiated)`);
            traceClient.traceEvent(traceSessionIdRef.current, 'ws.close', { metadata: { source: "sdk", reconnectAttempt: attempt } });
            attemptReconnect();
          }
        }
      });

      // Swap session ref — mic/screen will resume sending automatically
      sessionRef.current = newSession;

    } catch (error) {
      console.error(`[Pair] Reconnect attempt ${attempt} failed:`, error);
      setIsReconnecting(false);
      stopSession();
    }
  };

  return {
    isConnected, isRecording, isScreenSharing, isSpeaking, isReconnecting, isAiMuted,
    startSession, stopSession, toggleMicrophone, toggleAiAudio,
    startScreenShare, stopScreenShare, sendText,
  };
}
