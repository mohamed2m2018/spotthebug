/**
 * Next.js Instrumentation Hook — runs once on server start.
 * 
 * Initializes Langfuse via OpenTelemetry to auto-capture all @google/genai
 * SDK calls (prompts, responses, tokens, costs, latency).
 * 
 * Docs: https://langfuse.com/docs/get-started
 */

export async function register() {
  // Only run on the Node.js server runtime (not Edge, not browser)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { LangfuseSpanProcessor } = await import("@langfuse/otel");

    const sdk = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor()],
    });

    sdk.start();

    console.log("[Langfuse] ✅ Server-side OTel tracing initialized");
  }
}
