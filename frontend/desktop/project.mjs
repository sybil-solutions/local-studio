#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: !0,
      configurable: !0,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

var exports_assert_release_main = {};
__export(exports_assert_release_main, {
  assertReleaseMain: () => assertReleaseMain
});
import { execFileSync } from "node:child_process";
function valueAfter(args, name) {
  let index = args.indexOf(name);
  return index === -1 ? void 0 : args[index + 1];
}
function assertReleaseMain(args = process.argv.slice(2)) {
  let expected = valueAfter(args, "--commit")?.trim().toLowerCase();
  if (!expected || !/^[0-9a-f]{40}$/.test(expected))
    throw Error("--commit must be a full Git commit SHA");
  let current = execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], {
    encoding: "utf8"
  }).trim().split(/\s+/, 1)[0]?.toLowerCase();
  if (!current || !/^[0-9a-f]{40}$/.test(current))
    throw Error("Could not resolve origin/main");
  if (current !== expected)
    throw Error(`Refusing stale release: origin/main is ${current}, build is ${expected}`);
  return console.log(`Release source is current origin/main: ${expected}`), expected;
}
var init_assert_release_main = __esm(() => {
  assertReleaseMain();
});

var exports_assert_standalone_build = {};
import {
  existsSync as existsSync2,
  lstatSync,
  readFileSync as readFileSync2,
  readdirSync,
  readlinkSync,
  realpathSync
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
function filesUnder(directory) {
  return readdirSync(directory, { recursive: !0, withFileTypes: !0 }).filter((entry) => entry.isFile()).map((entry) => resolve(entry.parentPath, entry.name));
}
function symlinksUnder(directory) {
  return readdirSync(directory, { recursive: !0, withFileTypes: !0 }).filter((entry) => entry.isSymbolicLink()).map((entry) => resolve(entry.parentPath, entry.name));
}
function isRuntimeFile(file) {
  let path2 = relative(standaloneBase, file).replaceAll("\\", "/");
  return [
    "server.js",
    "package.json",
    ".next/",
    "public/",
    "node_modules/",
    "frontend/server.js",
    "frontend/package.json",
    "frontend/.next/",
    "frontend/public/",
    "frontend/node_modules/"
  ].some((prefix) => path2 === prefix || path2.startsWith(prefix));
}
var projectRoot, standaloneBase, candidates, runtimeRoots, requiredRuntimeFiles, runtimeRoot, unsafeRuntimeLinks, tracedPackageDirectory, danglingTracedPackages, piCodingAgentRoot, piAiRoot, piRuntimeEntries, piAiManifestPath, piAiManifest, requireFromPiAi, unexpected;
var init_assert_standalone_build = __esm(() => {
  projectRoot = resolve(import.meta.dirname, ".."), standaloneBase = resolve(projectRoot, ".next", "standalone"), candidates = [
    resolve(standaloneBase, "frontend", "server.js"),
    resolve(standaloneBase, "server.js")
  ], runtimeRoots = [resolve(standaloneBase, "frontend"), standaloneBase], requiredRuntimeFiles = [
    "node_modules/@earendil-works/pi-coding-agent/package.json",
    "node_modules/@earendil-works/pi-coding-agent/dist/index.js",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/package.json",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/data/amazon-bedrock.json",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/typebox/build/value/shared/union_priority_sort.mjs"
  ];
  if (!candidates.some((candidate) => existsSync2(candidate)))
    throw Error(`Missing standalone server: ${candidates.join(", ")}`);
  for (let file of requiredRuntimeFiles)
    if (!runtimeRoots.some((root) => existsSync2(resolve(root, file))))
      throw Error(`Missing standalone runtime dependency: ${file}`);
  runtimeRoot = runtimeRoots.find((root) => existsSync2(resolve(root, "server.js"))), unsafeRuntimeLinks = runtimeRoot ? symlinksUnder(runtimeRoot).filter((link) => {
    if (isAbsolute(readlinkSync(link)) || !existsSync2(link))
      return !0;
    let resolvedLink = relative(runtimeRoot, realpathSync(link));
    return resolvedLink === ".." || resolvedLink.startsWith(`..${sep}`) || isAbsolute(resolvedLink);
  }) : [];
  if (unsafeRuntimeLinks.length > 0)
    throw Error(`Unsafe standalone runtime links: ${unsafeRuntimeLinks.join(", ")}`);
  tracedPackageDirectory = runtimeRoot ? resolve(runtimeRoot, ".next/node_modules/@earendil-works") : void 0, danglingTracedPackages = tracedPackageDirectory ? existsSync2(tracedPackageDirectory) ? readdirSync(tracedPackageDirectory).map((entry) => resolve(tracedPackageDirectory, entry)).filter((entry) => lstatSync(entry).isSymbolicLink() && !existsSync2(entry)) : [] : [];
  if (danglingTracedPackages.length > 0)
    throw Error(`Dangling traced runtime packages: ${danglingTracedPackages.join(", ")}`);
  piCodingAgentRoot = runtimeRoot ? resolve(runtimeRoot, "node_modules/@earendil-works/pi-coding-agent") : null, piAiRoot = piCodingAgentRoot ? resolve(piCodingAgentRoot, "node_modules/@earendil-works/pi-ai") : null, piRuntimeEntries = piCodingAgentRoot && piAiRoot ? [resolve(piCodingAgentRoot, "dist/index.js"), resolve(piAiRoot, "dist/index.js")] : [];
  if (piRuntimeEntries.length !== 2 || piRuntimeEntries.some((entry) => !existsSync2(entry)))
    throw Error("Missing packaged Pi runtime entrypoints");
  for (let entry of piRuntimeEntries) {
    let importCheck = spawnSync(process.execPath, ["--input-type=module", "--eval", `import(${JSON.stringify(pathToFileURL(entry).href)})`], { cwd: runtimeRoot, encoding: "utf8" });
    if (importCheck.status !== 0)
      throw Error(`Standalone Pi runtime entrypoint is not importable: ${importCheck.stderr || importCheck.stdout}`);
  }
  piAiManifestPath = resolve(realpathSync(piAiRoot), "package.json"), piAiManifest = JSON.parse(readFileSync2(piAiManifestPath, "utf8")), requireFromPiAi = createRequire(piAiManifestPath);
  for (let dependency of Object.keys(piAiManifest.dependencies ?? {})) {
    let resolvedDependency = realpathSync(requireFromPiAi.resolve(dependency)), runtimeRelativePath = relative(runtimeRoot, resolvedDependency);
    if (runtimeRelativePath === ".." || runtimeRelativePath.startsWith(`..${sep}`) || isAbsolute(runtimeRelativePath))
      throw Error(`Pi AI dependency escaped standalone runtime: ${dependency}`);
  }
  unexpected = filesUnder(standaloneBase).filter((file) => !isRuntimeFile(file));
  if (unexpected.length > 0)
    throw Error(`Standalone build contains non-runtime files:
${unexpected.map((file) => relative(standaloneBase, file)).join(`
`)}`);
  console.log("  standalone server build is minimal");
});

import { readdirSync as readdirSync2, statSync } from "node:fs";
import { dirname, join, relative as relative2, sep as sep2 } from "node:path";
import { fileURLToPath } from "node:url";
function routeFromPageFile(filePath) {
  let segments = relative2(appDir, filePath).split(sep2).slice(0, -1);
  if (segments.some((segment) => segment.startsWith("[") || segment.startsWith("@") || segment.startsWith("_")))
    return null;
  let routeSegments = segments.filter((segment) => !segment.startsWith("("));
  return routeSegments.length === 0 ? "/" : `/${routeSegments.join("/")}`;
}
function pageFiles(directory) {
  let out = [];
  for (let entry of readdirSync2(directory)) {
    let entryPath = join(directory, entry);
    if (statSync(entryPath).isDirectory())
      out.push(...pageFiles(entryPath));
    else if (/^page\.(t|j)sx?$/u.test(entry))
      out.push(entryPath);
  }
  return out;
}
function sortRoutes(left, right) {
  let leftIndex = preferredOrder.indexOf(left.path), rightIndex = preferredOrder.indexOf(right.path);
  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1)
      return 1;
    if (rightIndex === -1)
      return -1;
    return leftIndex - rightIndex;
  }
  return left.path.localeCompare(right.path);
}
function discoveredPaths() {
  return [...new Set(pageFiles(appDir).map(routeFromPageFile).filter(Boolean))];
}
function httpRoutes() {
  return discoveredPaths().map((path2) => ({ path: path2, ...defaultHttpBudget, ...httpBudgetOverrides.get(path2) || {} })).sort(sortRoutes);
}
function browserRoutes() {
  return discoveredPaths().map((path2) => ({ path: path2, ...defaultBrowserBudget })).sort(sortRoutes);
}
var scriptsDir, appDir, preferredOrder, httpBudgetOverrides, defaultHttpBudget, defaultBrowserBudget;
var init_perf_routes = __esm(() => {
  scriptsDir = dirname(fileURLToPath(import.meta.url)), appDir = join(scriptsDir, "..", "src", "app"), preferredOrder = [
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
    "/setup"
  ], httpBudgetOverrides = new Map([
    ["/", { assetKiB: 1050 }],
    ["/agent", { assetKiB: 1250 }],
    ["/agent/sessions", { assetKiB: 1250 }],
    ["/quick", { assetKiB: 1250 }],
    ["/logs", { assetKiB: 1000 }],
    ["/server", { assetKiB: 1000 }],
    ["/usage", { assetKiB: 1025 }],
    ["/configure", { assetKiB: 1025 }],
    ["/discover", { assetKiB: 1000 }]
  ]), defaultHttpBudget = { medianMs: 50, p90Ms: 150, assetKiB: 1100 }, defaultBrowserBudget = { dclMs: 500, fcpMs: 700, taskMs: 250, nodes: 1200, heapMiB: 24, textChars: 8 };
});

