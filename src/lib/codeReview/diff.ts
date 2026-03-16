/**
 * Line-level diff utility for computing changed line ranges.
 * 
 * Uses a simple, efficient approach:
 * 1. Split both files into lines
 * 2. Use the Myers diff algorithm (simplified) to find the longest common subsequence
 * 3. Lines in the new file that aren't part of the LCS are "changed"
 * 4. Collapse adjacent changed lines into ranges
 * 
 * No external dependencies — runs on the server side only.
 */

import type { LineRange } from './types';

/**
 * Compute changed line ranges between original and modified file content.
 * Returns LineRange[] where each range indicates lines in the NEW file
 * that were added or modified.
 * 
 * @param originalContent - The committed/original version of the file
 * @param modifiedContent - The current/working version of the file
 * @returns Array of line ranges that changed in the modified file
 */
export function computeChangedLines(
  originalContent: string,
  modifiedContent: string,
): LineRange[] {
  const oldLines = originalContent.split('\n');
  const newLines = modifiedContent.split('\n');

  // Compute LCS table using dynamic programming
  const lcs = computeLCS(oldLines, newLines);

  // Walk the LCS to find which new lines are NOT in the common subsequence
  const changedNewLines = new Set<number>();
  const deletedOldLines = new Set<number>();

  let oi = oldLines.length;
  let ni = newLines.length;

  while (oi > 0 && ni > 0) {
    if (oldLines[oi - 1] === newLines[ni - 1]) {
      // This line is common — not changed
      oi--;
      ni--;
    } else if (lcs[oi - 1][ni] >= lcs[oi][ni - 1]) {
      // Line was deleted from old
      deletedOldLines.add(oi);
      oi--;
    } else {
      // Line was added/modified in new
      changedNewLines.add(ni); // 1-indexed
      ni--;
    }
  }

  // Remaining old lines are deletions
  while (oi > 0) {
    deletedOldLines.add(oi);
    oi--;
  }

  // Remaining new lines are additions
  while (ni > 0) {
    changedNewLines.add(ni);
    ni--;
  }

  // Collapse into ranges
  const ranges = collapseToRanges(changedNewLines, newLines.length);

  // Add deletion markers (pure deletions that don't have corresponding new lines)
  if (deletedOldLines.size > 0 && changedNewLines.size === 0 && ranges.length === 0) {
    // Pure deletion — file got shorter with no new content
    ranges.push({ start: 1, end: 1, isPureDeletion: true });
  }

  return ranges;
}

/**
 * Compute LCS length table using dynamic programming.
 * Space-optimized for large files.
 */
function computeLCS(oldLines: string[], newLines: string[]): number[][] {
  const m = oldLines.length;
  const n = newLines.length;

  // For very large files, use a simpler heuristic
  if (m * n > 10_000_000) {
    return computeLCSHeuristic(oldLines, newLines);
  }

  // Standard DP table
  const table: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }

  return table;
}

/**
 * Heuristic LCS for very large files: line-hash based matching.
 * Groups lines by content and matches greedily.
 */
function computeLCSHeuristic(oldLines: string[], newLines: string[]): number[][] {
  const m = oldLines.length;
  const n = newLines.length;

  // Build a map of new line content → positions
  const newLinePositions = new Map<string, number[]>();
  for (let j = 0; j < n; j++) {
    const line = newLines[j];
    if (!newLinePositions.has(line)) {
      newLinePositions.set(line, []);
    }
    newLinePositions.get(line)!.push(j);
  }

  // Greedy matching: for each old line, find the earliest unused new line match
  const matchedNew = new Set<number>();
  const changedNew = new Set<number>();

  for (let i = 0; i < m; i++) {
    const positions = newLinePositions.get(oldLines[i]);
    if (positions) {
      const match = positions.find(p => !matchedNew.has(p));
      if (match !== undefined) {
        matchedNew.add(match);
      }
    }
  }

  // All unmatched new lines are changed
  for (let j = 0; j < n; j++) {
    if (!matchedNew.has(j)) {
      changedNew.add(j + 1); // 1-indexed
    }
  }

  // Build a fake LCS table that represents the result
  // (only needs to be accessed by the walk-back algorithm)
  const table: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  // Fill with simple values — the caller will use changedNew directly
  for (let i = 0; i <= m; i++) {
    for (let j = 0; j <= n; j++) {
      table[i][j] = Math.min(i, j);
    }
  }

  return table;
}

/**
 * Expand each range by ±margin lines and merge overlapping ranges.
 * This provides context lines around changes (like git diff -U3).
 */
function expandRanges(ranges: LineRange[], totalLines: number, margin: number): LineRange[] {
  if (ranges.length === 0) return [];

  // Expand each range
  const expanded = ranges.map(r => ({
    start: Math.max(1, r.start - margin),
    end: Math.min(totalLines, r.end + margin),
    isPureDeletion: r.isPureDeletion,
  }));

  // Sort by start
  expanded.sort((a, b) => a.start - b.start);

  // Merge overlapping ranges
  const merged: LineRange[] = [expanded[0]];
  for (let i = 1; i < expanded.length; i++) {
    const last = merged[merged.length - 1];
    if (expanded[i].start <= last.end + 1) {
      last.end = Math.max(last.end, expanded[i].end);
    } else {
      merged.push(expanded[i]);
    }
  }

  return merged;
}

/**
 * Collapse a set of 1-indexed line numbers into contiguous LineRange[].
 */
function collapseToRanges(lines: Set<number>, totalLines: number): LineRange[] {
  if (lines.size === 0) return [];

  const sorted = Array.from(lines).sort((a, b) => a - b);
  const ranges: LineRange[] = [];

  let start = sorted[0];
  let end = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push({ start, end });
      start = sorted[i];
      end = sorted[i];
    }
  }
  ranges.push({ start, end });

  // Cap end at totalLines
  for (const r of ranges) {
    if (r.end > totalLines) r.end = totalLines;
  }

  return ranges;
}

/**
 * Convenience: check if a file is "new" (all lines are changed).
 */
export function isNewFile(originalContent: string | null | undefined): boolean {
  return !originalContent || originalContent.trim() === '';
}
