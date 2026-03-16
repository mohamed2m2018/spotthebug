import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { console.error("No GEMINI_API_KEY"); return; }
  
  const ai = new GoogleGenAI({ apiKey });

  // Phase 1: free text with grounding
  console.log("Phase 1: Generating with grounding (free text)...");
  const p1 = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Generate a beginner JavaScript coding problem about arrays. Include title, description, examples, starter code, reference solution, 3 hints, and test cases.`,
    config: { tools: [{ googleSearch: {} }] },
  });
  console.log("Phase 1 OK:", p1.text?.substring(0, 100));
  console.log("Grounding:", p1.candidates?.[0]?.groundingMetadata?.searchEntryPoint ? "YES" : "NO");

  // Phase 3: JSON schema (no tools)
  console.log("\nPhase 3: Structuring into JSON (no search)...");
  const p3 = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Extract this problem into JSON:\n${p1.text}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object" as const,
        properties: {
          title: { type: "string" as const },
          description: { type: "string" as const },
          starterCode: { type: "string" as const },
        },
        required: ["title", "description", "starterCode"],
      },
    },
  });
  const result = JSON.parse(p3.text || "{}");
  console.log("Phase 3 OK! Title:", result.title);
  console.log("Full result:", JSON.stringify(result, null, 2).substring(0, 300));
}

test().catch(console.error);
