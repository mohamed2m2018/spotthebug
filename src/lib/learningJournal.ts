"use client";

/**
 * Learning journal — accumulates session transcripts per area (dsa / sql /
 * sysdesign) in localStorage. Used to generate a PERSONALIZED study guide:
 * the LLM mines these transcripts for the learner's mistakes, misconceptions
 * the coach corrected, and questions they asked.
 */

export interface JournalEntry {
  topic: string;
  transcript: string;
  at: number;
}

const PREFIX = "stb_journal_v1_";
const MAX_ENTRIES = 40;
const MAX_TRANSCRIPT = 6000; // chars per entry

function key(area: string) {
  return PREFIX + area;
}

export function appendJournal(area: string, topic: string, transcript: string): void {
  if (typeof window === "undefined" || !area || !transcript?.trim()) return;
  try {
    const list = loadJournal(area);
    list.push({ topic, transcript: transcript.slice(0, MAX_TRANSCRIPT), at: Date.now() });
    localStorage.setItem(key(area), JSON.stringify(list.slice(-MAX_ENTRIES)));
  } catch { /* quota */ }
}

export function loadJournal(area: string): JournalEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(key(area)) || "[]") as JournalEntry[];
  } catch {
    return [];
  }
}

export function clearJournal(area: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(key(area));
}
