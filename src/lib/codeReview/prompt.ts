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

  // Build file contents — only include changed line ranges, not the full file.
  // This prevents the AI from commenting on unchanged code.
  const fileContents = files
    .map(f => {
      const lines = f.fileContent.split('\n');
      const changedRanges = f.changedLines || [];

      if (changedRanges.length === 0) {
        // No specific ranges — send full file (backward compat for new/untracked files)
        return `--- ${f.fileName} (${getLanguageName(f.fileName)}) ---\n${f.fileContent}`;
      }

      // Only extract the lines within changed ranges
      const snippets = changedRanges.map(range => {
        const start = Math.max(range.start, 1);
        const end = Math.min(range.end, lines.length);
        const snippet = lines.slice(start - 1, end)
          .map((line, i) => `${start + i}: ${line}`)
          .join('\n');
        return `Lines ${start}-${end}:\n${snippet}`;
      });

      return `--- ${f.fileName} (${getLanguageName(f.fileName)}) [changed lines only] ---\n${snippets.join('\n\n')}`;
    })
    .join('\n\n');

  const customSection = customInstructions
    ? `\n\n// Custom Instructions\n${customInstructions}\n`
    : '';

  // Core prompt adapted from shippie's instructionPrompt
  return `You are an expert ${language} developer performing a code review. Your task is to review the changed code and produce structured findings.

// Goal
Review the changed code in the provided files. Identify issues, assess risk, and produce a concise summary.
${goal ? `The developer's stated goal: "${goal}"` : ''}

// Understanding File Changes
- Line numbers followed by "(deletion)" indicate pure deletions — content removed without replacement.
- Regular line numbers show where content was added or modified.

// Rules for Code Review (from shippie/code-review-gpt)
- **Functionality:** Identify changes that could break existing functionality.
- **Testing:** Note if changes lack adequate test coverage.
- **Best Practices:** Ensure changes follow clean code principles, DRY, SOLID where applicable.
- **Risk Assessment:** Score each finding from 1 (low risk) to 5 (high risk). Flag API keys or secrets as risk 5.
- **Readability & Performance:** Comment on readability and performance issues.
- **Focus:** You are given ONLY the changed code snippets with their line numbers. ONLY output findings for line numbers you can see in the provided snippets. You do not have access to the rest of the file — do not guess or infer issues outside the visible lines.
- **Brevity:** Keep feedback concise and accurate. If multiple similar issues exist, report the most critical.
- **Confidence:** Only report issues you are confident about. If unsure about a library or pattern, skip it.
- **Language:** Provide feedback in ${reviewLanguage}.
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
      "message": "Brief description of the issue",
      "rule": "category like security/performance/best-practice/logic-error/missing-tests",
      "suggestedFix": "Optional: brief code or approach to fix"
    }
  ],
  "summary": "2-3 sentence summary of the overall changes and their quality",
  "riskScore": 1-5
}

Report only real issues you can verify in the code. Do not invent problems.`;
}
