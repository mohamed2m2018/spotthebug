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

    // Action: start — get a bug (AI-generated first, static fallback)
    if (action === "start") {
      const userSkills: string[] = skills || ["react"];

      // Try AI-generated grounded bug first
      let selectedBug = null;
      try {
        const genRes = await fetch(new URL("/api/generate-bug", req.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            skills: userSkills,
            difficulty,
            excludeTopics: excludeIds || [],
          }),
        });
        if (genRes.ok && genRes.body) {
          // generate-bug returns SSE — consume stream and extract result
          const reader = genRes.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const event = JSON.parse(line.slice(6));
                if (event.type === "result") {
                  selectedBug = event.bug;
                }
              } catch { /* partial JSON */ }
            }
          }
          if (selectedBug) {
            console.log(`[Session] Using AI-generated bug: "${selectedBug.title}" (grounding chunks: ${selectedBug.groundingChunks})`);
          }
        }
      } catch (err) {
        console.warn("[Session] AI bug generation failed, using static fallback:", err);
      }

      // Fallback to static bug database
      if (!selectedBug) {
        selectedBug = getRandomBug(userSkills, excludeIds || [], difficulty);
        if (selectedBug) {
          console.log(`[Session] Using static bug: "${selectedBug.title}"`);
        }
      }

      if (!selectedBug) {
        return NextResponse.json(
          { error: "No bugs found for your skills. Try adding more frameworks." },
          { status: 404 }
        );
      }

      const introPrompt = buildTextSessionIntroPrompt(
        selectedBug.buggyCode,
        selectedBug.language,
        selectedBug.description || selectedBug.title,
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
          grounded: selectedBug.grounded || false,
        },
        aiMessage: aiResponse,
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
