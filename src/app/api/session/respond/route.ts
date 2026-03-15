import { NextRequest, NextResponse } from "next/server";
import { chatWithGemini } from "@/lib/gemini";
import { CODE_COACH_SYSTEM_PROMPT, buildTextSessionIntroPrompt, buildEvaluationPrompt } from "@/config/prompts";
import { getRandomBug } from "@/lib/bugs";
import type { GeminiMessage } from "@/lib/gemini";
import type { Bug } from "@/lib/bugs";

/**
 * POST /api/session/respond
 * 
 * Handles the training session conversation.
 * All Gemini communication happens server-side — API key never exposed.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, userMessage, bug, conversationHistory, skills, excludeIds, difficulty } = body;

    // Action: start — get a random bug and generate the intro message
    if (action === "start") {
      const userSkills: string[] = skills || ["react"];
      const selectedBug = getRandomBug(userSkills, excludeIds || [], difficulty);

      if (!selectedBug) {
        return NextResponse.json(
          { error: "No bugs found for your skills. Try adding more frameworks." },
          { status: 404 }
        );
      }

      const introPrompt = buildTextSessionIntroPrompt(
        selectedBug.buggyCode,
        selectedBug.language,
        selectedBug.description,
        selectedBug.framework,
        selectedBug.category
      );
      const aiResponse = await chatWithGemini(
        [{ role: "user", parts: [{ text: introPrompt }] }],
        CODE_COACH_SYSTEM_PROMPT
      );

      return NextResponse.json({
        bug: {
          id: selectedBug.id,
          framework: selectedBug.framework,
          category: selectedBug.category,
          difficulty: selectedBug.difficulty,
          title: selectedBug.title,
          buggyCode: selectedBug.buggyCode,
          language: selectedBug.language,
        },
        aiMessage: aiResponse,
        // Keep hints server-side — only send them when needed
      });
    }

    // Action: respond — user described what they think the bug is
    if (action === "respond") {
      if (!userMessage || !bug) {
        return NextResponse.json(
          { error: "Missing userMessage or bug data" },
          { status: 400 }
        );
      }

      const history: GeminiMessage[] = conversationHistory || [];
      
      const evaluationPrompt = buildEvaluationPrompt(userMessage);
      history.push({ role: "user", parts: [{ text: evaluationPrompt }] });

      const aiResponse = await chatWithGemini(history, CODE_COACH_SYSTEM_PROMPT);
      
      history.push({ role: "model", parts: [{ text: aiResponse }] });

      return NextResponse.json({
        aiMessage: aiResponse,
        conversationHistory: history,
      });
    }

    // Action: hint — user asked for a hint
    if (action === "hint") {
      const hintLevel: number = body.hintLevel || 1;
      const fullBug = getFullBug(bug?.id);

      if (!fullBug) {
        return NextResponse.json({ error: "Bug not found" }, { status: 404 });
      }

      const hintText = hintLevel === 1 
        ? fullBug.hint1 
        : hintLevel === 2 
          ? fullBug.hint2 
          : fullBug.hint3;

      return NextResponse.json({
        hint: hintText,
        hintLevel,
      });
    }

    // Action: reveal — show the answer
    if (action === "reveal") {
      const fullBug = getFullBug(bug?.id);

      if (!fullBug) {
        return NextResponse.json({ error: "Bug not found" }, { status: 404 });
      }

      return NextResponse.json({
        correctFix: fullBug.correctFix,
        explanation: fullBug.explanation,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Session API error:", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}

// ==========================================
// Helper functions (server-side only)
// ==========================================



function getFullBug(bugId: string): Bug | undefined {
  const { bugs } = require("@/lib/bugs");
  return bugs.find((b: Bug) => b.id === bugId);
}
