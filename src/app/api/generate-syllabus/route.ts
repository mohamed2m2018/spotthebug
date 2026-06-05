import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

/**
 * POST /api/generate-syllabus
 *
 * Uses Gemini + Google Search to find a real book/course curriculum for a given topic,
 * then structures it into an ordered list of sub-topics for the user to practice.
 *
 * Pipeline:
 *   Phase 1: Google Search grounding — find real book/course table of contents
 *   Phase 2: Structure into JSON — ordered sub-topic list + source attribution
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { topic, mode = "solve", difficulty = "beginner", framework = "" } = body;

    if (!topic?.trim()) {
      return NextResponse.json({ error: "topic is required" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY required" }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });

    const modeContext = mode === "hunt"
      ? "finding and debugging bugs in code"
      : "solving coding problems and challenges";

    const frameworkContext = framework ? ` within ${framework}` : "";

    // Phase 1: Find real curriculum via Google Search
    console.log(`[GenerateSyllabus] Phase 1: Searching real curricula for "${topic}"...`);

    const phase1Response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `You are a curriculum researcher. Use Google Search to find real, authoritative learning curricula for the topic: "${topic}"${frameworkContext}.

Search for:
- Table of contents from popular textbooks (O'Reilly, Manning, No Starch Press, etc.)
- Official documentation learning paths (e.g., react.dev, python.org, MDN, docs.rs)
- Curricula from reputable courses (Epic React, Full Stack Open, The Odin Project, CS50, etc.)
- University course syllabi from top CS programs

Your goal is to find the REAL, established pedagogical order in which expert authors and educators teach "${topic}". Report what you find: which books or courses cover this topic, and in what order they introduce the sub-concepts.

Be specific — quote actual chapter titles, section names, or module names from real sources.`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const groundedCurriculum = phase1Response.text || "";
    const grounding = phase1Response.candidates?.[0]?.groundingMetadata;
    console.log(`[GenerateSyllabus] Phase 1 | ${groundedCurriculum.length} chars | Google Search: ${grounding?.searchEntryPoint ? "YES" : "NO"}`);

    // Phase 2: Structure into JSON
    console.log(`[GenerateSyllabus] Phase 2: Structuring into ordered syllabus...`);

    const phase2Response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Based on this research about real curricula for "${topic}":

${groundedCurriculum}

Create a structured, ordered syllabus for a ${difficulty}-level developer who will practice by ${modeContext}${frameworkContext}.

Rules:
- Follow the pedagogical order found in the real sources (simpler concepts before complex)
- Each sub-topic must be concrete and specific enough to generate a focused ${mode === "hunt" ? "code bug" : "coding problem"} from it
- Sub-topic names should be concise (2-6 words) — they will appear as session titles
- Include as many sub-topics as the topic genuinely warrants to be complete (don't truncate — cover the full scope)
- The source field should be the actual book/course title you found, e.g. "Official React Docs", "You Don't Know JS", "Eloquent JavaScript"`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object" as const,
          properties: {
            syllabus: {
              type: "array" as const,
              items: { type: "string" as const },
              description: "Ordered list of sub-topic names to practice",
            },
            source: {
              type: "string" as const,
              description: "Name of the primary book/course this syllabus is based on",
            },
            description: {
              type: "string" as const,
              description: "One sentence describing the learning path",
            },
          },
          required: ["syllabus", "source", "description"],
        },
      },
    });

    const result = JSON.parse(phase2Response.text || "{}");

    if (!result.syllabus?.length) {
      return NextResponse.json({ error: "Failed to generate syllabus" }, { status: 500 });
    }

    console.log(`[GenerateSyllabus] Done: ${result.syllabus.length} topics from "${result.source}"`);

    return NextResponse.json({
      syllabus: result.syllabus as string[],
      source: result.source as string,
      description: result.description as string,
    });
  } catch (error) {
    console.error("[GenerateSyllabus] Error:", error);
    return NextResponse.json({ error: "Failed to generate syllabus" }, { status: 500 });
  }
}
