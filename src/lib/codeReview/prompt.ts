/**
 * Code Review Prompt Builder
 * Adapted from shippie (formerly code-review-gpt)
 * @see https://github.com/mattzcarey/shippie
 * 
 * Key adaptations:
 * - Removed tool references (readFile, bash, grep) since we're not agentic
 * - Added structured JSON output instructions
 * - Kept the battle-tested review rules and workflow
 */

import type { ReviewFile, LineRange } from './types';

// ── Language map (from shippie/constants.ts) ──

const LANGUAGE_MAP: Record<string, string> = {
  '.js': 'JavaScript', '.ts': 'TypeScript', '.py': 'Python',
  '.sh': 'Shell', '.go': 'Go', '.rs': 'Rust',
  '.tsx': 'TypeScript (React)', '.jsx': 'JavaScript (React)',
  '.dart': 'Dart', '.php': 'PHP', '.cpp': 'C++',
  '.h': 'C++', '.c': 'C', '.cs': 'C#', '.rb': 'Ruby',
  '.kt': 'Kotlin', '.java': 'Java', '.vue': 'Vue',
  '.swift': 'Swift', '.html': 'HTML', '.css': 'CSS',
  '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML',
};

export function getLanguageName(fileName: string): string {
  const ext = '.' + fileName.split('.').pop();
  return LANGUAGE_MAP[ext] || 'Unknown';
}

// ── File tree visualization (from shippie/prompt/fileInfo.ts) ──

interface TreeNode {
  name: string;
  children: Record<string, TreeNode>;
  isFile?: boolean;
  changedLines?: LineRange[];
}

function buildFileTree(files: ReviewFile[]): TreeNode {
  const root: TreeNode = { name: 'root', children: {} };

  for (const file of files) {
    const parts = file.fileName.split('/');
    let node = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      if (!node.children[part]) {
        node.children[part] = { name: part, children: {} };
      }
      node = node.children[part];
      if (i === parts.length - 1) {
        node.isFile = true;
        node.changedLines = file.changedLines;
      }
    }
  }
  return root;
}

