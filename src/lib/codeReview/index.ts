/**
 * Code Review Engine
 * Callable interface for AI-powered code review.
 * 
 * Uses shippie's battle-tested prompt with our Gemini SDK.
 * Supports Google Search grounding for real documentation citations.
 * 
 * Usage:
 *   import { reviewCode } from '@/lib/codeReview';
 *   const result = await reviewCode({ files, goal });
 * 
 * @see https://github.com/mattzcarey/shippie (prompt source)
 */

import { GoogleGenAI } from '@google/genai';
import { buildReviewPrompt } from './prompt';
import type { ReviewOptions, ReviewResult, ReviewFinding } from './types';

export type { ReviewOptions, ReviewResult, ReviewFinding } from './types';
export type { ReviewFile, LineRange } from './types';

/**
 * Perform an AI-powered code review using Gemini + Google Search grounding.
 * 
 * @param options - Files to review, optional goal and custom instructions
 * @param apiKey - Gemini API key (falls back to GEMINI_API_KEY env var)
 * @returns Structured review result with findings, summary, and risk score
 */
export async function reviewCode(
  options: ReviewOptions,
  apiKey?: string,
): Promise<ReviewResult> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY is required for code review');
  }

  const ai = new GoogleGenAI({ apiKey: key });

  const prompt = buildReviewPrompt(
    options.files,
    options.goal,
    options.language || 'English',
    options.customInstructions,
  );

  // Two-phase approach: Gemini doesn't support googleSearch + responseMimeType:'application/json'
  // together. Phase 1 gets grounded review, Phase 2 structures it into JSON.

  // Phase 1: Code review with Google Search grounding (free text output)
  const phase1Response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const groundedReview = phase1Response.text || '';
  console.log(`[CodeReview] Phase 1 complete: ${groundedReview.length} chars grounded review`);

  // Phase 2: Structure the grounded review into JSON schema
  const phase2Response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Extract the code review findings from the following review text into the exact JSON structure specified.
Keep all information, severity levels, file names, line numbers, rules, and suggested fixes from the original review.

Review text:
${groundedReview}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object' as const,
        properties: {
          findings: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                file: { type: 'string' as const },
                line: { type: 'integer' as const },
                endLine: { type: 'integer' as const },
                severity: { type: 'string' as const },
                message: { type: 'string' as const },
                rule: { type: 'string' as const },
                suggestedFix: { type: 'string' as const },
              },
              required: ['file', 'line', 'severity', 'message', 'rule'],
            },
          },
          summary: { type: 'string' as const },
          riskScore: { type: 'integer' as const },
        },
        required: ['findings', 'summary', 'riskScore'],
      },
    },
  });

  const text = phase2Response.text || '{"findings":[],"summary":"Review completed.","riskScore":1}';
  
  try {
    const parsed = JSON.parse(text);
    
    // Normalize severity values
    const findings: ReviewFinding[] = (parsed.findings || []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (f: any) => ({
        file: f.file || 'unknown',
        line: f.line || 0,
        endLine: f.endLine,
        severity: normalizeSeverity(f.severity),
        message: f.message || '',
        rule: f.rule || 'general',
        suggestedFix: f.suggestedFix,
      })
    );

    return {
      findings,
      summary: parsed.summary || '',
      filesReviewed: options.files.length,
      riskScore: Math.min(5, Math.max(1, parsed.riskScore || 1)),
    };
  } catch {
    console.error('[CodeReview] Failed to parse Gemini response:', text.substring(0, 200));
    return {
      findings: [],
      summary: 'Review completed but output could not be parsed.',
      filesReviewed: options.files.length,
      riskScore: 1,
    };
  }
}

function normalizeSeverity(s: string): ReviewFinding['severity'] {
  const upper = (s || '').toUpperCase();
  if (upper.includes('ERROR') || upper.includes('CRITICAL') || upper.includes('HIGH')) return 'ERROR';
  if (upper.includes('WARN') || upper.includes('MEDIUM')) return 'WARNING';
  return 'INFO';
}
