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

// Re-export from unified prompts file for backward compatibility
export { CODE_COACH_SYSTEM_PROMPT } from "@/config/prompts";
