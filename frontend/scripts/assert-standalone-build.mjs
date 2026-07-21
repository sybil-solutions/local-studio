#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const projectRoot = resolve(import.meta.dirname, "..");
const standaloneBase = resolve(projectRoot, ".next", "standalone");
const candidates = [
  resolve(standaloneBase, "frontend", "server.js"),
  resolve(standaloneBase, "server.js"),
];
const runtimeRoots = [resolve(standaloneBase, "frontend"), standaloneBase];
const requiredRuntimeFiles = [
  "node_modules/@earendil-works/pi-coding-agent/package.json",
  "node_modules/@earendil-works/pi-coding-agent/dist/index.js",
  "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/package.json",
  "node_modules/@earendil-works/pi-coding-agent/node_modules/typebox/build/value/shared/union_priority_sort.mjs",
];

function filesUnder(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));
}

function symlinksUnder(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isSymbolicLink())
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

for (const file of requiredRuntimeFiles) {
  if (!runtimeRoots.some((root) => existsSync(resolve(root, file)))) {
    throw new Error(`Missing standalone runtime dependency: ${file}`);
  }
}

const runtimeRoot = runtimeRoots.find((root) => existsSync(resolve(root, "server.js")));
const unsafeRuntimeLinks = runtimeRoot
  ? symlinksUnder(runtimeRoot).filter((link) => {
      if (isAbsolute(readlinkSync(link)) || !existsSync(link)) return true;
      const resolvedLink = relative(runtimeRoot, realpathSync(link));
      return (
        resolvedLink === ".." || resolvedLink.startsWith(`..${sep}`) || isAbsolute(resolvedLink)
      );
    })
  : [];
if (unsafeRuntimeLinks.length > 0) {
  throw new Error(`Unsafe standalone runtime links: ${unsafeRuntimeLinks.join(", ")}`);
}
const tracedPackageDirectory = runtimeRoot
  ? resolve(runtimeRoot, ".next/node_modules/@earendil-works")
  : undefined;
const danglingTracedPackages = tracedPackageDirectory
  ? existsSync(tracedPackageDirectory)
    ? readdirSync(tracedPackageDirectory)
        .map((entry) => resolve(tracedPackageDirectory, entry))
        .filter((entry) => lstatSync(entry).isSymbolicLink() && !existsSync(entry))
    : []
  : [];
if (danglingTracedPackages.length > 0) {
  throw new Error(`Dangling traced runtime packages: ${danglingTracedPackages.join(", ")}`);
}
const piCodingAgentRoot = runtimeRoot
  ? resolve(runtimeRoot, "node_modules/@earendil-works/pi-coding-agent")
  : null;
const piAiRoot = piCodingAgentRoot
  ? resolve(piCodingAgentRoot, "node_modules/@earendil-works/pi-ai")
  : null;
const piRuntimeEntries =
  piCodingAgentRoot && piAiRoot
    ? [resolve(piCodingAgentRoot, "dist/index.js"), resolve(piAiRoot, "dist/index.js")]
    : [];
if (piRuntimeEntries.length !== 2 || piRuntimeEntries.some((entry) => !existsSync(entry))) {
  throw new Error("Missing packaged Pi runtime entrypoints");
}
for (const entry of piRuntimeEntries) {
  const importCheck = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `import(${JSON.stringify(pathToFileURL(entry).href)})`],
    { cwd: runtimeRoot, encoding: "utf8" },
  );
  if (importCheck.status !== 0) {
    throw new Error(
      `Standalone Pi runtime entrypoint is not importable: ${importCheck.stderr || importCheck.stdout}`,
    );
  }
}

const piAiManifestPath = resolve(realpathSync(piAiRoot), "package.json");
const piAiManifest = JSON.parse(readFileSync(piAiManifestPath, "utf8"));
const requireFromPiAi = createRequire(piAiManifestPath);
for (const dependency of Object.keys(piAiManifest.dependencies ?? {})) {
  const resolvedDependency = realpathSync(requireFromPiAi.resolve(dependency));
  const runtimeRelativePath = relative(runtimeRoot, resolvedDependency);
  if (
    runtimeRelativePath === ".." ||
    runtimeRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(runtimeRelativePath)
  ) {
    throw new Error(`Pi AI dependency escaped standalone runtime: ${dependency}`);
  }
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
