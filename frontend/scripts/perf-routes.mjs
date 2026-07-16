import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(scriptsDir, "..", "src", "app");

const preferredOrder = [
  "/",
  "/agent",
  "/agent/sessions",
  "/settings",
  "/recipes",
  "/logs",
  "/server",
  "/usage",
  "/configure",
  "/discover",
  "/quick",
  "/setup",
];

const httpBudgetOverrides = new Map([
  ["/", { assetKiB: 1050 }],
  ["/agent", { assetKiB: 1250 }],
  ["/agent/sessions", { assetKiB: 1250 }],
  ["/quick", { assetKiB: 1250 }],
  ["/logs", { assetKiB: 1000 }],
  ["/server", { assetKiB: 1000 }],
  ["/usage", { assetKiB: 1025 }],
  ["/configure", { assetKiB: 1025 }],
  ["/discover", { assetKiB: 1000 }],
]);

const defaultHttpBudget = { medianMs: 50, p90Ms: 150, assetKiB: 1100 };
const defaultBrowserBudget = { dclMs: 500, fcpMs: 700, taskMs: 250, nodes: 1200, heapMiB: 24, textChars: 8 };

function routeFromPageFile(filePath) {
  const relativePath = relative(appDir, filePath);
  const segments = relativePath.split(sep).slice(0, -1);
  if (segments.some((segment) => segment.startsWith("[") || segment.startsWith("@") || segment.startsWith("_"))) {
    return null;
  }
  const routeSegments = segments.filter((segment) => !segment.startsWith("("));
  return routeSegments.length === 0 ? "/" : `/${routeSegments.join("/")}`;
}

function pageFiles(directory) {
  const out = [];
  for (const entry of readdirSync(directory)) {
    const entryPath = join(directory, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      out.push(...pageFiles(entryPath));
    } else if (/^page\.(t|j)sx?$/u.test(entry)) {
      out.push(entryPath);
    }
  }
  return out;
}

function sortRoutes(left, right) {
  const leftIndex = preferredOrder.indexOf(left.path);
  const rightIndex = preferredOrder.indexOf(right.path);
  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  }
  return left.path.localeCompare(right.path);
}

function discoveredPaths() {
  return [...new Set(pageFiles(appDir).map(routeFromPageFile).filter(Boolean))];
}

export function httpRoutes() {
  return discoveredPaths()
    .map((path) => ({ path, ...defaultHttpBudget, ...(httpBudgetOverrides.get(path) || {}) }))
    .sort(sortRoutes);
}

export function browserRoutes() {
  return discoveredPaths()
    .map((path) => ({ path, ...defaultBrowserBudget }))
    .sort(sortRoutes);
}