var exports_browser_perf_audit = {};
import { existsSync as existsSync3, mkdtempSync, readFileSync as readFileSync3, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
import { spawn } from "node:child_process";
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function timeoutAfter(ms, message) {
  return new Promise((_, reject) => setTimeout(() => reject(Error(message)), ms));
}
function connectToTarget(webSocketDebuggerUrl) {
  let websocket = new WebSocket(webSocketDebuggerUrl), id = 0, pending = new Map;
  return websocket.addEventListener("message", (message) => {
    let data = JSON.parse(message.data);
    if (!data.id || !pending.has(data.id))
      return;
    let { resolve: resolve2, reject } = pending.get(data.id);
    if (pending.delete(data.id), data.error)
      reject(Error(JSON.stringify(data.error)));
    else
      resolve2(data.result);
  }), new Promise((resolve2, reject) => {
    websocket.addEventListener("open", () => resolve2({
      send(method, params = {}) {
        let callId = id += 1;
        return websocket.send(JSON.stringify({ id: callId, method, params })), new Promise((callResolve, callReject) => pending.set(callId, { resolve: callResolve, reject: callReject }));
      },
      close() {
        websocket.close();
      }
    })), websocket.addEventListener("error", reject);
  });
}
async function debugPortFor(userDataDir) {
  let activePortPath = join2(userDataDir, "DevToolsActivePort");
  for (let attempt = 0;attempt < 100; attempt += 1) {
    try {
      let port = readFileSync3(activePortPath, "utf8").split(`
`)[0]?.trim();
      if (/^\d+$/u.test(port ?? ""))
        return port;
    } catch {}
    await sleep(50);
  }
  throw Error("Chrome DevToolsActivePort did not appear");
}
async function pageTarget(debugPort) {
  for (let attempt = 0;attempt < 100; attempt += 1) {
    let target = (await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json())).find((entry) => entry.type === "page" && entry.url.startsWith(baseUrl));
    if (target)
      return target;
    await sleep(50);
  }
  throw Error("Chrome page target did not appear");
}
async function waitForComplete(page) {
  for (let attempt = 0;attempt < 100; attempt += 1) {
    if ((await page.send("Runtime.evaluate", { returnByValue: !0, expression: "document.readyState" })).result.value === "complete")
      return;
    await sleep(50);
  }
  throw Error("Page did not reach readyState=complete");
}
async function pageMetrics(page) {
  let evaluated = await page.send("Runtime.evaluate", {
    returnByValue: !0,
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
        textChars: document.body ? document.body.innerText.trim().length : 0,
      };
    })()`
  }), performanceMetrics = await page.send("Performance.getMetrics"), metric = Object.fromEntries(performanceMetrics.metrics.map((entry) => [entry.name, entry.value])), value = evaluated.result.value;
  return {
    dclMs: value.nav.domContentLoadedEventEnd,
    loadMs: value.nav.loadEventEnd,
    fcpMs: value.paints["first-contentful-paint"] || 0,
    resources: value.resources,
    scripts: value.scripts,
    css: value.css,
    nodes: value.nodes,
    textChars: value.textChars,
    heapMiB: (metric.JSHeapUsedSize || 0) / 1024 / 1024,
    taskMs: (metric.TaskDuration || 0) * 1000
  };
}
async function routeResult(route) {
  let userDataDir = mkdtempSync(join2(tmpdir(), "local-studio-browser-perf-")), child = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--window-size=1440,1000",
    `--user-data-dir=${userDataDir}`,
    `${baseUrl}${route.path}`
  ], { stdio: ["ignore", "ignore", "ignore"] });
  try {
    let debugPort = await debugPortFor(userDataDir), target = await pageTarget(debugPort), page = await connectToTarget(target.webSocketDebuggerUrl);
    try {
      return await page.send("Performance.enable"), await waitForComplete(page), await sleep(100), { path: route.path, ...await pageMetrics(page), budget: route };
    } finally {
      page.close();
    }
  } finally {
    child.kill("SIGTERM"), await sleep(100), rmSync(userDataDir, { recursive: !0, force: !0, maxRetries: 5, retryDelay: 50 });
  }
}
function formatNumber(value) {
  return value.toFixed(1).padStart(6, " ");
}
function violations(result) {
  let out = [];
  if (result.dclMs > result.budget.dclMs)
    out.push(`dcl ${result.dclMs.toFixed(1)}ms > ${result.budget.dclMs}ms`);
  if (result.fcpMs > result.budget.fcpMs)
    out.push(`fcp ${result.fcpMs.toFixed(1)}ms > ${result.budget.fcpMs}ms`);
  if (result.taskMs > result.budget.taskMs)
    out.push(`task ${result.taskMs.toFixed(1)}ms > ${result.budget.taskMs}ms`);
  if (result.nodes > result.budget.nodes)
    out.push(`nodes ${result.nodes} > ${result.budget.nodes}`);
  if (result.textChars < result.budget.textChars)
    out.push(`text ${result.textChars} < ${result.budget.textChars}`);
  if (result.heapMiB > result.budget.heapMiB)
    out.push(`heap ${result.heapMiB.toFixed(1)}MiB > ${result.budget.heapMiB}MiB`);
  return out;
}
var defaultChromePaths, chromePath, baseUrl, routeTimeoutMs, routes, failures;
var init_browser_perf_audit = __esm(async () => {
  init_perf_routes();
  defaultChromePaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ], chromePath = process.env.LOCAL_STUDIO_PERF_CHROME || defaultChromePaths.find((candidate) => existsSync3(candidate));
  if (!chromePath)
    console.error("Chrome executable not found. Set LOCAL_STUDIO_PERF_CHROME."), process.exit(1);
  baseUrl = (process.env.LOCAL_STUDIO_PERF_URL || "http://127.0.0.1:3000").replace(/\/+$/, ""), routeTimeoutMs = Math.max(5000, Number.parseInt(process.env.LOCAL_STUDIO_PERF_BROWSER_TIMEOUT_MS || "15000", 10)), routes = browserRoutes();
  console.log(`Local Studio browser perf audit: ${baseUrl}`);
  console.log("route              dcl    load     fcp    task    heap nodes  text res scripts css");
  failures = [];
  for (let route of routes) {
    let result = await Promise.race([
      routeResult(route).catch((error) => {
        throw Error(`${route.path}: ${error instanceof Error ? error.message : String(error)}`);
      }),
      timeoutAfter(routeTimeoutMs, `${route.path} timed out after ${routeTimeoutMs}ms`)
    ]), bad = violations(result);
    if (console.log(`${result.path.padEnd(16)} ${formatNumber(result.dclMs)}ms ${formatNumber(result.loadMs)}ms ${formatNumber(result.fcpMs)}ms ${formatNumber(result.taskMs)}ms ${formatNumber(result.heapMiB)}MiB ${String(result.nodes).padStart(5, " ")} ${String(result.textChars).padStart(5, " ")} ${String(result.resources).padStart(3, " ")} ${String(result.scripts).padStart(7, " ")} ${String(result.css).padStart(3, " ")}`), bad.length > 0)
      failures.push(`${result.path}: ${bad.join(", ")}`);
  }
  if (failures.length > 0) {
    console.error("Browser perf budget violations:");
    for (let failure of failures)
      console.error(`- ${failure}`);
    process.exit(1);
  }
});

var exports_bundle = {};
import {
  cpSync,
  existsSync as existsSync4,
  readdirSync as readdirSync3,
  mkdirSync,
  readFileSync as readFileSync5,
  realpathSync as realpathSync2,
  rmSync as rmSync2
} from "node:fs";
import path2 from "node:path";
import { spawnSync as spawnSync2 } from "node:child_process";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var packageDir, distDir, bundlePath, runtimePackages, build, lydellDir, bundle, sourceRoot;
var init_bundle = __esm(() => {
  packageDir = path2.resolve(path2.dirname(fileURLToPath2(import.meta.url)), "../../services/agent-runtime"), distDir = path2.join(packageDir, "dist"), bundlePath = path2.join(distDir, "standalone.mjs"), runtimePackages = [
    "playwright-core",
    "chromium-bidi",
    "mitt",
    "devtools-protocol",
    "@silvia-odwyer/photon-node",
    "undici",
    "@lydell/node-pty"
  ];
  rmSync2(distDir, { recursive: !0, force: !0 });
  mkdirSync(distDir, { recursive: !0 });
  build = spawnSync2("bun", [
    "build",
    "src/server.ts",
    "--target=node",
    "--external",
    "fsevents",
    "--external",
    "playwright-core",
    "--external",
    "@silvia-odwyer/photon-node",
    "--external",
    "undici",
    "--outfile=dist/standalone.mjs"
  ], { cwd: packageDir, stdio: "inherit" });
  if (build.status !== 0)
    throw Error(`Agent runtime bundle failed with status ${build.status ?? "unknown"}`);
  lydellDir = path2.join(packageDir, "node_modules", "@lydell");
  if (existsSync4(lydellDir)) {
    for (let entry of readdirSync3(lydellDir))
      if (entry.startsWith("node-pty-"))
        runtimePackages.push(`@lydell/${entry}`);
  }
  for (let packageName of runtimePackages) {
    let segments = packageName.split("/"), source = path2.join(packageDir, "node_modules", ...segments), destination = path2.join(distDir, "node_modules", ...segments);
    if (!existsSync4(path2.join(source, "package.json")))
      throw Error(`Missing browser runtime package: ${packageName}`);
    mkdirSync(path2.dirname(destination), { recursive: !0 }), cpSync(source, destination, { recursive: !0 });
  }
  bundle = readFileSync5(bundlePath, "utf8"), sourceRoot = realpathSync2(path2.join(packageDir, "..", ".."));
  if (bundle.includes(sourceRoot))
    throw Error(`Agent runtime bundle contains the build-machine root: ${sourceRoot}`);
  console.log(`Packaged portable browser runtime: ${runtimePackages.join(", ")}`);
});

var exports_check_conventional_commits = {};
import { execFileSync as execFileSync2 } from "node:child_process";
import { readFileSync as readFileSync6 } from "node:fs";
var allowedTypes, ignoredSubjects, args, messageFileIndex, rangeIndex, fail = (message) => {
  console.error(message), process.exitCode = 1;
}, validateSubject = (subject, label) => {
  if (!subject.trim()) {
    fail(`${label}: empty commit subject`);
    return;
  }
  if (ignoredSubjects.some((pattern) => pattern.test(subject)))
    return;
  let match = /^(?<type>[a-z]+)(?:\([a-z0-9._/-]+\))?(?<breaking>!)?: (?<summary>.+)$/.exec(subject);
  if (!match?.groups) {
    fail(`${label}: "${subject}" must follow "type(scope): summary"`);
    return;
  }
  let { type, summary } = match.groups;
  if (!allowedTypes.has(type))
    fail(`${label}: "${type}" is not an allowed commit type`);
  if (summary.length < 8)
    fail(`${label}: summary must be at least 8 characters`);
  if (/^[A-Z]/.test(summary))
    fail(`${label}: summary should start lowercase`);
  if (/[.]$/.test(summary))
    fail(`${label}: summary should not end with a period`);
};
var init_check_conventional_commits = __esm(() => {
  allowedTypes = new Set([
    "build",
    "chore",
    "ci",
    "docs",
    "feat",
    "fix",
    "micro",
    "perf",
    "refactor",
    "release",
    "revert",
    "style",
    "test"
  ]), ignoredSubjects = [
    /^Merge /,
    /^Revert /,
    /^Initial commit$/,
    /^dependabot\//
  ], args = process.argv.slice(2), messageFileIndex = args.indexOf("--message-file"), rangeIndex = args.indexOf("--range");
  if (messageFileIndex !== -1) {
    let messageFile = args[messageFileIndex + 1], subject = readFileSync6(messageFile, "utf8").split(/\r?\n/, 1)[0] ?? "";
    validateSubject(subject, "commit message");
  } else {
    let range = rangeIndex === -1 ? args[0] : args[rangeIndex + 1];
    if (!range)
      fail("Usage: check-conventional-commits.mjs --message-file <path> | --range <base..head>");
    else {
      let output2 = execFileSync2("git", ["log", "--format=%s", range], { encoding: "utf8" }).trim();
      (output2 ? output2.split(/\r?\n/) : []).forEach((subject, index) => validateSubject(subject, `commit ${index + 1}`));
    }
  }
  if (process.exitCode)
    console.error(`
Allowed types: ` + [...allowedTypes].join(", "));
});

var exports_complete_standalone_build = {};
import {
  cpSync as cpSync2,
  existsSync as existsSync5,
  lstatSync as lstatSync2,
  readdirSync as readdirSync4,
  readFileSync as readFileSync7,
  rmdirSync,
  rmSync as rmSync3,
  statSync as statSync2,
  symlinkSync,
  unlinkSync
} from "node:fs";
import { dirname as dirname2, relative as relative3, resolve as resolve2 } from "node:path";
function isRuntimeFile2(file2) {
  let path3 = relative3(standaloneBase2, file2).replaceAll("\\", "/");
  return [
    "server.js",
    "package.json",
    ".next/",
    "public/",
    "node_modules/",
    "frontend/server.js",
    "frontend/package.json",
    "frontend/.next/",
    "frontend/public/",
    "frontend/node_modules/"
  ].some((prefix) => path3 === prefix || path3.startsWith(prefix));
}
function filesUnder2(directory) {
  return readdirSync4(directory, { recursive: !0, withFileTypes: !0 }).filter((entry) => entry.isFile()).map((entry) => resolve2(entry.parentPath, entry.name));
}
function isVerifiedCopy(file2, repoRelativePath) {
  let source = resolve2(repoRoot, repoRelativePath);
  if (!existsSync5(source))
    return !1;
  let sourceStat = statSync2(source), copyStat = statSync2(file2);
  if (!sourceStat.isFile() || sourceStat.size !== copyStat.size)
    return !1;
  if (!(repoRelativePath === "data" || /(^|\/)data\//.test(repoRelativePath)))
    return !0;
  return readFileSync7(source).equals(readFileSync7(file2));
}
function removeEmptyDirectories(directory) {
  for (let entry of readdirSync4(directory, { withFileTypes: !0 }))
    if (entry.isDirectory())
      removeEmptyDirectories(resolve2(directory, entry.name));
  if (directory !== standaloneBase2 && readdirSync4(directory).length === 0)
    rmdirSync(directory);
}
var projectRoot2, repoRoot, standaloneBase2, standaloneRoots, standaloneRoot, runtimeDependencyPaths, tracedPiPackageDirectory, unverified, pruned = 0;
var init_complete_standalone_build = __esm(() => {
  projectRoot2 = resolve2(import.meta.dirname, ".."), repoRoot = resolve2(projectRoot2, ".."), standaloneBase2 = resolve2(projectRoot2, ".next", "standalone"), standaloneRoots = [resolve2(standaloneBase2, "frontend"), standaloneBase2], standaloneRoot = standaloneRoots.find((root) => existsSync5(resolve2(root, "server.js")));
  if (!standaloneRoot)
    throw Error(`Missing standalone server under: ${standaloneBase2}`);
  runtimeDependencyPaths = [
    "node_modules/typebox",
    "node_modules/@earendil-works/pi-coding-agent"
  ];
  for (let dependencyPath of runtimeDependencyPaths) {
    let source = resolve2(projectRoot2, dependencyPath);
    if (!existsSync5(source))
      throw Error(`Missing runtime dependency source: ${dependencyPath}`);
    let destination = resolve2(standaloneRoot, dependencyPath);
    cpSync2(source, destination, { recursive: !0 });
    let executableShimDirectories = readdirSync4(destination, {
      recursive: !0,
      withFileTypes: !0
    }).filter((entry) => entry.isDirectory() && entry.name === ".bin").map((entry) => resolve2(entry.parentPath, entry.name));
    for (let directory of executableShimDirectories)
      rmSync3(directory, { recursive: !0, force: !0 });
  }
  tracedPiPackageDirectory = resolve2(standaloneRoot, ".next/node_modules/@earendil-works");
  if (existsSync5(tracedPiPackageDirectory)) {
    let packageTargets = new Map([
      [
        "pi-ai-",
        resolve2(standaloneRoot, "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai")
      ],
      ["pi-coding-agent-", resolve2(standaloneRoot, "node_modules/@earendil-works/pi-coding-agent")]
    ]);
    for (let entry of readdirSync4(tracedPiPackageDirectory)) {
      let target = [...packageTargets].find(([prefix]) => entry.startsWith(prefix))?.[1];
      if (!target)
        continue;
      let link = resolve2(tracedPiPackageDirectory, entry);
      if (!lstatSync2(link).isSymbolicLink())
        throw Error(`Expected traced Pi package alias to be a symlink: ${link}`);
      unlinkSync(link), symlinkSync(relative3(dirname2(link), target), link, "dir");
    }
  }
  unverified = [];
  for (let file2 of filesUnder2(standaloneBase2)) {
    if (isRuntimeFile2(file2))
      continue;
    let repoRelativePath = relative3(standaloneBase2, file2).replaceAll("\\", "/");
    if (!isVerifiedCopy(file2, repoRelativePath)) {
      unverified.push(repoRelativePath);
      continue;
    }
    unlinkSync(file2), pruned += 1;
  }
  if (unverified.length > 0)
    throw Error(`Standalone output contains non-runtime files with no matching repo source; refusing to prune them (move them aside manually if expected):