function formatLineRanges(ranges?: LineRange[]): string {
  if (!ranges?.length) return '';
  return ranges
    .sort((a, b) => a.start - b.start)
    .map(r => {
      if (r.isPureDeletion) return `${r.start} (deletion)`;
      return r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`;
    })
    .join(', ');
}

function formatTree(node: TreeNode, prefix = '', isLast = true): string {
  let output = '';
  if (node.name !== 'root') {
    let line = `${prefix}${isLast ? '└── ' : '├── '}${node.name}`;
    if (node.isFile) {
      const lines = formatLineRanges(node.changedLines);
      if (lines) line += `: ${lines}`;
    }
    output += `${line}\n`;
  }

  const keys = Object.keys(node.children).sort();
  for (let i = 0; i < keys.length; i++) {
    const child = node.children[keys[i]];
    const last = i === keys.length - 1;
    const childPrefix = node.name === 'root' ? '' : `${prefix}${isLast ? '    ' : '│   '}`;
    output += formatTree(child, childPrefix, last);
  }
  return output;
}

export function createFileInfo(files: ReviewFile[]): string {
  const tree = buildFileTree(files);
  const treeStr = formatTree(tree).trim();
  return `Files changed for this review:\n${treeStr}\n---\n`;
}

// ── Main prompt (adapted from shippie/prompt/prompts.ts) ──

/**
 * Builds the complete code review prompt.
 * 
 * Adaptation from shippie:
 * - Removed tool-call instructions (we call Gemini in a single shot, not agentic loop)
 * - Added structured JSON output format
 * - Kept the core review philosophy: risk scoring, focus-on-changed-lines, brevity, confidence-gating
 * - Added Google Search grounding context
 */
export function buildReviewPrompt(
  files: ReviewFile[],
  goal?: string,
  reviewLanguage = 'English',
  customInstructions?: string,
): string {
  const language = files.length > 0 ? getLanguageName(files[0].fileName) : 'Unknown';
  const fileInfo = createFileInfo(files);

  // Build file contents — send full file but MARK changed lines with >>> prefix.
  // This gives the AI full context (imports, function bodies, brackets)
  // while clearly indicating which lines to focus on.
  const fileContents = files
    .map(f => {
      const lines = f.fileContent.split('\n');
      const changedRanges = f.changedLines || [];

      if (changedRanges.length === 0) {
        // No specific ranges — mark all lines as changed (new/untracked files)
        return `--- ${f.fileName} (${getLanguageName(f.fileName)}) [all lines changed] ---\n${lines.map((line, i) => `>>> ${i + 1}: ${line}`).join('\n')}`;
      }

      // Build a set of changed line numbers for O(1) lookup
      const changedLineNumbers = new Set<number>();
      for (const range of changedRanges) {
        for (let i = range.start; i <= range.end; i++) {
          changedLineNumbers.add(i);
        }
      }

      // Send full file with changed lines marked by >>>
      const annotatedLines = lines.map((line, i) => {
        const lineNum = i + 1;
        const marker = changedLineNumbers.has(lineNum) ? '>>> ' : '    ';
        return `${marker}${lineNum}: ${line}`;
      }).join('\n');

      return `--- ${f.fileName} (${getLanguageName(f.fileName)}) ---\n${annotatedLines}`;
    })
    .join('\n\n');

  const customSection = customInstructions
    ? `\n\n// Custom Instructions\n${customInstructions}\n`
    : '';

  // Core prompt adapted from shippie's instructionPrompt
  return `You are an expert ${language} developer performing a thorough code review. Your task is to review the changed code, find real problems, and suggest concrete improvements.

// CRITICAL: VERIFY BEFORE REPORTING
Before reporting ANY finding about a third-party library, framework, or API:
- Use Google Search to verify how the library actually works — its return types, sync/async behavior, method signatures.
- If you are unsure whether a method is synchronous or asynchronous, SEARCH for its documentation first.
- A wrong finding about a library (e.g., claiming a synchronous API is async) will mislead the developer and cause real damage.
- Only report library-related issues you have verified through search.

// Goal
Review the changed code in the provided files. Find bugs, security issues, architectural problems, and improvement opportunities.
${goal ? `The developer's stated goal: "${goal}"` : ''}

// Understanding The Code Format
- Each file is shown in FULL with line numbers.
- Lines prefixed with \`>>>\` are CHANGED lines — these are the lines you must review.
- Lines prefixed with spaces are UNCHANGED context — use them to understand imports, function signatures, and flow, but do NOT report findings on unchanged lines.

// What To Look For (on >>> changed lines ONLY)
- **Bugs & Logic Errors:** Race conditions, null/undefined access, off-by-one errors, unhandled promise rejections, incorrect conditionals.
- **Security:** Exposed secrets, missing input validation, injection risks, insecure defaults.
- **Architecture:** Tight coupling, God functions/components, missing separation of concerns, wrong patterns for the use case.
- **Error Handling:** Swallowed errors, missing try/catch, no user feedback on failure, silent failures.
- **Performance:** Unnecessary re-renders, missing memoization, N+1 queries, expensive operations in hot paths.
- **Clean Code:** DRY violations, magic numbers, poor naming, dead code, commented-out code left in.
- **Enhancements:** Better patterns that could replace the current approach, missing edge case handling, configuration that should be externalized.
- **Testing:** Missing test coverage for critical paths.

// Severity Definitions
- **ERROR:** Bugs, security vulnerabilities, data loss risks, crashes. Things that MUST be fixed before shipping.
- **WARNING:** Architectural issues, performance problems, code quality concerns. Things that SHOULD be fixed.
- **INFO:** Concrete improvements — a better pattern, a missing edge case, a config that should be externalized, a cleaner approach. Every INFO finding must describe WHAT to change and WHY it's better. Observations like "this is correctly configured" are NOT findings — only include actionable improvements.

Every file has room for improvement. Find at least one actionable finding per file. Describe the problem specifically — what is wrong, what could go wrong, or what would be better.

// Rules
- ONLY report findings on lines marked with \`>>>\`. Use unchanged lines for context only.
- Focus on the most impactful issues first.
- Be specific: reference exact line numbers and variable names.
- When a finding involves library behavior, include a brief technical explanation of WHY the library works that way. For example: explain that MMKV is synchronous because it uses memory-mapped files (mmap) via JSI, not the React Native bridge. This depth helps the developer learn, not just fix.
- Provide feedback in ${reviewLanguage}.
${customSection}
// File Tree
${fileInfo}
// Code Contents
${fileContents}

// Output Format
Return a JSON object with this exact structure:
{
  "findings": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "endLine": 45,
      "severity": "ERROR" | "WARNING" | "INFO",
      "message": "Brief description of the PROBLEM or IMPROVEMENT — what is wrong or what would be better",
      "rule": "category like security/performance/best-practice/logic-error/missing-tests/enhancement",
      "suggestedFix": "Optional: brief code or approach to fix"
    }
  ],
  "summary": "2-3 sentence summary of the overall changes and their quality",
  "riskScore": 1-5
}`;
}
