"use client";

import { useState, useRef, useCallback } from "react";
import { base64ToArrayBuffer } from "@/lib/voiceUtils";

/**
 * Shared audio playback engine used by both hunt and pair voice hooks.
 * Handles: PCM decoding, scheduled playback, source tracking, and flush on interruption.
 */

export interface UseAudioPlaybackReturn {
  /** Decode and schedule a base64 PCM audio chunk for playback */
  playAudioChunk: (base64Audio: string) => void;
  /** Immediately stop all scheduled audio (call on interruption) */
  flushAudioQueue: () => void;
  /** Clear source refs without stopping (call on turnComplete) */
  clearCompletedSources: () => void;
  /** Whether the AI is currently speaking */
  isSpeaking: boolean;
  /** Shared AudioContext ref — used by mic setup in consuming hooks */
  audioContextRef: React.MutableRefObject<AudioContext | null>;
}

export function useAudioPlayback(logPrefix: string = "[Voice]"): UseAudioPlaybackReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const speakingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const chunkCountRef = useRef(0);

  const playAudioChunk = useCallback((base64Audio: string) => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;

    if (ctx.state === "suspended") {
      ctx.resume();
    }

    chunkCountRef.current++;
    const chunkNum = chunkCountRef.current;

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

    activeSourcesRef.current.push(source);
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
    };

    const currentTime = ctx.currentTime;
    if (nextPlayTimeRef.current < currentTime) {
      nextPlayTimeRef.current = currentTime;
    }
    source.start(nextPlayTimeRef.current);
    const scheduledDuration = audioBuffer.duration;
    nextPlayTimeRef.current += scheduledDuration;

    // Reduce console spam — only log every 20th chunk
    if (chunkCountRef.current % 20 === 0) {
      console.log(`${logPrefix} 🔊 Audio chunk #${chunkNum} — ${int16Array.length} samples, ${scheduledDuration.toFixed(3)}s`);
    }

    setIsSpeaking(true);
    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
    speakingTimerRef.current = setTimeout(() => {
      setIsSpeaking(false);
    }, scheduledDuration * 1000 + 500);
  }, [logPrefix]);

  const flushAudioQueue = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
    setIsSpeaking(false);
    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
    console.log(`${logPrefix} 🧹 Audio queue flushed — all scheduled audio stopped`);
  }, [logPrefix]);

  const clearCompletedSources = useCallback(() => {
    activeSourcesRef.current = [];
  }, []);

  return {
    playAudioChunk,
    flushAudioQueue,
    clearCompletedSources,
    isSpeaking,
    audioContextRef,
  };
}
