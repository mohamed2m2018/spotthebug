"use client";

import { loadJournal } from "@/lib/learningJournal";

/**
 * Generate a printable study guide (cheat-sheet + personalized review) for a
 * track and open it in a new tab for the user to save as PDF (browser print).
 */

const AREA_TITLE: Record<string, string> = {
  dsa: "Problem Solving (DSA)",
  sql: "SQL & Databases",
  sysdesign: "Backend & System Design",
};

interface Entry {
  topic: string;
  mentalModel: string;
  coreIdea: string;
  tricks: string[];
  complexity: string;
  gotchas: string[];
}
interface Personalized {
  mistakes: string[];
  misconceptions: string[];
  questions: string[];
  weakSpots: string[];
}

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function list(items: string[]): string {
  return (items || []).map((i) => `<li dir="auto">${esc(i)}</li>`).join("");
}

function buildHtml(area: string, entries: Entry[], p: Personalized | null): string {
  const title = AREA_TITLE[area] || area;
  const cards = entries.map((e) => `
    <section class="card">
      <h2 dir="auto">${esc(e.topic)}</h2>
      <p dir="auto"><b>🧠 Mental model:</b> ${esc(e.mentalModel)}</p>
      <p dir="auto"><b>💡 Core idea:</b> ${esc(e.coreIdea)}</p>
      <p><b>🎯 Tricks / cues:</b></p><ul>${list(e.tricks)}</ul>
      <p dir="auto"><b>⚙️ Complexity / trade-off:</b> ${esc(e.complexity)}</p>
      <p><b>⚠️ Gotchas:</b></p><ul>${list(e.gotchas)}</ul>
    </section>`).join("");

  const hasPersonal = p && (p.mistakes?.length || p.misconceptions?.length || p.questions?.length || p.weakSpots?.length);
  const personal = hasPersonal ? `
    <section class="card personal">
      <h2>📌 Your personalized review</h2>
      ${p!.weakSpots?.length ? `<p><b>Weak spots:</b></p><ul>${list(p!.weakSpots)}</ul>` : ""}
      ${p!.mistakes?.length ? `<p><b>Mistakes you made:</b></p><ul>${list(p!.mistakes)}</ul>` : ""}
      ${p!.misconceptions?.length ? `<p><b>Misconceptions corrected:</b></p><ul>${list(p!.misconceptions)}</ul>` : ""}
      ${p!.questions?.length ? `<p><b>Questions you asked:</b></p><ul>${list(p!.questions)}</ul>` : ""}
    </section>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>Study Guide — ${esc(title)}</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 820px; margin: 0 auto; padding: 32px; color: #111; line-height: 1.6; }
    h1 { font-size: 1.6rem; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 14px 18px; margin: 14px 0; page-break-inside: avoid; }
    .card h2 { font-size: 1.1rem; margin: 0 0 8px; color: #6d28d9; }
    .personal { border-color: #16a34a; background: #f0fdf4; }
    .personal h2 { color: #15803d; }
    ul { margin: 4px 0 10px; padding-inline-start: 22px; }
    .bar { position: sticky; top: 0; background: #fff; padding: 8px 0; }
    button { padding: 8px 16px; border-radius: 8px; border: none; background: #6d28d9; color: #fff; font-weight: 700; cursor: pointer; }
    @media print { .bar { display: none; } }
  </style></head>
  <body>
    <div class="bar"><button onclick="window.print()">🖨️ Save as PDF</button></div>
    <h1>📚 Study Guide — ${esc(title)}</h1>
    ${personal}
    ${cards}
  </body></html>`;
}

export async function generateStudyGuide(area: string, topics: string[]): Promise<void> {
  const journal = loadJournal(area).map((j) => ({ topic: j.topic, transcript: j.transcript }));
  const win = window.open("", "_blank");
  if (win) win.document.write("<p style='font-family:sans-serif;padding:24px'>Generating your study guide… (this takes a few seconds)</p>");
  const res = await fetch("/api/study-guide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ area, topics, journal }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (win) win.document.body.innerHTML = `<p style='font-family:sans-serif;padding:24px;color:#b00'>Failed: ${esc(data.error || "error")}</p>`;
    return;
  }
  const html = buildHtml(area, data.entries || [], data.personalized || null);
  if (win) { win.document.open(); win.document.write(html); win.document.close(); }
}
