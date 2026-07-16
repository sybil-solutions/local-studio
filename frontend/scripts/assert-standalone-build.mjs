#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const standaloneBase = resolve(projectRoot, ".next", "standalone");
const candidates = [
  resolve(standaloneBase, "frontend", "server.js"),
  resolve(standaloneBase, "server.js"),
];

function filesUnder(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));
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

if (!candidates.some((candidate) => existsSync(candidate))) {
  throw new Error(`Missing standalone server: ${candidates.join(", ")}`);
}

const unexpected = filesUnder(standaloneBase).filter((file) => !isRuntimeFile(file));

if (unexpected.length > 0) {
  throw new Error(
    `Standalone build contains non-runtime files:\n${unexpected
      .map((file) => relative(standaloneBase, file))
      .join("\n")}`,
  );
}

console.log("  standalone server build is minimal");
