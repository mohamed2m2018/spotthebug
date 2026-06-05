import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The live voice session has a stateful WebSocket/AudioContext lifecycle that
  // React StrictMode's dev mount→unmount→remount double-invoke corrupts (the
  // unmount cleanup tears down the session mid-startup → dropped opening audio).
  // Production never double-mounts; disable it so dev matches production.
  reactStrictMode: false,
  serverExternalPackages: [
    "@opentelemetry/sdk-node",
    "@google/adk",
    "@google-cloud/opentelemetry-cloud-monitoring-exporter",
    "@google-cloud/opentelemetry-cloud-trace-exporter",
    "@opentelemetry/resource-detector-gcp",
  ],
};

export default nextConfig;
