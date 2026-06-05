"use client";

/**
 * Save & resume a teaching session. Persists the session snapshot (mode, topic,
 * editor code, transcript, syllabus position) in localStorage so the learner can
 * close the app and pick up where they left off.
 *
 * The live voice connection itself cannot resume after a long gap (the Gemini
 * resumption handle is short-lived), so resuming restores the UI + progress and
 * starts a fresh voice session that continues the same topic.
 */

import { useEffect, useState } from "react";
import type { SolveMode } from "@/hooks/useProblemSolvingVoice";

export interface SavedMessage {
  role: "ai" | "user";
  text: string;
}

export interface SavedSession {
  mode: SolveMode;
  trackId?: string;
  syllabusIndex: number;
  topicLabel: string;
  code: string;
  messages: SavedMessage[];
  savedAt: number;
}

const KEY = "stb_saved_session_v1";
const EVENT = "stb-saved-session";

export function saveSession(s: SavedSession): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new Event(EVENT));
  } catch { /* quota / disabled */ }
}

export function loadSession(): SavedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}

/** Live-updating saved session (for the resume banner on the select screen). */
export function useSavedSession(): SavedSession | null {
  const [saved, setSaved] = useState<SavedSession | null>(null);
  useEffect(() => {
    const update = () => setSaved(loadSession());
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return saved;
}
