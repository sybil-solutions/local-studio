import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

type FindingLevel = "error" | "warning";

interface Finding {
  level: FindingLevel;
  rule: string;
  path: string;
  detail: string;
}

interface AuditStats {
  directories: number;
  files: number;
}

const SRC_DIR = path.resolve(process.cwd(), "src");
const MAX_FILES_PER_DIR = Number.parseInt(process.env["MAX_FILES_PER_DIR"] ?? "20", 10);
const MAX_SUBDIRS_PER_DIR = Number.parseInt(process.env["MAX_SUBDIRS_PER_DIR"] ?? "8", 10);
const STRUCTURE_COUNT_EXCLUDED_DIRS = new Set(["tests"]);

const findings: Finding[] = [];
const stats: AuditStats = {
  directories: 0,
  files: 0,
};
const modulesRoot = path.join(SRC_DIR, "modules");
const runtimeBoundaryFiles = new Set(["http/bounded-body.ts", "http/effect-handler.ts", "main.ts"]);
let managedRuntimeCount = 0;

const kebabCase = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

function addSourceFinding(rule: string, filePath: string, node: ts.Node, detail: string): void {
  const sourceFile = node.getSourceFile();
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  findings.push({
    level: "error",
    rule,
    path: filePath,
    detail: `${line + 1}:${character + 1} ${detail}`,
  });
}

function identifierText(node: ts.Node): string | null {
  return ts.isIdentifier(node) ? node.text : null;
}

function isEffectCompositionCatch(node: ts.CallExpression): boolean {
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "catch" &&
    ["Effect", "Stream"].includes(identifierText(node.expression.expression) ?? "")
  );
}

function isInsideEffectTryPromise(node: ts.Node): boolean {
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
}

function scanEffectStandards(filePath: string): void {
  if (!filePath.endsWith(".ts") || filePath.endsWith(".d.ts")) return;
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const relativePath = path.relative(SRC_DIR, filePath);
  const isRuntimeBoundary = runtimeBoundaryFiles.has(relativePath);

  const visit = (node: ts.Node): void => {
    if (ts.canHaveModifiers(node)) {
      const modifiers = ts.getModifiers(node);
      if (
        modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) &&
        !isInsideEffectTryPromise(node)
      ) {
        addSourceFinding(
          "effect-async-boundary",
          filePath,
          node,
          "Use Effect for controller async work",
        );
      }
    }

    if (
      !isRuntimeBoundary &&
      ts.isTypeReferenceNode(node) &&
      ["Promise", "PromiseLike"].includes(identifierText(node.typeName) ?? "")
    ) {
      addSourceFinding(
        "effect-promise-type",
        filePath,
        node,
        "Promise types are restricted to runtime adapters",
      );
    }

    if (
      !isRuntimeBoundary &&
      ts.isNewExpression(node) &&
      identifierText(node.expression) === "Promise"
    ) {
      addSourceFinding(
        "effect-promise-constructor",
        filePath,
        node,
        "Use Effect.async or Effect.callback",
      );
    }

    if (ts.isIdentifier(node) && ["AsyncLock", "AsyncQueue"].includes(node.text)) {
      addSourceFinding(
        "effect-legacy-concurrency",
        filePath,
        node,
        "Use Effect concurrency primitives",
      );
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
        ["runPromise", "runPromiseExit", "runSync", "runFork"].includes(
          node.expression.name.text,
        ) &&
        (identifierText(node.expression.expression) === "Effect" ||
          /runtime/i.test(node.expression.expression.getText(sourceFile)))
      ) {
        addSourceFinding(
          "effect-runner-boundary",
          filePath,
          node,
          "Effect runners are restricted to runtime adapters",
        );
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
        addSourceFinding(
          "effect-promise-catch",
          filePath,
          node,
          "Use Effect.catch or Effect.catchTag",
        );
      }

      if (
        !isRuntimeBoundary &&
        ts.isPropertyAccessExpression(node.expression) &&
        identifierText(node.expression.expression) === "Promise"
      ) {
        addSourceFinding(
          "effect-promise-static",
          filePath,
          node,
          "Use Effect concurrency and coordination APIs",
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

function scanDirectory(dir: string): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const directFiles = entries.filter((entry) => entry.isFile());
  const directDirectories = entries.filter(
    (entry) =>
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      !STRUCTURE_COUNT_EXCLUDED_DIRS.has(entry.name),
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
    if (entry.name.startsWith(".")) {
      continue;
    }

    if (entry.isDirectory() && !kebabCase.test(entry.name)) {
      findings.push({
        level: "warning",
        rule: "kebab-case",
        path: fullPath,
        detail: `Name "${entry.name}" is not kebab-case`,
      });
    }

    if (entry.isDirectory()) {
      scanDirectory(fullPath);
    } else if (entry.isFile()) {
      scanEffectStandards(fullPath);
    }
  }
}

function printSummary(): void {
  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warning");

  console.log("=== Controller Standards Audit ===");
  console.log(`Directories scanned: ${stats.directories}`);
  console.log(`Direct file entries scanned: ${stats.files}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log("");

  const sortedFindings = findings.sort((a, b) => {
    if (a.level !== b.level) {
      return a.level === "error" ? -1 : 1;
    }
    return a.path.localeCompare(b.path);
  });

  for (const finding of sortedFindings) {
    const emoji = finding.level === "error" ? "[ERR]" : "[WARN]";
    console.log(`${emoji} ${finding.rule} | ${finding.path}`);
    console.log(`      ${finding.detail}`);
  }
}

function run(): number {
  if (!fs.existsSync(SRC_DIR)) {
    console.error("ERROR: src directory not found");
    return 1;
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

  const hasErrors = findings.some((finding) => finding.level === "error");
  return hasErrors ? 1 : 0;
}

process.exit(run());
