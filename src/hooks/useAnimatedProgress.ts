"use client";

import { useState, useEffect, useRef } from "react";

/**
 * Smoothly animates progress between discrete SSE milestone values.
 * 
 * When `target` jumps (e.g. 0 → 15 → 50 → 80 → 100), this hook
 * gradually fills the gap so the bar always feels alive.
 * 
 * It advances at ~1% per tick toward 70% of the way to the next
 * likely milestone, then waits for the real SSE update.
 */
export function useAnimatedProgress(target: number, tickMs = 300): number {
  const [display, setDisplay] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    // When target changes, snap up if display is behind
    setDisplay(prev => Math.max(prev, target));
  }, [target]);

  useEffect(() => {
    const interval = setInterval(() => {
      setDisplay(prev => {
        const current = targetRef.current;

        // Already at or past 100
        if (prev >= 100) return 100;

        // If display is behind target, catch up quickly
        if (prev < current) {
          return Math.min(prev + 3, current);
        }

        // Smoothly creep forward: advance up to 70% toward next milestone
        // Milestones: 15, 50, 80, 100
        const milestones = [15, 50, 80, 100];
        const nextMilestone = milestones.find(m => m > current) ?? 100;
        const ceiling = current + (nextMilestone - current) * 0.7;

        if (prev >= ceiling) return prev; // Don't exceed ceiling

        return Math.min(prev + 0.5, ceiling);
      });
    }, tickMs);

    return () => clearInterval(interval);
  }, [tickMs]);

  return Math.round(display);
}
