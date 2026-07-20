import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import executableIdentity from "../../services/agent-runtime/src/executable-identity.cjs";
import { desktopCommandSucceeds } from "./electron-builder-command.mjs";

const {
  AUDITED_NODE_IDENTITIES,
  AUDITED_NODE_EXECUTABLE_SHA256,
  AUDITED_WINDOWS_HELPER_BUILD,
  AUDITED_WINDOWS_HELPER_IDENTITY,
  executableSignaturePresent,
  signingStableExecutableIdentity,
} = executableIdentity;

const NODE_RUNTIME_VERSION = "24.18.0";
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_OUTPUT_BYTES = 16 * 1024;
const DATA_MODE = 0o444;
const EXECUTABLE_MODE = 0o555;
const EXECUTABLE_ACCESS = "read-execute";
const DATA_ACCESS = "read-only";
const ARCHITECTURES = new Map([
  [1, "x64"],
  [3, "arm64"],
]);
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeSources = JSON.parse(
  readFileSync(path.join(frontendRoot, "desktop", "runtime-sources.json"), "utf8"),
);
const windowsHelperIdentity = JSON.parse(
  readFileSync(
    path.join(
      frontendRoot,
      "..",
      "services",
      "agent-runtime",
      "native",
      "windows-runtime-helper.json",
    ),
    "utf8",
  ),
);

function resolveResourcesDir(appOutDir, productFilename, electronPlatformName) {
  if (electronPlatformName === "darwin" || electronPlatformName === "mas") {
    return path.join(appOutDir, `${productFilename}.app`, "Contents", "Resources");
  }
  return path.join(appOutDir, "resources");
}

function runtimeEnvironment() {
  return Object.fromEntries(
    ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "SystemRoot", "TEMP", "TMP", "TMPDIR", "WINDIR"].flatMap(
      (key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]]),
    ),
  );
}

function rawIdentity(bytes) {
  return { algorithm: "sha256-v1", digest: createHash("sha256").update(bytes).digest("hex") };
}

function valueDigest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function targetIdentity(electronPlatformName, arch) {
  const platform = electronPlatformName === "mas" ? "darwin" : electronPlatformName;
  const architecture = typeof arch === "number" ? ARCHITECTURES.get(arch) : arch;
  if (
    !["darwin", "linux", "win32"].includes(platform) ||
    !["arm64", "x64"].includes(architecture) ||
    (platform === "win32" && architecture === "arm64")
  ) {
    throw new Error("Packaged runtime target is invalid");
  }
  return { platform, arch: architecture, key: `${platform}-${architecture}` };
}

