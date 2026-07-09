import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const defaultChromePaths = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

const chromePath =
  process.env.LOCAL_STUDIO_PERF_CHROME ||
  defaultChromePaths.find((candidate) => existsSync(candidate));

if (!chromePath) {
  console.error("Chrome executable not found. Set LOCAL_STUDIO_PERF_CHROME.");
  process.exit(1);
}

const baseUrl = (process.env.LOCAL_STUDIO_PERF_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const routeTimeoutMs = Math.max(5_000, Number.parseInt(process.env.LOCAL_STUDIO_PERF_BROWSER_TIMEOUT_MS || "15000", 10));

const routes = [
  { path: "/", dclMs: 500, fcpMs: 700, taskMs: 250, nodes: 1200, heapMiB: 24 },
  { path: "/agent", dclMs: 500, fcpMs: 700, taskMs: 250, nodes: 1200, heapMiB: 24 },
  { path: "/settings", dclMs: 500, fcpMs: 700, taskMs: 250, nodes: 1200, heapMiB: 24 },
  { path: "/recipes", dclMs: 500, fcpMs: 700, taskMs: 250, nodes: 1200, heapMiB: 24 },
  { path: "/logs", dclMs: 500, fcpMs: 700, taskMs: 250, nodes: 1200, heapMiB: 24 },
  { path: "/download", dclMs: 500, fcpMs: 700, taskMs: 250, nodes: 1200, heapMiB: 24 },
  { path: "/server", dclMs: 500, fcpMs: 700, taskMs: 250, nodes: 1200, heapMiB: 24 },
  { path: "/usage", dclMs: 500, fcpMs: 700, taskMs: 250, nodes: 1200, heapMiB: 24 },
  { path: "/configure", dclMs: 500, fcpMs: 700, taskMs: 250, nodes: 1200, heapMiB: 24 },
  { path: "/discover", dclMs: 500, fcpMs: 700, taskMs: 250, nodes: 1200, heapMiB: 24 },
  { path: "/quick", dclMs: 500, fcpMs: 700, taskMs: 250, nodes: 1200, heapMiB: 24 },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

function connectToTarget(webSocketDebuggerUrl) {
  const websocket = new WebSocket(webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  websocket.addEventListener("message", (message) => {
    const data = JSON.parse(message.data);
    if (!data.id || !pending.has(data.id)) return;
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) {
      reject(new Error(JSON.stringify(data.error)));
    } else {
      resolve(data.result);
    }
  });
  return new Promise((resolve, reject) => {
    websocket.addEventListener("open", () =>
      resolve({
        send(method, params = {}) {
          const callId = (id += 1);
          websocket.send(JSON.stringify({ id: callId, method, params }));
          return new Promise((callResolve, callReject) =>
            pending.set(callId, { resolve: callResolve, reject: callReject }),
          );
        },
        close() {
          websocket.close();
        },
      }),
    );
    websocket.addEventListener("error", reject);
  });
}

async function debugPortFor(userDataDir) {
  const activePortPath = join(userDataDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return readFileSync(activePortPath, "utf8").split("\n")[0]?.trim();
    } catch {}
    await sleep(50);
  }
  throw new Error("Chrome DevToolsActivePort did not appear");
}

async function pageTarget(debugPort) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
    const target = targets.find((entry) => entry.type === "page" && entry.url.startsWith(baseUrl));
    if (target) return target;
    await sleep(50);
  }
  throw new Error("Chrome page target did not appear");
}

async function waitForComplete(page) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await page.send("Runtime.evaluate", { returnByValue: true, expression: "document.readyState" });
    if (state.result.value === "complete") return;
    await sleep(50);
  }
  throw new Error("Page did not reach readyState=complete");
}

async function pageMetrics(page) {
  const evaluated = await page.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const paints = Object.fromEntries(performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime]));
      const resources = performance.getEntriesByType("resource");
      return {
        nav: nav ? nav.toJSON() : null,
        paints,
        resources: resources.length,
        scripts: resources.filter((entry) => entry.initiatorType === "script").length,
        css: resources.filter((entry) => entry.initiatorType === "link" || entry.name.endsWith(".css")).length,
        nodes: document.getElementsByTagName("*").length,
      };
    })()`,
  });
  const performanceMetrics = await page.send("Performance.getMetrics");
  const metric = Object.fromEntries(performanceMetrics.metrics.map((entry) => [entry.name, entry.value]));
  const value = evaluated.result.value;
  return {
    dclMs: value.nav.domContentLoadedEventEnd,
    loadMs: value.nav.loadEventEnd,
    fcpMs: value.paints["first-contentful-paint"] || 0,
    resources: value.resources,
    scripts: value.scripts,
    css: value.css,
    nodes: value.nodes,
    heapMiB: (metric.JSHeapUsedSize || 0) / 1024 / 1024,
    taskMs: (metric.TaskDuration || 0) * 1000,
  };
}

async function routeResult(route) {
  const userDataDir = mkdtempSync(join(tmpdir(), "local-studio-browser-perf-"));
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-dev-shm-usage",
      "--window-size=1440,1000",
      `--user-data-dir=${userDataDir}`,
      `${baseUrl}${route.path}`,
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );

  try {
    const debugPort = await debugPortFor(userDataDir);
    const target = await pageTarget(debugPort);
    const page = await connectToTarget(target.webSocketDebuggerUrl);
    try {
      await page.send("Performance.enable");
      await waitForComplete(page);
      await sleep(100);
      return { path: route.path, ...(await pageMetrics(page)), budget: route };
    } finally {
      page.close();
    }
  } finally {
    child.kill("SIGTERM");
    await sleep(100);
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

function formatNumber(value) {
  return value.toFixed(1).padStart(6, " ");
}

function violations(result) {
  const out = [];
  if (result.dclMs > result.budget.dclMs) out.push(`dcl ${result.dclMs.toFixed(1)}ms > ${result.budget.dclMs}ms`);
  if (result.fcpMs > result.budget.fcpMs) out.push(`fcp ${result.fcpMs.toFixed(1)}ms > ${result.budget.fcpMs}ms`);
  if (result.taskMs > result.budget.taskMs) out.push(`task ${result.taskMs.toFixed(1)}ms > ${result.budget.taskMs}ms`);
  if (result.nodes > result.budget.nodes) out.push(`nodes ${result.nodes} > ${result.budget.nodes}`);
  if (result.heapMiB > result.budget.heapMiB) {
    out.push(`heap ${result.heapMiB.toFixed(1)}MiB > ${result.budget.heapMiB}MiB`);
  }
  return out;
}

console.log(`Local Studio browser perf audit: ${baseUrl}`);
console.log("route          dcl    load     fcp    task    heap nodes res scripts css");
const failures = [];
for (const route of routes) {
  const result = await Promise.race([
    routeResult(route),
    timeoutAfter(routeTimeoutMs, `${route.path} timed out after ${routeTimeoutMs}ms`),
  ]);
  const bad = violations(result);
  console.log(
    `${result.path.padEnd(10)} ${formatNumber(result.dclMs)}ms ${formatNumber(result.loadMs)}ms ${formatNumber(result.fcpMs)}ms ${formatNumber(result.taskMs)}ms ${formatNumber(result.heapMiB)}MiB ${String(result.nodes).padStart(5, " ")} ${String(result.resources).padStart(3, " ")} ${String(result.scripts).padStart(7, " ")} ${String(result.css).padStart(3, " ")}`,
  );
  if (bad.length > 0) failures.push(`${result.path}: ${bad.join(", ")}`);
}

if (failures.length > 0) {
  console.error("Browser perf budget violations:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
