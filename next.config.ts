import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@opentelemetry/sdk-node",
    "@google/adk",
    "@google-cloud/opentelemetry-cloud-monitoring-exporter",
    "@google-cloud/opentelemetry-cloud-trace-exporter",
    "@opentelemetry/resource-detector-gcp",
  ],
};

export default nextConfig;