${unverified.join(`
`)}`);
  removeEmptyDirectories(standaloneBase2);
  console.log(`  standalone repaired: +${runtimeDependencyPaths.length} runtime dependency trees, -${pruned} traced non-runtime files`);
});

var exports_controller_standards_audit = {};
import fs from "node:fs";
import { createRequire as createRequire2 } from "node:module";
import path3 from "node:path";
function addSourceFinding(rule, filePath, node, detail) {
  let sourceFile = node.getSourceFile(), { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  findings.push({
    level: "error",
    rule,
    path: filePath,
    detail: `${line + 1}:${character + 1} ${detail}`
  });
}
function identifierText(node) {
  return ts.isIdentifier(node) ? node.text : null;
}
function isEffectCompositionCatch(node) {
  return ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "catch" && ["Effect", "Stream"].includes(identifierText(node.expression.expression) ?? "");
}
function isInsideEffectTryPromise(node) {
  let parent = node.parent;
  while (parent) {
    if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && identifierText(parent.expression.expression) === "Effect" && parent.expression.name.text === "tryPromise")
      return !0;
    parent = parent.parent;
  }
  return !1;
}
function scanEffectStandards(filePath) {
  if (!filePath.endsWith(".ts") || filePath.endsWith(".d.ts"))
    return;
  let source = fs.readFileSync(filePath, "utf8"), sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, !0), relativePath = path3.relative(SRC_DIR, filePath), isRuntimeBoundary = runtimeBoundaryFiles.has(relativePath), visit = (node) => {
    if (ts.canHaveModifiers(node)) {
      if (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) && !isInsideEffectTryPromise(node))
        addSourceFinding("effect-async-boundary", filePath, node, "Use Effect for controller async work");
    }
    if (!isRuntimeBoundary && ts.isTypeReferenceNode(node) && ["Promise", "PromiseLike"].includes(identifierText(node.typeName) ?? ""))
      addSourceFinding("effect-promise-type", filePath, node, "Promise types are restricted to runtime adapters");
    if (!isRuntimeBoundary && ts.isNewExpression(node) && identifierText(node.expression) === "Promise")
      addSourceFinding("effect-promise-constructor", filePath, node, "Use Effect.async or Effect.callback");
    if (ts.isIdentifier(node) && ["AsyncLock", "AsyncQueue"].includes(node.text))
      addSourceFinding("effect-legacy-concurrency", filePath, node, "Use Effect concurrency primitives");
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && identifierText(node.expression.expression) === "ManagedRuntime" && node.expression.name.text === "make")
        managedRuntimeCount += 1;
      if (!isRuntimeBoundary && ts.isPropertyAccessExpression(node.expression) && ["runPromise", "runPromiseExit", "runSync", "runFork"].includes(node.expression.name.text) && (identifierText(node.expression.expression) === "Effect" || /runtime/i.test(node.expression.expression.getText(sourceFile))))
        addSourceFinding("effect-runner-boundary", filePath, node, "Effect runners are restricted to runtime adapters");
      if (!isRuntimeBoundary && ts.isPropertyAccessExpression(node.expression) && ["then", "finally"].includes(node.expression.name.text))
        addSourceFinding("effect-promise-chain", filePath, node, "Use Effect composition");
      if (!isRuntimeBoundary && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "catch" && !isEffectCompositionCatch(node))
        addSourceFinding("effect-promise-catch", filePath, node, "Use Effect.catch or Effect.catchTag");
      if (!isRuntimeBoundary && ts.isPropertyAccessExpression(node.expression) && identifierText(node.expression.expression) === "Promise")
        addSourceFinding("effect-promise-static", filePath, node, "Use Effect concurrency and coordination APIs");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}
function scanDirectory(dir) {
  let entries2 = fs.readdirSync(dir, { withFileTypes: !0 }), directFiles = entries2.filter((entry) => entry.isFile()), directDirectories = entries2.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !STRUCTURE_COUNT_EXCLUDED_DIRS.has(entry.name));
  if (stats.directories += 1, stats.files += directFiles.length, directFiles.length > MAX_FILES_PER_DIR)
    findings.push({
      level: "error",
      rule: "directory-file-limit",
      path: dir,
      detail: `${directFiles.length} files (limit ${MAX_FILES_PER_DIR})`
    });
  if (dir !== modulesRoot && directDirectories.length > MAX_SUBDIRS_PER_DIR)
    findings.push({
      level: "error",
      rule: "directory-subdir-limit",
      path: dir,
      detail: `${directDirectories.length} subdirectories (limit ${MAX_SUBDIRS_PER_DIR})`
    });
  for (let entry of entries2) {
    let fullPath = path3.join(dir, entry.name);
    if (entry.name.startsWith("."))
      continue;
    if (entry.isDirectory() && !kebabCase.test(entry.name))
      findings.push({
        level: "warning",
        rule: "kebab-case",
        path: fullPath,
        detail: `Name "${entry.name}" is not kebab-case`
      });
    if (entry.isDirectory())
      scanDirectory(fullPath);
    else if (entry.isFile())
      scanEffectStandards(fullPath);
  }
}
function printSummary() {
  let errors = findings.filter((f) => f.level === "error"), warnings = findings.filter((f) => f.level === "warning");
  console.log("=== Controller Standards Audit ==="), console.log(`Directories scanned: ${stats.directories}`), console.log(`Direct file entries scanned: ${stats.files}`), console.log(`Errors: ${errors.length}`), console.log(`Warnings: ${warnings.length}`), console.log("");
  let sortedFindings = findings.sort((a, b) => {
    if (a.level !== b.level)
      return a.level === "error" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  for (let finding of sortedFindings) {
    let emoji = finding.level === "error" ? "[ERR]" : "[WARN]";
    console.log(`${emoji} ${finding.rule} | ${finding.path}`), console.log(`      ${finding.detail}`);
  }
}
function run() {
  if (!fs.existsSync(SRC_DIR))
    return console.error("ERROR: src directory not found"), 1;
  if (scanDirectory(SRC_DIR), managedRuntimeCount !== 1)
    findings.push({
      level: "error",
      rule: "effect-single-runtime",
      path: SRC_DIR,
      detail: `${managedRuntimeCount} ManagedRuntime.make calls (expected exactly 1)`
    });
  return printSummary(), findings.some((finding) => finding.level === "error") ? 1 : 0;
}
var require2, ts, SRC_DIR, MAX_FILES_PER_DIR, MAX_SUBDIRS_PER_DIR, STRUCTURE_COUNT_EXCLUDED_DIRS, findings, stats, modulesRoot, runtimeBoundaryFiles, managedRuntimeCount = 0, kebabCase;
var init_controller_standards_audit = __esm(() => {
  require2 = createRequire2(path3.resolve(process.cwd(), "package.json")), ts = require2("typescript"), SRC_DIR = path3.resolve(process.cwd(), "src"), MAX_FILES_PER_DIR = Number.parseInt(process.env.MAX_FILES_PER_DIR ?? "20", 10), MAX_SUBDIRS_PER_DIR = Number.parseInt(process.env.MAX_SUBDIRS_PER_DIR ?? "8", 10), STRUCTURE_COUNT_EXCLUDED_DIRS = new Set(["tests"]), findings = [], stats = {
    directories: 0,
    files: 0
  }, modulesRoot = path3.join(SRC_DIR, "modules"), runtimeBoundaryFiles = new Set(["http/bounded-body.ts", "http/effect-handler.ts", "main.ts"]), kebabCase = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;
  process.exit(run());
});

var exports_desktop_package_smoke = {};
__export(exports_desktop_package_smoke, {
  runDesktopPackageSmoke: () => runDesktopPackageSmoke
});
import { spawn as spawn2 } from "node:child_process";
import {
  existsSync as existsSync6,
  mkdtempSync as mkdtempSync2,
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync8,
  rmSync as rmSync4,
  writeFileSync as writeFileSync2
} from "node:fs";
import net from "node:net";
import { createRequire as createRequire3 } from "node:module";
import os from "node:os";
import path4 from "node:path";
import process2 from "node:process";
import { fileURLToPath as fileURLToPath3 } from "node:url";
function valueAfter2(args2, name) {
  let index = args2.indexOf(name);
  return index === -1 ? void 0 : args2[index + 1];
}
function delay(ms) {
  return new Promise((resolve3) => setTimeout(resolve3, ms));
}
async function reservePort() {
  let server = net.createServer();
  await new Promise((resolve3, reject) => {
    server.once("error", reject), server.listen(0, "127.0.0.1", resolve3);
  });
  let address = server.address(), port = typeof address === "object" && address ? address.port : 0;
  if (await new Promise((resolve3, reject) => server.close((error) => error ? reject(error) : resolve3())), !port)
    throw Error("Could not reserve a debugging port");
  return port;
}
async function waitForFile(file2, timeoutMs) {
  let started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync6(file2)) {
      let value = readFileSync8(file2, "utf8").trim();
      if (value)
        return value;
    }
    await delay(200);
  }
  throw Error(`Timed out waiting for ${file2}`);
}
async function waitForJson(url, timeoutMs) {
  let started = Date.now(), lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      let response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok)
        return await response.json();
      lastError = Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}
async function postJson(url, body2) {
  let response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body2),
    signal: AbortSignal.timeout(30000)
  }), payload = await response.json();
  if (!response.ok || payload.ok !== !0)
    throw Error(`${url} failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}
