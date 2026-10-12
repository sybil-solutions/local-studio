// Repository invariants. Each validator prints a pass line or exits 1 with
// the exact violations; the `check` entry composes them with the workspace
// gates so the local command and CI cannot drift apart.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { git, repoRoot } from "./lib.mjs";

/** Named contract types must be declared exactly once, in the allowed files. */
export function validateContracts() {
  const contractNames = [
    "Backend",
    "ServeRuntimeKind",
    "ServeRuntime",
    "Serve",
    "ServePayload",
    "RecipeBase",
    "RecipePayload",
    "DownloadStatus",
    "DownloadFileStatus",
    "DownloadFileInfo",
    "ModelDownload",
    "StorageInfo",
    "ModelInfo",
    "ServiceInfo",
    "SystemConfig",
    "EnvironmentInfo",
    "Environment",
    "EnvironmentEngineId",
    "RuntimeBackendInfo",
    "EngineBackend",
    "RuntimeKind",
    "RuntimeTarget",
    "EngineJob",
    "RuntimePlatformKind",
    "RuntimeRocmSmiTool",
    "RuntimeGpuMonitoringTool",
    "RuntimeCudaInfo",
    "RuntimeRocmInfo",
    "RuntimeTorchBuildInfo",
    "RuntimePlatformInfo",
    "RuntimeGpuMonitoringInfo",
    "RuntimeGpuInfoSummary",
    "CompatibilitySeverity",
    "CompatibilityCheck",
    "SystemRuntimeInfo",
    "CompatibilityReport",
    "ConfigData",
    "RuntimeUpgradeResult",
    "ControllerEventType",
    "ControllerStreamEventType",
    "ControllerEventDomain",
    "ControllerBrowserEventChannel",
    "GPU",
    "Metrics",
    "VRAMCalculation",
    "PeakMetrics",
    "ProcessInfo",
    "LogSession",
    "StudioSettings",
    "StudioDiagnostics",
    "ControllerUsageStats",
    "UsageStats",
    "RigHardwareType",
    "RigNodeRole",
    "RigNodeSource",
    "RigAccelerator",
    "RigNode",
    "Rig",
    "RigsPayload",
  ];
  const allowedFiles = new Set([
    "controller/contracts/recipes.ts",
    "controller/contracts/system.ts",
    "controller/contracts/controller-events.ts",
    "controller/contracts/observability.ts",
    "controller/contracts/usage.ts",
    "controller/contracts/rigs.ts",
    "controller/src/modules/shared/recipe-types.ts",
    "controller/src/modules/shared/system-types.ts",
    "frontend/src/lib/types.ts",
    "frontend/src/lib/controller-events-contract.ts",
  ]);
  const scanRoots = ["shared", "controller/contracts", "controller/src", "frontend/src"];
  const findings = [];
  const exportedDeclarations = new Map();

  const inspect = (filePath) => {
    const rel = path.relative(repoRoot, filePath).replaceAll("\\", "/");
    const source = readFileSync(filePath, "utf8");
    const declaration = /\bexport\s+(?:declare\s+)?(?:type|interface)\s+([A-Za-z0-9_]+)/g;
    for (const match of source.matchAll(declaration)) {
      const name = match[1];
      if (!exportedDeclarations.has(name)) exportedDeclarations.set(name, []);
      exportedDeclarations.get(name).push(rel);
    }
    for (const name of contractNames) {
      if (
        new RegExp(`export\\s+(interface|type)\\s+${name}\\b`).test(source) &&
        !allowedFiles.has(rel)
      ) {
        findings.push(`${rel}: ${name}`);
      }
    }
  };

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) inspect(full);
    }
  };
  for (const scanRoot of scanRoots) walk(path.join(repoRoot, scanRoot));

  if (findings.length > 0) {
    console.error("Shared contract check failed. Move these declarations to controller/contracts:");
    for (const finding of findings) console.error(`- ${finding}`);
    process.exit(1);
  }
  const duplicateDeclarations = [...exportedDeclarations.entries()]
    .filter(([, files]) => files.length > 1)
    .sort(([left], [right]) => left.localeCompare(right));
  if (duplicateDeclarations.length > 0) {
    console.error("Duplicate exported type/interface declarations found:");
    for (const [name, files] of duplicateDeclarations) {
      console.error(`- ${name}`);
      for (const file of files) console.error(`  ${file}`);
    }
    console.error("Export one declaration and re-export aliases from compatibility barrels instead.");
    process.exit(1);
  }
  console.log("Shared contract check passed");
}