function exactObject(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fileIdentity(entry, mode, platform) {
  const bytes = readFileSync(entry);
  try {
    return mode === EXECUTABLE_ACCESS
      ? signingStableExecutableIdentity(bytes, platform)
      : rawIdentity(bytes);
  } catch {
    throw new Error("Packaged runtime closure is invalid");
  }
}

function accessMatches(stat, access, platform) {
  if (platform === "win32") return (stat.mode & 0o222) === 0;
  const expected = access === EXECUTABLE_ACCESS ? EXECUTABLE_MODE : DATA_MODE;
  return (stat.mode & 0o777) === expected;
}

function expectedClosurePaths(target) {
  const expectedPaths = [target.platform === "win32" ? "node.exe" : "node", "LICENSE.node"];
  if (target.platform === "win32") expectedPaths.push("windows-runtime-helper.exe");
  return expectedPaths;
}

function closureEntries(manifest, expectedPaths) {
  const entries = manifest.closure;
  if (
    !Array.isArray(entries) ||
    entries.length !== expectedPaths.length ||
    expectedPaths.some((entry) => !entries.some((candidate) => candidate?.path === entry))
  ) {
    throw new Error("Packaged runtime closure is invalid");
  }
  return entries;
}

function assertClosureDirectory(runtimeDir, expectedPaths) {
  const expectedNames = new Set(["runtime-manifest.json", ...expectedPaths]);
  const names = readdirSync(runtimeDir);
  if (names.length !== expectedNames.size || names.some((name) => !expectedNames.has(name))) {
    throw new Error("Packaged runtime closure is invalid");
  }
}

function assertClosureEntry(runtimeDir, entry, target) {
  if (
    !exactObject(Object.keys(entry ?? {}).sort(), ["identity", "mode", "path", "role"]) ||
    typeof entry?.path !== "string" ||
    path.basename(entry.path) !== entry.path ||
    !exactObject(Object.keys(entry.identity ?? {}).sort(), ["algorithm", "digest"]) ||
    typeof entry.identity.algorithm !== "string" ||
    typeof entry.identity.digest !== "string" ||
    ![EXECUTABLE_ACCESS, DATA_ACCESS].includes(entry.mode)
  ) {
    throw new Error("Packaged runtime closure is invalid");
  }
  const absolute = path.join(runtimeDir, entry.path);
  const stat = lstatSync(absolute);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    realpathSync(absolute) !== absolute ||
    !accessMatches(stat, entry.mode, target.platform) ||
    !exactObject(fileIdentity(absolute, entry.mode, target.platform), entry.identity)
  ) {
    throw new Error("Packaged runtime closure is invalid");
  }
}

function assertNodeClosure(entries, manifest) {
  const license = entries.find((entry) => entry.path === "LICENSE.node");
  const executable = entries.find((entry) => entry.path === manifest.node?.executable);
  if (
    license?.role !== "node-license" ||
    license.mode !== DATA_ACCESS ||
    !exactObject(license.identity, {
      algorithm: "sha256-v1",
      digest: runtimeSources.license?.sha256,
    }) ||
    executable?.role !== "node-executable" ||
    executable.mode !== EXECUTABLE_ACCESS ||
    !exactObject(executable.identity, manifest.node?.upstream?.codeIdentity)
  ) {
    throw new Error("Packaged runtime closure is invalid");
  }
}

function assertWindowsClosure(entries, manifest, target) {
  if (target.platform !== "win32") {
    if (manifest.windowsHelper !== undefined) {
      throw new Error("Packaged runtime closure is invalid");
    }
    return;
  }
  const helper = entries.find((entry) => entry.path === "windows-runtime-helper.exe");
  if (
    helper?.role !== "windows-process-helper" ||
    helper.mode !== EXECUTABLE_ACCESS ||
    !exactObject(windowsHelperIdentity, AUDITED_WINDOWS_HELPER_BUILD) ||
    !exactObject(manifest.windowsHelper, {
      ...windowsHelperIdentity,
      executable: "windows-runtime-helper.exe",
    }) ||
    !exactObject(helper.identity, windowsHelperIdentity.codeIdentity) ||
    !exactObject(helper.identity, AUDITED_WINDOWS_HELPER_IDENTITY)
  ) {
    throw new Error("Packaged runtime closure is invalid");
  }
}

function verifiedClosure(runtimeDir, manifest, target) {
  const expectedPaths = expectedClosurePaths(target);
  const entries = closureEntries(manifest, expectedPaths);
  assertClosureDirectory(runtimeDir, expectedPaths);
  for (const entry of entries) {
    assertClosureEntry(runtimeDir, entry, target);
  }
  assertNodeClosure(entries, manifest);
  assertWindowsClosure(entries, manifest, target);
  return path.join(runtimeDir, manifest.node.executable);
}

function decodedManifest(manifestPath) {
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("Packaged standalone Node runtime manifest is invalid");
  }
}

function assertManifestTarget(manifest, target) {
  if (
    !exactObject(Object.keys(manifest?.target ?? {}).sort(), ["arch", "key", "platform"]) ||
    manifest?.target?.platform !== target.platform ||
    manifest?.target?.arch !== target.arch ||
    manifest?.target?.key !== target.key
  ) {
    throw new Error("Packaged runtime target is invalid");
  }
}

