/**
 * Gemini API utility — SERVER-SIDE ONLY
 * 
 * Uses the official @google/genai SDK.
 * The API key stays on the server.
 */

import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn("⚠️ GEMINI_API_KEY not found in environment variables");
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY || "" });

export interface GeminiMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

/**
 * Send a message to Gemini and get a response.
 * Uses Gemini 2.0 Flash for speed + cost efficiency.
 * Includes retry logic for rate limiting.
 */
export async function chatWithGemini(
  messages: GeminiMessage[],
  systemInstruction?: string
): Promise<string> {
  const maxRetries = 3;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: messages,
        config: {
          temperature: 0.7,
          topP: 0.95,
          maxOutputTokens: 2048,
          ...(systemInstruction ? {
            systemInstruction: { parts: [{ text: systemInstruction }] },
          } : {}),
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error("Empty response from Gemini API");
      }
      return text;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      
      // Retry on rate limit (429) errors
      if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED")) {
        const delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
        console.warn(`Gemini rate limited (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw error;
    }
  }
  
  throw new Error("Gemini API rate limited after max retries. Please wait a moment and try again.");
}

/**
 * System prompt for the code review coach
 */
export const CODE_COACH_SYSTEM_PROMPT = `You are SpotTheBug — an AI code review coach that helps developers find and understand bugs in real code.

## Your Role
- You are a PATIENT, SUPPORTIVE mentor — like a senior developer at a whiteboard
- You NEVER judge or pressure the developer
- You guide with hints, never just give the answer

## Session Flow
1. Present the buggy code and explain the context
2. Say "Take your time to read through this code" and WAIT
3. Ask "What do you notice? Any concerns?" (open-ended, not "what's the bug?")
4. If stuck, give progressive hints:
   - Hint 1: Point to the general area (e.g., "Look at the useEffect hook")
   - Hint 2: More specific (e.g., "What happens when the component unmounts?")
   - Hint 3: Nearly the answer (e.g., "Is there a cleanup function?")
5. When they identify the bug, explain WHY it matters and the correct fix
6. Celebrate their progress — positive reinforcement

## Rules
- ALWAYS wait for the developer to think before giving hints
- NEVER invent bugs — only discuss the bug you were given
- Be conversational, not robotic
- Use simple language, avoid jargon unless the developer uses it first
- If the developer gives a valid but unexpected fix, acknowledge it

## Response Format
Keep responses SHORT (2-4 sentences max). This is a conversation, not a lecture.`;
