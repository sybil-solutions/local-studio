#!/usr/bin/env node
// Enforces the frontend layering convention:
//   src/ui        — shared primitives only; never imports features or app code
//   src/features  — one folder per page-feature (recipes, discover, settings,
//                   usage, plugins, setup, logs, dashboard, ...); never imports app code
//   src/app       — thin route shells composing features; no _components trees
//   src/lib, src/hooks — shared layer; every module must have consumers in more
//                   than one feature (or outside features); see shared-layer rule
//   src/components — retired; must stay empty
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const srcRoot = join(projectRoot, "src");
// src/ui holds zero feature-coupled files; primitive purity has no exceptions.
const legacyPrimitivePurityFiles = new Set([]);
// Shared-layer consumer rule exceptions. This list starts (and should stay)
// empty: adding an entry requires written justification in the same commit
// explaining why the module must live in src/lib or src/hooks despite having
// a single-feature (or zero) consumer footprint.
const sharedLayerAllowlist = new Set([]);
const retiredUiFeatureDirs = new Set([
  "recipes",
  "discover",
  "configs",
  "usage",
  "plugins",
  "setup",
  "logs",
  "dashboard",
]);
const sourceExtensions = new Set([".ts", ".tsx"]);

const findings = [];
// Shared-layer modules (src/lib, src/hooks) keyed by src-relative path, each
// mapping to the set of src-relative importer paths discovered during the walk.
const sharedModuleImporters = new Map();

function isSharedLayerPath(rel) {
  const top = rel.split(sep)[0];
  return top === "lib" || top === "hooks";
}

function resolveImportTarget(importerPath, specifier) {
  let base;
  if (specifier.startsWith("@/")) {
    base = join(srcRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(importerPath), specifier);
  } else {
    return null;
  }
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
  }
  return null;
}

function recordImportEdges(filePath, rel, source) {
  for (const match of source.matchAll(
    /(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g,
  )) {
    const target = resolveImportTarget(filePath, match[1]);
    if (!target || target === filePath) continue;
    const targetRel = relative(srcRoot, target);
    if (targetRel.startsWith("..") || !isSharedLayerPath(targetRel)) continue;
    let importers = sharedModuleImporters.get(targetRel);
    if (!importers) {
      importers = new Set();
      sharedModuleImporters.set(targetRel, importers);
    }
    importers.add(rel);
  }
}

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
  const segments = rel.split(sep);

  if (segments[0] === "components") {
    findings.push({
      rule: "retired-components-dir",
      path: rel,
      detail: "src/components is retired; page features live in src/features, primitives in src/ui.",
    });
  }

  if (segments[0] === "ui" && segments.length > 2 && retiredUiFeatureDirs.has(segments[1])) {
    findings.push({
      rule: "feature-location",
      path: rel,
      detail: `Page-feature UI belongs in src/features/${segments[1]}; src/ui is for shared primitives.`,
    });
  }

  if (segments[0] === "app" && rel.includes(`${sep}_components${sep}`)) {
    findings.push({
      rule: "route-ui-location",
      path: rel,
      detail: "Route UI belongs in src/features/<name>; app routes stay thin shells.",
    });
  }

  const extension = filePath.slice(filePath.lastIndexOf("."));
  if (!sourceExtensions.has(extension)) return;

  const source = readFileSync(filePath, "utf8");

  if (isSharedLayerPath(rel) && !rel.endsWith(".d.ts") && !sharedModuleImporters.has(rel)) {
    sharedModuleImporters.set(rel, new Set());
  }
  recordImportEdges(filePath, rel, source);

  for (const match of source.matchAll(/from\s+["']@\/components\/([^"']+)["']/g)) {
    findings.push({
      rule: "retired-components-import",
      path: rel,
      detail: `Import "@/components/${match[1]}" is retired; use "@/features/..." or "@/ui/...".`,
    });
  }

  if (segments[0] === "ui" && !legacyPrimitivePurityFiles.has(rel)) {
    for (const match of source.matchAll(/from\s+["']@\/(features|app)\/([^"']+)["']/g)) {
      findings.push({
        rule: "primitive-purity",
        path: rel,
        detail: `src/ui is the primitives layer and must not import "@/${match[1]}/${match[2]}".`,
      });
    }
  }

  if (segments[0] === "features") {
    for (const match of source.matchAll(/from\s+["']@\/app\/([^"']+)["']/g)) {
      findings.push({
        rule: "feature-app-import",
        path: rel,
        detail: `src/features must not import app code ("@/app/${match[1]}"); features are composed by routes, not the reverse.`,
      });
    }
  }
}

// Shared-layer consumer rule: a module in src/lib or src/hooks earns its spot
// by serving more than one feature. Fail when every importer lives inside a
// single features/<name>/ directory (move it into that feature) or when no
// importer exists at all (dead code). Modules imported only by other shared
// modules are internal helpers and pass.
function evaluateSharedLayerConsumers() {
  for (const [rel, importers] of [...sharedModuleImporters.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (sharedLayerAllowlist.has(rel)) continue;
    if (importers.size === 0) {
      findings.push({
        rule: "shared-layer-consumers",
        path: rel,
        detail: "No importer anywhere in src; shared-layer modules without consumers are dead code.",
      });
      continue;
    }
    const featureOwners = new Set();
    let hasNonFeatureImporter = false;
    for (const importer of importers) {
      const segments = importer.split(sep);
      if (segments[0] === "features" && segments.length > 1) {
        featureOwners.add(segments[1]);
      } else {
        hasNonFeatureImporter = true;
      }
    }
    if (!hasNonFeatureImporter && featureOwners.size === 1) {
      const [owner] = featureOwners;
      findings.push({
        rule: "shared-layer-consumers",
        path: rel,
        detail: `All importers live in src/features/${owner}; move this module into that feature.`,
      });
    }
  }
}

if (statSync(srcRoot, { throwIfNoEntry: false })) {
  walk(srcRoot);
  evaluateSharedLayerConsumers();
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