async function waitForAgentRuntime(logFile, timeoutMs) {
  let started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync6(logFile)) {
      let url = [
        ...readFileSync8(logFile, "utf8").matchAll(/agent-runtime: (?:\[agent-runtime\] )?listening on (http:\/\/127\.0\.0\.1:\d+)/g)
      ].at(-1)?.[1];
      if (url) {
        let payload = await waitForJson(`${url}/health`, 1e4);
        return { url, payload };
      }
    }
    await delay(250);
  }
  throw Error(`Timed out waiting for agent runtime in ${logFile}`);
}
async function waitForPage(browser, origin, timeoutMs) {
  let started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (let context of browser.contexts())
      for (let page of context.pages())
        if (page.url().startsWith(origin))
          return page;
    await delay(200);
  }
  throw Error(`Timed out waiting for Electron page at ${origin}`);
}
async function smokeTerminal(page) {
  return page.evaluate(async () => {
    let bridge = globalThis.localStudioDesktop;
    if (!bridge)
      throw Error("Desktop bridge is unavailable");
    let status = await bridge.terminal.status();
    if (!status.available)
      throw Error(status.reason || "PTY is unavailable");
    let session = await bridge.terminal.open({
      cwd: "/tmp",
      cols: 80,
      rows: 24,
      ownerKey: "desktop-package-smoke"
    });
    return new Promise((resolve3, reject) => {
      let output2 = session.replay || "", timer = setTimeout(() => {
        disposeData(), disposeExit(), reject(Error(`PTY smoke timed out: ${output2}`));
      }, 1e4), finish = () => {
        if (!output2.includes("LOCAL_STUDIO_PTY_OK"))
          return;
        clearTimeout(timer), disposeData(), disposeExit(), resolve3({ available: !0, output: "LOCAL_STUDIO_PTY_OK" });
      }, disposeData = bridge.terminal.onData((id, chunk) => {
        if (id !== session.id)
          return;
        output2 += chunk, finish();
      }), disposeExit = bridge.terminal.onExit((id) => {
        if (id !== session.id)
          return;
        finish();
      });
      bridge.terminal.write(session.id, "printf 'LOCAL_STUDIO_PTY_OK\\n'; exit\\n"), finish();
    });
  });
}
async function terminate(child) {
  if (!child?.pid)
    return;
  try {
    process2.kill(-child.pid, "SIGTERM");
  } catch {}
  await Promise.race([
    child.exitCode === null && child.signalCode === null ? new Promise((resolve3) => child.once("exit", resolve3)) : Promise.resolve(),
    delay(5000)
  ]);
  try {
    process2.kill(-child.pid, "SIGKILL");
  } catch {}
}
async function runDesktopPackageSmoke(args2 = process2.argv.slice(2)) {
  let frontend = path4.resolve(path4.dirname(fileURLToPath3(import.meta.url)), ".."), requestedApp = valueAfter2(args2, "--app"), appPath = requestedApp ? path4.resolve(requestedApp) : path4.join(frontend, "dist-desktop", "mac-arm64", "Local Studio.app"), expectedVersion = valueAfter2(args2, "--expected-version"), executable = path4.join(appPath, "Contents", "MacOS", "Local Studio");
  if (!existsSync6(executable))
    throw Error(`Missing packaged executable: ${executable}`);
  let temp = mkdtempSync2(path4.join(os.tmpdir(), "local-studio-package-smoke-")), userData = path4.join(temp, "user-data"), logFile = path4.join(userData, "logs", "desktop.log"), frontendPortFile = path4.join(userData, "embedded-frontend.port"), debugPort = await reservePort(), stdout = [], stderr = [];
  mkdirSync2(userData, { recursive: !0 }), writeFileSync2(path4.join(userData, "api-settings.json"), `${JSON.stringify({
    backendUrl: "http://127.0.0.1:65534",
    apiKey: "",
    voiceUrl: "",
    voiceModel: "whisper-large-v3-turbo"
  })}
`, { mode: 384 });
  let env = { ...process2.env };
  delete env.ELECTRON_RUN_AS_NODE, Object.assign(env, {
    LOCAL_STUDIO_AGENT_CWD: temp,
    LOCAL_STUDIO_DESKTOP_APP_NAME: `Local Studio Smoke ${process2.pid}`,
    LOCAL_STUDIO_DESKTOP_DISABLE_AUTO_UPDATE: "true",
    LOCAL_STUDIO_DESKTOP_USER_DATA_DIR: userData
  });
  let child, browser;
  try {
    child = spawn2(executable, [`--remote-debugging-port=${debugPort}`], {
      cwd: temp,
      detached: !0,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    }), child.stdout.on("data", (chunk) => stdout.push(String(chunk))), child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    let frontendPort = Number(await waitForFile(frontendPortFile, 60000));
    if (!Number.isInteger(frontendPort) || frontendPort <= 0)
      throw Error(`Invalid embedded frontend port: ${frontendPort}`);
    let origin = `http://127.0.0.1:${frontendPort}`, desktopHealth = await waitForJson(`${origin}/api/desktop-health`, 30000), agentRuntime = await waitForAgentRuntime(logFile, 30000), embeddedBrowser = await postJson(`${agentRuntime.url}/api/agent/browser/navigate`, { url: `${origin}/agent` });
    if (!String(embeddedBrowser.data?.url ?? "").startsWith(origin))
      throw Error(`Packaged browser navigated to an unexpected URL: ${JSON.stringify(embeddedBrowser)}`);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    let page = await waitForPage(browser, origin, 30000);
    await page.waitForLoadState("domcontentloaded");
    let agentResponse = await page.goto(`${origin}/agent`, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    if (!agentResponse?.ok())
      throw Error(`Agent route returned ${agentResponse?.status() ?? "no response"}`);
    let runtime = await page.evaluate(async () => {
      if (!globalThis.localStudioDesktop)
        throw Error("Desktop bridge is unavailable");
      return globalThis.localStudioDesktop.getRuntime();
    });
    if (expectedVersion && runtime.appVersion !== expectedVersion)
      throw Error(`Packaged app version ${runtime.appVersion} does not match ${expectedVersion}`);
    let terminal = await smokeTerminal(page), result = {
      appPath,
      agentStatus: agentResponse.status(),
      desktopHealth,
      agentRuntime: agentRuntime.payload,
      embeddedBrowser: embeddedBrowser.data,
      runtime,
      terminal
    };
    return console.log(JSON.stringify(result, null, 2)), result;
  } catch (error) {
    let diagnostics = [
      existsSync6(logFile) ? readFileSync8(logFile, "utf8").slice(-12000) : "",
      stdout.join("").slice(-4000),
      stderr.join("").slice(-4000)
    ].filter(Boolean).join(`
`);
    throw Error(`${error instanceof Error ? error.message : String(error)}
${diagnostics}`);
  } finally {
    if (browser)
      await browser.close().catch(() => {
        return;
      });
    await terminate(child), rmSync4(temp, { recursive: !0, force: !0 });
  }
}
var require3, chromium;
var init_desktop_package_smoke = __esm(async () => {
  require3 = createRequire3(path4.resolve(path4.dirname(fileURLToPath3(import.meta.url)), "../package.json")), { chromium } = require3("playwright-core");
  await runDesktopPackageSmoke();
});

var exports_link_services_node_modules = {};
import { lstatSync as lstatSync3, mkdirSync as mkdirSync3, rmSync as rmSync5, symlinkSync as symlinkSync2 } from "node:fs";
import path5 from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
var frontendDir, servicesDir, linkPath, existingEntryKind = () => {
  try {
    let stat = lstatSync3(linkPath);
    if (stat.isSymbolicLink())
      return "link";
    return stat.isDirectory() ? "directory" : "file";
  } catch {
    return "missing";
  }
}, removeExistingEntry = () => {
  rmSync5(linkPath, { recursive: !0, force: !0 });
}, createLink = () => {
  if (process.platform === "win32") {
    symlinkSync2(path5.join(frontendDir, "node_modules"), linkPath, "junction");
    return;
  }
  symlinkSync2(path5.join("..", "frontend", "node_modules"), linkPath, "dir");
}, kind;
var init_link_services_node_modules = __esm(() => {
  frontendDir = path5.resolve(path5.dirname(fileURLToPath4(import.meta.url)), ".."), servicesDir = path5.join(path5.dirname(frontendDir), "services"), linkPath = path5.join(servicesDir, "node_modules");
  mkdirSync3(servicesDir, { recursive: !0 });
  kind = existingEntryKind();
  if (kind === "directory")
    console.error(`[link-services-node-modules] ${linkPath} is a real directory; leaving it alone.`), process.exit(0);
  if (kind !== "missing")
    removeExistingEntry();
  createLink();
});

var exports_perf_audit = {};
import { performance } from "node:perf_hooks";
function percentile(values, ratio) {
  let index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1);
  return values[index] ?? 0;
}
function assetUrls(html) {
  let scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]), css = [...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map((match) => match[1]);
  return [...new Set([...scripts, ...css])];
}
async function assetSize(url) {
  let absolute = new URL(url, baseUrl2).toString(), cached = assetSizeCache.get(absolute);
  if (cached !== void 0)
    return cached;
  let response = await fetch(absolute);
  if (!response.ok)
    throw Error(`Asset ${absolute} returned ${response.status}`);
  let bytes = (await response.arrayBuffer()).byteLength;
  return assetSizeCache.set(absolute, bytes), bytes;
}
async function routeResult2(route) {
  let timings = [], html = "";
  for (let index = 0;index < runs; index += 1) {
    let started = performance.now(), response = await fetch(`${baseUrl2}${route.path}`, { cache: "no-store" });
    if (html = await response.text(), !response.ok)
      throw Error(`${route.path} returned ${response.status}`);
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  let assets = assetUrls(html), bytes = (await Promise.all(assets.map((url) => assetSize(url)))).reduce((total, value) => total + value, 0);
  return {
    path: route.path,
    medianMs: percentile(timings, 0.5),
    p90Ms: percentile(timings, 0.9),
    assetKiB: bytes / 1024,
    scripts: [...html.matchAll(/<script[^>]+src="/g)].length,
    css: [...html.matchAll(/<link[^>]+href="[^"]+\.css[^"]*"/g)].length,
    budget: route
  };
}
function formatNumber2(value) {
  return value.toFixed(1).padStart(6, " ");
}
function violations2(result) {
  let out = [];
  if (result.medianMs > result.budget.medianMs)
    out.push(`median ${result.medianMs.toFixed(1)}ms > ${result.budget.medianMs}ms`);
  if (result.p90Ms > result.budget.p90Ms)
    out.push(`p90 ${result.p90Ms.toFixed(1)}ms > ${result.budget.p90Ms}ms`);
  if (result.assetKiB > result.budget.assetKiB)
    out.push(`assets ${result.assetKiB.toFixed(1)}KiB > ${result.budget.assetKiB}KiB`);
  return out;
}
var baseUrl2, runs, routes2, assetSizeCache, results, failures2;
var init_perf_audit = __esm(async () => {
  init_perf_routes();
  baseUrl2 = (process.env.LOCAL_STUDIO_PERF_URL || "http://127.0.0.1:3000").replace(/\/+$/, ""), runs = Math.max(3, Number.parseInt(process.env.LOCAL_STUDIO_PERF_RUNS || "8", 10)), routes2 = httpRoutes(), assetSizeCache = new Map;
  results = [];
  for (let route of routes2)
    results.push(await routeResult2(route));
  console.log(`Local Studio perf audit: ${baseUrl2} (${runs} runs per route)`);
  console.log("route            median     p90  assets scripts css");
  failures2 = [];
  for (let result of results) {
    let bad = violations2(result);
    if (console.log(`${result.path.padEnd(16)} ${formatNumber2(result.medianMs)}ms ${formatNumber2(result.p90Ms)}ms ${formatNumber2(result.assetKiB)}KiB ${String(result.scripts).padStart(7, " ")} ${String(result.css).padStart(3, " ")}`), bad.length > 0)
      failures2.push(`${result.path}: ${bad.join(", ")}`);
  }
  if (failures2.length > 0) {
    console.error("Perf budget violations:");
    for (let failure of failures2)
      console.error(`- ${failure}`);
    process.exit(1);
  }
});

var exports_postbuild = {};
import { readdirSync as readdirSync5, readFileSync as readFileSync10, statSync as statSync3, writeFileSync as writeFileSync4, existsSync as existsSync8 } from "node:fs";
import path7 from "node:path";
import { fileURLToPath as fileURLToPath6 } from "node:url";
function* jsFiles(dir) {
  for (let entry of readdirSync5(dir, { withFileTypes: !0 })) {
    let full = path7.join(dir, entry.name);
    if (entry.isDirectory())
      yield* jsFiles(full);
    else if (entry.isFile() && entry.name.endsWith(".js"))
      yield full;
  }
}
function resolveSpecifier(fromFile, spec) {
  if (/\.(js|mjs|cjs|json|node)$/.test(spec))
    return spec;
  let base = path7.resolve(path7.dirname(fromFile), spec);
  if (existsSync8(`${base}.js`))
    return `${spec}.js`;
  if (existsSync8(base) && statSync3(base).isDirectory() && existsSync8(path7.join(base, "index.js")))
    return `${spec}/index.js`;
  return spec;
}
var packageDir2, distDir2, realEntry, SPECIFIER_RE, rewrites = 0, shim = `// Generated by scripts/postbuild.mjs — stable entry for "node dist/server.js".
import "./services/agent-runtime/src/server.js";
`;
var init_postbuild = __esm(() => {
  packageDir2 = path7.resolve(path7.dirname(fileURLToPath6(import.meta.url)), "../../services/agent-runtime"), distDir2 = path7.join(packageDir2, "dist"), realEntry = path7.join(distDir2, "services", "agent-runtime", "src", "server.js");
  if (!existsSync8(realEntry))
    console.error(`[postbuild] expected tsc output missing: ${realEntry}`), process.exit(1);
  SPECIFIER_RE = /(from\s+|import\s*\(\s*|export\s+\*\s+from\s+|import\s+)("(\.{1,2}\/[^"]+)"|'(\.{1,2}\/[^']+)')/g;
  for (let file2 of jsFiles(distDir2)) {
    let source = readFileSync10(file2, "utf8"), next = source.replace(SPECIFIER_RE, (match, lead, quoted, dq, sq) => {
      let spec = dq ?? sq, fixed = resolveSpecifier(file2, spec);
      if (fixed === spec)
        return match;
      rewrites += 1;
      let quote = quoted[0];
      return `${lead}${quote}${fixed}${quote}`;
    });
    if (next !== source)
      writeFileSync4(file2, next);
  }
  writeFileSync4(path7.join(distDir2, "server.js"), shim);
  console.log(`[postbuild] rewrote ${rewrites} relative specifiers; wrote dist/server.js shim`);
});

var exports_prepare_next_build = {};
import { rmSync as rmSync6 } from "node:fs";
import { resolve as resolve3 } from "node:path";
var init_prepare_next_build = __esm(() => {
  rmSync6(resolve3(import.meta.dirname, "../.next"), { recursive: !0, force: !0 });
});

var exports_release_statement = {};
import { execFileSync as execFileSync3 } from "node:child_process";
var args2, sinceIndex, rangeIndex2, maxIndex, maxItems, range, logArgs, output2, subjects, groups, grouped, emitted = 0;
var init_release_statement = __esm(() => {
  args2 = process.argv.slice(2), sinceIndex = args2.indexOf("--since"), rangeIndex2 = args2.indexOf("--range"), maxIndex = args2.indexOf("--max"), maxItems = Number(maxIndex === -1 ? 20 : args2[maxIndex + 1]), range = rangeIndex2 === -1 ? `--since=${sinceIndex === -1 ? "1 week ago" : args2[sinceIndex + 1]}` : args2[rangeIndex2 + 1], logArgs = rangeIndex2 === -1 ? ["log", "origin/main", range, "--pretty=format:%s"] : ["log", range, "--pretty=format:%s"], output2 = execFileSync3("git", logArgs, { encoding: "utf8" }).trim(), subjects = output2 ? output2.split(/\r?\n/) : [], groups = [
    ["Features", /^(feat)(?:\(.+\))?!?: (.+)$/],
    ["Fixes", /^(fix)(?:\(.+\))?!?: (.+)$/],
    ["Performance", /^(perf)(?:\(.+\))?!?: (.+)$/],
    ["Refactors", /^(refactor)(?:\(.+\))?!?: (.+)$/],
    ["Tests", /^(test)(?:\(.+\))?!?: (.+)$/],
    ["Infrastructure", /^(build|ci|chore|release)(?:\(.+\))?!?: (.+)$/],
    ["Polish", /^(micro|style)(?:\(.+\))?!?: (.+)$/],
    ["Documentation", /^(docs)(?:\(.+\))?!?: (.+)$/]
  ], grouped = new Map(groups.map(([name]) => [name, []]));
  for (let subject of subjects)
    for (let [name, pattern] of groups) {
      let match = pattern.exec(subject);
      if (match) {
        grouped.get(name).push(match[2]);
        break;
      }
    }
  console.log(`# Release Statement
`);
  for (let [name, items] of grouped) {
    if (!items.length || emitted >= maxItems)
      continue;
    console.log(`## ${name}
`);
    for (let item of items.slice(0, maxItems - emitted))
      console.log(`- ${item}`), emitted += 1;
    console.log("");
  }
  if (emitted === 0)
    console.log("- No conventional release changes found for the selected range.");
});

var exports_install_desktop_app_test = {};
import assert from "node:assert/strict";
import { execFileSync as execFileSync4, spawnSync as spawnSync3 } from "node:child_process";
import {
  chmodSync,
  existsSync as existsSync9,
  mkdirSync as mkdirSync4,
  mkdtempSync as mkdtempSync3,
  readFileSync as readFileSync11,
  readdirSync as readdirSync6,
  rmSync as rmSync7,
  statSync as statSync4,
  writeFileSync as writeFileSync5
} from "node:fs";
import os2 from "node:os";
import path8 from "node:path";
import test from "node:test";
import { fileURLToPath as fileURLToPath7 } from "node:url";
function writeExecutable(file2, content) {
  writeFileSync5(file2, content, { mode: 493 }), chmodSync(file2, 493);
}
function createHarness(t) {
  let root = mkdtempSync3(path8.join(os2.tmpdir(), "local-studio-installer-"));
  t.after(() => rmSync7(root, { recursive: !0, force: !0 }));
  let applications = path8.join(root, "Applications"), rollbacks = path8.join(root, "Rollbacks"), commands = path8.join(root, "bin");
  mkdirSync4(applications, { recursive: !0 }), mkdirSync4(commands, { recursive: !0 }), writeExecutable(path8.join(commands, "ditto"), `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] !== "-c") {
  fs.cpSync(args[0], args[1], { recursive: true });
  process.exit(0);
}
const source = args.at(-2);
const destination = args.at(-1);
if (process.env.LOCAL_STUDIO_TEST_FAIL_ARCHIVE === source) process.exit(1);
const base = path.basename(source);
const members = [];
function walk(directory, relative) {
  members.push(relative + "/");
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const next = path.join(directory, entry.name);
    const member = relative + "/" + entry.name;
    if (entry.isDirectory()) walk(next, member);
    else members.push(member);
  }
}
walk(source, base);
fs.writeFileSync(destination, members.join("\\n") + "\\n");
`), writeExecutable(path8.join(commands, "unzip"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const archive = args.at(-1);
if (!fs.existsSync(archive)) process.exit(1);
if (args[0] === "-Z1") process.stdout.write(fs.readFileSync(archive));
`), writeExecutable(path8.join(commands, "codesign"), `#!/usr/bin/env node
const target = process.argv.at(-1);
if (process.env.LOCAL_STUDIO_TEST_FAIL_CODESIGN === target) process.exit(1);
`), writeExecutable(path8.join(commands, "spctl"), `#!/usr/bin/env node
const target = process.argv.at(-1);
if (process.env.LOCAL_STUDIO_TEST_FAIL_SPCTL === target) process.exit(1);
`), writeExecutable(path8.join(commands, "plist-buddy"), `#!/usr/bin/env node
const fs = require("node:fs");
const text = fs.readFileSync(process.argv.at(-1), "utf8");
const match = text.match(/<key>CFBundleIdentifier<\\/key>\\s*<string>([^<]+)<\\/string>/);
if (!match) process.exit(1);
process.stdout.write(match[1] + "\\n");
`);
  let launchServicesLog = path8.join(root, "launch-services.log");
  writeExecutable(path8.join(commands, "lsregister"), `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.LOCAL_STUDIO_TEST_LS_LOG, process.argv.slice(2).join(" ") + "\\n");
`);
  let env = {
    ...process.env,
    PATH: `${commands}:${process.env.PATH}`,
    LOCAL_STUDIO_INSTALL_ROOT: applications,
    LOCAL_STUDIO_ROLLBACK_ROOT: rollbacks,
    LOCAL_STUDIO_LSREGISTER: path8.join(commands, "lsregister"),
    LOCAL_STUDIO_PLIST_BUDDY: path8.join(commands, "plist-buddy"),
    LOCAL_STUDIO_SKIP_RUNTIME_CLEANUP: "1",
    LOCAL_STUDIO_TEST_LS_LOG: launchServicesLog
  };
  return { applications, env, launchServicesLog, rollbacks, root };
}
function createBundle(directory, name, id, marker) {
  let executable = path8.join(directory, "Contents", "MacOS", name);
  mkdirSync4(path8.dirname(executable), { recursive: !0 }), writeFileSync5(executable, marker, { mode: 493 }), chmodSync(executable, 493), writeFileSync5(path8.join(directory, "Contents", "Info.plist"), `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>${id}</string></dict></plist>`);
}
function runInstaller(harness, args3, extraEnv = {}) {
  return spawnSync3("bash", [installer, ...args3], {
    cwd: repository,
    encoding: "utf8",
    env: { ...harness.env, ...extraEnv }
  });
}
function installedMarker(applications, name) {
  return readFileSync11(path8.join(applications, `${name}.app`, "Contents", "MacOS", name), "utf8");
}
var repository, installer;
var init_install_desktop_app_test = __esm(() => {
  repository = path8.resolve(path8.dirname(fileURLToPath7(import.meta.url)), "../.."), installer = path8.join(repository, "scripts", "install-desktop-app.sh");
  test("migrates every legacy Local Studio bundle into non-app rollback archives", (t) => {
    let harness = createHarness(t);
    createBundle(path8.join(harness.applications, "Local Studio.app"), "Local Studio", "org.local.studio.desktop", "stable-current"), createBundle(path8.join(harness.applications, "Local Studio Dev.app"), "Local Studio Dev", "org.local.studio.desktop.dev", "dev-current"), createBundle(path8.join(harness.applications, "Local Studio.app.previous"), "Local Studio", "org.local.studio.desktop", "stable-old"), createBundle(path8.join(harness.applications, "Local Studio.app.previous", "Contents", "Frameworks", "Local Studio Helper.app"), "Local Studio Helper", "org.local.studio.desktop.helper", "helper"), createBundle(path8.join(harness.applications, "Local Studio Dev previous.app"), "Local Studio Dev", "org.local.studio.desktop.dev", "dev-old"), mkdirSync4(harness.rollbacks, { recursive: !0 }), writeFileSync5(path8.join(harness.rollbacks, "Local Studio.zip"), "corrupt");
    let result = runInstaller(harness, ["--migrate-rollbacks"]);
    assert.equal(result.status, 0, result.stderr), assert.deepEqual(readdirSync6(harness.applications).sort(), ["Local Studio Dev.app", "Local Studio.app"]), assert.equal(statSync4(path8.join(harness.rollbacks, "Local Studio.zip")).isFile(), !0), assert.equal(statSync4(path8.join(harness.rollbacks, "Local Studio Dev.zip")).isFile(), !0), assert.match(readFileSync11(path8.join(harness.rollbacks, "Local Studio.zip"), "utf8"), /^Contents\/Info\.plist$/m), assert.match(readFileSync11(path8.join(harness.rollbacks, "Local Studio Dev.zip"), "utf8"), /^Contents\/Info\.plist$/m), assert.equal(readdirSync6(harness.rollbacks).some((entry) => entry.endsWith(".app")), !1);
    let launchServices = readFileSync11(harness.launchServicesLog, "utf8");
    assert.match(launchServices, /-u .*Local Studio\.app\.previous/), assert.match(launchServices, /-u .*Local Studio Helper\.app/);
  });
  test("installs through a hidden staging path and archives the outgoing app", (t) => {
    let harness = createHarness(t), built = path8.join(harness.root, "built", "Local Studio.app");
    createBundle(built, "Local Studio", "org.local.studio.desktop", "new"), createBundle(path8.join(harness.applications, "Local Studio.app"), "Local Studio", "org.local.studio.desktop", "old"), createBundle(path8.join(harness.applications, "Local Studio backup.app"), "Local Studio", "org.local.studio.desktop", "older");
    let result = runInstaller(harness, ["stable"], { LOCAL_STUDIO_BUILT_APP: built });
    assert.equal(result.status, 0, result.stderr), assert.equal(installedMarker(harness.applications, "Local Studio"), "new"), assert.deepEqual(readdirSync6(harness.applications), ["Local Studio.app"]), assert.equal(existsSync9(path8.join(harness.rollbacks, "Local Studio.zip")), !0), assert.equal(readdirSync6(harness.applications).some((entry) => entry.includes("installing") || entry.includes("replaced")), !1);
  });
  test("restores the original app when final signature verification fails", (t) => {
    let harness = createHarness(t), built = path8.join(harness.root, "built", "Local Studio.app"), target = path8.join(harness.applications, "Local Studio.app");
    createBundle(built, "Local Studio", "org.local.studio.desktop", "new"), createBundle(target, "Local Studio", "org.local.studio.desktop", "old");
    let result = runInstaller(harness, ["stable"], {
      LOCAL_STUDIO_BUILT_APP: built,
      LOCAL_STUDIO_TEST_FAIL_CODESIGN: target
    });
    assert.notEqual(result.status, 0), assert.equal(installedMarker(harness.applications, "Local Studio"), "old"), assert.deepEqual(readdirSync6(harness.applications), ["Local Studio.app"]);
  });
  test("restores the original stable app when Gatekeeper rejects the replacement", (t) => {
    let harness = createHarness(t), built = path8.join(harness.root, "built", "Local Studio.app"), target = path8.join(harness.applications, "Local Studio.app");
    createBundle(built, "Local Studio", "org.local.studio.desktop", "new"), createBundle(target, "Local Studio", "org.local.studio.desktop", "old");
    let result = runInstaller(harness, ["stable"], {
      LOCAL_STUDIO_BUILT_APP: built,
      LOCAL_STUDIO_TEST_FAIL_SPCTL: target
    });
    assert.notEqual(result.status, 0), assert.equal(installedMarker(harness.applications, "Local Studio"), "old"), assert.deepEqual(readdirSync6(harness.applications), ["Local Studio.app"]);
  });
  test("preserves the current app when creating its rollback archive fails", (t) => {
    let harness = createHarness(t), built = path8.join(harness.root, "built", "Local Studio.app"), target = path8.join(harness.applications, "Local Studio.app");
    createBundle(built, "Local Studio", "org.local.studio.desktop", "new"), createBundle(target, "Local Studio", "org.local.studio.desktop", "old");
    let result = runInstaller(harness, ["stable"], {
      LOCAL_STUDIO_BUILT_APP: built,
      LOCAL_STUDIO_TEST_FAIL_ARCHIVE: path8.join(target, "Contents")
    });
    assert.notEqual(result.status, 0), assert.equal(installedMarker(harness.applications, "Local Studio"), "old"), assert.deepEqual(readdirSync6(harness.applications), ["Local Studio.app"]);
  });
  test("no-backup install removes stale archives and discoverable legacy bundles", (t) => {
    let harness = createHarness(t), built = path8.join(harness.root, "built", "Local Studio Dev.app");
    createBundle(built, "Local Studio Dev", "org.local.studio.desktop.dev", "new"), createBundle(path8.join(harness.applications, "Local Studio Dev.app"), "Local Studio Dev", "org.local.studio.desktop.dev", "old"), createBundle(path8.join(harness.applications, "Local Studio Dev.app.previous"), "Local Studio Dev", "org.local.studio.desktop.dev", "older"), mkdirSync4(harness.rollbacks, { recursive: !0 }), writeFileSync5(path8.join(harness.rollbacks, "Local Studio Dev.zip"), "stale");
    let result = runInstaller(harness, ["dev", "--no-backup"], { LOCAL_STUDIO_BUILT_APP: built });
    assert.equal(result.status, 0, result.stderr), assert.equal(installedMarker(harness.applications, "Local Studio Dev"), "new"), assert.deepEqual(readdirSync6(harness.applications), ["Local Studio Dev.app"]), assert.equal(existsSync9(path8.join(harness.rollbacks, "Local Studio Dev.zip")), !1);
  });
  test("tracked operational scripts cannot create discoverable app backups", () => {
    let files = execFileSync4("git", ["ls-files", "scripts", "frontend/scripts", ".github/workflows"], {
      cwd: repository,
      encoding: "utf8"
    }).trim().split(`
`).filter((file2) => file2 && file2 !== "scripts/project.mjs" && existsSync9(path8.join(repository, file2))), violations3 = [];
    for (let file2 of files) {
      let text = readFileSync11(path8.join(repository, file2), "utf8");
      if (/\.app\.(?:previous|prev|pre|backup)|(?:previous|backup)\.app/i.test(text))
        violations3.push(file2);
      if (/ROLLBACK=.*\/Applications/i.test(text))
        violations3.push(file2);
    }
    assert.deepEqual([...new Set(violations3)], []);
  });
});

function value(env, name) {
  let candidate = env[name];
  return typeof candidate === "string" ? candidate.trim() : "";
}
function resolveNotarytoolCredentials(env, apiKeyPath) {
  let apiKey = value(env, "APPLE_API_KEY_BASE64"), apiKeyId = value(env, "APPLE_API_KEY_ID"), apiIssuer = value(env, "APPLE_API_ISSUER");
  if (apiKey && apiKeyId && apiIssuer)
    return {
      kind: "api-key",
      apiKey,
      args: ["--key", apiKeyPath, "--key-id", apiKeyId, "--issuer", apiIssuer]
    };
  let appleId = value(env, "APPLE_ID"), password = value(env, "APPLE_APP_SPECIFIC_PASSWORD"), teamId = value(env, "APPLE_TEAM_ID");
  if (appleId && password && teamId)
    return {
      kind: "apple-id",
      args: ["--apple-id", appleId, "--password", password, "--team-id", teamId]
    };
  throw Error("Apple notarization requires either the API key secret trio or the Apple ID secret trio");
}

var exports_release_notary_credentials_test = {};
import assert2 from "node:assert/strict";
import { test as test2 } from "node:test";
var init_release_notary_credentials_test = __esm(() => {
  test2("uses App Store Connect API credentials when the full trio is present", () => {
    assert2.deepEqual(resolveNotarytoolCredentials({
      APPLE_API_KEY_BASE64: "encoded-key",
      APPLE_API_KEY_ID: "key-id",
      APPLE_API_ISSUER: "issuer"
    }, "/tmp/AuthKey.p8"), {
      kind: "api-key",
      apiKey: "encoded-key",
      args: ["--key", "/tmp/AuthKey.p8", "--key-id", "key-id", "--issuer", "issuer"]
    });
  });
  test2("uses Apple ID credentials when API credentials are unavailable", () => {
    assert2.deepEqual(resolveNotarytoolCredentials({
      APPLE_ID: "developer@example.com",
      APPLE_APP_SPECIFIC_PASSWORD: "app-password",
      APPLE_TEAM_ID: "team-id"
    }, "/tmp/AuthKey.p8"), {
      kind: "apple-id",
      args: [
        "--apple-id",
        "developer@example.com",
        "--password",
        "app-password",
        "--team-id",
        "team-id"
      ]
    });
  });
  test2("rejects partial notarization credential sets", () => {
    assert2.throws(() => resolveNotarytoolCredentials({ APPLE_ID: "developer@example.com" }, "/tmp/key.p8"), /requires either the API key secret trio or the Apple ID secret trio/);
  });
});

var releasePackageArguments = ({ app, version, commit }) => [
  "--prepackaged",
  app,
  "--config",
  "desktop/electron-builder.yml",
  "--config.mac.identity=null",
  "--config.mac.notarize=false",
  "--config.dmg.sign=false",
  `--config.extraMetadata.version=${version}`,
  `--config.extraMetadata.localStudioCommit=${commit}`,
  "--publish",
  "never"
];

var exports_release_package_arguments_test = {};
import assert3 from "node:assert/strict";
import { readFileSync as readFileSyncReleasePolicy } from "node:fs";
import test3 from "node:test";
function workflowStepSource(workflow, name) {
  let marker = `      - name: ${name}`, start = workflow.indexOf(marker);
  if (start === -1)
    throw Error(`Missing release workflow step: ${name}`);
  let next = workflow.indexOf("\n      - ", start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}
var init_release_package_arguments_test = __esm(() => {
  test3("release signing packaging never publishes implicitly", () => {
    let version = "2.9.0", commit = "0123456789abcdef0123456789abcdef01234567", args3 = releasePackageArguments({
      app: "/tmp/Local Studio.app",
      version,
      commit
    });
    assert3.deepEqual(args3.slice(-2), ["--publish", "never"]), assert3.deepEqual(args3.slice(0, 2), ["--prepackaged", "/tmp/Local Studio.app"]), assert3.ok(args3.includes(`--config.extraMetadata.version=${version}`)), assert3.ok(args3.includes(`--config.extraMetadata.localStudioCommit=${commit}`));
  });
  test3("stable release version authority stays explicit and wired end to end", () => {
    let instructions = readFileSyncReleasePolicy(new URL("../../AGENTS.md", import.meta.url), "utf8"), workflow = readFileSyncReleasePolicy(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8"), fallbackPaths = ["../../package.json", "../package.json", "../../controller/package.json", "../../controller/contracts/package.json", "../../services/agent-runtime/package.json"], fallbacks = fallbackPaths.map((manifest) => JSON.parse(readFileSyncReleasePolicy(new URL(manifest, import.meta.url), "utf8"))), shared = JSON.parse(readFileSyncReleasePolicy(new URL("../../shared/package.json", import.meta.url), "utf8")), unsigned = workflowStepSource(workflow, "Build unsigned release app"), signing = workflowStepSource(workflow, "Sign and notarize release assets"), staging = workflowStepSource(workflow, "Stage signed release assets"), computedVersion = "${{ steps.next-release.outputs.version }}", propagatedVersion = "${{ needs.build.outputs.release_version }}", sourceCommit = "${{ github.event.workflow_run.head_sha }}";
    assert3.match(instructions, /semantic-release's computed version is the authority for stable desktop releases/u), assert3.match(instructions, /root app, frontend, controller, controller contracts, and agent runtime are synchronized development fallbacks/u), assert3.match(instructions, /`shared\/package\.json` intentionally remains independently versioned at `0\.0\.0`/u), assert3.ok(workflow.includes(`release_version: ${computedVersion}`)), assert3.ok(unsigned.includes(`--config.extraMetadata.version=${computedVersion}`)), assert3.ok(unsigned.includes(`--config.extraMetadata.localStudioCommit=${sourceCommit}`)), assert3.ok(signing.includes(`--version ${propagatedVersion}`)), assert3.ok(signing.includes('--commit "$RELEASE_SHA"')), assert3.ok(staging.includes(`--version ${propagatedVersion}`)), assert3.ok(staging.includes('--commit "$RELEASE_SHA"')), assert3.deepEqual(fallbacks.map((manifest) => manifest.name), ["local-studio", "frontend", "local-studio-controller", "@local-studio/contracts", "@local-studio/agent-runtime"]), assert3.equal(new Set(fallbacks.map((manifest) => manifest.version)).size, 1), assert3.equal(shared.name, "@local-studio/shared"), assert3.equal(shared.version, "0.0.0");
  });
  test3("release staging validates and stamps version and source commit", () => {
    let version = "2.9.0", commit = "0123456789abcdef0123456789abcdef01234567", names = [...releaseAssetNames(version).map(releaseAssetName), "Local-Studio-arm64.dmg"];
    assert3.doesNotThrow(() => assertPackagedReleaseMetadata({ version, localStudioCommit: commit }, version, commit)), assert3.throws(() => assertPackagedReleaseMetadata({ version: "2.8.0", localStudioCommit: commit }, version, commit), /Packaged version 2\.8\.0 does not match release 2\.9\.0/u), assert3.throws(() => assertPackagedReleaseMetadata({ version, localStudioCommit: "fedcba9876543210fedcba9876543210fedcba98" }, version, commit), /Packaged commit .* does not match release/u);
    let manifest = releaseStagingManifest(version, commit, names, (name) => `sha256:${name}`);
    assert3.equal(manifest.version, version), assert3.equal(manifest.commit, commit), assert3.deepEqual(Object.keys(manifest.assets), names), assert3.deepEqual(manifest.assets[names[0]], { sha256: `sha256:${names[0]}` });
  });
  test3("release updater metadata and asset names derive from the computed version", () => {
    let version = "2.9.0", releaseDate = "2026-08-07T00:00:00.000Z", names = releaseAssetNames(version), metadata = releaseUpdaterMetadata(version, releaseDate, { sha512: "zip", size: 12 }, { sha512: "dmg", size: 34 });
    assert3.deepEqual(names, [`Local Studio-${version}-arm64.dmg`, `Local Studio-${version}-arm64.dmg.blockmap`, `Local Studio-${version}-arm64-mac.zip`, `Local Studio-${version}-arm64-mac.zip.blockmap`, "latest-mac.yml"]), assert3.equal(metadata.version, version), assert3.equal(metadata.path, `Local-Studio-${version}-arm64-mac.zip`), assert3.equal(metadata.releaseDate, releaseDate), assert3.deepEqual(metadata.files, [{ url: `Local-Studio-${version}-arm64-mac.zip`, sha512: "zip", size: 12 }, { url: `Local-Studio-${version}-arm64.dmg`, sha512: "dmg", size: 34 }]);
  });
  test3("release signing notarizes and staples the app before packaging", () => {
    let calls = [];
    notarizeApplication("/tmp/Local Studio.app", "/tmp/Local Studio.zip", ["--key", "/tmp/key"], (command, args3) => calls.push([command, args3]));
    assert3.deepEqual(calls, [
      ["ditto", ["-c", "-k", "--keepParent", "/tmp/Local Studio.app", "/tmp/Local Studio.zip"]],
      ["xcrun", ["notarytool", "submit", "/tmp/Local Studio.zip", "--key", "/tmp/key", "--wait", "--output-format", "json"]],
      ["xcrun", ["stapler", "staple", "/tmp/Local Studio.app"]],
      ["xcrun", ["stapler", "validate", "/tmp/Local Studio.app"]],
      ["spctl", ["--assess", "--type", "execute", "--verbose=4", "/tmp/Local Studio.app"]]
    ]);
  });
});

var exports_sign_desktop_release = {};
__export(exports_sign_desktop_release, {
  signDesktopRelease: () => signDesktopRelease
});
import { execFileSync as execFileSync5 } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync as existsSync10, mkdirSync as mkdirSync5, readFileSync as readFileSync12, rmSync as rmSync8, symlinkSync as symlinkSync3, writeFileSync as writeFileSync6 } from "node:fs";
import { createRequire as createRequire4 } from "node:module";
import os3 from "node:os";
import path9 from "node:path";
import { fileURLToPath as fileURLToPath8 } from "node:url";
function valueAfter3(args3, name) {
  let index = args3.indexOf(name);
  return index === -1 ? void 0 : args3[index + 1];
}
function requireValue(name) {
  let value2 = process.env[name];
  if (!value2)
    throw Error(`Repo secret ${name} is missing`);
  return value2;
}
function run2(command, args3, options = {}) {
  execFileSync5(command, args3, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    ...options
  });
}
function commandOutput(command, args3) {
  return execFileSync5(command, args3, {
    cwd: root,
    env: process.env,
    encoding: "utf8"
  }).trim();
}
function keychainList() {
  return [
    ...commandOutput("security", ["list-keychains", "-d", "user"]).matchAll(/"([^"]+)"/g)
  ].map((match) => match[1]);
}
function writeCertificate(link, destination) {
  let value2 = link.trim();
  if (value2.startsWith("file://")) {
    writeFileSync6(destination, readFileSync12(fileURLToPath8(value2)), { mode: 384, flag: "wx" });
    return;
  }
  if (existsSync10(value2)) {
    writeFileSync6(destination, readFileSync12(value2), { mode: 384, flag: "wx" });
    return;
  }
  let encoded = value2.replace(/^data:[^;]+;base64,/, "");
  writeFileSync6(destination, Buffer.from(encoded, "base64"), { mode: 384, flag: "wx" });
}
function notarizeApplication(app, archive, credentials, execute = run2) {
  execute("ditto", ["-c", "-k", "--keepParent", app, archive]), execute("xcrun", [
    "notarytool",
    "submit",
    archive,
    ...credentials,
    "--wait",
    "--output-format",
    "json"
  ]), execute("xcrun", ["stapler", "staple", app]), execute("xcrun", ["stapler", "validate", app]), execute("spctl", [
    "--assess",
    "--type",
    "execute",
    "--verbose=4",
    app
  ]);
}
function releaseUpdaterMetadata(version, releaseDate, zipInfo, dmgInfo) {
  let [dmgName, , zipName] = releaseAssetNames(version);
  return {
    version,
    files: [
      {
        url: zipName.replaceAll(" ", "-"),
        sha512: zipInfo.sha512,
        size: zipInfo.size
      },
      {
        url: dmgName.replaceAll(" ", "-"),
        sha512: dmgInfo.sha512,
        size: dmgInfo.size
      }
    ],
    path: zipName.replaceAll(" ", "-"),
    sha512: zipInfo.sha512,
    releaseDate
  };
}
async function refreshUpdateMetadata(output3, version) {
  let { buildBlockMap } = require4(path9.join(frontend, "node_modules", "app-builder-lib", "out", "targets", "blockmap", "blockmap.js")), YAML = require4(path9.join(frontend, "node_modules", "yaml")), [dmgName, , zipName] = releaseAssetNames(version), zipInfo = await buildBlockMap(path9.join(output3, zipName), "gzip", path9.join(output3, `${zipName}.blockmap`)), dmgInfo = await buildBlockMap(path9.join(output3, dmgName), "gzip", path9.join(output3, `${dmgName}.blockmap`)), updatePath = path9.join(output3, "latest-mac.yml"), current = YAML.parse(readFileSync12(updatePath, "utf8"));
  writeFileSync6(updatePath, YAML.stringify(releaseUpdaterMetadata(version, current.releaseDate, zipInfo, dmgInfo)));
}
async function signDesktopRelease(args3 = process.argv.slice(2)) {
  let version = valueAfter3(args3, "--version")?.trim(), commit = valueAfter3(args3, "--commit")?.trim().toLowerCase(), prepackaged = valueAfter3(args3, "--prepackaged")?.trim();
  if (!version || !/^\d+\.\d+\.\d+$/.test(version))
    throw Error("--version must be a semantic version");
  if (!commit || !/^[0-9a-f]{40}$/.test(commit))
    throw Error("--commit must be a full Git commit SHA");
  if (!prepackaged || !existsSync10(prepackaged))
    throw Error("--prepackaged must point to an unsigned app bundle");
  let certificate = requireValue("CSC_LINK"), certificatePassword = requireValue("CSC_KEY_PASSWORD"), temporary = path9.join(os3.tmpdir(), `local-studio-release-${process.pid}`), apiKeyPath = path9.join(temporary, "AuthKey_notary.p8"), notaryCredentials = resolveNotarytoolCredentials(process.env, apiKeyPath), certificatePath = path9.join(temporary, "developer-id.p12"), keychainPath = path9.join(temporary, "release-signing.keychain-db"), keychainPassword = randomBytes(32).toString("hex"), originalKeychains = keychainList(), output3 = path9.join(frontend, "dist-desktop"), dmg = path9.join(output3, `Local Studio-${version}-arm64.dmg`), resolvedApp = path9.resolve(prepackaged), appNotaryArchive = path9.join(temporary, "Local Studio.app.zip"), entitlements = path9.join(frontend, "desktop", "resources", "entitlements.mac.plist");
  try {
    if (rmSync8(temporary, { recursive: !0, force: !0 }), mkdirSync5(temporary, { recursive: !0, mode: 448 }), notaryCredentials.kind === "api-key")
      writeFileSync6(apiKeyPath, Buffer.from(notaryCredentials.apiKey, "base64"), {
        mode: 384,
        flag: "wx"
      });
    writeCertificate(certificate, certificatePath), run2("security", ["create-keychain", "-p", keychainPassword, keychainPath]), run2("security", ["set-keychain-settings", "-lut", "21600", keychainPath]), run2("security", ["unlock-keychain", "-p", keychainPassword, keychainPath]), run2("security", [
      "import",
      certificatePath,
      "-k",
      keychainPath,
      "-P",
      certificatePassword,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security"
    ]), run2("security", [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      keychainPassword,
      keychainPath
    ]), run2("security", ["list-keychains", "-d", "user", "-s", keychainPath, ...originalKeychains]);
    let identity = commandOutput("security", [
      "find-identity",
      "-v",
      "-p",
      "codesigning",
      keychainPath
    ]).match(/"([^"]*Developer ID Application:[^"]*)"/)?.[1];
    if (!identity)
      throw Error("Imported certificate does not contain a Developer ID Application identity");
    let { signAsync } = require4(path9.join(frontend, "node_modules", "@electron", "osx-sign"));
    await signAsync({
      app: resolvedApp,
      platform: "darwin",
      type: "distribution",
      identity,
      keychain: keychainPath,
      hardenedRuntime: !0,
      preAutoEntitlements: !1
    }), run2("codesign", [
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--entitlements",
      entitlements,
      "--sign",
      identity,
      "--keychain",
      keychainPath,
      resolvedApp
    ]), run2("codesign", ["--verify", "--deep", "--strict", "--verbose=4", resolvedApp]), notarizeApplication(resolvedApp, appNotaryArchive, notaryCredentials.args), process.env.LOCAL_STUDIO_RELEASE_VERSION = version, process.env.LOCAL_STUDIO_RELEASE_COMMIT = commit, process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false", run2(path9.join(frontend, "node_modules", ".bin", "electron-builder"), releasePackageArguments({ app: resolvedApp, version, commit }), { cwd: frontend }), run2("codesign", [
      "--force",
      "--timestamp",
      "--sign",
      identity,
      "--keychain",
      keychainPath,
      dmg
    ]), run2("xcrun", [
      "notarytool",
      "submit",
      dmg,
      ...notaryCredentials.args,
      "--wait",
      "--output-format",
      "json"
    ]), run2("xcrun", ["stapler", "staple", dmg]), await refreshUpdateMetadata(output3, version), run2("xcrun", ["stapler", "validate", dmg]), run2("codesign", ["--verify", "--verbose=4", dmg]), run2("spctl", [
      "--assess",
      "--type",
      "open",
      "--context",
      "context:primary-signature",
      "--verbose=4",
      dmg
    ]);
    let packagedApp = path9.join(output3, "mac-arm64", "Local Studio.app");
    mkdirSync5(path9.dirname(packagedApp), { recursive: !0 }), rmSync8(packagedApp, { recursive: !0, force: !0 }), symlinkSync3(resolvedApp, packagedApp, "dir"), console.log(`Signed and notarized Local Studio ${version} from ${commit}`);
  } finally {
    if (originalKeychains.length > 0)
      run2("security", ["list-keychains", "-d", "user", "-s", ...originalKeychains]);
    if (existsSync10(keychainPath))
      run2("security", ["delete-keychain", keychainPath]);
    rmSync8(temporary, { recursive: !0, force: !0 });
  }
}
var root, frontend, require4;
var init_sign_desktop_release = __esm(async () => {
  root = path9.resolve(path9.dirname(fileURLToPath8(import.meta.url)), "../.."), frontend = path9.join(root, "frontend"), require4 = createRequire4(import.meta.url);
  await signDesktopRelease();
});

var exports_stage_desktop_release = {};
__export(exports_stage_desktop_release, {
  stageDesktopRelease: () => stageDesktopRelease
});
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync as existsSync11,
  mkdirSync as mkdirSync6,
  readFileSync as readFileSync13,
  rmSync as rmSync9,
  writeFileSync as writeFileSync7
} from "node:fs";
import { createRequire as createRequire5 } from "node:module";
import path10 from "node:path";
import { fileURLToPath as fileURLToPath9 } from "node:url";
function frontendVersion() {
  let manifest = JSON.parse(readFileSync13(path10.join(frontend2, "package.json"), "utf8"));
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version))
    throw Error("frontend/package.json must contain a semantic version");
  return manifest.version;
}
function valueAfter4(args3, name) {
  let index = args3.indexOf(name);
  return index === -1 ? void 0 : args3[index + 1];
}
function releaseAssetNames(version) {
  let base = `Local Studio-${version}-arm64`;
  return [
    `${base}.dmg`,
    `${base}.dmg.blockmap`,
    `${base}-mac.zip`,
    `${base}-mac.zip.blockmap`,
    "latest-mac.yml"
  ];
}
function requireAsset(name) {
  let file2 = path10.join(output3, name);
  if (!existsSync11(file2))
    throw Error(`Missing desktop release asset: ${file2}`);
  return file2;
}
function releaseAssetName(name) {
  return name.replaceAll(" ", "-");
}
function sha256(file2) {
  return createHash("sha256").update(readFileSync13(file2)).digest("hex");
}
function packagedMetadata() {
  let archive = path10.join(output3, "mac-arm64", "Local Studio.app", "Contents", "Resources", "app.asar");
  if (!existsSync11(archive))
    throw Error(`Missing packaged app archive: ${archive}`);
  let asar = require5(path10.join(frontend2, "node_modules", "@electron", "asar"));
  return JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"));
}
function assertPackagedReleaseMetadata(metadata, version, commit) {
  if (metadata.version !== version)
    throw Error(`Packaged version ${metadata.version} does not match release ${version}`);
  if (metadata.localStudioCommit !== commit)
    throw Error(`Packaged commit ${String(metadata.localStudioCommit)} does not match release ${commit}`);
}
function releaseStagingManifest(version, commit, names, digest) {
  return {
    schemaVersion: 1,
    version,
    commit,
    assets: Object.fromEntries(names.map((name) => [
      name,
      { sha256: digest(name) }
    ]))
  };
}
function stageDesktopRelease(args3 = process.argv.slice(2)) {
  let version = valueAfter4(args3, "--version")?.trim() || frontendVersion(), commit = valueAfter4(args3, "--commit")?.trim().toLowerCase();
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw Error("--version must be a semantic version");
  if (!commit || !/^[0-9a-f]{40}$/.test(commit))
    throw Error("--commit must be a full Git commit SHA");
  let metadata = packagedMetadata();
  assertPackagedReleaseMetadata(metadata, version, commit);
  let names = releaseAssetNames(version), assets = names.map((name) => [
    requireAsset(name),
    path10.join(staging, releaseAssetName(name))
  ]);
  rmSync9(staging, { recursive: !0, force: !0 }), mkdirSync6(staging, { recursive: !0 });
  for (let [source, destination] of assets)
    copyFileSync(source, destination);
  copyFileSync(requireAsset(`Local Studio-${version}-arm64.dmg`), path10.join(staging, "Local-Studio-arm64.dmg"));
  let stagedNames = [
    ...names.map(releaseAssetName),
    "Local-Studio-arm64.dmg"
  ], manifest = releaseStagingManifest(version, commit, stagedNames, (name) => sha256(path10.join(staging, name)));
  return writeFileSync7(path10.join(staging, "Local-Studio-release.json"), `${JSON.stringify(manifest, null, 2)}
`), console.log(`Staged ${stagedNames.length + 1} Local Studio ${version} assets in ${staging}`), manifest;
}
var root2, frontend2, output3, staging, require5;
var init_stage_desktop_release = __esm(() => {
  root2 = path10.resolve(path10.dirname(fileURLToPath9(import.meta.url)), "../.."), frontend2 = path10.join(root2, "frontend"), output3 = path10.join(frontend2, "dist-desktop"), staging = path10.join(root2, "release-staging"), require5 = createRequire5(import.meta.url);
  stageDesktopRelease();
});

var exports_start_standalone = {};
import { cpSync as cpSync3, existsSync as existsSync12, mkdirSync as mkdirSync7 } from "node:fs";
import { spawn as spawn3 } from "node:child_process";
import { dirname as dirname3, resolve as resolve4 } from "node:path";
import { fileURLToPath as fileURLToPath10 } from "node:url";
function copyDirectory(from, to) {
  mkdirSync7(to, { recursive: !0 }), cpSync3(from, to, { recursive: !0 });
}
async function runtimeHealthy() {
  try {
    let response = await fetch(`${runtimeUrl}/health`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok)
      return !1;
    return (await response.json()).service === "local-studio-agent-runtime";
  } catch {
    return !1;
  }
}
async function waitForRuntime(child) {
  for (let attempt = 0;attempt < 150; attempt += 1) {
    if (child.exitCode !== null)
      throw Error(`Agent runtime exited with code ${child.exitCode}`);
    if (await runtimeHealthy())
      return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw Error(`Timed out waiting for agent runtime: ${runtimeUrl}`);
}
async function startRuntime() {
  if (await runtimeHealthy())
    return null;
  let url = new URL(runtimeUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
    throw Error(`Agent runtime is unavailable: ${runtimeUrl}`);
  let entry = resolve4(projectRoot3, "..", "services", "agent-runtime", "dist", "standalone.mjs");
  if (!existsSync12(entry))
    throw Error(`Missing agent runtime bundle: ${entry}`);
  let child = spawn3(process.execPath, [entry], {
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: url.port || "8081",
      LOCAL_STUDIO_FRONTEND_BASE: `http://127.0.0.1:${port}`
    }
  });
  try {
    return await waitForRuntime(child), child;
  } catch (error) {
    if (child.exitCode === null)
      child.kill("SIGTERM");
    throw error;
  }
}
function stopOwnedRuntime() {
  if (agentRuntime?.exitCode === null)
    agentRuntime.kill("SIGTERM");
}
var projectRoot3, standaloneRoot2, nestedRoot, serverRoot, rawPort, port, runtimeUrl, agentRuntime, server, runtimeExitCode = 0;
var init_start_standalone = __esm(async () => {
  projectRoot3 = resolve4(dirname3(fileURLToPath10(import.meta.url)), ".."), standaloneRoot2 = resolve4(projectRoot3, ".next", "standalone"), nestedRoot = resolve4(standaloneRoot2, "frontend"), serverRoot = existsSync12(nestedRoot) ? nestedRoot : standaloneRoot2, rawPort = process.env.PORT || "4783", port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("PORT must be an integer from 1024 through 65535");
  runtimeUrl = (process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL || "http://127.0.0.1:8081").replace(/\/+$/, "");
  if (!existsSync12(standaloneRoot2))
    throw Error('Missing ".next/standalone". Run "npm run build" first.');
  copyDirectory(resolve4(projectRoot3, "public"), resolve4(serverRoot, "public"));
  copyDirectory(resolve4(projectRoot3, ".next", "static"), resolve4(serverRoot, ".next", "static"));
  agentRuntime = await startRuntime(), server = spawn3(process.execPath, ["server.js"], {
    cwd: serverRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
      PORT: String(port),
      LOCAL_STUDIO_AGENT_CWD: process.env.LOCAL_STUDIO_AGENT_CWD || resolve4(projectRoot3, ".."),
      LOCAL_STUDIO_AGENT_RUNTIME_URL: runtimeUrl
    }
  });
  console.log(`Local Studio: http://127.0.0.1:${port}`);
  server.on("exit", (code) => {
    stopOwnedRuntime(), process.exit(runtimeExitCode || code || 0);
  });
  agentRuntime?.on("exit", (code) => {
    if (runtimeExitCode = code || 1, server.exitCode === null)
      server.kill("SIGTERM");
  });
  process.on("SIGINT", () => server.kill("SIGINT"));
  process.on("SIGTERM", () => server.kill("SIGTERM"));
});

