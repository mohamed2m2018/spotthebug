import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

/**
 * POST /api/study-guide
 *
 * Generates a printable interview cheat-sheet for a track's syllabus: per topic
 * a mental model, core idea, tricks/cues, complexity/trade-offs, and gotchas.
 * The client renders it to a printable page → save as PDF.
 */

export const runtime = "nodejs";

const AREA_LABEL: Record<string, string> = {
  dsa: "data-structures & algorithms problem-solving patterns",
  sql: "SQL & databases",
  sysdesign: "backend engineering & system design",
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const area: string = body.area || "dsa";
  const topics: string[] = Array.isArray(body.topics) ? body.topics : [];
  const journal: { topic: string; transcript: string }[] = Array.isArray(body.journal) ? body.journal : [];
  if (!topics.length) return NextResponse.json({ error: "No topics provided" }, { status: 400 });

  // Personalized section is built from the learner's own session transcripts.
  const journalText = journal
    .map((j) => `### ${j.topic}\n${j.transcript}`)
    .join("\n\n")
    .slice(0, 24000);
  const personalizedBlock = journalText
    ? `\n\nThe learner had these coaching sessions (transcripts; "Coach:" = AI, "Developer:" = the learner). Mine them for a PERSONALIZED review:\n${journalText}\n\nFrom the transcripts, fill "personalized" with:\n- mistakes: specific things the learner got wrong or the coach had to correct.\n- misconceptions: wrong mental models the learner showed, with the correction.\n- questions: things the learner asked about (so they can revisit).\n- weakSpots: topics/concepts they struggled with most.\nIf the transcripts are empty or unclear, return empty arrays.`
    : `\n\nNo personal transcripts available — return "personalized" with empty arrays.`;

  const ai = new GoogleGenAI({ apiKey });
  try {
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `You are creating a concise INTERVIEW cheat-sheet for ${AREA_LABEL[area] || area}.
For EACH topic below, write one compact entry. Write in clear ARABIC, but keep all technical terms, keywords, and code in English.

Topics:
${topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

For each topic give:
- mentalModel: the governing mental model in ONE vivid everyday analogy (Arabic).
- coreIdea: the key idea / how it works, 1-2 sentences (Arabic, English terms).
- tricks: 2-4 short cues — how to RECOGNIZE when to use it and the key trick to apply it.
- complexity: time/space Big-O, or the main performance/scaling trade-off (short).
- gotchas: 1-3 common mistakes or interview follow-ups.
Be concise and high-signal — this is a last-minute review sheet.${personalizedBlock}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object" as const,
          properties: {
            entries: {
              type: "array" as const,
              items: {
                type: "object" as const,
                properties: {
                  topic: { type: "string" as const },
                  mentalModel: { type: "string" as const },
                  coreIdea: { type: "string" as const },
                  tricks: { type: "array" as const, items: { type: "string" as const } },
                  complexity: { type: "string" as const },
                  gotchas: { type: "array" as const, items: { type: "string" as const } },
                },
                required: ["topic", "mentalModel", "coreIdea", "tricks", "complexity", "gotchas"],
              },
            },
            personalized: {
              type: "object" as const,
              properties: {
                mistakes: { type: "array" as const, items: { type: "string" as const } },
                misconceptions: { type: "array" as const, items: { type: "string" as const } },
                questions: { type: "array" as const, items: { type: "string" as const } },
                weakSpots: { type: "array" as const, items: { type: "string" as const } },
              },
              required: ["mistakes", "misconceptions", "questions", "weakSpots"],
            },
          },
          required: ["entries", "personalized"],
        },
      },
    });
    const data = JSON.parse(res.text || "{}");
    return NextResponse.json({ area, entries: data.entries || [], personalized: data.personalized || null });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
