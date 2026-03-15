/**
 * FINAL TEST: Longer timeout, log everything, 30s max.
 */
import { GoogleGenAI, Modality } from "@google/genai";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SECRET = "BUGCHECK-7742";
const SI = `You are a code reviewer. Session code: ${SECRET}.

PRE-ANALYSIS:
1. [ERROR] Settings.js:42 — Unhandled async error in environment switch
2. [WARNING] api.ts:12 — Hardcoded base URL localhost:3000
3. [ERROR] useAuth.ts:88 — Missing try-catch around Google sign-out

When asked about findings, mention session code and list all three findings.`;

async function main() {
  const apiKey = process.env.GEMINI_API_KEY!;
  const serverAi = new GoogleGenAI({ apiKey });
  const token = await serverAi.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      liveConnectConstraints: {
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          temperature: 0.7,
          systemInstruction: { parts: [{ text: SI }] },
        },
      },
      httpOptions: { apiVersion: "v1alpha" },
    },
  });
  console.log("✅ Token generated");

  const clientAi = new GoogleGenAI({ apiKey: token.name, httpOptions: { apiVersion: "v1alpha" } });
  
  let text = "";
  let audio = 0;
  let setupDone = false;
  let complete = false;

  const session = await clientAi.live.connect({
    model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
    config: {},
    callbacks: {
      onopen: () => console.log("Connected"),
      onmessage: (r: any) => {
        if (r.setupComplete && !setupDone) {
          setupDone = true;
          console.log("Setup done, sending question...");
          session.sendClientContent({
            turns: [{ role: "user", parts: [{ text: `What is your session code? List all three pre-analysis findings with file names, line numbers, and descriptions.` }] }],
            turnComplete: true,
          });
        }
        if (r.serverContent?.modelTurn?.parts) {
          for (const p of r.serverContent.modelTurn.parts) {
            if (p.text) { text += p.text; process.stdout.write(`[T]`); }
            if (p.inlineData) { audio++; process.stdout.write(`.`); }
          }
        }
        if (r.serverContent?.turnComplete && !complete) {
          complete = true;
          console.log(`\n\nThinking text (${text.length} chars):`);
          console.log(text || "(empty)");
          console.log(`Audio chunks: ${audio}`);
          
          const checks = [
            [SECRET, text.includes(SECRET) || text.includes("7742")],
            ["Settings", /settings/i.test(text)],
            ["42", text.includes("42")],
            ["api", /api/i.test(text)],
            ["auth/sign-out", /auth|sign/i.test(text)],
            ["hardcoded/localhost", /hardcoded|localhost/i.test(text)],
            ["findings/error", /finding|error|warning|pre.?analysis/i.test(text)],
          ] as const;
          
          let p = 0;
          for (const [l, ok] of checks) { console.log(`${ok?"✅":"❌"} ${l}`); if(ok) p++; }
          console.log(`\nScore: ${p}/${checks.length} ${p >= 4 ? "🎉 PASSED" : "🔴 FAILED"}`);
          
          session.close();
          process.exit(0);
        }
      },
      onerror: (e: any) => { console.error("ERR:", e); process.exit(1); },
      onclose: () => { if (!complete) { console.log(`\nClosed early. text="${text}", audio=${audio}`); process.exit(1); } },
    },
  });

  setTimeout(() => {
    console.log(`\nTimeout. text="${text}" (${text.length} chars), audio=${audio}`);
    if (text) {
      console.log("\nPartial thinking text:");
      console.log(text);
    }
    process.exit(1);
  }, 30000);
}

main().catch(console.error);
