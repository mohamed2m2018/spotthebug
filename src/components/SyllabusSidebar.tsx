"use client";

import { useState } from "react";
import { PROBLEM_CATEGORIES, getProblemById } from "@/config/problems";
import styles from "./SyllabusSidebar.module.css";

interface SyllabusSidebarProps {
  syllabus?: string[];
  currentIndex?: number;
  /** If provided, show LeetCode curate progress instead of regular syllabus */
  problemIds?: string[];
  currentProblemId?: string;
  solvedProblemIds?: string[];
  /** Concept labels completed across sessions (persisted) — shown as ✓. */
  completedConcepts?: string[];
}

export default function SyllabusSidebar({
  syllabus, currentIndex = 0,
  problemIds, currentProblemId, solvedProblemIds = [],
  completedConcepts = [],
}: SyllabusSidebarProps) {
  const [expanded, setExpanded] = useState(false);

  // LeetCode curate mode
  if (problemIds && problemIds.length > 0) {
    return (
      <aside className={`${styles.sidebar} ${expanded ? styles.expanded : styles.collapsed}`}>
        <div className={styles.items}>
          {problemIds.map((pid, i) => {
            const prob = getProblemById(pid);
            const isSolved = solvedProblemIds.includes(pid);
            const isActive = currentProblemId === pid;
            return (
              <div
                key={pid}
                className={`${styles.item} ${isSolved ? styles.done : ""} ${isActive ? styles.active : ""}`}
                title={prob ? `#${prob.leetcodeNumber} ${prob.title}` : pid}
              >
                <span className={styles.icon}>
                  {isSolved ? "✅" : isActive ? "🔵" : "○"}
                </span>
                {expanded && (
                  <span className={styles.label}>
                    {prob ? `${prob.leetcodeNumber}. ${prob.title}` : pid}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <button
          className={styles.toggleBtn}
          onClick={() => setExpanded(e => !e)}
          title={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? "‹" : "›"}
        </button>
      </aside>
    );
  }

  // Regular syllabus mode (backward compatible)
  if (!syllabus) return null;

  return (
    <aside className={`${styles.sidebar} ${expanded ? styles.expanded : styles.collapsed}`}>
      <div className={styles.items}>
        {syllabus.map((item, i) => {
          const isDone = i < currentIndex || completedConcepts.includes(item);
          const isActive = i === currentIndex;
          return (
            <div
              key={i}
              className={`${styles.item} ${isDone ? styles.done : ""} ${isActive ? styles.active : ""}`}
              title={item}
            >
              <span className={styles.icon}>
                {isDone ? "✅" : isActive ? "🔵" : "○"}
              </span>
              {expanded && (
                <span className={styles.label}>{item}</span>
              )}
            </div>
          );
        })}
      </div>

      <button
        className={styles.toggleBtn}
        onClick={() => setExpanded(e => !e)}
        title={expanded ? "Collapse syllabus" : "Expand syllabus"}
      >
        {expanded ? "‹" : "›"}
      </button>
    </aside>
  );
}
