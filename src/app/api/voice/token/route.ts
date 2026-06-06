import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, Modality } from "@google/genai";
import { getLangfuseServer } from "@/lib/langfuse";
import { HUNT_VOICE_SYSTEM_PROMPT, PAIR_VOICE_SYSTEM_PROMPT, SOLVE_VOICE_SYSTEM_PROMPT, SQL_VOICE_SYSTEM_PROMPT, SYSDESIGN_VOICE_SYSTEM_PROMPT, EXPLAIN_VOICE_SYSTEM_PROMPT, buildGroundedInstruction } from "@/config/prompts";
import type { ReviewFinding } from "@/config/prompts";
import { VOICE_MODEL } from "@/config/voiceModel";

const SYSTEM_PROMPTS: Record<string, string> = {
  hunt: HUNT_VOICE_SYSTEM_PROMPT,
  pair: PAIR_VOICE_SYSTEM_PROMPT,
  solve: SOLVE_VOICE_SYSTEM_PROMPT,
  sql: SQL_VOICE_SYSTEM_PROMPT,
  sysdesign: SYSDESIGN_VOICE_SYSTEM_PROMPT,
  explain: EXPLAIN_VOICE_SYSTEM_PROMPT,
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
    const mode = (["pair", "hunt", "solve", "sql", "sysdesign", "explain"].includes(body.mode)) ? body.mode : "hunt";

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
      input: { mode, model: VOICE_MODEL },
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
          model: VOICE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            // No explicit temperature: with gemini-3.1-flash-live native audio,
            // setting it (esp. 0) triggers intermittent no-audio / runaway / 1011.
            // Omitting it entirely is the community-verified clean config
            // (googleapis/js-genai#1578).
            systemInstruction: {
              parts: [{ text: systemInstruction }]
            },
            // Context window compression → extend sessions beyond 10-min connection limit
            contextWindowCompression: {
              triggerTokens: "200000",
              slidingWindow: { targetTokens: "100000" },
            },
            // Session resumption (opaque — transparent mode is Vertex-only, not
            // supported on the Gemini Developer API). Survives WebSocket resets.
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
