"use client";

import { useState, useRef, useCallback } from "react";
import {
  fetchVoiceToken, buildWsUrl, arrayBufferToBase64,
  base64ToArrayBuffer, downsampleTo16k, float32ToInt16,
} from "@/lib/voiceUtils";
import { getSystemInstruction, ReviewMode, DEFAULT_MODE } from "@/config/reviewModes";

export interface VoiceTranscript {
  role: "user" | "ai";
  text: string;
}

export interface PairSessionContext {
  tree?: string;
  goal?: string;
  projectName?: string;
  frameworks?: string[];
  mode?: ReviewMode;
}

interface UsePairVoiceOptions {
  onTranscript?: (t: VoiceTranscript) => void;
}

export interface UsePairVoiceReturn {
  isConnected: boolean;
  isRecording: boolean;
  isScreenSharing: boolean;
  isSpeaking: boolean;
  startSession: (context?: PairSessionContext) => Promise<void>;
  stopSession: () => void;
  toggleMicrophone: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  sendText: (text: string) => void;
}

export function usePairVoice(options: UsePairVoiceOptions = {}): UsePairVoiceReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef(0);
  const speakingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // ── Diagnostic counters ──
  const audioChunkCountRef = useRef(0);
  const frameCountRef = useRef(0);
  const micChunkCountRef = useRef(0);

  // ── Audio Playback ──

  const playAudioChunk = (base64Audio: string) => {
    audioChunkCountRef.current++;
    const chunkNum = audioChunkCountRef.current;

    if (!audioContextRef.current) {
      console.warn(`[Pair] ⚠️ Audio chunk #${chunkNum} SKIPPED — no AudioContext`);
      return;
    }
    const ctx = audioContextRef.current;

    if (ctx.state === 'suspended') {
      console.warn(`[Pair] ⚠️ AudioContext is SUSPENDED, attempting resume...`);
      ctx.resume();
    }

    const arrayBuffer = base64ToArrayBuffer(base64Audio);
    const int16Array = new Int16Array(arrayBuffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }
    const audioBuffer = ctx.createBuffer(1, float32Array.length, 24000);
    audioBuffer.getChannelData(0).set(float32Array);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    const currentTime = ctx.currentTime;
    if (nextPlayTimeRef.current < currentTime) {
      nextPlayTimeRef.current = currentTime;
    }
    source.start(nextPlayTimeRef.current);
    const scheduledDuration = audioBuffer.duration;
    nextPlayTimeRef.current += scheduledDuration;

    console.log(`[Pair] 🔊 Audio chunk #${chunkNum} PLAYED — ${int16Array.length} samples, ${scheduledDuration.toFixed(3)}s duration, ctx.state=${ctx.state}`);

    setIsSpeaking(true);
    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
    speakingTimerRef.current = setTimeout(() => {
      setIsSpeaking(false);
    }, scheduledDuration * 1000 + 500);
  };

  // ── Text Sending ──

  const sendText = useCallback((text: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      },
    }));
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

  const startScreenShare = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: false,
      });
      screenStreamRef.current = screenStream;
      setIsScreenSharing(true);

      const video = document.createElement('video');
      video.srcObject = screenStream;
      video.play();

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;

      // Capture frames at 1fps
      screenIntervalRef.current = setInterval(() => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          console.warn('[Pair] 📹 Frame skipped — WS not open');
          return;
        }
        if (video.videoWidth === 0) {
          console.warn('[Pair] 📹 Frame skipped — video not ready');
          return;
        }

        frameCountRef.current++;
        const frameNum = frameCountRef.current;

        const maxDim = 1024;
        const scale = Math.min(maxDim / video.videoWidth, maxDim / video.videoHeight, 1);
        canvas.width = video.videoWidth * scale;
        canvas.height = video.videoHeight * scale;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        const base64Data = dataUrl.split(',')[1];

        console.log(`[Pair] 📹 Frame #${frameNum} sent — ${canvas.width}x${canvas.height}, ${(base64Data.length / 1024).toFixed(0)}KB`);

        wsRef.current?.send(JSON.stringify({
          realtimeInput: {
            video: { data: base64Data, mimeType: 'image/jpeg' }
          }
        }));
      }, 1000);

      // Handle user stopping share via browser UI
      screenStream.getVideoTracks()[0].addEventListener('ended', () => {
        stopScreenShare();
      });

      // Tell AI that screen sharing has started
      sendText("[SCREEN_SHARE_STARTED] I'm now sharing my screen. You should be receiving video frames. Describe what you see on my screen to confirm you can see it. Then review any code that's visible.");

    } catch (err) {
      console.error('[Pair] Screen share error:', err);
      setIsScreenSharing(false);
    }
  }, [sendText, stopScreenShare]);

  // ── Stop Session ──

  const stopSession = useCallback(() => {
    stopScreenShare();
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    setIsConnected(false);
    setIsRecording(false);
    setIsSpeaking(false);
  }, [stopScreenShare]);

  // ── Toggle Microphone ──

  const toggleMicrophone = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsRecording(track.enabled);
    }
  }, []);

  // ── Start Session ──

  const startSession = async (context?: PairSessionContext) => {
    // Clean up any existing connection first
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const token = await fetchVoiceToken("pair");
      wsRef.current = new WebSocket(buildWsUrl(token));

      wsRef.current.onopen = (event) => {
        const ws = event.target as WebSocket;
        console.log("[Pair] WebSocket open, sending setup...");
        const selectedMode = context?.mode || DEFAULT_MODE;
        console.log(`[Pair] Mode: ${selectedMode}`);
        ws.send(JSON.stringify({
          setup: {
            model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }
              }
            },
            systemInstruction: {
              parts: [{ text: getSystemInstruction(selectedMode) }],
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            proactivity: { proactiveAudio: true },
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
                endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
              },
            },
          }
        }));
      };

      // Start mic after setup completes
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
            if (wsRef.current?.readyState !== WebSocket.OPEN) return;
            const inputData = downsampleTo16k(e.inputBuffer.getChannelData(0), nativeSampleRate);
            const pcm16 = float32ToInt16(inputData);
            const base64Audio = arrayBufferToBase64(pcm16.buffer as ArrayBuffer);
            micChunkCountRef.current++;
            // Log every 50th mic chunk to avoid spam
            if (micChunkCountRef.current % 50 === 0) {
              console.log(`[Pair] 🎤 Mic chunk #${micChunkCountRef.current} sent — ${pcm16.length} samples`);
            }
            wsRef.current?.send(JSON.stringify({
              realtimeInput: { audio: { data: base64Audio, mimeType: "audio/pcm;rate=16000" } }
            }));
          };

          // Build context-aware greeting
          let greetingPrompt = "";
          if (context?.tree && context?.goal) {
            greetingPrompt = `[SESSION_CONTEXT]\nProject: ${context.projectName || "Unknown"}\nFrameworks: ${context.frameworks?.join(", ") || "Unknown"}\n\nProject structure:\n${context.tree}\n\nDeveloper's current task: ${context.goal}\n\nYou now know the project structure and what they're working on. Start the session by acknowledging the project (mention the framework and structure briefly), then ask a specific question about their current task. Be warm and curious. One short paragraph.`;
          } else if (context?.tree) {
            greetingPrompt = `[SESSION_CONTEXT]\nProject: ${context.projectName || "Unknown"}\nFrameworks: ${context.frameworks?.join(", ") || "Unknown"}\n\nProject structure:\n${context.tree}\n\nStart the session by commenting on the project structure you see. Ask what they're currently working on. Be warm and curious. One short paragraph.`;
          } else if (context?.goal) {
            greetingPrompt = `[SESSION_CONTEXT]\nDeveloper's current task: ${context.goal}\n\nStart the session by acknowledging what they're working on. Suggest they share their screen so you can see the code. Be warm and curious. One short paragraph.`;
          } else {
            greetingPrompt = `Start our pair programming session. Greet me casually like a senior developer colleague who just sat down next to me. Ask what I'm building, what the codebase is about, and suggest I share my screen so you can take a look at the code together. Be warm and genuinely curious. One short paragraph max.`;
          }

          wsRef.current?.send(JSON.stringify({
            clientContent: {
              turns: [{ role: "user", parts: [{ text: greetingPrompt }] }],
              turnComplete: true,
            }
          }));

        } catch (micError) {
          console.error("[Pair] Microphone error:", micError);
          stopSession();
        }
      };

      // ── Message handler ──
      let wsMessageCount = 0;
      wsRef.current.onmessage = async (event) => {
        try {
          wsMessageCount++;
          const rawData = event.data instanceof Blob ? await event.data.text() : event.data;
          const data = JSON.parse(rawData);

          // Classify the message type for logging
          const msgTypes: string[] = [];
          if (data.setupComplete) msgTypes.push('setupComplete');
          if (data.error) msgTypes.push('ERROR');
          if (data.serverContent?.turnComplete) msgTypes.push('turnComplete');
          if (data.serverContent?.interrupted) msgTypes.push('interrupted');
          if (data.serverContent?.modelTurn?.parts) {
            const partTypes = data.serverContent.modelTurn.parts.map(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (p: any) => p.inlineData ? `audio(${p.inlineData.mimeType})` : p.text ? 'text' : 'unknown'
            );
            msgTypes.push(`modelTurn[${partTypes.join(',')}]`);
          }
          if (data.serverContent?.outputTranscription) msgTypes.push('outputTranscription');
          if (data.serverContent?.inputTranscription) msgTypes.push('inputTranscription');
          if (msgTypes.length === 0) msgTypes.push('other');

          console.log(`[Pair] 📨 WS msg #${wsMessageCount}: ${msgTypes.join(' + ')}`);

          if (data.setupComplete) {
            console.log("[Pair] ✅ Setup complete, starting mic...");
            setIsConnected(true);
            startMic();
            return;
          }

          // Server error
          if (data.error) {
            console.error("[Pair] ❌ Server error:", JSON.stringify(data.error));
            return;
          }

          // Turn complete
          if (data.serverContent?.turnComplete) {
            console.log(`[Pair] 🔄 Turn complete — total audio chunks played so far: ${audioChunkCountRef.current}`);
          }

          // Interrupted (user spoke while AI was talking)
          if (data.serverContent?.interrupted) {
            console.warn(`[Pair] 🗣️ INTERRUPTED — the model was cut off. Audio chunks so far: ${audioChunkCountRef.current}, mic chunks: ${micChunkCountRef.current}, video frames: ${frameCountRef.current}`);
          }

          // Audio chunks
          if (data.serverContent?.modelTurn?.parts) {
            let audioPartsCount = 0;
            let nonAudioParts = 0;
            for (const part of data.serverContent.modelTurn.parts) {
              if (part.inlineData?.mimeType?.startsWith("audio/pcm")) {
                audioPartsCount++;
                playAudioChunk(part.inlineData.data);
              } else {
                nonAudioParts++;
                console.log('[Pair] 📦 Non-audio part in modelTurn:', JSON.stringify(part).slice(0, 200));
              }
            }
            if (audioPartsCount === 0) {
              console.warn(`[Pair] ⚠️ modelTurn had ${nonAudioParts} parts but ZERO audio parts`);
            }
          }

          // AI transcript
          if (data.serverContent?.outputTranscription?.text) {
            const text = data.serverContent.outputTranscription.text;
            console.log("[Pair] 🤖 AI:", text);
            optionsRef.current.onTranscript?.({ role: "ai", text });
          }

          // User transcript
          if (data.serverContent?.inputTranscription?.text) {
            const text = data.serverContent.inputTranscription.text;
            console.log("[Pair] 👤 User:", text);
            optionsRef.current.onTranscript?.({ role: "user", text });
          }

          // Log any unhandled top-level keys
          const knownKeys = new Set(['setupComplete', 'error', 'serverContent']);
          const unknownKeys = Object.keys(data).filter(k => !knownKeys.has(k));
          if (unknownKeys.length > 0) {
            console.warn('[Pair] ⚠️ Unknown WS message keys:', unknownKeys, JSON.stringify(data).slice(0, 300));
          }
        } catch (e) {
          console.error("[Pair] Failed to parse WS message", e);
        }
      };

      wsRef.current.onclose = (event) => {
        console.log(`[Pair] WebSocket closed — code: ${event.code}, reason: "${event.reason}", clean: ${event.wasClean}`);
        setIsConnected(false);
        setIsRecording(false);
      };

      wsRef.current.onerror = (err) => {
        console.error("[Pair] WebSocket error:", err);
        stopSession();
      };

    } catch (error) {
      console.error("[Pair] Failed to start:", error);
      throw error;
    }
  };

  return {
    isConnected, isRecording, isScreenSharing, isSpeaking,
    startSession, stopSession, toggleMicrophone,
    startScreenShare, stopScreenShare, sendText,
  };
}
