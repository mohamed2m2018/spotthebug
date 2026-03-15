/**
 * Langfuse server-side client singleton.
 *
 * Uses LANGFUSE_SECRET_KEY + LANGFUSE_PUBLIC_KEY for full API access.
 * Only used by server-side API routes (/api/trace, /api/voice/token).
 *
 * Browser-side tracing goes through /api/trace via traceClient.ts.
 */

import Langfuse from "langfuse";

let _langfuseServer: Langfuse | null = null;

export function getLangfuseServer(): Langfuse {
  if (!_langfuseServer) {
    _langfuseServer = new Langfuse({
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
    });
  }
  return _langfuseServer;
}
