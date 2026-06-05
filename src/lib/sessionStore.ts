"use client";

/**
 * Save & resume teaching sessions. Persists a LIST of session snapshots (each
 * its own entry, keyed by id) in localStorage so the learner can keep several
 * saved sessions and resume any of them.
 *
 * The live voice connection can't resume after a long gap (the resumption
 * handle is short-lived), so resuming restores the UI + progress and starts a
 * fresh voice session that continues the same topic.
 */

import { useEffect, useState } from "react";
import type { SolveMode } from "@/hooks/useProblemSolvingVoice";

export interface SavedMessage {
  role: "ai" | "user";
  text: string;
}

export interface SavedSession {
  id: string;
  mode: SolveMode;
  trackId?: string;
  syllabusIndex: number;
  topicLabel: string;
  code: string;
  messages: SavedMessage[];
  savedAt: number;
}

const KEY = "stb_saved_sessions_v1";
const EVENT = "stb-saved-sessions";
const MAX = 30;

function readAll(): SavedSession[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as SavedSession[];
  } catch {
    return [];
  }
}

function writeAll(list: SavedSession[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event(EVENT));
  } catch { /* quota */ }
}

/** Upsert a session by id; most-recent first. */
export function saveSession(s: SavedSession): void {
  const list = readAll().filter((x) => x.id !== s.id);
  list.unshift(s);
  list.sort((a, b) => b.savedAt - a.savedAt);
  writeAll(list);
}

export function loadSessions(): SavedSession[] {
  return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

export function removeSession(id: string): void {
  writeAll(readAll().filter((x) => x.id !== id));
}

/** Live-updating list of saved sessions (for the resume list on the select screen). */
export function useSavedSessions(): SavedSession[] {
  const [list, setList] = useState<SavedSession[]>([]);
  useEffect(() => {
    const update = () => setList(loadSessions());
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return list;
}
