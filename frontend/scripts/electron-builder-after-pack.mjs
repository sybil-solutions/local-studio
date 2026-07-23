import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function resolveResourcesDir(appOutDir, productFilename, electronPlatformName) {
  if (electronPlatformName === "darwin" || electronPlatformName === "mas") {
    return path.join(appOutDir, `${productFilename}.app`, "Contents", "Resources");
  }
  return path.join(appOutDir, "resources");
}

export default async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const productFilename = packager.appInfo.productFilename;

  const resourcesDir = resolveResourcesDir(appOutDir, productFilename, electronPlatformName);
  const standaloneBase = path.join(resourcesDir, "app", "frontend", ".next", "standalone");

  const candidates = [
    path.join(standaloneBase, "frontend", "server.js"),
    path.join(standaloneBase, "server.js"),
  ];

  const standaloneServer = candidates.find((candidate) => existsSync(candidate));
  if (!standaloneServer) {
    throw new Error(
      [
        "Packaged app is missing the embedded Next standalone server — refusing to sign/ship a broken bundle.",
        `Looked for: ${candidates.join(" or ")}`,
        'electron-builder failed to copy extraResources from .next/standalone (it can log "file source doesn\'t exist" yet still exit 0).',
        "Re-run the build (run `npm run build` first if .next/standalone is absent).",
      ].join("\n  "),
    );
  }

  const standaloneRoot = path.dirname(standaloneServer);
  const requiredRuntimeFiles = [
    path.join(
      standaloneRoot,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "dist",
      "index.js",
    ),
    path.join(
      standaloneRoot,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "node_modules",
      "@earendil-works",
      "pi-ai",
      "package.json",
    ),
  ];
  const missingRuntimeFile = requiredRuntimeFiles.find((file) => !existsSync(file));
  if (missingRuntimeFile) {
    throw new Error(`Packaged app is missing a Pi runtime dependency: ${missingRuntimeFile}`);
  }

  const agentRuntimeRoot = path.join(resourcesDir, "app", "agent-runtime");
  const agentRuntime = path.join(agentRuntimeRoot, "standalone.mjs");
  const requiredAgentRuntimeFiles = [
    agentRuntime,
    path.join(agentRuntimeRoot, "node_modules", "playwright-core", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "chromium-bidi", "package.json"),
    path.join(
      agentRuntimeRoot,
      "node_modules",
      "chromium-bidi",
      "node_modules",
      "zod",
      "package.json",
    ),
    path.join(agentRuntimeRoot, "node_modules", "mitt", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "devtools-protocol", "package.json"),
  ];
  const missingAgentRuntimeFile = requiredAgentRuntimeFiles.find((file) => !existsSync(file));
  if (missingAgentRuntimeFile) {
    throw new Error(`Packaged app is missing an agent runtime dependency: ${missingAgentRuntimeFile}`);
  }

  const agentRuntimeSource = readFileSync(agentRuntime, "utf8");
  const absolutePlaywrightPath =
    /["'](?:[A-Za-z]:\\|\/)[^"'\n]*node_modules[\\/]playwright-core[\\/]/;
  if (absolutePlaywrightPath.test(agentRuntimeSource)) {
    throw new Error("Packaged agent runtime contains a build-machine Playwright path");
  }

  console.log(`  afterPack: embedded frontend and agent runtime present (${electronPlatformName})`);
}
