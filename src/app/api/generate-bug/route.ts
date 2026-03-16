import { NextRequest } from "next/server";
import { GoogleGenAI } from "@google/genai";

/**
 * POST /api/generate-bug
 *
 * Generates a coding bug using Gemini + Google Search grounding.
 * Streams progress via SSE (same pattern as /api/generate-problem).
 *
 * 3-phase pipeline:
 *   Phase 1: Generate bug from real patterns (grounded free text)
 *   Phase 2: Validate bug correctness (grounded free text)
 *   Phase 3: Structure into JSON (no search tools — JSON mode allowed)
 */
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
      };

      try {
        const body = await req.json();
        const { skills = ["react"], difficulty = "beginner", excludeTopics = [] } = body;

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          send("error", { error: "GEMINI_API_KEY required" });
          controller.close();
          return;
        }

        const ai = new GoogleGenAI({ apiKey });
        const framework = skills[Math.floor(Math.random() * skills.length)];

        // Phase 1: Generate bug with Google Search grounding (free text)
        send("progress", { message: "🔍 Searching for real bug patterns...", percentage: 15 });
        console.log(`[GenerateBug] Phase 1: Generating ${difficulty} ${framework} bug...`);

        const phase1Response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `You are a coding training content creator. Generate one realistic code bug for a ${difficulty}-level developer learning ${framework}.

Use Google Search to find REAL, common bug patterns for ${framework}. Base your bug on actual patterns from Stack Overflow, GitHub issues, or official docs.

${excludeTopics.length > 0 ? `Avoid these topics (already used): ${excludeTopics.join(", ")}` : ""}

Requirements:
- The buggy code should be 6-20 lines, focused on ONE bug
- The bug must be realistic — something a real developer would write
- The buggy code must look like NATURAL code — NO comments that hint at or reveal the bug. No "// BUG:", no "// This won't work", no "// Wrong approach" etc. The code should look like it was written by a developer who genuinely thinks it's correct
- Include the correct fix separately
- Include 3 progressive hints (vague → specific → almost the answer)
- Include a technical explanation of WHY it's a bug (reference the underlying mechanism)
- Specify the language: "tsx" for React, "javascript" for Node.js, "typescript" for TypeScript, "python" for Python

Write out all the details clearly.`,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });

        const groundedBug = phase1Response.text || "";
        const p1Grounding = phase1Response.candidates?.[0]?.groundingMetadata;
        console.log(`[GenerateBug] Phase 1 | ${groundedBug.length} chars | Google Search: ${p1Grounding?.searchEntryPoint ? "YES" : "NO"} | Chunks: ${p1Grounding?.groundingChunks?.length || 0}`);

        // Phase 2: Validate correctness (grounded free text)
        send("progress", { message: "✅ Validating bug correctness...", percentage: 50 });
        console.log(`[GenerateBug] Phase 2: Validating...`);

        const phase2Response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `You are a code correctness validator. Verify this generated coding bug:

${groundedBug}

Use Google Search to verify:
1. Is this actually a real bug pattern in ${framework}?
2. Is the buggy code actually buggy — would it produce wrong behavior?
3. Is the claimed fix correct?
4. Is the explanation technically accurate?

If everything is correct, confirm with "VALID. Confidence: X/10"
If there are issues, describe them and provide corrections.`,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });

        const validationText = phase2Response.text || "";
        console.log(`[GenerateBug] Phase 2 | Validation: ${validationText.substring(0, 100)}`);

        // Phase 3: Structure into JSON (no search tools — JSON mode works)
        send("progress", { message: "📝 Structuring bug challenge...", percentage: 80 });
        console.log(`[GenerateBug] Phase 3: Structuring into JSON...`);

        const phase3Response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Extract the coding bug from the following content into JSON. Use the validated/corrected version if corrections were made.

Original bug:
${groundedBug}

Validation:
${validationText}

CRITICAL for buggyCode and correctFix fields: These must be properly formatted multi-line code strings. Use literal newline characters (\n) to separate lines. Each line of code must be on its own line, with proper indentation using spaces. Example of correct format in JSON: "function foo() {\n  const x = 1;\n  return x;\n}"

A single-line format like "import React from 'react';function Foo() { ... }" is UNACCEPTABLE — it makes the code unreadable.`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "object" as const,
              properties: {
                framework: { type: "string" as const },
                category: { type: "string" as const },
                difficulty: { type: "string" as const },
                title: { type: "string" as const },
                description: { type: "string" as const },
                buggyCode: { type: "string" as const, description: "Multi-line buggy code with proper newline characters between each line. Must be readable, properly indented code — not a single line. CRITICAL: The code must contain NO comments that hint at or reveal the bug. No '// BUG:', no '// This won't work', no explanatory comments about what's wrong. The code should look like a developer genuinely wrote it thinking it's correct." },
                language: { type: "string" as const },
                hint1: { type: "string" as const },
                hint2: { type: "string" as const },
                hint3: { type: "string" as const },
                correctFix: { type: "string" as const, description: "Multi-line corrected code with proper newline characters between each line. Same formatting rules as buggyCode." },
                explanation: { type: "string" as const },
              },
              required: ["framework", "category", "difficulty", "title", "description", "buggyCode", "language", "hint1", "hint2", "hint3", "correctFix", "explanation"],
            },
          },
        });

        const bug = JSON.parse(phase3Response.text || "{}");
        const id = `gen-${bug.framework}-${Date.now()}`;
        console.log(`[GenerateBug] Done: "${bug.title}"`);

        send("result", {
          bug: {
            id,
            ...bug,
            grounded: true,
            groundingChunks: p1Grounding?.groundingChunks?.length || 0,
          },
        });
        controller.close();
      } catch (error) {
        console.error("[GenerateBug] Error:", error);
        send("error", { error: "Failed to generate bug" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