var exports_validate_shared_contracts = {};
import { readFileSync as readFileSync14, readdirSync as readdirSync7 } from "node:fs";
import { join as join4, relative as relative4, resolve as resolve5 } from "node:path";
function walk(dir) {
  for (let entry of readdirSync7(dir, { withFileTypes: !0 })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules")
      continue;
    let full = join4(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
      inspect(full);
  }
}
function inspect(filePath) {
  let rel = relative4(root3, filePath).replaceAll("\\", "/"), source = readFileSync14(filePath, "utf8");
  collectExportedDeclarations(rel, source);
  for (let name of contractNames)
    if (new RegExp(`export\\s+(interface|type)\\s+${name}\\b`).test(source) && !allowedFiles.has(rel))
      findings2.push(`${rel}: ${name}`);
}
function collectExportedDeclarations(rel, source) {
  let declaration = /\bexport\s+(?:declare\s+)?(?:type|interface)\s+([A-Za-z0-9_]+)/g;
  for (let match of source.matchAll(declaration)) {
    let name = match[1];
    if (!exportedDeclarations.has(name))
      exportedDeclarations.set(name, []);
    exportedDeclarations.get(name).push(rel);
  }
}
var root3, contractNames, allowedFiles, scanRoots, findings2, exportedDeclarations, duplicateDeclarations;
var init_validate_shared_contracts = __esm(() => {
  root3 = resolve5(import.meta.dirname, "../.."), contractNames = [
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
    "RigsPayload"
  ], allowedFiles = new Set([
    "controller/contracts/recipes.ts",
    "controller/contracts/system.ts",
    "controller/contracts/controller-events.ts",
    "controller/contracts/observability.ts",
    "controller/contracts/usage.ts",
    "controller/contracts/rigs.ts",
    "controller/src/modules/shared/recipe-types.ts",
    "controller/src/modules/shared/system-types.ts",
    "frontend/src/lib/types.ts",
    "frontend/src/lib/controller-events-contract.ts"
  ]), scanRoots = ["shared", "controller/contracts", "controller/src", "frontend/src"], findings2 = [], exportedDeclarations = new Map;
  for (let scanRoot of scanRoots)
    walk(join4(root3, scanRoot));
  if (findings2.length > 0) {
    console.error("Shared contract check failed. Move these declarations to controller/contracts:");
    for (let finding of findings2)
      console.error(`- ${finding}`);
    process.exit(1);
  }
  duplicateDeclarations = [...exportedDeclarations.entries()].filter(([, files]) => files.length > 1).sort(([left], [right]) => left.localeCompare(right));
  if (duplicateDeclarations.length > 0) {
    console.error("Duplicate exported type/interface declarations found:");
    for (let [name, files] of duplicateDeclarations) {
      console.error(`- ${name}`);
      for (let file2 of files)
        console.error(`  ${file2}`);
    }
    console.error("Export one declaration and re-export aliases from compatibility barrels instead."), process.exit(1);
  }
  console.log("Shared contract check passed");
});

var exports_validate_package_json = {};
import { readFileSync as readFileSync15 } from "node:fs";
import { resolve as resolve6 } from "node:path";
var packageRepository, packageRequirements, packageLocks, packageMissing, releaseVersion;
function packageAuditRead(relativePath) {
  return JSON.parse(readFileSync15(resolve6(packageRepository, relativePath), "utf8"));
}
var init_validate_package_json = __esm(() => {
  packageRepository = resolve6(import.meta.dirname, "../.."), packageRequirements = [
    ["package.json", ["doctor", "setup", "dev", "dev:controller", "build", "start", "start:controller", "test", "check", "test:integration"]],
    ["frontend/package.json", ["dev", "build", "start", "desktop:dist", "check:quality"]],
    ["controller/package.json", ["dev", "start", "typecheck", "lint", "check", "test"]],
    ["services/agent-runtime/package.json", ["bundle", "build", "dev", "start", "test"]],
    ["shared/package.json", []],
    ["controller/contracts/package.json", []]
  ], packageLocks = ["frontend/package-lock.json", "controller/bun.lock", "services/agent-runtime/bun.lock", "shared/bun.lock"], packageMissing = [];
  for (let [manifest, scripts] of packageRequirements) {
    let packageJson = packageAuditRead(manifest);
    if (packageJson.private !== true)
      packageMissing.push(`${manifest}:private`);
    for (let script of scripts)
      if (!packageJson.scripts?.[script])
        packageMissing.push(`${manifest}:script:${script}`);
  }
  for (let lockfile of packageLocks)
    if (!existsSync(resolve6(packageRepository, lockfile)))
      packageMissing.push(lockfile);
  releaseVersion = packageAuditRead("package.json").version;
  for (let manifest of ["frontend/package.json", "controller/package.json", "controller/contracts/package.json", "services/agent-runtime/package.json"])
    if (packageAuditRead(manifest).version !== releaseVersion)
      packageMissing.push(`${manifest}:version`);
  if (packageMissing.length > 0)
    console.error(`
  package.json integrity check FAILED
`), console.error(`  Invalid: ${packageMissing.join(", ")}`), process.exit(1);
  console.log("  package.json integrity check passed");
});

var exports_validate_barrel_dir_siblings = {};
import { readdirSync as readdirSync8 } from "node:fs";
import { join as join5, relative as relative5, resolve as resolve7 } from "node:path";
function walk2(dir) {
  let entries2 = readdirSync8(dir, { withFileTypes: !0 }), directoryNames = new Set(entries2.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  for (let entry of entries2) {
    if (entry.name.startsWith(".") || entry.name === "node_modules")
      continue;
    let full = join5(dir, entry.name);
    if (entry.isDirectory()) {
      walk2(full);
      continue;
    }
    if (!entry.isFile())
      continue;
    let match = entry.name.match(/^(.+)\.tsx?$/);
    if (!match || !directoryNames.has(match[1]))
      continue;
    let rel = relative5(root4, full);
    if (siblingAllowlist.has(rel))
      continue;
    findings3.push(`${rel} sits next to directory ${relative5(root4, join5(dir, match[1]))}/`);
  }
}
var root4, siblingAllowlist, scanRoots2, findings3;
var init_validate_barrel_dir_siblings = __esm(() => {
  root4 = resolve7(import.meta.dirname, "../.."), siblingAllowlist = new Set([]), scanRoots2 = ["frontend/src", "controller/src"], findings3 = [];
  for (let scanRoot of scanRoots2)
    walk2(join5(root4, scanRoot));
  if (findings3.length > 0) {
    console.error("Barrel/dir sibling check failed. Merge each file into its same-named directory (or flatten the directory):");
    for (let finding of findings3)
      console.error(`- ${finding}`);
    process.exit(1);
  }
  console.log("Barrel/dir sibling check passed");
});

var exports_validate_ui_structure = {};
import { readFileSync as readFileSync16, readdirSync as readdirSync9, statSync as statSync5 } from "node:fs";
import { dirname as dirname4, join as join6, relative as relative6, resolve as resolve8, sep as sep3 } from "node:path";
function isSharedLayerPath(rel) {
  let top = rel.split(sep3)[0];
  return top === "lib" || top === "hooks";
}
function resolveImportTarget(importerPath, specifier) {
  let base;
  if (specifier.startsWith("@/"))
    base = join6(srcRoot, specifier.slice(2));
  else if (specifier.startsWith("."))
    base = resolve8(dirname4(importerPath), specifier);
  else
    return null;
  for (let candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join6(base, "index.ts"),
    join6(base, "index.tsx")
  ])
    if (statSync5(candidate, { throwIfNoEntry: !1 })?.isFile())
      return candidate;
  return null;
}
function recordImportEdges(filePath, rel, source) {
  for (let match of source.matchAll(/(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)) {
    let target = resolveImportTarget(filePath, match[1]);
    if (!target || target === filePath)
      continue;
    let targetRel = relative6(srcRoot, target);
    if (targetRel.startsWith("..") || !isSharedLayerPath(targetRel))
      continue;
    let importers = sharedModuleImporters.get(targetRel);
    if (!importers)
      importers = new Set, sharedModuleImporters.set(targetRel, importers);
    importers.add(rel);
  }
}
function walk3(dir) {
  for (let entry of readdirSync9(dir, { withFileTypes: !0 })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules")
      continue;
    let fullPath = join6(dir, entry.name);
    if (entry.isDirectory()) {
      walk3(fullPath);
      continue;
    }
    if (entry.isFile())
      inspectFile(fullPath);
  }
}
function inspectFile(filePath) {
  let rel = relative6(srcRoot, filePath), segments = rel.split(sep3);
  if (segments[0] === "components")
    findings4.push({
      rule: "retired-components-dir",
      path: rel,
      detail: "src/components is retired; page features live in src/features, primitives in src/ui."
    });
  if (segments[0] === "ui" && segments.length > 2 && retiredUiFeatureDirs.has(segments[1]))
    findings4.push({
      rule: "feature-location",
      path: rel,
      detail: `Page-feature UI belongs in src/features/${segments[1]}; src/ui is for shared primitives.`
    });
  if (segments[0] === "app" && rel.includes(`${sep3}_components${sep3}`))
    findings4.push({
      rule: "route-ui-location",
      path: rel,
      detail: "Route UI belongs in src/features/<name>; app routes stay thin shells."
    });
  let extension = filePath.slice(filePath.lastIndexOf("."));
  if (!sourceExtensions.has(extension))
    return;
  let source = readFileSync16(filePath, "utf8");
  if (isSharedLayerPath(rel) && !rel.endsWith(".d.ts") && !sharedModuleImporters.has(rel))
    sharedModuleImporters.set(rel, new Set);
  recordImportEdges(filePath, rel, source);
  for (let match of source.matchAll(/from\s+["']@\/components\/([^"']+)["']/g))
    findings4.push({
      rule: "retired-components-import",
      path: rel,
      detail: `Import "@/components/${match[1]}" is retired; use "@/features/..." or "@/ui/...".`
    });
  if (segments[0] === "ui" && !legacyPrimitivePurityFiles.has(rel))
    for (let match of source.matchAll(/from\s+["']@\/(features|app)\/([^"']+)["']/g))
      findings4.push({
        rule: "primitive-purity",
        path: rel,
        detail: `src/ui is the primitives layer and must not import "@/${match[1]}/${match[2]}".`
      });
  if (segments[0] === "features")
    for (let match of source.matchAll(/from\s+["']@\/app\/([^"']+)["']/g))
      findings4.push({
        rule: "feature-app-import",
        path: rel,
        detail: `src/features must not import app code ("@/app/${match[1]}"); features are composed by routes, not the reverse.`
      });
}
function evaluateSharedLayerConsumers() {
  for (let [rel, importers] of [...sharedModuleImporters.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (sharedLayerAllowlist.has(rel))
      continue;
    if (importers.size === 0) {
      findings4.push({
        rule: "shared-layer-consumers",
        path: rel,
        detail: "No importer anywhere in src; shared-layer modules without consumers are dead code."
      });
      continue;
    }
    let featureOwners = new Set, hasNonFeatureImporter = !1;
    for (let importer of importers) {
      let segments = importer.split(sep3);
      if (segments[0] === "features" && segments.length > 1)
        featureOwners.add(segments[1]);
      else
        hasNonFeatureImporter = !0;
    }
    if (!hasNonFeatureImporter && featureOwners.size === 1) {
      let [owner] = featureOwners;
      findings4.push({
        rule: "shared-layer-consumers",
        path: rel,
        detail: `All importers live in src/features/${owner}; move this module into that feature.`
      });
    }
  }
}
var projectRoot4, srcRoot, legacyPrimitivePurityFiles, sharedLayerAllowlist, retiredUiFeatureDirs, sourceExtensions, findings4, sharedModuleImporters;
var init_validate_ui_structure = __esm(() => {
  projectRoot4 = resolve8(import.meta.dirname, ".."), srcRoot = join6(projectRoot4, "src"), legacyPrimitivePurityFiles = new Set([]), sharedLayerAllowlist = new Set([]), retiredUiFeatureDirs = new Set([
    "recipes",
    "discover",
    "configs",
    "usage",
    "setup",
    "logs",
    "dashboard"
  ]), sourceExtensions = new Set([".ts", ".tsx"]), findings4 = [], sharedModuleImporters = new Map;
  if (statSync5(srcRoot, { throwIfNoEntry: !1 }))
    walk3(srcRoot), evaluateSharedLayerConsumers();
  if (findings4.length > 0) {
    console.error("UI structure check failed:");
    for (let finding of findings4)
      console.error(`- ${finding.rule}: ${finding.path}`), console.error(`  ${finding.detail}`);
    process.exit(1);
  }
  console.log("UI structure check passed");
});

import { execFileSync as execFileSync6, spawnSync as spawnSync4 } from "node:child_process";
import { chmodSync as chmodSync2, readFileSync as readFileSync17, readdirSync as readdirSync10 } from "node:fs";
import path11 from "node:path";
import { fileURLToPath as fileURLToPath11 } from "node:url";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
function resolveResourcesDir(appOutDir, productFilename, electronPlatformName) {
  if (electronPlatformName === "darwin" || electronPlatformName === "mas")
    return path.join(appOutDir, `${productFilename}.app`, "Contents", "Resources");
  return path.join(appOutDir, "resources");
}
async function afterPack(context) {
  let { appOutDir, packager, electronPlatformName } = context, productFilename = packager.appInfo.productFilename, resourcesDir = resolveResourcesDir(appOutDir, productFilename, electronPlatformName), standaloneBase = path.join(resourcesDir, "app", "frontend", ".next", "standalone"), candidates = [
    path.join(standaloneBase, "frontend", "server.js"),
    path.join(standaloneBase, "server.js")
  ], standaloneServer = candidates.find((candidate) => existsSync(candidate));
  if (!standaloneServer)
    throw Error([
      "Packaged app is missing the embedded Next standalone server — refusing to sign/ship a broken bundle.",
      `Looked for: ${candidates.join(" or ")}`,
      `electron-builder failed to copy extraResources from .next/standalone (it can log "file source doesn't exist" yet still exit 0).`,
      "Re-run the build (run `npm run build` first if .next/standalone is absent)."
    ].join(`
  `));
  let standaloneRoot = path.dirname(standaloneServer), missingRuntimeFile = [
    path.join(standaloneRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js"),
    path.join(standaloneRoot, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "package.json"),
    path.join(standaloneRoot, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist", "providers", "data", "amazon-bedrock.json")
  ].find((file) => !existsSync(file));
  if (missingRuntimeFile)
    throw Error(`Packaged app is missing a Pi runtime dependency: ${missingRuntimeFile}`);
  let agentRuntimeRoot = path.join(resourcesDir, "app", "agent-runtime"), agentRuntime = path.join(agentRuntimeRoot, "standalone.mjs"), missingAgentRuntimeFile = [
    agentRuntime,
    path.join(agentRuntimeRoot, "node_modules", "playwright-core", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "chromium-bidi", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "chromium-bidi", "node_modules", "zod", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "mitt", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "devtools-protocol", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "@silvia-odwyer", "photon-node", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "undici", "package.json")
  ].find((file) => !existsSync(file));
  if (missingAgentRuntimeFile)
    throw Error(`Packaged app is missing an agent runtime dependency: ${missingAgentRuntimeFile}`);
  let agentRuntimeSource = readFileSync(agentRuntime, "utf8");
  if (/["'](?:[A-Za-z]:\\|\/(?:Users|home|root)\/)[^"'\n]*node_modules[\\/]/.test(agentRuntimeSource))
    throw Error("Packaged agent runtime contains a build-machine dependency path");
  let missingPiLauncherMarker = [
    "resolveElectronNodeExecutable",
    "resolvePackagedPiCli",
    "Frameworks",
    "Helper.app",
    "ELECTRON_RUN_AS_NODE"
  ].find((marker) => !agentRuntimeSource.includes(marker));
  if (missingPiLauncherMarker)
    throw Error(`Packaged agent runtime is missing Pi helper launcher: ${missingPiLauncherMarker}`);
  if (electronPlatformName === "darwin") {
    let helperExecutable = path.join(path.dirname(resourcesDir), "Frameworks", `${productFilename} Helper.app`, "Contents", "MacOS", `${productFilename} Helper`);
    if (!existsSync(helperExecutable))
      throw Error(`Packaged app is missing its Pi helper executable: ${helperExecutable}`);
  }
  let packagedPiCli = path.join(resourcesDir, "app", "frontend", ".next", "standalone", "frontend", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  if (!existsSync(packagedPiCli))
    throw Error(`Packaged app is missing its Pi CLI: ${packagedPiCli}`);
  console.log(`  afterPack: embedded frontend and agent runtime present (${electronPlatformName})`);
}

var project_entry_default = afterPack, root5 = path11.resolve(path11.dirname(fileURLToPath11(import.meta.url)), "../.."), commands = new Map([
  ["assert-release-main", () => Promise.resolve().then(() => (init_assert_release_main(), exports_assert_release_main))],
  ["assert-standalone", () => Promise.resolve().then(() => (init_assert_standalone_build(), exports_assert_standalone_build))],
  ["browser-perf", () => init_browser_perf_audit().then(() => exports_browser_perf_audit)],
  ["bundle-agent-runtime", () => Promise.resolve().then(() => (init_bundle(), exports_bundle))],
  ["check-commits", () => Promise.resolve().then(() => (init_check_conventional_commits(), exports_check_conventional_commits))],
  ["complete-standalone", () => Promise.resolve().then(() => (init_complete_standalone_build(), exports_complete_standalone_build))],
  ["controller-standards", () => Promise.resolve().then(() => (init_controller_standards_audit(), exports_controller_standards_audit))],
  ["desktop-smoke", () => init_desktop_package_smoke().then(() => exports_desktop_package_smoke)],
  ["doctor", async () => doctor()],
  ["link-services", () => Promise.resolve().then(() => (init_link_services_node_modules(), exports_link_services_node_modules))],
  ["perf", () => init_perf_audit().then(() => exports_perf_audit)],
  ["postbuild-agent-runtime", () => Promise.resolve().then(() => (init_postbuild(), exports_postbuild))],
  ["prepare-agent-runtime", async () => rmSync6(path11.join(root5, "services", "agent-runtime", "dist"), { recursive: !0, force: !0 })],
  ["prepare-next", () => Promise.resolve().then(() => (init_prepare_next_build(), exports_prepare_next_build))],
  ["release-notes", () => Promise.resolve().then(() => (init_release_statement(), exports_release_statement))],
  ["self-test", async () => {
    await Promise.resolve().then(() => (init_install_desktop_app_test(), exports_install_desktop_app_test)), await Promise.resolve().then(() => (init_release_notary_credentials_test(), exports_release_notary_credentials_test)), await Promise.resolve().then(() => (init_release_package_arguments_test(), exports_release_package_arguments_test));
  }],
  ["setup", async () => setupRepository()],
  ["sign-release", () => init_sign_desktop_release().then(() => exports_sign_desktop_release)],
  ["stage-release", () => Promise.resolve().then(() => (init_stage_desktop_release(), exports_stage_desktop_release))],
  ["start", () => init_start_standalone().then(() => exports_start_standalone)],
  ["validate-contracts", () => Promise.resolve().then(() => (init_validate_shared_contracts(), exports_validate_shared_contracts))],
  ["validate-package", () => Promise.resolve().then(() => (init_validate_package_json(), exports_validate_package_json))],
  ["validate-structure", () => Promise.resolve().then(() => (init_validate_barrel_dir_siblings(), exports_validate_barrel_dir_siblings))],
  ["validate-ui", () => Promise.resolve().then(() => (init_validate_ui_structure(), exports_validate_ui_structure))],
  ["audit-layout", async () => auditLayout()]
]);
function parsedVersion(value) {
  let match = value.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}
function versionMeetsMinimum(actual, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index])
      return true;
    if (actual[index] < minimum[index])
      return false;
  }
  return true;
}
function requireTool(label, command, args3, minimum) {
  let result = spawnSync4(command, args3, { cwd: root5, encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw Error(`${label} is required but unavailable`);
  let output4 = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(), actual = parsedVersion(output4);
  if (!actual || !versionMeetsMinimum(actual, minimum))
    throw Error(`${label} ${minimum.join(".")} or newer is required; found ${output4 || "unknown"}`);
  console.log(`${label}: ${actual.join(".")}`);
}
function doctor() {
  requireTool("Node.js", process.execPath, ["--version"], [22, 19, 0]);
  requireTool("npm", "npm", ["--version"], [10, 0, 0]);
  requireTool("Bun", "bun", ["--version"], [1, 3, 14]);
  requireTool("Python", "python3", ["--version"], [3, 10, 0]);
  requireTool("Git", "git", ["--version"], [2, 0, 0]);
  console.log("Toolchain check passed");
}
function setupRepository() {
  doctor();
  for (let directory of ["controller", "shared", "services/agent-runtime"])
    run3("bun", ["install", "--frozen-lockfile"], path11.join(root5, directory));
  run3("npm", ["ci", "--legacy-peer-deps"], path11.join(root5, "frontend"));
  console.log("Repository setup complete");
}
function auditLayout() {
  let expected = ["frontend/desktop/project.mjs", "scripts/install-controller.sh", "scripts/install-desktop-app.sh"], actual = readdirSync10(path11.join(root5, "scripts"), { withFileTypes: !0 }).filter((entry) => entry.isFile()).map((entry) => `scripts/${entry.name}`).sort(), executable = git(["ls-files", "-s"]).split("\n").filter((line) => line.startsWith("100755 ")).map((line) => line.split("\t")[1]).sort(), stale = ["frontend/scripts", "controller/scripts", "services/agent-runtime/scripts"].filter((directory) => existsSync(path11.join(root5, directory)));
  if (JSON.stringify(actual) !== JSON.stringify(expected.slice(1)) || JSON.stringify(executable) !== JSON.stringify(expected) || stale.length > 0)
    throw Error(`Automation layout drifted: scripts=${actual.join(",")}; executable=${executable.join(",")}; stale=${stale.join(",")}`);
  console.log("Automation layout passed: exactly three scripts");
}
function git(args3, options = {}) {
  return execFileSync6("git", args3, { cwd: root5, encoding: "utf8", ...options }).trim();
}
function run3(command, args3, cwd = root5) {
  let result = spawnSync4(command, args3, { cwd, stdio: "inherit" });
  if (result.error)
    throw result.error;
  if (result.status !== 0)
    process.exit(result.status ?? 1);
}
function stagedFiles() {
  let output4 = git(["diff", "--cached", "--name-only"]);
  return output4 ? output4.split(`
`) : [];
}
function preCommit() {
  let branch = git(["branch", "--show-current"]);
  if (["main", "dev"].includes(branch))
    throw Error(`pre-commit: commits on ${branch} are blocked; use a work branch and PR`);
  let files = stagedFiles(), lines = git(["diff", "--cached", "--numstat"]).split(`
`).reduce((total, row) => {
    let [added, removed, file2] = row.split("\t");
    if (!/^\d+$/.test(added ?? "") || !/^\d+$/.test(removed ?? ""))
      return total;
    if (["frontend/desktop/project.mjs", "scripts/project.mjs"].includes(file2 ?? "") || !existsSync(path11.join(root5, file2 ?? "")) || /(^|\/)(package-lock\.json|bun\.lockb?|.*\.snap)$/.test(file2 ?? ""))
      return total;
    return total + Number(added) + Number(removed);
  }, 0);
  if (files.length > 15 || lines > 600)
    throw Error(`pre-commit: staged change is too large (${files.length} files, ${lines} source lines); limit is 15 files and 600 source lines`);
  if (files.some((file2) => /^(frontend|shared|tests\/frontend)\//.test(file2)))
    run3("npm", ["run", "precommit"], path11.join(root5, "frontend"));
  if (files.some((file2) => file2.startsWith("controller/")))
    run3("bun", ["run", "typecheck"], path11.join(root5, "controller"));
}
function prePush() {
  let remote = process.argv[2], url = process.argv[3], updates = readFileSync17(0, "utf8").trim();
  for (let update of updates ? updates.split(`
`) : []) {
    let [localRef, localSha, remoteRef, remoteSha] = update.trim().split(/\s+/);
    if (["refs/heads/main", "refs/heads/dev"].includes(remoteRef))
      throw Error(`pre-push: direct pushes to ${remoteRef} are blocked; merge through GitHub`);
    if (/^0{40}$/.test(localSha))
      continue;
    let range2;
    if (/^0{40}$/.test(remoteSha)) {
      let defaultRef;
      try {
        defaultRef = git(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`]);
      } catch {
        defaultRef = `${remote}/main`;
      }
      try {
        range2 = `${git(["merge-base", defaultRef, localSha])}..${localSha}`;
      } catch {
        range2 = localSha;
      }
    } else
      range2 = `${remoteSha}..${localSha}`;
    console.log(`Checking conventional commits for ${localRef} -> ${remote}/${remoteRef} (${url})`), run3(process.execPath, [path11.join(root5, "scripts/project.mjs"), "check-commits", "--range", range2]);
  }
  run3("npm", ["run", "check:static"], path11.join(root5, "frontend")), run3("npm", ["run", "check:cleanup"], path11.join(root5, "frontend")), run3(process.execPath, [path11.join(root5, "scripts/project.mjs"), "assert-standalone"]);
}
function setupHooks() {
  let worktree = spawnSync4("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root5, encoding: "utf8" });
  if (worktree.status !== 0 || worktree.stdout.trim() !== "true")
    return console.log("Skipping Git hook setup outside a worktree");
  git(["rev-parse", "--git-dir"]), git(["config", "core.hooksPath", ".githooks"]);
  for (let name of readdirSync10(path11.join(root5, ".githooks")))
    chmodSync2(path11.join(root5, ".githooks", name), 493);
}
var invoked = path11.basename(process.argv[1] ?? "");
if (invoked === "commit-msg")
  process.argv.splice(2, 0, "--message-file"), await Promise.resolve().then(() => (init_check_conventional_commits(), exports_check_conventional_commits));
else if (invoked === "pre-commit")
  preCommit();
else if (invoked === "pre-push")
  prePush();
else if (invoked === "project.mjs" || path11.resolve(process.argv[1] ?? "") === fileURLToPath11(import.meta.url)) {
  let command = process.argv[2];
  if (process.argv.splice(2, 1), command === "setup-hooks")
    setupHooks();
  else if (!command || !commands.has(command))
    console.error(`Usage: node scripts/project.mjs <${[...commands.keys()].join("|")}>`), process.exit(1);
  else
    await commands.get(command)();
}
export {
  project_entry_default as default
};
