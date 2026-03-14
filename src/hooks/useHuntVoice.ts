"use client";

import { useState, useRef, useCallback } from "react";
import {
  fetchVoiceToken, buildWsUrl, arrayBufferToBase64,
  base64ToArrayBuffer, downsampleTo16k, float32ToInt16,
} from "@/lib/voiceUtils";

export interface VoiceTranscript {
  role: "user" | "ai";
  text: string;
}

interface UseHuntVoiceOptions {
  onTranscript?: (t: VoiceTranscript) => void;
  onBugSolved?: () => void;
}

export interface UseHuntVoiceReturn {
  isConnected: boolean;
  isRecording: boolean;
  isSpeaking: boolean;
  startSession: (bugContext?: string) => Promise<void>;
  stopSession: () => void;
  toggleMicrophone: () => void;
  sendText: (text: string) => void;
  sendCodeUpdate: (code: string) => void;
}

export function useHuntVoice(options: UseHuntVoiceOptions = {}): UseHuntVoiceReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef(0);
  const speakingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ── Audio Playback ──

  const playAudioChunk = (base64Audio: string) => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;
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
    nextPlayTimeRef.current += audioBuffer.duration;

    setIsSpeaking(true);
    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
    speakingTimerRef.current = setTimeout(() => {
      setIsSpeaking(false);
    }, audioBuffer.duration * 1000 + 500);
  };

  // ── Text / Code Sending ──

  const sendText = useCallback((text: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      },
    }));
  }, []);

  const sendCodeUpdate = useCallback((code: string) => {
    sendText(`[CODE_UPDATE] The developer edited the code:\n\`\`\`\n${code}\n\`\`\``);
  }, [sendText]);

  // ── Stop Session ──

  const stopSession = useCallback(() => {
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
  }, []);

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

  const startSession = async (bugContext?: string) => {
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
      const token = await fetchVoiceToken("hunt");
      wsRef.current = new WebSocket(buildWsUrl(token));

      wsRef.current.onopen = (event) => {
        const ws = event.target as WebSocket;
        console.log("[Hunt] WebSocket open, sending setup...");
        ws.send(JSON.stringify({
          setup: {
            model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }
              }
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          }
        }));
      };

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
            if (wsRef.current?.readyState !== WebSocket.OPEN) return;
            const inputData = downsampleTo16k(e.inputBuffer.getChannelData(0), nativeSampleRate);
            const pcm16 = float32ToInt16(inputData);
            const base64Audio = arrayBufferToBase64(pcm16.buffer as ArrayBuffer);
            wsRef.current?.send(JSON.stringify({
              realtimeInput: { audio: { data: base64Audio, mimeType: "audio/pcm;rate=16000" } }
            }));
          };

          // Send bug context
          const introText = bugContext
            ? `You are starting a SpotTheBug code review training session. Here is the buggy code:\n\n${bugContext}\n\nIntroduce this code to the developer. Tell them to take their time reading it. Ask them what they notice. Be encouraging. Do NOT reveal the bug. When the developer correctly identifies and explains the bug, congratulate them and include exactly [BUG_SOLVED] in your response.`
            : "Hello! Briefly introduce the SpotTheBug training session.";

          wsRef.current?.send(JSON.stringify({
            clientContent: {
              turns: [{ role: "user", parts: [{ text: introText }] }],
              turnComplete: true,
            }
          }));
        } catch (micError) {
          console.error("[Hunt] Microphone error:", micError);
          stopSession();
        }
      };

      // ── Message handler ──
      wsRef.current.onmessage = async (event) => {
        try {
          const rawData = event.data instanceof Blob ? await event.data.text() : event.data;
          const data = JSON.parse(rawData);

          if (data.setupComplete) {
            console.log("[Hunt] Setup complete, starting mic...");
            setIsConnected(true);
            startMicAndContext();
          }

          if (data.serverContent?.modelTurn?.parts) {
            for (const part of data.serverContent.modelTurn.parts) {
              if (part.inlineData?.mimeType?.startsWith("audio/pcm")) {
                playAudioChunk(part.inlineData.data);
              }
            }
          }

          if (data.serverContent?.outputTranscription?.text) {
            const text = data.serverContent.outputTranscription.text;
            optionsRef.current.onTranscript?.({ role: "ai", text });
            if (text.includes("[BUG_SOLVED]")) {
              optionsRef.current.onBugSolved?.();
            }
          }

          if (data.serverContent?.inputTranscription?.text) {
            optionsRef.current.onTranscript?.({ role: "user", text: data.serverContent.inputTranscription.text });
          }
        } catch (e) {
          console.error("[Hunt] Failed to parse WS message", e);
        }
      };

      wsRef.current.onclose = () => {
        console.log("[Hunt] WebSocket closed");
        setIsConnected(false);
        setIsRecording(false);
      };

      wsRef.current.onerror = (err) => {
        console.error("[Hunt] WebSocket error:", err);
        stopSession();
      };

    } catch (error) {
      console.error("[Hunt] Failed to start:", error);
      throw error;
    }
  };

  return {
    isConnected, isRecording, isSpeaking,
    startSession, stopSession, toggleMicrophone,
    sendText, sendCodeUpdate,
  };
}
