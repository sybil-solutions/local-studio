#!/usr/bin/env node
// Repairs the standalone output after `next build`, because Next/Turbopack's
// file tracer is unreliable in both directions here:
//
// 1. It MISSES runtime dependencies loaded dynamically (pi-ai's jiti provider
//    loader, typebox's lazy imports) — `outputFileTracingIncludes` has proven
//    ineffective across versions, so the needed trees are copied explicitly.
// 2. It VACUUMS the whole project (the agent's fs routes legitimately use
//    dynamic paths, which flips the tracer into whole-project mode) and
//    `outputFileTracingExcludes` is ignored, so sources, desktop bundles, and
//    data snapshots land in the output. Those are pruned — but only after
//    proving each file is a byte-for-byte (data/) or same-size copy of a repo
//    source, so state written by a locally *run* standalone server (the server
//    runs with its cwd inside this directory) can never be destroyed.
//
// assert-standalone-build.mjs then independently verifies the result.
import { cpSync, existsSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(projectRoot, "..");
const standaloneBase = resolve(projectRoot, ".next", "standalone");
const standaloneRoots = [resolve(standaloneBase, "frontend"), standaloneBase];
const standaloneRoot = standaloneRoots.find((root) => existsSync(resolve(root, "server.js")));

if (!standaloneRoot) {
  throw new Error(`Missing standalone server under: ${standaloneBase}`);
}

const runtimeDependencyPaths = [
  "node_modules/typebox",
  "node_modules/@earendil-works/pi-ai/dist",
  "node_modules/@earendil-works/pi-coding-agent/node_modules/typebox",
  "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist",
];

for (const dependencyPath of runtimeDependencyPaths) {
  const source = resolve(projectRoot, dependencyPath);
  if (!existsSync(source)) {
    throw new Error(`Missing runtime dependency source: ${dependencyPath}`);
  }
  cpSync(source, resolve(standaloneRoot, dependencyPath), { recursive: true });
}

function isRuntimeFile(file) {
  const path = relative(standaloneBase, file).replaceAll("\\", "/");
  return [
    "server.js",
    "package.json",
    ".next/",
    "public/",
    "node_modules/",
    "frontend/server.js",
    "frontend/package.json",
    "frontend/.next/",
    "frontend/public/",
    "frontend/node_modules/",
  ].some((prefix) => path === prefix || path.startsWith(prefix));
}

function filesUnder(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));
}

function isVerifiedCopy(file, repoRelativePath) {
  const source = resolve(repoRoot, repoRelativePath);
  if (!existsSync(source)) return false;
  const sourceStat = statSync(source);
  const copyStat = statSync(file);
  if (!sourceStat.isFile() || sourceStat.size !== copyStat.size) return false;
  // Anything under a data/ tree could in principle be live state written by a
  // previously-run standalone server, so require byte equality there.
  const isData = repoRelativePath === "data" || /(^|\/)data\//.test(repoRelativePath);
  if (!isData) return true;
  return readFileSync(source).equals(readFileSync(file));
}

const unverified = [];
let pruned = 0;

for (const file of filesUnder(standaloneBase)) {
  if (isRuntimeFile(file)) continue;
  const repoRelativePath = relative(standaloneBase, file).replaceAll("\\", "/");
  if (!isVerifiedCopy(file, repoRelativePath)) {
    unverified.push(repoRelativePath);
    continue;
  }
  unlinkSync(file);
  pruned += 1;
}

if (unverified.length > 0) {
  throw new Error(
    `Standalone output contains non-runtime files with no matching repo source; ` +
      `refusing to prune them (move them aside manually if expected):\n${unverified.join("\n")}`,
  );
}

function removeEmptyDirectories(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirectories(resolve(directory, entry.name));
  }
  if (directory !== standaloneBase && readdirSync(directory).length === 0) {
    rmdirSync(directory);
  }
}
removeEmptyDirectories(standaloneBase);

console.log(
  `  standalone repaired: +${runtimeDependencyPaths.length} runtime dependency trees, -${pruned} traced non-runtime files`,
);
