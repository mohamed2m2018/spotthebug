"use client";

import { useState, useRef, useCallback } from "react";

// Transcript message from voice session
export interface VoiceTranscript {
  role: "ai" | "user";
  text: string;
}

interface UseVoiceReturn {
  isConnected: boolean;
  isRecording: boolean;
  isScreenSharing: boolean;
  isSpeaking: boolean;
  startSession: (mode: "hunt" | "pair", bugContext?: string) => Promise<void>;
  stopSession: () => void;
  toggleMicrophone: () => void;
  sendText: (text: string) => void;
  sendCodeUpdate: (code: string) => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  volumeHistory: number[];
}

interface UseVoiceOptions {
  onTranscript?: (transcript: VoiceTranscript) => void;
  onBugSolved?: () => void;
}

export function useVoice(options: UseVoiceOptions = {}): UseVoiceReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volumeHistory, setVolumeHistory] = useState<number[]>([]);
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  
  // Audio playback queue
  const nextPlayTimeRef = useRef(0);
  const speakingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ── Utility: ArrayBuffer ⇄ Base64 ──

  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
    const binaryString = window.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  };

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

    // Track speaking state for avatar animation
    setIsSpeaking(true);
    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
    speakingTimerRef.current = setTimeout(() => {
      setIsSpeaking(false);
    }, audioBuffer.duration * 1000 + 500);
  };

  // ── Session Control ──

  const stopScreenShare = useCallback(() => {
    if (screenIntervalRef.current) {
      clearInterval(screenIntervalRef.current);
      screenIntervalRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
  }, []);

  const stopSession = useCallback(() => {
    stopScreenShare();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsConnected(false);
    setIsRecording(false);
  }, [stopScreenShare]);

  // ── Send text message through the live WebSocket ──

  const sendText = useCallback((text: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      clientContent: {
        turns: [{
          role: "user",
          parts: [{ text }]
        }],
        turnComplete: true
      }
    }));
  }, []);

  // ── Screen Share: capture frames and send to Gemini ──

  const startScreenShare = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1 },
        audio: false,
      });
      screenStreamRef.current = screenStream;
      setIsScreenSharing(true);

      // Create offscreen canvas for frame extraction
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d')!;

      // Create video element to read screen frames
      const video = document.createElement('video');
      video.srcObject = screenStream;
      video.muted = true;
      await video.play();

      // Send frame every ~1 second
      screenIntervalRef.current = setInterval(() => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;

        // Scale down for bandwidth (max 1024px wide)
        const scale = Math.min(1, 1024 / video.videoWidth);
        canvas.width = video.videoWidth * scale;
        canvas.height = video.videoHeight * scale;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Export as JPEG and send
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        const base64Data = dataUrl.split(',')[1];

        wsRef.current?.send(JSON.stringify({
          realtimeInput: {
            video: {
              data: base64Data,
              mimeType: 'image/jpeg'
            }
          }
        }));
      }, 1000);

      // Handle user stopping share via browser UI
      screenStream.getVideoTracks()[0].addEventListener('ended', () => {
        stopScreenShare();
      });

      // Notify Gemini to switch to screen-share pair-programming mode
      sendText("[SCREEN_SHARE_MODE] I'm now sharing my screen with you. You can see my code editor. Switch to pair programming mode: (1) Look at the code on my screen and describe what you see. (2) Review it for bugs, performance issues, or improvements. (3) When I ask questions, reference the specific code you see. (4) Be a helpful pair programmer, not a quiz master. Speak naturally as if sitting next to me.");

    } catch (err) {
      console.error('Screen share error:', err);
      setIsScreenSharing(false);
    }
  }, [stopScreenShare, sendText]);

  // ── Send code update to Gemini ──

  const sendCodeUpdate = useCallback((code: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      clientContent: {
        turns: [{
          role: "user",
          parts: [{ text: `[CODE_UPDATE] The developer edited the code. Here is their current version:\n\`\`\`\n${code}\n\`\`\`\nBriefly acknowledge you see their edit. If it fixes the bug, say so and include [BUG_SOLVED]. If not, give a gentle hint without revealing the answer.` }]
        }],
        turnComplete: true
      }
    }));
  }, []);

  // ── Start Session ──

  const startSession = async (mode: "hunt" | "pair", bugContext?: string) => {
    try {
      // 1. Get ephemeral token from our server
      const tokenRes = await fetch("/api/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const tokenData = await tokenRes.json();

      if (!tokenRes.ok) {
        throw new Error(tokenData.error || "Failed to get voice token");
      }

      const ephemeralToken = tokenData.token;

      // 2. Connect directly to Google's WebSocket
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${ephemeralToken}`;
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log("WebSocket connected, sending setup...");

        // 3. Send session config — ONLY setup, nothing else yet
        wsRef.current?.send(JSON.stringify({
          setup: {
            model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: "Kore" }
                }
              }
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          }
        }));
      };

      // Helper: start mic + send context (called AFTER setupComplete)
      const startMicAndContext = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
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

            let inputData = e.inputBuffer.getChannelData(0);

            // Downsample to 16kHz
            if (nativeSampleRate !== 16000) {
              const ratio = nativeSampleRate / 16000;
              const newLength = Math.floor(inputData.length / ratio);
              const downsampled = new Float32Array(newLength);
              for (let i = 0; i < newLength; i++) {
                downsampled[i] = inputData[Math.floor(i * ratio)];
              }
              inputData = downsampled;
            }

            // Volume visualizer
            let sum = 0;
            for (let i = 0; i < inputData.length; i++) {
              sum += inputData[i] * inputData[i];
            }
            const rms = Math.sqrt(sum / inputData.length);
            setVolumeHistory(prev => [...prev.slice(-20), rms]);

            // Convert Float32 to Int16 PCM
            const pcm16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]));
              pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            // Send audio to Gemini
            const base64Audio = arrayBufferToBase64(pcm16.buffer);
            wsRef.current?.send(JSON.stringify({
              realtimeInput: {
                audio: {
                  data: base64Audio,
                  mimeType: "audio/pcm;rate=16000"
                }
              }
            }));
          };

          // Send bug context to start the conversation
          const introText = bugContext
            ? `You are starting a SpotTheBug code review training session. Here is the buggy code the developer is looking at:\n\n${bugContext}\n\nIntroduce this code to the developer. Tell them to take their time reading it. Ask them what they notice. Be encouraging. Do NOT reveal the bug. When the developer correctly identifies and explains the bug, congratulate them and include exactly [BUG_SOLVED] in your response.`
            : "Hello! Please briefly introduce the SpotTheBug training session.";

          wsRef.current?.send(JSON.stringify({
            clientContent: {
              turns: [{
                role: "user",
                parts: [{ text: introText }]
              }],
              turnComplete: true
            }
          }));

        } catch (micError) {
          console.error("Microphone error:", micError);
          stopSession();
        }
      };

      // ── Handle incoming messages ──

      wsRef.current.onmessage = async (event) => {
        try {
          const rawData = event.data instanceof Blob 
            ? await event.data.text() 
            : event.data;
          const data = JSON.parse(rawData);

          // Audio chunks
          if (data.serverContent?.modelTurn?.parts) {
            for (const part of data.serverContent.modelTurn.parts) {
              if (part.inlineData?.mimeType?.startsWith("audio/pcm")) {
                playAudioChunk(part.inlineData.data);
              }
            }
          }

          // AI text transcript (what Gemini said)
          if (data.serverContent?.outputTranscription?.text) {
            const text = data.serverContent.outputTranscription.text;
            optionsRef.current.onTranscript?.({ role: "ai", text });

            // Check for bug solved marker
            if (text.includes("[BUG_SOLVED]")) {
              optionsRef.current.onBugSolved?.();
            }
          }

          // User speech transcript (what the user said via mic)
          if (data.serverContent?.inputTranscription?.text) {
            const text = data.serverContent.inputTranscription.text;
            optionsRef.current.onTranscript?.({ role: "user", text });
          }

          // Setup complete — NOW start mic and send context
          if (data.setupComplete) {
            console.log("Gemini Live session setup complete, starting mic...");
            setIsConnected(true);
            startMicAndContext();
          }
        } catch (e) {
          console.error("Failed to parse WS message", e);
        }
      };

      wsRef.current.onclose = () => {
        console.log("Gemini WebSocket closed");
        stopSession();
      };

      wsRef.current.onerror = (e) => {
        console.error("WebSocket error:", e);
        stopSession();
      };

    } catch (error) {
      console.error("Failed to start voice session:", error);
      stopSession();
    }
  };

  // ── Toggle Mic ──

  const toggleMicrophone = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsRecording(audioTrack.enabled);
      }
    }
  };

  return {
    isConnected,
    isRecording,
    isScreenSharing,
    isSpeaking,
    startSession,
    stopSession,
    toggleMicrophone,
    sendText,
    sendCodeUpdate,
    startScreenShare,
    stopScreenShare,
    volumeHistory,
  };
}
