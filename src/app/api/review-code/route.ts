/**
 * POST /api/review-code
 * 
 * AI-powered code review using shippie's battle-tested prompt
 * + Gemini with Google Search grounding + structured JSON output.
 * 
 * Accepts `originalContent` per file to compute accurate changed line ranges.
 * When originalContent is provided, only changed lines are reviewed.
 * When missing (new/added files), the entire file is reviewed.
 * 
 * @see src/lib/codeReview/ for the review engine
 */

import { NextRequest, NextResponse } from 'next/server';
import { reviewCode } from '@/lib/codeReview';
import type { ReviewFile } from '@/lib/codeReview';
import { computeChangedLines, isNewFile } from '@/lib/codeReview/diff';

interface RequestBody {
  files: Array<{
    path: string;
    content: string;
    originalContent?: string; // committed version for diff computation
    language: string;
  }>;
  goal?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: RequestBody = await req.json();

    if (!body.files?.length) {
      return NextResponse.json(
        { error: 'No files provided for review' },
        { status: 400 }
      );
    }

    // Convert API format to ReviewFile format with accurate changedLines
    const reviewFiles: ReviewFile[] = body.files.map(f => {
      const totalLines = f.content.split('\n').length;

      // Compute actual changed line ranges when original content is available
      let changedLines;
      if (isNewFile(f.originalContent)) {
        // New/added file → all lines are "changed"
        changedLines = [{ start: 1, end: totalLines }];
      } else {
        changedLines = computeChangedLines(f.originalContent!, f.content);
        // Fallback: if diff returns empty (files identical), skip this file
        if (changedLines.length === 0) {
          console.log(`[ReviewCode] ${f.path}: no changes detected, skipping`);
          return null;
        }
      }

      console.log(`[ReviewCode] ${f.path}: ${changedLines.length} changed range(s) out of ${totalLines} total lines`);

      return {
        fileName: f.path,
        fileContent: f.content,
        changedLines,
      };
    }).filter((f): f is ReviewFile => f !== null);

    if (reviewFiles.length === 0) {
      return NextResponse.json({
        findings: [],
        summary: 'No actual changes detected in the provided files.',
        riskScore: 1,
        filesReviewed: 0,
        tool: 'gemini-grounded',
      });
    }

    const result = await reviewCode({
      files: reviewFiles,
      goal: body.goal,
    });

    return NextResponse.json({
      findings: result.findings,
      summary: result.summary,
      riskScore: result.riskScore,
      filesReviewed: result.filesReviewed,
      tool: 'gemini-grounded',
    });
  } catch (error) {
    console.error('[ReviewCode] Error:', error);
    return NextResponse.json(
      { error: 'Code review failed', findings: [], summary: '', riskScore: 0, filesReviewed: 0 },
      { status: 500 }
    );
  }
}

