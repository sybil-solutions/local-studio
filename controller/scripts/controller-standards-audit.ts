import fs from "node:fs";
import path from "node:path";

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
  modulesChecked: number;
}

const SRC_DIR = path.resolve(process.cwd(), "src");
const MODULES_DIR = path.join(SRC_DIR, "modules");
const MAX_FILES_PER_DIR = Number.parseInt(process.env["MAX_FILES_PER_DIR"] ?? "20", 10);
const MAX_SUBDIRS_PER_DIR = Number.parseInt(process.env["MAX_SUBDIRS_PER_DIR"] ?? "8", 10);
const MAX_DOC_LOOKBACK = 20;
const REQUIRED_MODULE_CONTRACT_FILES = ["types.ts", "interfaces.ts", "configs.ts", "index.ts"];
const STRUCTURE_COUNT_EXCLUDED_DIRS = new Set(["tests"]);

const findings: Finding[] = [];
const stats: AuditStats = {
  directories: 0,
  files: 0,
  modulesChecked: 0,
};
const modulesRoot = path.join(SRC_DIR, "modules");

const moduleDirectories = new Set<string>();
if (fs.existsSync(MODULES_DIR)) {
  for (const item of fs.readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (item.isDirectory() && !item.name.startsWith(".")) {
      moduleDirectories.add(path.join(MODULES_DIR, item.name));
    }
  }
}

const kebabCase = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

/**
 *
 * @param dir
 */
function scanDirectory(dir: string): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const directFiles = entries.filter((entry) => entry.isFile());
  const directDirectories = entries.filter(
    (entry) =>
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      !STRUCTURE_COUNT_EXCLUDED_DIRS.has(entry.name)
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
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      checkFunctionDocs(fullPath);
    }
  }
}

/**
 *
 * @param filePath
 */
function checkFunctionDocs(filePath: string): void {
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;

    const trimmed = line.trim();
    const exportFunction =
      /^(export\s+)?(async\s+)?function\s+\w+/.test(trimmed) && trimmed.startsWith("export ");
    const exportArrowFunction =
      /^(export\s+)?const\s+\w+\s*=\s*(async\s+)?\(.+\)\s*=>/.test(trimmed) ||
      /^(export\s+)?const\s+\w+\s*:\s*\(.*\)\s*=>/.test(trimmed) ||
      /^(export\s+)?const\s+\w+\s*=\s*(async\s+)?\(.+\)\s*=>/.test(trimmed);
    const isTarget = trimmed.startsWith("export") && (exportFunction || exportArrowFunction);
    if (!isTarget) {
      continue;
    }

    let hasJSDocument = false;
    let seenCommentStart = false;
    for (let index_ = index - 1; index_ >= Math.max(0, index - MAX_DOC_LOOKBACK); index_--) {
      const previous = lines[index_];
      if (previous === undefined) {
        continue;
      }
      const trimmedPrevious = previous.trim();
      if (trimmedPrevious === "") {
        continue;
      }
      if (trimmedPrevious.startsWith("/**")) {
        hasJSDocument = true;
        break;
      }
      if (trimmedPrevious.endsWith("*/")) {
        seenCommentStart = true;
        if (trimmedPrevious.startsWith("/*")) {
          hasJSDocument = true;
          break;
        }
        continue;
      }
      if (seenCommentStart) {
        if (trimmedPrevious.startsWith("*") || trimmedPrevious.startsWith("* ")) {
          continue;
        }
        if (trimmedPrevious.startsWith("/**")) {
          hasJSDocument = true;
        }
        break;
      }
      break;
    }

    if (!hasJSDocument) {
      findings.push({
        level: "warning",
        rule: "function-doc-comment",
        path: filePath,
        detail: `Missing comment block above exported function on line ${index + 1}`,
      });
    }
  }
}

/**
 *
 */
function evaluateModuleContracts(): void {
  for (const moduleDir of moduleDirectories) {
    const hasRequiredFiles = new Set<string>();
    const entries = fs.readdirSync(moduleDir, { withFileTypes: true });

    stats.modulesChecked += 1;

    for (const entry of entries) {
      if (entry.isFile() && REQUIRED_MODULE_CONTRACT_FILES.includes(entry.name)) {
        hasRequiredFiles.add(entry.name);
      }
    }

    const missing = REQUIRED_MODULE_CONTRACT_FILES.filter(
      (fileName) => !hasRequiredFiles.has(fileName)
    );
    if (missing.length > 0) {
      findings.push({
        level: "warning",
        rule: "module-contract",
        path: moduleDir,
        detail: `Missing required files: ${missing.join(", ")}`,
      });
    }
  }
}

/**
 *
 */
function printSummary(): void {
  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warning");

  console.log("=== Controller Standards Audit ===");
  console.log(`Directories scanned: ${stats.directories}`);
  console.log(`Direct file entries scanned: ${stats.files}`);
  console.log(`Modules checked: ${stats.modulesChecked}`);
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

/**
 *
 */
function run(): number {
  if (!fs.existsSync(SRC_DIR)) {
    console.error("ERROR: src directory not found");
    return 1;
  }

  scanDirectory(SRC_DIR);
  evaluateModuleContracts();
  printSummary();

  const hasErrors = findings.some((finding) => finding.level === "error");
  return hasErrors ? 1 : 0;
}

process.exit(run());
