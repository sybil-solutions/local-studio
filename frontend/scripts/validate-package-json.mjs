#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkgPath = resolve(import.meta.dirname, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const required = ["scripts", "devDependencies"];
const requiredScripts = ["dev", "build", "test", "desktop:dist"];
const missing = [];

for (const key of required) {
  if (!pkg[key] || typeof pkg[key] !== "object") {
    missing.push(key);
  }
}
for (const script of requiredScripts) {
  if (!pkg.scripts?.[script]) {
    missing.push(`script:${script}`);
  }
}

if (missing.length > 0) {
  console.error(`\n  package.json integrity check FAILED\n`);
  console.error(`  Missing: ${missing.join(", ")}`);
  console.error(`  This file may have been accidentally stripped.`);
  console.error(`  Run: git checkout -- frontend/package.json\n`);
  process.exit(1);
}

console.log("  package.json integrity check passed");
