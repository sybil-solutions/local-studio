#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const srcRoot = join(projectRoot, "src");
const componentsRoot = join(srcRoot, "components");
const allowedComponentsPrefix = `components${sep}dashboard${sep}`;
const allowedAppComponentPrefix = `app${sep}agent${sep}_components${sep}`;
const sourceExtensions = new Set([".ts", ".tsx"]);

const findings = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (entry.isFile()) inspectFile(fullPath);
  }
}

function inspectFile(filePath) {
  const rel = relative(srcRoot, filePath);
  if (rel.startsWith(`components${sep}`) && !rel.startsWith(allowedComponentsPrefix)) {
    findings.push({
      rule: "generic-ui-location",
      path: rel,
      detail: "Shared UI belongs in src/ui; src/components is reserved for dashboard/status UI.",
    });
  }

  if (
    rel.startsWith(`app${sep}`) &&
    rel.includes(`${sep}_components${sep}`) &&
    !rel.startsWith(allowedAppComponentPrefix)
  ) {
    findings.push({
      rule: "route-ui-location",
      path: rel,
      detail: "Route UI components belong in src/ui; only app/agent/_components is exempt.",
    });
  }

  const extension = filePath.slice(filePath.lastIndexOf("."));
  if (!sourceExtensions.has(extension)) return;

  const source = readFileSync(filePath, "utf8");
  const importPattern = /from\s+["']@\/components\/([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    if (!match[1].startsWith("dashboard/")) {
      findings.push({
        rule: "generic-ui-import",
        path: rel,
        detail: `Import "@/components/${match[1]}" should move to "@/ui/..." or an app-local component.`,
      });
    }
  }

  const appComponentImportPattern = /from\s+["']@\/app\/([^"']*\/_components\/[^"']+)["']/g;
  for (const match of source.matchAll(appComponentImportPattern)) {
    if (!match[1].startsWith("agent/_components/")) {
      findings.push({
        rule: "route-ui-import",
        path: rel,
        detail: `Import "@/app/${match[1]}" should move to "@/ui/...".`,
      });
    }
  }
}

if (statSync(componentsRoot, { throwIfNoEntry: false })) {
  walk(srcRoot);
}

if (findings.length > 0) {
  console.error("UI structure check failed:");
  for (const finding of findings) {
    console.error(`- ${finding.rule}: ${finding.path}`);
    console.error(`  ${finding.detail}`);
  }
  process.exit(1);
}

console.log("UI structure check passed");
