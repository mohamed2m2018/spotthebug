/**
 * Test script: Sends trace events directly to the running dev server
 * and then queries Langfuse API to verify data was stored.
 *
 * Usage: npx tsx test-trace.ts
 * Requires: npm run dev running on port 3000
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const API_URL = "http://localhost:3000/api/trace";
const SESSION_ID = `test_trace_${Date.now()}`;

async function sendBatch(batch: any[]) {
  console.log(`\n📤 Sending batch of ${batch.length} events...`);
  console.log("   Payload preview:", JSON.stringify(batch[0], null, 2).slice(0, 300));

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batch }),
  });

  const responseText = await res.text();
  console.log(`   Response status: ${res.status}`);
  console.log(`   Response body: ${responseText}`);
  return res.ok;
}

async function queryLangfuse(traceId: string) {
  const baseUrl = process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com";
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    console.log("⚠️  No Langfuse keys found, skipping direct query");
    return null;
  }

  // Query Langfuse API directly to see if data was stored
  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  const url = `${baseUrl}/api/public/traces?name=pair.session&limit=1&orderBy=timestamp&order=DESC`;

  console.log(`\n🔍 Querying Langfuse: ${url}`);
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!res.ok) {
    console.log(`   ❌ Langfuse query failed: ${res.status} ${await res.text()}`);
    return null;
  }

  const data = await res.json();
  const trace = data.data?.[0];
  if (!trace) {
    console.log("   ❌ No trace found in Langfuse");
    return null;
  }

  console.log(`   ✅ Found trace: ${trace.id}`);
  console.log(`   Name: ${trace.name}`);
  console.log(`   Metadata: ${JSON.stringify(trace.metadata)}`);

  // Get observations for this trace
  const obsUrl = `${baseUrl}/api/public/observations?traceId=${trace.id}&limit=20`;
  const obsRes = await fetch(obsUrl, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (obsRes.ok) {
    const obsData = await obsRes.json();
    console.log(`\n   📊 Observations (${obsData.data?.length || 0} total):`);
    for (const ob of obsData.data || []) {
      console.log(`     - ${ob.name}: input=${JSON.stringify(ob.input)?.slice(0, 200)} | output=${JSON.stringify(ob.output)?.slice(0, 200)} | meta=${JSON.stringify(ob.metadata)?.slice(0, 200)}`);
    }
  }

  return trace;
}

async function main() {
  console.log("=== TRACE PIPELINE TEST ===");
  console.log(`Session ID: ${SESSION_ID}`);

  // Step 1: Start trace
  const ok1 = await sendBatch([
    {
      action: "startTrace",
      sessionId: SESSION_ID,
      mode: "pair",
      metadata: { test: true, startedAt: new Date().toISOString() },
      timestamp: Date.now(),
    },
  ]);
  if (!ok1) { console.log("❌ Failed to start trace"); return; }

  // Step 2: Send event with data
  await new Promise(r => setTimeout(r, 500));

  const ok2 = await sendBatch([
    {
      action: "event",
      sessionId: SESSION_ID,
      name: "ws.open",
      input: { systemInstruction: "You are a senior software engineer with 15+ years..." },
      metadata: { hasReviewFindings: true, hasScreenStream: true, toolCount: 2 },
      timestamp: Date.now(),
    },
    {
      action: "event",
      sessionId: SESSION_ID,
      name: "ai.transcript",
      output: { text: "Hello! I can see your screen. Let me take a look at the code." },
      metadata: { messageNum: 1 },
      timestamp: Date.now(),
    },
    {
      action: "event",
      sessionId: SESSION_ID,
      name: "screen.frame",
      metadata: { frameNum: 1, width: 1920, height: 1080, sizeKB: 45 },
      timestamp: Date.now(),
    },
  ]);
  if (!ok2) { console.log("❌ Failed to send events"); return; }

  // Step 3: End trace (forces Langfuse flush)
  await new Promise(r => setTimeout(r, 500));

  const ok3 = await sendBatch([
    {
      action: "endTrace",
      sessionId: SESSION_ID,
      output: { summary: "Test session completed" },
      timestamp: Date.now(),
    },
  ]);
  if (!ok3) { console.log("❌ Failed to end trace"); return; }

  console.log("\n✅ All batches sent successfully!");

  // Step 4: Wait for Langfuse to ingest, then query
  console.log("\n⏳ Waiting 5s for Langfuse to ingest...");
  await new Promise(r => setTimeout(r, 5000));

  await queryLangfuse(SESSION_ID);

  console.log("\n=== TEST COMPLETE ===");
}

main().catch(console.error);
