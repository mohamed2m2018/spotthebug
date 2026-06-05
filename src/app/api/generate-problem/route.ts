import { NextRequest } from "next/server";
import { GoogleGenAI } from "@google/genai";

/**
 * POST /api/generate-problem
 *
 * Generates a coding problem using Gemini + Google Search grounding.
 * Streams progress via SSE (same pattern as /api/review-code).
 *
 * 3-phase pipeline:
 *   Phase 1: Generate problem (grounded free text)
 *   Phase 2: Validate correctness (grounded free text)
 *   Phase 3: Structure into JSON (responseSchema, no tools)
 */

const TOPICS = [
  "arrays", "strings", "objects", "async/await", "recursion",
  "data-structures", "algorithms", "api-design", "error-handling",
  "state-management", "dom-manipulation", "functional-programming",
];

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
      };

      try {
        const body = await req.json();
        const { skills = [], difficulty = "beginner", topic, mode = "solve" } = body;

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          send("error", { error: "GEMINI_API_KEY required" });
          controller.close();
          return;
        }

        const ai = new GoogleGenAI({ apiKey });
        // Use the combined language/framework or let AI infer from topic
        const language = skills.length > 0
          ? skills.join(" using ")
          : topic
            ? "the most appropriate language for this topic"
            : "JavaScript";
        const selectedTopic = topic || TOPICS[Math.floor(Math.random() * TOPICS.length)];

        // Phase 1: Generate with Google Search grounding
        send("progress", { message: "🔍 Searching for real coding challenges...", percentage: 15 });
        console.log(`[GenerateProblem] Phase 1: ${difficulty} ${language} (${selectedTopic})...`);

        // Mode-specific generation brief. SQL and System-Design are teaching
        // problems, not runnable code challenges.
        const phase1Contents =
          mode === "sql"
            ? `You are a SQL interview-practice problem creator. Generate a realistic SQL problem for a ${difficulty}-level developer.

Use Google Search to find real SQL interview questions related to "${selectedTopic}".

Requirements:
- Give one or more table schemas with column names/types and 3-6 sample rows each.
- A clear question that the developer answers by writing a SQL query (or, for concept topics like indexing/isolation levels/deadlocks, a short conceptual question to reason about).
- 2-3 examples: the input tables and the expected result set.
- A correct reference SQL solution (or model answer for concept questions).
- 3 progressive hints (vague → specific).
- Starter code: a SQL comment placeholder, e.g. "-- Write your query here".
- The "functionName" is not meaningful for SQL — set it to "query". Test cases may be an empty array.

Write out all the details clearly.`
            : mode === "sysdesign"
            ? `You are a backend / system-design teaching-problem creator. Generate a concrete design brief for a ${difficulty}-level developer about "${selectedTopic}".

Use Google Search to find how such systems/features are designed and the trade-offs involved.

Requirements:
- A concrete design BRIEF: a feature or system to design (e.g. "design a shoppable short-video feed with a product sidebar matched to each video"). State the functional requirements and scale assumptions (many users, large dataset).
- Make clear the developer must (1) sketch the CLASSES / data model and (2) describe IN WORDS the key algorithm(s) and how it scales (e.g. the recommender / ranking).
- 2-3 "examples": frame these as key requirements or constraints to satisfy.
- A reference design OUTLINE as the reference solution (main classes, data stores, queues/caches, and the scaling approach) — this is a model answer, not runnable code.
- 3 progressive hints guiding toward the design.
- Starter code: a scratchpad template, e.g. "// Design scratchpad — sketch your classes, data model, and notes here".
- "functionName" set to "design". Test cases may be an empty array.

Write out all the details clearly.`
            : `You are a coding challenge creator. Generate a practical coding problem for a ${difficulty}-level developer using ${language}.

Use Google Search to find real interview questions and coding challenges related to "${selectedTopic}".

Requirements:
- Problem should be solvable in 5-20 minutes
- Include clear constraints and 2-3 examples with input/output
- Include a complete, working reference solution in ${language}
- Include 3 progressive hints (vague → specific)
- Include 2-3 test cases with expected output
- Include starter code with function signature

Write out all the details clearly.`;

        const phase1Response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: phase1Contents,
          config: { tools: [{ googleSearch: {} }] },
        });

        const groundedProblem = phase1Response.text || "";
        const p1Grounding = phase1Response.candidates?.[0]?.groundingMetadata;
        console.log(`[GenerateProblem] Phase 1 | ${groundedProblem.length} chars | Google Search: ${p1Grounding?.searchEntryPoint ? "YES" : "NO"}`);

        // Phase 2: Validate
        send("progress", { message: "✅ Validating problem correctness...", percentage: 50 });
        console.log(`[GenerateProblem] Phase 2: Validating...`);

        const phase2Response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `You are a code correctness validator. Verify this coding problem:

${groundedProblem}

Use Google Search if needed. Check:
1. Does the reference solution actually solve the problem correctly?
2. Are the test cases and expected outputs correct?
3. Is this appropriate for "${difficulty}" difficulty?

If correct, respond: "VALID. Confidence: X/10"
If issues exist, describe and correct them.`,
          config: { tools: [{ googleSearch: {} }] },
        });

        const validationText = phase2Response.text || "";
        console.log(`[GenerateProblem] Phase 2 | Validation: ${validationText.substring(0, 100)}`);

        // Phase 3: Structure into JSON
        send("progress", { message: "📝 Structuring challenge...", percentage: 80 });
        console.log(`[GenerateProblem] Phase 3: JSON...`);

        const phase3Response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Extract the coding problem into JSON. Use the validated/corrected version if corrections were made.