function assertManifestShape(manifest, target) {
  const expectedKeys = ["closure", "digest", "format", "node", "target"];
  if (target.platform === "win32") expectedKeys.push("windowsHelper");
  if (
    !exactObject(Object.keys(manifest).sort(), expectedKeys.sort()) ||
    !exactObject(Object.keys(manifest.node ?? {}).sort(), [
      "executable",
      "license",
      "package",
      "upstream",
      "version",
    ]) ||
    manifest.format !== "local-studio-desktop-runtime-v2" ||
    runtimeSources.format !== "local-studio-runtime-sources-v2" ||
    runtimeSources.nodeVersion !== NODE_RUNTIME_VERSION ||
    manifest.node?.version !== NODE_RUNTIME_VERSION ||
    manifest.node?.executable !== (target.platform === "win32" ? "node.exe" : "node") ||
    manifest.node?.license !== "LICENSE.node"
  ) {
    throw new Error("Packaged standalone Node runtime identity is invalid");
  }
}

function assertRuntimeSource(source, target) {
  if (
    !exactObject(source?.upstream?.codeIdentity, AUDITED_NODE_IDENTITIES[target.key]) ||
    source?.upstream?.executableSha256 !== AUDITED_NODE_EXECUTABLE_SHA256[target.key]
  ) {
    throw new Error("Packaged standalone Node runtime identity is invalid");
  }
}

function assertManifestIdentity(manifest, target) {
  assertManifestTarget(manifest, target);
  assertManifestShape(manifest, target);
  const { digest: manifestDigest, ...body } = manifest;
  const source = runtimeSources.targets?.[target.key];
  assertRuntimeSource(source, target);
  if (
    !exactObject(manifest.node.package, source?.package) ||
    !exactObject(manifest.node.upstream, source?.upstream) ||
    manifestDigest !== valueDigest(body)
  ) {
    throw new Error("Packaged standalone Node runtime identity is invalid");
  }
}

function assertRuntimeDirectory(runtimeDir, manifestPath, target) {
  const runtimeStat = lstatSync(runtimeDir);
  const manifestStat = lstatSync(manifestPath);
  if (
    runtimeStat.isSymbolicLink() ||
    !runtimeStat.isDirectory() ||
    realpathSync(runtimeDir) !== runtimeDir ||
    manifestStat.isSymbolicLink() ||
    !manifestStat.isFile() ||
    !accessMatches(manifestStat, DATA_ACCESS, target.platform)
  ) {
    throw new Error("Packaged runtime closure is invalid");
  }
}

export function verifiedRuntime(resourcesDir, electronPlatformName, arch) {
  const runtimeDir = path.join(resourcesDir, "app", "runtime");
  const manifestPath = path.join(runtimeDir, "runtime-manifest.json");
  if (!existsSync(runtimeDir) || !existsSync(manifestPath)) {
    throw new Error("Packaged app is missing the pinned standalone Node runtime");
  }
  const target = targetIdentity(electronPlatformName, arch);
  const manifest = decodedManifest(manifestPath);
  assertManifestIdentity(manifest, target);
  assertRuntimeDirectory(runtimeDir, manifestPath, target);
  return verifiedClosure(runtimeDir, manifest, target);
}