/** Manifest integrity: required scripts, private flag, lockfiles, version parity. */
export function validatePackage() {
  const read = (relativePath) =>
    JSON.parse(readFileSync(path.resolve(repoRoot, relativePath), "utf8"));
  const packageRequirements = [
    ["package.json", ["setup", "dev", "build", "start", "check", "desktop:dist"]],
    ["frontend/package.json", ["dev", "build", "start", "desktop:dist", "check:quality"]],
    ["controller/package.json", ["dev", "start", "typecheck", "lint", "check"]],
    ["services/agent-runtime/package.json", ["bundle", "build", "dev", "check"]],
    ["shared/package.json", []],
    ["controller/contracts/package.json", []],
  ];
  const packageLocks = [
    "frontend/package-lock.json",
    "controller/bun.lock",
    "services/agent-runtime/bun.lock",
    "shared/bun.lock",
  ];
  const missing = [];
  for (const [manifest, scripts] of packageRequirements) {
    const packageJson = read(manifest);
    if (packageJson.private !== true) missing.push(`${manifest}:private`);
    for (const script of scripts) {
      if (!packageJson.scripts?.[script]) missing.push(`${manifest}:script:${script}`);
    }
  }
  for (const lockfile of packageLocks) {
    if (!existsSync(path.resolve(repoRoot, lockfile))) missing.push(lockfile);
  }
  const releaseVersion = read("package.json").version;
  for (const manifest of [
    "frontend/package.json",
    "controller/package.json",
    "controller/contracts/package.json",
    "services/agent-runtime/package.json",
  ]) {
    if (read(manifest).version !== releaseVersion) missing.push(`${manifest}:version`);
  }
  if (missing.length > 0) {
    console.error("\n  package.json integrity check FAILED\n");
    console.error(`  Invalid: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("  package.json integrity check passed");
}

/** A `foo.ts` barrel must not sit beside a `foo/` directory. */
export function validateStructure() {
  const siblingAllowlist = new Set([]);
  const scanRoots = ["frontend/src", "controller/src"];
  const findings = [];
  const walk = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    const directoryNames = new Set(
      entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    );
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const match = entry.name.match(/^(.+)\.tsx?$/);
      if (!match || !directoryNames.has(match[1])) continue;
      const rel = path.relative(repoRoot, full);
      if (siblingAllowlist.has(rel)) continue;
      findings.push(`${rel} sits next to directory ${path.relative(repoRoot, path.join(dir, match[1]))}/`);
    }
  };
  for (const scanRoot of scanRoots) walk(path.join(repoRoot, scanRoot));
  if (findings.length > 0) {
    console.error(
      "Barrel/dir sibling check failed. Merge each file into its same-named directory (or flatten the directory):",
    );
    for (const finding of findings) console.error(`- ${finding}`);
    process.exit(1);
  }
  console.log("Barrel/dir sibling check passed");
}

/** Frontend layering rules: retired dirs, primitive purity, feature isolation. */
export function validateUi() {
  const srcRoot = path.join(repoRoot, "frontend", "src");
  const legacyPrimitivePurityFiles = new Set([]);
  const sharedLayerAllowlist = new Set([]);
  const retiredUiFeatureDirs = new Set([
    "recipes",
    "discover",
    "configs",
    "usage",
    "setup",
    "logs",
    "dashboard",
  ]);
  const sourceExtensions = new Set([".ts", ".tsx"]);
  const findings = [];
  const sharedModuleImporters = new Map();

  const isSharedLayerPath = (rel) => {
    const top = rel.split(path.sep)[0];
    return top === "lib" || top === "hooks";
  };

  const resolveImportTarget = (importerPath, specifier) => {
    let base;
    if (specifier.startsWith("@/")) base = path.join(srcRoot, specifier.slice(2));
    else if (specifier.startsWith(".")) base = path.resolve(path.dirname(importerPath), specifier);
    else return null;
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ]) {
      if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
    }
    return null;
  };

  const recordImportEdges = (filePath, rel, source) => {
    for (const match of source.matchAll(
      /(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g,
    )) {
      const target = resolveImportTarget(filePath, match[1]);
      if (!target || target === filePath) continue;
      const targetRel = path.relative(srcRoot, target);
      if (targetRel.startsWith("..") || !isSharedLayerPath(targetRel)) continue;
      let importers = sharedModuleImporters.get(targetRel);
      if (!importers) {
        importers = new Set();
        sharedModuleImporters.set(targetRel, importers);
      }
      importers.add(rel);
    }
  };

  const inspectFile = (filePath) => {
    const rel = path.relative(srcRoot, filePath);
    const segments = rel.split(path.sep);
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
    if (segments[0] === "app" && rel.includes(`${path.sep}_components${path.sep}`)) {
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
  };

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) inspectFile(fullPath);
    }
  };

  const evaluateSharedLayerConsumers = () => {
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
        const segments = importer.split(path.sep);
        if (segments[0] === "features" && segments.length > 1) featureOwners.add(segments[1]);
        else hasNonFeatureImporter = true;
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
  };

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
}

/**
 * TypeScript-AST audit of controller/src: Effect-usage rules, kebab-case
 * names, and directory size limits. Runs relative to process.cwd() because
 * the controller package invokes it from its own directory.
 */
export function controllerStandards() {
  const requireFromCwd = createRequire(path.resolve(process.cwd(), "package.json"));
  const ts = requireFromCwd("typescript");
  const SRC_DIR = path.resolve(process.cwd(), "src");
  const MAX_FILES_PER_DIR = Number.parseInt(process.env.MAX_FILES_PER_DIR ?? "20", 10);
  const MAX_SUBDIRS_PER_DIR = Number.parseInt(process.env.MAX_SUBDIRS_PER_DIR ?? "8", 10);
  const STRUCTURE_COUNT_EXCLUDED_DIRS = new Set();
  const findings = [];
  const stats = { directories: 0, files: 0 };
  const modulesRoot = path.join(SRC_DIR, "modules");
  const runtimeBoundaryFiles = new Set(["http/bounded-body.ts", "http/effect-handler.ts", "main.ts"]);
  let managedRuntimeCount = 0;
  const kebabCase = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

  const addSourceFinding = (rule, filePath, node, detail) => {
    const sourceFile = node.getSourceFile();
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({ level: "error", rule, path: filePath, detail: `${line + 1}:${character + 1} ${detail}` });
  };
  const identifierText = (node) => (ts.isIdentifier(node) ? node.text : null);
  const isEffectCompositionCatch = (node) =>
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "catch" &&
    ["Effect", "Stream"].includes(identifierText(node.expression.expression) ?? "");
  const isInsideEffectTryPromise = (node) => {
    let parent = node.parent;
    while (parent) {
      if (
        ts.isCallExpression(parent) &&
        ts.isPropertyAccessExpression(parent.expression) &&
        identifierText(parent.expression.expression) === "Effect" &&
        parent.expression.name.text === "tryPromise"
      ) {
        return true;
      }
      parent = parent.parent;
    }
    return false;
  };

  const scanEffectStandards = (filePath) => {
    if (!filePath.endsWith(".ts") || filePath.endsWith(".d.ts")) return;
    const source = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    const relativePath = path.relative(SRC_DIR, filePath);
    const isRuntimeBoundary = runtimeBoundaryFiles.has(relativePath);
    const visit = (node) => {
      if (ts.canHaveModifiers(node)) {
        if (
          ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) &&
          !isInsideEffectTryPromise(node)
        ) {
          addSourceFinding("effect-async-boundary", filePath, node, "Use Effect for controller async work");
        }
      }
      if (
        !isRuntimeBoundary &&
        ts.isTypeReferenceNode(node) &&
        ["Promise", "PromiseLike"].includes(identifierText(node.typeName) ?? "")
      ) {
        addSourceFinding("effect-promise-type", filePath, node, "Promise types are restricted to runtime adapters");
      }
      if (!isRuntimeBoundary && ts.isNewExpression(node) && identifierText(node.expression) === "Promise") {
        addSourceFinding("effect-promise-constructor", filePath, node, "Use Effect.async or Effect.callback");
      }
      if (ts.isIdentifier(node) && ["AsyncLock", "AsyncQueue"].includes(node.text)) {
        addSourceFinding("effect-legacy-concurrency", filePath, node, "Use Effect concurrency primitives");
      }
      if (ts.isCallExpression(node)) {
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          identifierText(node.expression.expression) === "ManagedRuntime" &&
          node.expression.name.text === "make"
        ) {
          managedRuntimeCount += 1;
        }
        if (
          !isRuntimeBoundary &&
          ts.isPropertyAccessExpression(node.expression) &&
          ["runPromise", "runPromiseExit", "runSync", "runFork"].includes(node.expression.name.text) &&
          (identifierText(node.expression.expression) === "Effect" ||
            /runtime/i.test(node.expression.expression.getText(sourceFile)))
        ) {
          addSourceFinding("effect-runner-boundary", filePath, node, "Effect runners are restricted to runtime adapters");
        }
        if (
          !isRuntimeBoundary &&
          ts.isPropertyAccessExpression(node.expression) &&
          ["then", "finally"].includes(node.expression.name.text)
        ) {
          addSourceFinding("effect-promise-chain", filePath, node, "Use Effect composition");
        }
        if (
          !isRuntimeBoundary &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "catch" &&
          !isEffectCompositionCatch(node)
        ) {
          addSourceFinding("effect-promise-catch", filePath, node, "Use Effect.catch or Effect.catchTag");
        }
        if (
          !isRuntimeBoundary &&
          ts.isPropertyAccessExpression(node.expression) &&
          identifierText(node.expression.expression) === "Promise"
        ) {
          addSourceFinding("effect-promise-static", filePath, node, "Use Effect concurrency and coordination APIs");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  };

  const scanDirectory = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    const directFiles = entries.filter((entry) => entry.isFile());
    const directDirectories = entries.filter(
      (entry) =>
        entry.isDirectory() && !entry.name.startsWith(".") && !STRUCTURE_COUNT_EXCLUDED_DIRS.has(entry.name),
    );
    stats.directories += 1;
    stats.files += directFiles.length;
    if (directFiles.length > MAX_FILES_PER_DIR) {
      findings.push({
        level: "error",
        rule: "directory-file-limit",
        path: dir,
        detail: `${directFiles.length} files (limit ${MAX_FILES_PER_DIR})`,
      });
    }
    if (dir !== modulesRoot && directDirectories.length > MAX_SUBDIRS_PER_DIR) {
      findings.push({
        level: "error",
        rule: "directory-subdir-limit",
        path: dir,
        detail: `${directDirectories.length} subdirectories (limit ${MAX_SUBDIRS_PER_DIR})`,
      });
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory() && !kebabCase.test(entry.name)) {
        findings.push({
          level: "warning",
          rule: "kebab-case",
          path: fullPath,
          detail: `Name "${entry.name}" is not kebab-case`,
        });
      }
      if (entry.isDirectory()) scanDirectory(fullPath);
      else if (entry.isFile()) scanEffectStandards(fullPath);
    }
  };

  const printSummary = () => {
    const errors = findings.filter((f) => f.level === "error");
    const warnings = findings.filter((f) => f.level === "warning");
    console.log("=== Controller Standards Audit ===");
    console.log(`Directories scanned: ${stats.directories}`);
    console.log(`Direct file entries scanned: ${stats.files}`);
    console.log(`Errors: ${errors.length}`);
    console.log(`Warnings: ${warnings.length}`);
    console.log("");
    const sortedFindings = findings.sort((a, b) => {
      if (a.level !== b.level) return a.level === "error" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
    for (const finding of sortedFindings) {
      const emoji = finding.level === "error" ? "[ERR]" : "[WARN]";
      console.log(`${emoji} ${finding.rule} | ${finding.path}`);
      console.log(`      ${finding.detail}`);
    }
  };

  if (!existsSync(SRC_DIR)) {
    console.error("ERROR: src directory not found");
    process.exit(1);
  }
  scanDirectory(SRC_DIR);
  if (managedRuntimeCount !== 1) {
    findings.push({
      level: "error",
      rule: "effect-single-runtime",
      path: SRC_DIR,
      detail: `${managedRuntimeCount} ManagedRuntime.make calls (expected exactly 1)`,
    });
  }
  printSummary();
  process.exit(findings.some((finding) => finding.level === "error") ? 1 : 0);
}

/**
 * The automation layout gate: exactly three shell scripts plus the project.mjs
 * symlink in scripts/, exactly four tracked executables, no per-package
 * scripts/ directories. The automation modules themselves live in
 * frontend/desktop/automation/ as ordinary non-executable source.
 */
export function auditLayout() {
  const expected = [
    "frontend/desktop/project.mjs",
    "scripts/dev-watch.sh",
    "scripts/install-controller.sh",
    "scripts/install-desktop-app.sh",
  ];
  const actual = readdirSync(path.join(repoRoot, "scripts"), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `scripts/${entry.name}`)
    .sort();
  const executable = git(["ls-files", "-s"])
    .split("\n")
    .filter((line) => line.startsWith("100755 "))
    .map((line) => line.split("\t")[1])
    .sort();
  const stale = ["frontend/scripts", "controller/scripts", "services/agent-runtime/scripts"].filter(
    (directory) => existsSync(path.join(repoRoot, directory)),
  );
  if (
    JSON.stringify(actual) !== JSON.stringify(expected.slice(1)) ||
    JSON.stringify(executable) !== JSON.stringify(expected) ||
    stale.length > 0
  ) {
    throw Error(
      `Automation layout drifted: scripts=${actual.join(",")}; executable=${executable.join(",")}; stale=${stale.join(",")}`,
    );
  }
  console.log("Automation layout passed: exactly four scripts");
}
