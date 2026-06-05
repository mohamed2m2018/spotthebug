/**
 * Single source of truth for the Gemini Live (real-voice) model.
 *
 * Latest native-audio / audio-to-audio model. Replaces
 * gemini-2.5-flash-native-audio-preview-12-2025, which returned WebSocket
 * code=1011 ("Internal error encountered") mid-turn at ~80% rate from
 * 2026-05-27 onward. 3.1-flash-live keeps the same Live API surface:
 * 16kHz PCM in / 24kHz out, AUDIO modality, speechConfig prebuilt voices,
 * outputAudioTranscription, search grounding, function calling.
 *
 * Constrained ephemeral tokens LOCK the model — the value baked into the
 * token (VOICE_MODEL) and the value passed to ai.live.connect()
 * (VOICE_MODEL_PATH) must refer to the same model, so both derive from here.
 */
export const VOICE_MODEL = "gemini-3.1-flash-live-preview";

/** With the `models/` prefix required by ai.live.connect(). */
export const VOICE_MODEL_PATH = `models/${VOICE_MODEL}`;

/** Prebuilt voice used across all sessions. */
export const VOICE_NAME = "Kore";
