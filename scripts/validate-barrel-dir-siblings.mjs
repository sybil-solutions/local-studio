#!/usr/bin/env node
// Enforces the no-barrel-and-dir-siblings convention: a file X.ts/X.tsx must
// never sit next to a directory named X/. Either the file is a barrel masking
// the directory's real modules (importers should reach concrete files) or the
// two spell one concept across two locations; merge the file into the
// directory or flatten the directory.
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
// Exceptions to the sibling rule. This list starts (and should stay) empty:
// adding an entry requires written justification in the same commit explaining
// why the file and the same-named directory must coexist.
const siblingAllowlist = new Set([]);
const scanRoots = ["frontend/src", "controller/src"];
const findings = [];

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const directoryNames = new Set(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  );
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^(.+)\.tsx?$/);
    if (!match || !directoryNames.has(match[1])) continue;
    const rel = relative(root, full);
    if (siblingAllowlist.has(rel)) continue;
    findings.push(`${rel} sits next to directory ${relative(root, join(dir, match[1]))}/`);
  }
}

for (const scanRoot of scanRoots) {
  walk(join(root, scanRoot));
}

if (findings.length > 0) {
  console.error(
    "Barrel/dir sibling check failed. Merge each file into its same-named directory (or flatten the directory):",
  );
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Barrel/dir sibling check passed");
