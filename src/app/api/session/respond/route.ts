import { NextRequest, NextResponse } from "next/server";
import { chatWithGemini, CODE_COACH_SYSTEM_PROMPT } from "@/lib/gemini";
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

      const introPrompt = buildIntroPrompt(selectedBug);
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
      
      const evaluationPrompt = buildEvaluationPrompt(bug, userMessage);
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

function buildIntroPrompt(bug: Bug): string {
  return `You are starting a new code review training round.

Here is the buggy code the developer will see on screen:

\`\`\`${bug.language}
${bug.buggyCode}
\`\`\`

Context: ${bug.description}
Framework: ${bug.framework}
Category: ${bug.category}

Introduce this code to the developer. Tell them to take their time reading it. Ask them what they notice. Be encouraging and conversational. Do NOT reveal the bug.`;
}

function buildEvaluationPrompt(bug: { id: string; title: string }, userMessage: string): string {
  return `The developer said: "${userMessage}"

Evaluate their response. Are they getting close to identifying the bug? Guide them with:
- If they're on the right track: encourage them and ask them to elaborate
- If they're wrong: gently redirect without giving the answer
- If they found it: celebrate and explain why it matters

Keep your response to 2-3 sentences. Be conversational.`;
}

function getFullBug(bugId: string): Bug | undefined {
  const { bugs } = require("@/lib/bugs");
  return bugs.find((b: Bug) => b.id === bugId);
}
