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
const serverFiles = runtimeRoot ? filesUnder(resolve(runtimeRoot, ".next/server")) : [];
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
const tracedPiPackages = new Set(
  serverFiles.flatMap((file) => {
    if (!file.endsWith(".js")) return [];
    return (
      readFileSync(file, "utf8").match(/@earendil-works\/(?:pi-ai|pi-coding-agent)-[a-z0-9_-]+/g) ??
      []
    );
  }),
);
if (
  !runtimeRoot ||
  !["pi-ai-", "pi-coding-agent-"].every((prefix) =>
    [...tracedPiPackages].some((entry) => entry.includes(`/${prefix}`)),
  )
) {
  throw new Error("Missing traced Pi runtime externals");
}
for (const tracedPiPackage of tracedPiPackages) {
  const importCheck = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `import(${JSON.stringify(tracedPiPackage)})`],
    { cwd: resolve(runtimeRoot, ".next"), encoding: "utf8" },
  );
  if (importCheck.status !== 0) {
    throw new Error(
      `Standalone Pi runtime external is not importable: ${importCheck.stderr || importCheck.stdout}`,
    );
  }
}

const tracedPiAi = [...tracedPiPackages].find((entry) => entry.includes("/pi-ai-"));
if (!runtimeRoot || !tracedPiAi) {
  throw new Error("Missing traced Pi AI runtime external");
}
const piAiRoot = realpathSync(resolve(runtimeRoot, ".next/node_modules", tracedPiAi));
const piAiManifestPath = resolve(piAiRoot, "package.json");
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
