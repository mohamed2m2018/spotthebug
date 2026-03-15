/**
 * Code Review Types
 * Adapted from shippie (formerly code-review-gpt)
 * @see https://github.com/mattzcarey/shippie
 */

export interface LineRange {
  start: number;
  end: number;
  isPureDeletion?: boolean;
}

export interface ReviewFile {
  fileName: string;
  fileContent: string;
  changedLines: LineRange[];
}

export interface ReviewFinding {
  file: string;
  line: number;
  endLine?: number;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  rule: string;
  suggestedFix?: string;
}

export interface ReviewResult {
  findings: ReviewFinding[];
  summary: string;
  filesReviewed: number;
  riskScore: number; // 1-5 (shippie's risk assessment)
}

export interface ReviewOptions {
  files: ReviewFile[];
  goal?: string;
  language?: string; // review output language (default: English)
  customInstructions?: string;
}
