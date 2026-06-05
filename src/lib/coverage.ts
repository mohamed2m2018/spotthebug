"use client";

/**
 * Persistent coverage tracker — remembers which concepts the learner has
 * completed, per track ("dsa" | "sql" | "sysdesign"), in localStorage so
 * progress survives reloads and carries across the 2-day cram.
 */

import { useEffect, useState } from "react";

const KEY = "stb_coverage_v1";
const EVENT = "stb-coverage";

type Store = Record<string, string[]>; // trackId -> covered concept labels

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Store;
  } catch {
    return {};
  }
}

function write(store: Store): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(store));
  window.dispatchEvent(new Event(EVENT));
}

/** Mark a concept covered for a track (idempotent). */
export function markCovered(trackId: string, concept: string): void {
  if (!trackId || !concept) return;
  const store = read();
  const set = new Set(store[trackId] || []);
  if (set.has(concept)) return;
  set.add(concept);
  store[trackId] = [...set];
  write(store);
}

/** Current covered concepts for a track. */
export function getCovered(trackId: string): string[] {
  return read()[trackId] || [];
}

/** Reset a track's progress. */
export function resetCoverage(trackId: string): void {
  const store = read();
  delete store[trackId];
  write(store);
}

/** Live-updating covered list for a track (re-renders on change, cross-tab). */
export function useCovered(trackId: string): string[] {
  const [covered, setCovered] = useState<string[]>([]);
  useEffect(() => {
    const update = () => setCovered(getCovered(trackId));
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [trackId]);
  return covered;
}
