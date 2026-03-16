/**
 * Shared voice utilities — pure functions used by both hunt and pair hooks.
 * No React state or hooks here.
 */

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Fetch ephemeral token from our API, optionally including review context */
export async function fetchVoiceToken(
  mode: "hunt" | "pair" | "solve",
  dynamicContext?: {
    reviewFindings?: unknown[];
    selectedFiles?: string[];
    goal?: string;
    resumptionHandle?: string;
  }
): Promise<string> {
  const res = await fetch("/api/voice/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      ...(dynamicContext?.reviewFindings && { reviewFindings: dynamicContext.reviewFindings }),
      ...(dynamicContext?.selectedFiles && { selectedFiles: dynamicContext.selectedFiles }),
      ...(dynamicContext?.goal && { goal: dynamicContext.goal }),
      ...(dynamicContext?.resumptionHandle && { resumptionHandle: dynamicContext.resumptionHandle }),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to get voice token");
  return data.token;
}

/** Build WebSocket URL for Gemini Live API */
export function buildWsUrl(token: string): string {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${token}`;
}

/** Downsample Float32 audio data from native rate to 16kHz */
export function downsampleTo16k(inputData: Float32Array, nativeSampleRate: number): Float32Array {
  if (nativeSampleRate === 16000) return inputData;
  const ratio = nativeSampleRate / 16000;
  const newLength = Math.floor(inputData.length / ratio);
  const downsampled = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    downsampled[i] = inputData[Math.floor(i * ratio)];
  }
  return downsampled;
}

/** Convert Float32 audio to Int16 PCM */
export function float32ToInt16(input: Float32Array): Int16Array {
  const pcm16 = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return pcm16;
}
