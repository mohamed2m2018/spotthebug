import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

/**
 * POST /api/ground-explanation
 *
 * When a developer solves a bug, this endpoint generates a deep,
 * Google Search-grounded technical explanation of WHY the bug exists.
 *
 * Returns the kind of insight like:
 * "MMKV is synchronous because it uses memory-mapped files (mmap) via JSI"
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { buggyCode, framework, category, title, correctFix } = body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY required" }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `You are a senior developer writing a deep technical explanation for a bug that was just found by a junior developer in a training session.

The developer solved this bug:
- Title: ${title}
- Framework: ${framework}
- Category: ${category}
- Buggy code: \`\`\`\n${buggyCode}\n\`\`\`
- Fix: ${correctFix}

Use Google Search to find:
1. The official documentation that explains WHY this pattern is buggy
2. The underlying technical mechanism (e.g., "React uses reference equality for re-renders", "JavaScript closures capture variables by reference")
3. Any real-world incidents or common occurrences of this bug pattern
4. Related best practices from official docs

Write a concise but deep technical explanation (3-5 sentences) that:
- Explains the ROOT CAUSE at the language/runtime level
- References specific mechanisms (closures, event loop, virtual DOM diffing, etc.)
- Mentions if this is a common pattern seen in production code
- Gives one practical takeaway the developer can apply going forward

Keep it conversational — this will be spoken by a voice AI coach.`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const grounding = response.candidates?.[0]?.groundingMetadata;
    console.log(`[GroundExplanation] "${title}" | Google Search: ${grounding?.searchEntryPoint ? "YES" : "NO"} | Chunks: ${grounding?.groundingChunks?.length || 0}`);

    return NextResponse.json({
      explanation: response.text || "Great job finding that bug!",
      grounded: !!grounding?.searchEntryPoint,
      groundingChunks: grounding?.groundingChunks?.length || 0,
    });
  } catch (error) {
    console.error("[GroundExplanation] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate explanation" },
      { status: 500 }
    );
  }
}
