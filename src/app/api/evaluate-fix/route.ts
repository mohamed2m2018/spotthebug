import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

/**
 * POST /api/evaluate-fix
 *
 * 2-phase evaluation using Gemini + Google Search grounding:
 *   Phase 1: Grounded analysis (free text + Google Search)
 *   Phase 2: Structure into JSON (no search tools — JSON mode works)
 *
 * Same pattern as /api/generate-bug pipeline.
 */
export async function POST(req: NextRequest) {
  try {
    const { buggyCode, correctFix, explanation, userCode, language } = await req.json();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY required" }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });

    // Phase 1: Grounded analysis (free text + Google Search)
    console.log("[EvaluateFix] Phase 1: Grounded analysis...");

    const phase1Response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `You are a code correctness evaluator. A developer is trying to fix a bug in their code.

ORIGINAL BUGGY CODE:
\`\`\`${language}
${buggyCode}
\`\`\`

KNOWN CORRECT FIX (one possible solution):
\`\`\`${language}
${correctFix}
\`\`\`

BUG EXPLANATION:
${explanation}

DEVELOPER'S CURRENT CODE:
\`\`\`${language}
${userCode}
\`\`\`

Use Google Search to verify the underlying bug mechanism. Then evaluate:
1. Does the developer's code address the ROOT CAUSE of the bug?
2. Their fix does NOT need to match the known fix exactly — any valid approach counts.
3. Be precise — check actual code logic, not surface-level changes.
4. REJECT the fix if it introduces a SECURITY VULNERABILITY (e.g., using eval() instead of JSON.parse) or unhandled exceptions, even if it technically 'works'.
5. REJECT the fix if it contains obvious syntax errors that prevent execution.

Write your analysis clearly: is the fix correct or not, and why (1-2 sentences).`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const analysisText = phase1Response.text || "";
    const grounding = phase1Response.candidates?.[0]?.groundingMetadata;
    console.log(`[EvaluateFix] Phase 1 | ${analysisText.length} chars | Google Search: ${grounding?.searchEntryPoint ? "YES" : "NO"} | Chunks: ${grounding?.groundingChunks?.length || 0}`);

    // Phase 2: Structure into JSON (no search tools)
    console.log("[EvaluateFix] Phase 2: Structuring result...");

    const phase2Response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Extract the evaluation result from this analysis into JSON:

${analysisText}

Return whether the developer's fix is correct and a brief feedback message.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object" as const,
          properties: {
            isCorrect: { type: "boolean" as const, description: "true if the developer's code correctly fixes the root cause of the bug" },
            feedback: { type: "string" as const, description: "Brief 1-2 sentence feedback on the fix" },
          },
          required: ["isCorrect", "feedback"],
        },
      },
    });

    const result = JSON.parse(phase2Response.text || "{}");
    console.log(`[EvaluateFix] Result: ${result.isCorrect ? "CORRECT" : "INCORRECT"} — ${result.feedback}`);

    return NextResponse.json({
      ...result,
      searchUsed: !!(grounding?.groundingChunks?.length),
    });
  } catch (error) {
    console.error("[EvaluateFix] Error:", error);
    return NextResponse.json(
      { isCorrect: false, feedback: "Evaluation failed — could not verify the fix.", searchUsed: false },
      { status: 500 }
    );
  }
}
