import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, Modality } from "@google/genai";
import { getLangfuseServer } from "@/lib/langfuse";
import { HUNT_VOICE_SYSTEM_PROMPT, PAIR_VOICE_SYSTEM_PROMPT, buildGroundedInstruction } from "@/config/prompts";
import type { ReviewFinding } from "@/config/prompts";

const SYSTEM_PROMPTS: Record<string, string> = {
  hunt: HUNT_VOICE_SYSTEM_PROMPT,
  pair: PAIR_VOICE_SYSTEM_PROMPT,
};

/**
 * POST /api/voice/token
 * 
 * Generates a short-lived ephemeral token for the Gemini Live API.
 * Accepts a `mode` parameter: "hunt" (bug training) or "pair" (screen share).
 * 
 * For "pair" mode, also accepts optional dynamic context:
 * - reviewFindings: pre-analyzed code issues to inject
 * - selectedFiles: files the developer changed
 * - goal: what the developer is working on
 * 
 * The systemInstruction is baked into the token's liveConnectConstraints
 * because Google's constrained tokens LOCK config — client-side
 * systemInstruction is silently ignored by the server.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini API key not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const mode = (body.mode === "pair") ? "pair" : "hunt";

    // Build system instruction: use grounded version if review data is provided
    let systemInstruction: string;
    if (mode === "pair" && body.reviewFindings) {
      const findings: ReviewFinding[] = body.reviewFindings;
      const selectedFiles: string[] | null = body.selectedFiles || null;
      const goal: string | undefined = body.goal;
      systemInstruction = buildGroundedInstruction(findings, selectedFiles, goal);
    } else {
      systemInstruction = SYSTEM_PROMPTS[mode];
    }

    // ── Langfuse trace ──
    const langfuse = getLangfuseServer();
    const trace = langfuse.trace({
      name: "voice.token.generate",
      metadata: {
        mode,
        hasGroundedInstruction: systemInstruction !== SYSTEM_PROMPTS[mode],
        systemInstructionLength: systemInstruction.length,
      },
    });
    const span = trace.span({
      name: "gemini.authToken.create",
      input: { mode, model: "gemini-2.5-flash-native-audio-preview-12-2025" },
    });

    const client = new GoogleGenAI({ apiKey });

    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    // Client can send a resumption handle for reconnects
    const resumptionHandle: string | undefined = body.resumptionHandle;

    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model: "gemini-2.5-flash-native-audio-preview-12-2025",
          config: {
            responseModalities: [Modality.AUDIO],
            temperature: 0.7,
            systemInstruction: {
              parts: [{ text: systemInstruction }]
            },
            // Context window compression → extend sessions beyond 10-min connection limit
            contextWindowCompression: {
              triggerTokens: "200000",
              slidingWindow: { targetTokens: "100000" },
            },
            // Session resumption → survive periodic WebSocket resets
            sessionResumption: {
              ...(resumptionHandle ? { handle: resumptionHandle } : {}),
            },
          }
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });

    span.end({ output: { tokenGenerated: true, expireTime } });

    return NextResponse.json({ token: token.name, mode });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errDetails = error instanceof Error ? error.stack : undefined;
    console.error("Failed to generate ephemeral token:", errMsg, errDetails);
    // Log error to Langfuse
    try {
      const langfuse = getLangfuseServer();
      langfuse.trace({
        name: "voice.token.generate.error",
        metadata: { error: errMsg },
      });
    } catch { /* tracing should never break the app */ }
    return NextResponse.json(
      { error: `Failed to generate voice session token: ${errMsg}` },
      { status: 500 }
    );
  }
}