Original problem:
${groundedProblem}

Validation:
${validationText}

Language: ${language}

IMPORTANT for starterCode: The starter code must be properly formatted multi-line code. Place the function signature on line 1, a placeholder comment like "// Your code here" on its own indented line inside the function body, and the closing brace on a separate final line. Example format:
function exampleFn(param) {
  // Your code here
}

This ensures the code is valid syntax. A single-line format like "function fn(arr) { // comment }" is INVALID because the inline comment swallows the closing brace.`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "object" as const,
              properties: {
                title: { type: "string" as const },
                description: { type: "string" as const },
                topic: { type: "string" as const },
                difficulty: { type: "string" as const },
                language: { type: "string" as const },
                framework: { type: "string" as const },
                examples: {
                  type: "array" as const,
                  items: {
                    type: "object" as const,
                    properties: {
                      input: { type: "string" as const },
                      output: { type: "string" as const },
                      explanation: { type: "string" as const },
                    },
                    required: ["input", "output"],
                  },
                },
                starterCode: { type: "string" as const, description: "Multi-line starter code with function signature. The body contains a '// Your code here' comment on its own line, and the closing brace on a separate final line. Must be valid syntax." },
                functionName: { type: "string" as const, description: "The name of the main function the student must implement" },
                referenceSolution: { type: "string" as const },
                hint1: { type: "string" as const },
                hint2: { type: "string" as const },
                hint3: { type: "string" as const },
                testCases: {
                  type: "array" as const,
                  items: {
                    type: "object" as const,
                    properties: {
                      input: { type: "string" as const },
                      expectedOutput: { type: "string" as const },
                    },
                    required: ["input", "expectedOutput"],
                  },
                },
              },
              required: ["title", "description", "topic", "difficulty", "language", "starterCode", "functionName", "referenceSolution", "hint1", "hint2", "hint3", "testCases", "examples"],
            },
          },
        });

        const problem = JSON.parse(phase3Response.text || "{}");
        const id = `prob-${selectedTopic}-${Date.now()}`;
        console.log(`[GenerateProblem] Done: "${problem.title}"`);

        // Send final result
        send("result", {
          problem: {
            id,
            ...problem,
            grounded: true,
            groundingChunks: p1Grounding?.groundingChunks?.length || 0,
          },
        });
        controller.close();
      } catch (error) {
        console.error("[GenerateProblem] Error:", error);
        send("error", { error: "Failed to generate problem" });
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
