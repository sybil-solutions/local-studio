#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const contractNames = [
  "Backend",
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
  "SortField",
  "SortDirection",
];
const allowedFiles = new Set([
  "shared/contracts/recipes.ts",
  "shared/contracts/system.ts",
  "shared/contracts/controller-events.ts",
  "shared/contracts/observability.ts",
  "shared/contracts/usage.ts",
  "controller/src/modules/shared/recipe-types.ts",
  "controller/src/modules/shared/system-types.ts",
  "controller/src/modules/shared/controller-events.ts",
  "frontend/src/lib/types/recipes/recipes.ts",
  "frontend/src/lib/types/recipes/downloads.ts",
  "frontend/src/lib/types/recipes/models.ts",
  "frontend/src/lib/types/recipes/runtime.ts",
  "frontend/src/lib/controller-events-contract.ts",
  "frontend/src/lib/types/system/config.ts",
  "frontend/src/lib/types/system/logs.ts",
  "frontend/src/lib/types/system/metrics.ts",
  "frontend/src/lib/types/system/process.ts",
  "frontend/src/lib/types/system/studio.ts",
  "frontend/src/lib/types/system/usage.ts",
]);
const scanRoots = ["shared", "controller/src", "frontend/src"];
const findings = [];
const exportedDeclarations = new Map();

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) inspect(full);
  }
}

function inspect(filePath) {
  const rel = relative(root, filePath);
  const source = readFileSync(filePath, "utf8");
  collectExportedDeclarations(rel, source);
  for (const name of contractNames) {
    const declaration = new RegExp(`export\\s+(interface|type)\\s+${name}\\b`);
    if (declaration.test(source) && !allowedFiles.has(rel)) {
      findings.push(`${rel}: ${name}`);
    }
  }
}

function collectExportedDeclarations(rel, source) {
  const declaration = /\bexport\s+(?:declare\s+)?(?:type|interface)\s+([A-Za-z0-9_]+)/g;
  for (const match of source.matchAll(declaration)) {
    const name = match[1];
    if (!exportedDeclarations.has(name)) exportedDeclarations.set(name, []);
    exportedDeclarations.get(name).push(rel);
  }
}

for (const scanRoot of scanRoots) {
  walk(join(root, scanRoot));
}

if (findings.length > 0) {
  console.error("Shared contract check failed. Move these declarations to shared/contracts:");
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
