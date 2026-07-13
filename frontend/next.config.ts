import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Workaround for Next.js 16 bug: when unset, config.generateBuildId becomes
  // undefined, but generateBuildId() calls it as a function without a guard.
  generateBuildId: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
  output: "standalone",
  images: { unoptimized: true },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Keep the Pi SDK out of the webpack/turbopack bundle so it loads from
  // node_modules at runtime (Node-only deps, dynamic jiti loader, etc.).
  //
  // `ws` (CDP browser host transport) must also stay external: when webpack
  // bundles it, the late `module.exports.mask = …` reassignment in ws's
  // buffer-util.js (the bufferutil-optional path) is mangled so the frame masker
  // resolves to a non-function. Outgoing WebSocket frames then either corrupt on
  // the wire (Chromium replies JSON-RPC -32700) or throw "b.mask is not a
  // function", and every Page.startScreencast / Input.dispatchMouseEvent call
  // hangs until it times out. Loaded from node_modules, the unbundled masker
  // works and the screencast/input paths are solid.
  serverExternalPackages: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
    "jiti",
    "ws",
  ],
  // pi-ai's register-builtins.js pulls each provider (openai-completions, etc.)
  // in dynamically, which Next's standalone tracer follows inconsistently — so a
  // build can silently omit e.g. openai-completions.js and the agent then throws
  // "Cannot find module …/providers/openai-completions.js" at runtime. Force the
  // whole pi-ai dist (top-level AND the copy nested under pi-coding-agent) into
  // the standalone output so the provider set is always complete.
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/@earendil-works/pi-ai/dist/**/*.js",
      "./node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/**/*.js",
    ],
  },
  // Ships raw .ts sources (no build step) — Next must transpile it.
  //
  // @local-studio/agent-runtime also ships raw .ts (services/agent-runtime), so
  // it cannot be externalized (Node can't execute TypeScript at runtime in the
  // standalone server) — it is transpiled and bundled with the app. Long-lived
  // runtime state survives dev HMR through the package's single globalThis
  // registry (services/agent-runtime/src/instances.ts).
  transpilePackages: ["@local-studio/contracts", "@local-studio/agent-runtime"],
  // The package and shared/agent live outside frontend/, so their real paths
  // don't have frontend/node_modules on the walk-up resolution path. Teach
  // webpack to also look here for their external deps (effect, the pi SDK).
  webpack: (config, { nextRuntime }) => {
    config.resolve.modules = [
      ...(config.resolve.modules ?? ["node_modules"]),
      path.join(__dirname, "node_modules"),
    ];
    // instrumentation.ts is compiled for the edge runtime too. Its node-only
    // half (instrumentation-node.ts, node:net) is behind a NEXT_RUNTIME gate,
    // but dev builds don't dead-code-eliminate the gated dynamic import, so
    // the edge compile still tries to read the node: scheme and fails
    // (UnhandledSchemeError). Stub it out for edge — the gate keeps it from
    // ever executing there.
    if (nextRuntime === "edge") {
      config.resolve.alias = {
        ...config.resolve.alias,
        "node:net": false,
      };
    }
    return config;
  },
  // No resolveAlias here: turbopack rejects absolute alias targets ("server
  // relative imports are not implemented yet"), and none is needed — the
  // services/node_modules → frontend/node_modules symlink (postinstall
  // link-services-node-modules.mjs) puts effect/the pi SDK on the walk-up
  // path for the out-of-root agent-runtime sources.
  turbopack: {
    root: path.join(__dirname, ".."),
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
  async headers() {
    // Baseline security headers. The CSP is intentionally permissive on inline
    // scripts/styles (Next's hydration + theme bootstrap script, Tailwind, xterm,
    // highlight.js) and on connect targets (same-origin proxy, SSE/WebSocket),
    // so it adds a backstop without breaking the app; it can be tightened later
    // with per-request nonces. `frame-ancestors 'none'` blocks clickjacking.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https: http: ws: wss:",
      "frame-src 'self' https: http:",
      "media-src 'self' blob: data:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
