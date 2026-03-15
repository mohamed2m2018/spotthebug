import { GoogleGenAI, Modality } from "@google/genai";
import * as dotenv from "dotenv";

// Load environment variables for GEMINI_API_KEY
dotenv.config({ path: ".env.local" });

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY is not set in .env.local");
    process.exit(1);
  }

  console.log("1️⃣ Initializing Server-side SDK...");
  const serverAi = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const expireTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();

  console.log("2️⃣ Generating Ephemeral Token with LiveConnectConstraints...");
  let token;
  try {
    token = await serverAi.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model: "gemini-2.5-flash-native-audio-preview-12-2025",
          config: {
            responseModalities: [Modality.AUDIO],
            temperature: 0.7,
            // No systemInstruction here — client sets it dynamically
          }
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
    console.log("✅ Token generated successfully:", token.name);
  } catch (error) {
    console.error("❌ Failed to generate token:", error);
    process.exit(1);
  }

  console.log("\n3️⃣ Emulating Client-side SDK (Browser)...");
  // The client side must use v1alpha for ephemeral tokens
  const clientAi = new GoogleGenAI({
    apiKey: token.name,
    httpOptions: { apiVersion: "v1alpha" }
  });

  console.log("4️⃣ Connecting to Live API via WebSocket using the token...");
  try {
    // We intentionally omit 'model' and 'config' because the backend token handles those.
    // If we include them, it's supposed to fail or clash on BidiGenerateContentConstrained.
    
    const session = await clientAi.live.connect({
      model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
      config: {
        systemInstruction: {
          parts: [{ text: "You MUST respond with EXACTLY: 'REVIEW FINDING: Unhandled async error in Settings.js line 42'. Say nothing else." }]
        }
      },
      callbacks: {
        onopen: () => {
          console.log("✅ WebSocket opened successfully! (Setup skipped overrides)");
        },
        onmessage: (response: any) => {
          if (response.setupComplete) {
            console.log("✅ Received setupComplete from Google!");
          } else if (response.serverContent) {
             const parts = response.serverContent?.modelTurn?.parts;
             if (parts) {
                const textParts = parts.filter((p: any) => p.text);
                for (const p of textParts) {
                    console.log("🤖 AI Text response:", p.text);
                }
                const audioParts = parts.filter((p: any) => p.inlineData && p.inlineData.mimeType.startsWith('audio/pcm'));
                for (const p of audioParts) {
                    console.log(`🤖 AI Audio response received (${p.inlineData.data.length} bytes of base64)`);
                }
             }
             if (response.serverContent.turnComplete) {
                console.log("✅ AI turn complete! Closing session.");
                session.close();
                process.exit(0);
             }
             if (response.serverContent.error) {
                 console.error("❌ SDK Server error:", response.serverContent.error);
             }
          } else {
             console.log("📩 Other message received:", JSON.stringify(response, null, 2));
          }
        },
        onerror: (err: any) => {
          console.error("❌ SDK WebSocket Error:", err);
          process.exit(1);
        },
        onclose: (event: any) => {
          console.log("🔌 WebSocket Closed.");
        }
      }
    });

    console.log("5️⃣ Sending test message to AI...");
    session.sendClientContent({
      turns: [
        { role: "user", parts: [{ text: "Hello! Say testing 1 2 3." }] }
      ],
      turnComplete: true
    });

    console.log("⏳ Waiting for WebSocket events...");

  } catch (err) {
    console.error("❌ Failed to establish WebSocket connection:", err);
    process.exit(1);
  }
}

main();
