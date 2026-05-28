import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";
import path from "path";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  output: "standalone",
  images: { unoptimized: true },
  // Keep the Pi SDK out of the webpack/turbopack bundle so it loads from
  // node_modules at runtime (Node-only deps, dynamic jiti loader, etc.).
  serverExternalPackages: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
    "jiti",
  ],
  turbopack: {
    root: path.join(__dirname, ".."),
    resolveAlias: {
      tailwindcss: path.join(__dirname, "node_modules/tailwindcss"),
    },
  },
  async redirects() {
    return [
      {
        source: "/models",
        destination: "/recipes",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/chat-v2",
        destination: "/api/chat",
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