export function packagedMcpProbe(runtime, probe) {
  return new Promise((resolve, reject) => {
    const secret = randomBytes(32).toString("hex");
    const child = spawn(runtime, [probe], {
      env: runtimeEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    let buffer = "";
    let outputBytes = 0;
    let verified = false;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const send = (payload) => child.stdin?.write(`${JSON.stringify(payload)}\n`);
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Packaged stdio MCP probe timed out"));
    }, PROBE_TIMEOUT_MS);
    child.once("error", () => finish(new Error("Packaged stdio MCP probe failed")));
    child.once("close", (code) =>
      finish(code === 0 && verified ? undefined : new Error("Packaged stdio MCP probe failed")),
    );
    child.stdout?.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > PROBE_OUTPUT_BYTES) {
        child.kill();
        finish(new Error("Packaged stdio MCP probe failed"));
        return;
      }
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          child.kill();
          finish(new Error("Packaged stdio MCP probe failed"));
          return;
        }
        if (message.localStudioBootstrap === "ready") {
          send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
        } else if (message.id === 1) {
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        } else if (
          message.id === 2 &&
          Array.isArray(message.result?.tools) &&
          message.result.tools.length === 1 &&
          message.result.tools[0]?.name === "packaged-runtime-ready"
        ) {
          verified = true;
          child.stdin?.end();
        }
      }
    });
    send({
      localStudioBootstrap: "v1",
      environment: { LOCAL_STUDIO_PACKAGED_PROBE_TOKEN: secret },
    });
  });
}

export function verifiedPackagedFiles(context) {
  const { appOutDir, arch, packager, electronPlatformName } = context;
  const productFilename = packager.appInfo.productFilename;

  const resourcesDir = resolveResourcesDir(appOutDir, productFilename, electronPlatformName);
  const standaloneBase = path.join(resourcesDir, "app", "frontend", ".next", "standalone");

  const candidates = [
    path.join(standaloneBase, "frontend", "server.js"),
    path.join(standaloneBase, "server.js"),
  ];

  if (!candidates.some((candidate) => existsSync(candidate))) {
    throw new Error(
      [
        "Packaged app is missing the embedded Next standalone server — refusing to sign/ship a broken bundle.",
        `Looked for: ${candidates.join(" or ")}`,
        'electron-builder failed to copy extraResources from .next/standalone (it can log "file source doesn\'t exist" yet still exit 0).',
        "Re-run the build (run `npm run build` first if .next/standalone is absent).",
      ].join("\n  "),
    );
  }

  const agentRuntime = path.join(resourcesDir, "app", "agent-runtime", "server.mjs");
  if (!existsSync(agentRuntime)) {
    throw new Error(`Packaged app is missing the agent runtime: ${agentRuntime}`);
  }

  const runtime = verifiedRuntime(resourcesDir, electronPlatformName, arch);
  const probe = path.join(resourcesDir, "desktop", "resources", "mcp", "packaged-stdio-probe.mjs");
  if (!existsSync(probe)) throw new Error("Packaged app is missing the stdio MCP probe");

  return { probe, resourcesDir, runtime };
}

export async function verifyPackagedApplication(context) {
  const verified = verifiedPackagedFiles(context);
  await packagedMcpProbe(verified.runtime, verified.probe);
  return verified;
}

export async function removeStaleMacSignature(context) {
  if (!["darwin", "mas"].includes(context.electronPlatformName) || process.platform !== "darwin") {
    return;
  }
  const application = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const executable = path.join(
    application,
    "Contents",
    "MacOS",
    context.packager.appInfo.productFilename,
  );
  let signed;
  try {
    signed = executableSignaturePresent(readFileSync(executable), "darwin");
  } catch {
    throw new Error("Stale desktop package signature inspection failed");
  }
  if (!signed) return;
  if (!(await desktopCommandSucceeds("/usr/bin/codesign", ["--remove-signature", application]))) {
    throw new Error("Stale desktop package signature removal failed");
  }
  try {
    if (executableSignaturePresent(readFileSync(executable), "darwin")) {
      throw new Error("Stale desktop package signature remains");
    }
  } catch {
    throw new Error("Stale desktop package signature removal failed");
  }
}

export default async function afterPack(context) {
  await verifyPackagedApplication(context);
  await removeStaleMacSignature(context);

  console.log(
    `  afterPack: embedded frontend, agent runtime, packaged stdio MCP runtime, and pre-sign bundle verified (${context.electronPlatformName})`,
  );
}
