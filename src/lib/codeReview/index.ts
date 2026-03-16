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
  onProgress?: (message: string) => void,
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

  // Three-phase approach:
  // Phase 1: Code review with Google Search grounding (free text)
  // Phase 2: Validate findings — challenge each finding with Google Search
  // Phase 3: Structure into JSON

  // Phase 1: Code review with Google Search grounding (free text output)
  onProgress?.('🔍 Analyzing code with Google Search grounding...');
  const phase1Response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const groundedReview = phase1Response.text || '';
  // Log grounding metadata to verify Google Search was actually used
  const p1Grounding = phase1Response.candidates?.[0]?.groundingMetadata;
  console.log(`[CodeReview] Phase 1 complete: ${groundedReview.length} chars | Google Search queries: ${p1Grounding?.searchEntryPoint ? 'YES' : 'NO'} | Grounding chunks: ${p1Grounding?.groundingChunks?.length || 0}`);

  // Phase 2: Validate each finding — challenge library assumptions with Google Search
  onProgress?.('🔎 Validating findings against documentation...');
  const phase2Response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `You are a senior code review validator. Your job is to fact-check the following code review findings.

For EACH finding in the review:
1. If the finding claims something about a third-party library (return types, sync/async behavior, method signatures, API behavior) — USE GOOGLE SEARCH to verify whether the claim is correct.
2. If the finding is WRONG about how a library works (e.g., claiming a synchronous API returns a Promise when it doesn't), REMOVE the finding and explain why.
3. If the finding is correct and verified, KEEP it as-is.
4. If the finding is about pure application logic (not library-specific), keep it — no search needed.

Output the VALIDATED review with only correct findings. Mark each finding as [VERIFIED] or [REMOVED] with a brief reason.

Code review to validate:
${groundedReview}`,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const validatedReview = phase2Response.text || groundedReview;
  const p2Grounding = phase2Response.candidates?.[0]?.groundingMetadata;
  console.log(`[CodeReview] Phase 2 (validation) complete: ${validatedReview.length} chars | Google Search queries: ${p2Grounding?.searchEntryPoint ? 'YES' : 'NO'} | Grounding chunks: ${p2Grounding?.groundingChunks?.length || 0}`);

  // Phase 3: Structure the validated review into JSON schema
  onProgress?.('📝 Structuring verified findings...');
  const phase3Response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Extract the code review findings from the following validated review into the exact JSON structure specified.
Only include findings marked as [VERIFIED] or findings not explicitly marked as [REMOVED].
Keep all information, severity levels, file names, line numbers, rules, and suggested fixes from the review.

Validated review:
${validatedReview}`,
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

  const text = phase3Response.text || '{"findings":[],"summary":"Review completed.","riskScore":1}';
  
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
