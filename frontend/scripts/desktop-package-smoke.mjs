import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const frontendDirectory = resolve(dirname(scriptPath), "..");
const outputDirectory = join(frontendDirectory, "dist-desktop");
const artifactPath = join(outputDirectory, "desktop-smoke.log");
const startupTimeoutMs = 120_000;
const cdpTimeoutMs = 30_000;
const requestTimeoutMs = 5_000;
const pollIntervalMs = 100;
const gracefulQuitTimeoutMs = 10_000;
const terminateTimeoutMs = 5_000;
const cleanupReserveMs = 25_000;
const outputLimit = 32_768;
export const smokeControllerUrl = "http://127.0.0.1:65534";
const inheritedEnvironmentNames = [
  "CI",
  "DISPLAY",
  "GITHUB_ACTIONS",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "USER",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
];
const controllerUrlEnvironmentNames = [
  "BACKEND_URL",
  "LOCAL_STUDIO_BACKEND_URL",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_BACKEND_URL",
];
const controllerKeyEnvironmentNames = ["API_KEY", "INFERENCE_API_KEY", "LOCAL_STUDIO_API_KEY"];
const sentinelCredential = "local-studio-smoke-sentinel-credential";
const diagnosticControlSeparator = "\x1f";
const closingLoopbackServers = new WeakSet();

const terminalStatusExpression = `
(async () => {
  const status = window.localStudioDesktop?.terminal?.status;
  if (typeof status !== "function") return { bridgeAvailable: false };
  return { bridgeAvailable: true, status: await status() };
})()
`;

function executableCandidates(platform, arch, directory) {
  if (platform === "darwin") {
    return [
      join(directory, `mac-${arch}`, "Local Studio.app", "Contents", "MacOS", "Local Studio"),
      join(directory, "mac", "Local Studio.app", "Contents", "MacOS", "Local Studio"),
    ];
  }
  if (platform === "linux") {
    return [
      join(directory, `linux-${arch}-unpacked`, "local-studio"),
      join(directory, "linux-unpacked", "local-studio"),
      join(directory, `linux-${arch}-unpacked`, "Local Studio"),
      join(directory, "linux-unpacked", "Local Studio"),
    ];
  }
  if (platform === "win32") {
    return [
      join(directory, `win-${arch}-unpacked`, "Local Studio.exe"),
      join(directory, "win-unpacked", "Local Studio.exe"),
      join(directory, `win-${arch}-unpacked`, "local-studio.exe"),
      join(directory, "win-unpacked", "local-studio.exe"),
    ];
  }
  throw new Error(`Unsupported desktop smoke platform: ${platform}`);
}

export function resolvePackagedExecutable({
  platform = process.platform,
  arch = process.arch,
  outputDirectory: directory = outputDirectory,
  exists = existsSync,
} = {}) {
  const candidates = executableCandidates(platform, arch, directory);
  const matches = candidates.filter((candidate) => exists(candidate));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Multiple packaged desktop executables found: ${matches.join(", ")}`);
  }
  throw new Error(`Packaged desktop executable not found. Checked: ${candidates.join(", ")}`);
}

export function resolveSmokeArchitecture({
  runnerArchitecture = process.env.LOCAL_STUDIO_DESKTOP_SMOKE_ARCH,
  processArchitecture = process.arch,
} = {}) {
  const requested = runnerArchitecture?.trim().toUpperCase();
  const architecture = requested ? { ARM64: "arm64", X64: "x64" }[requested] : processArchitecture;
  if (!architecture || !["arm64", "x64"].includes(architecture)) {
    throw new Error(`Unsupported desktop smoke runner architecture: ${runnerArchitecture}`);
  }
  if (architecture !== processArchitecture) {
    throw new Error(
      `Desktop smoke runner architecture ${architecture} does not match Node.js architecture ${processArchitecture}`,
    );
  }
  return architecture;
}

function cpuArchitecture(cpuType) {
  if (cpuType === 0x0100000c) return "arm64";
  if (cpuType === 0x01000007) return "x64";
  return null;
}

function thinMachArchitecture(buffer, littleEndian) {
  const cpuType = littleEndian ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4);
  const architecture = cpuArchitecture(cpuType);
  if (!architecture) throw new Error(`Unsupported Mach-O CPU type: 0x${cpuType.toString(16)}`);
  return [architecture];
}

function fatMachArchitectures(buffer, littleEndian, entrySize) {
  const read = littleEndian ? Buffer.prototype.readUInt32LE : Buffer.prototype.readUInt32BE;
  const count = read.call(buffer, 4);
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 32 ||
    buffer.length < 8 + count * entrySize
  ) {
    throw new Error("Malformed universal Mach-O header");
  }
  const architectures = new Set();
  for (let index = 0; index < count; index += 1) {
    const architecture = cpuArchitecture(read.call(buffer, 8 + index * entrySize));
    if (architecture) architectures.add(architecture);
  }
  if (architectures.size === 0) throw new Error("Universal Mach-O contains no supported CPU type");
  return [...architectures];
}

function machArchitectures(buffer) {
  if (buffer.length < 8) throw new Error("Packaged Mach-O executable is truncated");
  const magic = buffer.readUInt32BE(0);
  if (magic === 0xcffaedfe || magic === 0xcefaedfe) return thinMachArchitecture(buffer, true);
  if (magic === 0xfeedfacf || magic === 0xfeedface) return thinMachArchitecture(buffer, false);
  if (magic === 0xcafebabe) return fatMachArchitectures(buffer, false, 20);
  if (magic === 0xbebafeca) return fatMachArchitectures(buffer, true, 20);
  if (magic === 0xcafebabf) return fatMachArchitectures(buffer, false, 32);
  if (magic === 0xbfbafeca) return fatMachArchitectures(buffer, true, 32);
  throw new Error(`Packaged executable is not Mach-O: 0x${magic.toString(16)}`);
}

function elfArchitectures(buffer) {
  if (
    buffer.length < 20 ||
    buffer[0] !== 0x7f ||
    buffer[1] !== 0x45 ||
    buffer[2] !== 0x4c ||
    buffer[3] !== 0x46
  ) {
    throw new Error("Packaged executable is not ELF");
  }
  const machine = buffer[5] === 1 ? buffer.readUInt16LE(18) : buffer.readUInt16BE(18);
  if (machine === 183) return ["arm64"];
  if (machine === 62) return ["x64"];
  throw new Error(`Unsupported ELF machine type: ${machine}`);
}

function peArchitectures(buffer) {
  if (buffer.length < 64 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) {
    throw new Error("Packaged executable is not PE");
  }
  const headerOffset = buffer.readUInt32LE(0x3c);
  if (headerOffset + 6 > buffer.length || buffer.readUInt32LE(headerOffset) !== 0x00004550) {
    throw new Error("Packaged PE executable is malformed");
  }
  const machine = buffer.readUInt16LE(headerOffset + 4);
  if (machine === 0xaa64) return ["arm64"];
  if (machine === 0x8664) return ["x64"];
  throw new Error(`Unsupported PE machine type: ${machine}`);
}

export function executableArchitectures(source, platform = process.platform) {
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
  if (platform === "darwin") return machArchitectures(buffer);
  if (platform === "linux") return elfArchitectures(buffer);
  if (platform === "win32") return peArchitectures(buffer);
  throw new Error(`Unsupported executable format platform: ${platform}`);
}

export async function assertNativeExecutableArchitecture({
  executable,
  architecture,
  platform = process.platform,
  read = readFile,
}) {
  const available = executableArchitectures(await read(executable), platform);
  if (!available.includes(architecture)) {
    throw new Error(
      `Packaged desktop architectures ${available.join(", ")} do not include runner architecture ${architecture}`,
    );
  }
  return available;
}

export function parseEmbeddedPort(value) {
  const normalized = String(value).trim();
  if (!/^\d+$/u.test(normalized)) {
    throw new Error("Malformed embedded frontend port: expected an integer");
  }
  const port = Number(normalized);
  if (!Number.isInteger(port) || port <= 1024 || port > 65_535) {
    throw new Error("Malformed embedded frontend port: expected a value from 1025 to 65535");
  }
  return port;
}

export function validateDesktopHealth(status, payload) {
  if (status !== 200) {
    throw new Error(`Packaged desktop health returned status ${status}`);
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.ok !== true ||
    typeof payload.ts !== "number" ||
    !Number.isFinite(payload.ts)
  ) {
    throw new Error("Packaged desktop health returned unhealthy JSON");
  }
  return payload;
}

export function validatePtyEvaluation(evaluation) {
  if (evaluation?.exceptionDetails) {
    throw new Error("Packaged desktop terminal bridge evaluation failed");
  }
  const value = evaluation?.result?.value;
  if (!value || value.bridgeAvailable !== true) {
    throw new Error("Packaged desktop preload bridge is missing");
  }
  const status = value.status;
  if (!status || status.available !== true) {
    const reason =
      typeof status?.reason === "string" && status.reason.trim() ? `: ${status.reason}` : "";
    throw new Error(`Packaged desktop native PTY is unavailable${reason}`);
  }
  return status;
}

export async function waitForNativeBridge({
  childStatus,
  evaluate,
  timeoutMs = cdpTimeoutMs,
  now = Date.now,
  delay = sleep,
  intervalMs = pollIntervalMs,
  signal,
}) {
  const startedAt = now();
  while (true) {
    signal?.throwIfAborted();
    const stopped = childStoppedError(childStatus(), "preload bridge");
    if (stopped) throw stopped;
    const evaluation = await evaluate();
    if (
      evaluation?.exceptionDetails ||
      evaluation?.result?.value?.bridgeAvailable === true
    ) {
      return validatePtyEvaluation(evaluation);
    }
    const elapsed = now() - startedAt;
    if (elapsed >= timeoutMs) {
      throw new Error(timeoutMessage("Packaged desktop preload bridge", timeoutMs));
    }
    await delay(Math.min(intervalMs, timeoutMs - elapsed), signal);
  }
}

function childStoppedError(status, stage) {
  if (!status) return null;
  if (status.error) {
    const message = status.error instanceof Error ? status.error.message : String(status.error);
    return new Error(`Packaged desktop failed before ${stage}: ${message}`);
  }
  const details = [
    status.code === null ? null : `code ${status.code}`,
    status.signal ? `signal ${status.signal}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return new Error(
    `Packaged desktop exited before ${stage} was ready (${details || "unknown status"})`,
  );
}

function timeoutMessage(label, timeoutMs, detail) {
  return `${label} timed out after ${timeoutMs}ms${detail ? `: ${detail}` : ""}`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function waitForEmbeddedPort({
  portFile,
  childStatus,
  readFile: read = readFile,
  timeoutMs = startupTimeoutMs,
  now = Date.now,
  delay = sleep,
  intervalMs = pollIntervalMs,
  signal,
}) {
  const startedAt = now();
  while (true) {
    signal?.throwIfAborted();
    const stopped = childStoppedError(childStatus(), "embedded frontend port file");
    if (stopped) throw stopped;
    try {
      return parseEmbeddedPort(await read(portFile, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const elapsed = now() - startedAt;
    if (elapsed >= timeoutMs) {
      throw new Error(timeoutMessage("Embedded frontend port file", timeoutMs));
    }
    await delay(Math.min(intervalMs, timeoutMs - elapsed), signal);
  }
}

async function boundedPromise(
  promise,
  timeoutMs,
  label,
  {
    clearTimer = clearTimeout,
    onTimeout,
    setTimer = setTimeout,
    signal,
  } = {},
) {
  let timer;
  let abort;
  try {
    const pending = [
      promise,
      new Promise((_, reject) => {
        timer = setTimer(() => {
          const error = new Error(timeoutMessage(label, timeoutMs));
          onTimeout?.(error);
          reject(error);
        }, timeoutMs);
      }),
    ];
    if (signal) {
      pending.push(
        new Promise((_, reject) => {
          abort = () => reject(signal.reason ?? new Error(`${label} aborted`));
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        }),
      );
    }
    return await Promise.race(pending);
  } finally {
    clearTimer(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

export function createLifecycleDeadline(
  timeoutMs = startupTimeoutMs,
  { clearTimer = clearTimeout, now = Date.now, setTimer = setTimeout } = {},
) {
  const controller = new AbortController();
  const expiresAt = now() + timeoutMs;
  const expire = (error) => {
    if (!controller.signal.aborted) controller.abort(error);
  };
  const expirationTimer = setTimer(
    () => expire(new Error(timeoutMessage("Packaged desktop smoke lifecycle", timeoutMs))),
    timeoutMs,
  );
  expirationTimer.unref?.();
  const available = (reserveMs = 0) => Math.max(0, expiresAt - now() - reserveMs);
  const remaining = (label, reserveMs = 0) => {
    const duration = available(reserveMs);
    if (duration === 0) throw new Error(timeoutMessage(label, timeoutMs));
    return duration;
  };
  const run = async (operation, label, reserveMs = 0) => {
    controller.signal.throwIfAborted();
    const duration = remaining(label, reserveMs);
    const result = await boundedPromise(Promise.resolve().then(operation), duration, label, {
      clearTimer,
      onTimeout: expire,
      setTimer,
      signal: controller.signal,
    });
    return result;
  };
  const runUntilExpiration = async (operation, label) => {
    const duration = remaining(label);
    const result = await boundedPromise(Promise.resolve().then(operation), duration, label, {
      clearTimer,
      setTimer,
    });
    if (available() === 0) throw new Error(timeoutMessage(label, timeoutMs));
    return result;
  };
  const dispose = () => clearTimer(expirationTimer);
  return {
    available,
    dispose,
    expiresAt,
    remaining,
    run,
    runUntilExpiration,
    signal: controller.signal,
    timeoutMs,
  };
}

function aggregatedFailure(failures, label) {
  if (failures.length === 0) return null;
  if (failures.length === 1) return failures[0];
  return new AggregateError(failures, `${label}: ${failures.map(errorMessage).join("; ")}`);
}

export function createResourceScope() {
  const entries = [];
  const lateFailures = [];
  let status = "open";
  const emergency = (entry) => {
    if (entry.emergencyReleased) return;
    entry.emergencyReleased = true;
    return entry.emergencyRelease(entry.resource);
  };
  const recordLateEmergency = (entry) => {
    try {
      Promise.resolve(emergency(entry)).catch((error) => lateFailures.push(error));
    } catch (error) {
      lateFailures.push(error);
    }
  };
  const register = (resource, { emergencyRelease, release }) => {
    const entry = {
      emergencyRelease: emergencyRelease ?? release,
      emergencyReleased: false,
      release,
      released: false,
      resource,
    };
    entries.push(entry);
    if (status === "closed") {
      entry.released = true;
      recordLateEmergency(entry);
    }
    return resource;
  };
  const acquire = (operation, finalizers, run = (pending) => pending()) => {
    const acquired = Promise.resolve().then(operation).then((resource) => register(resource, finalizers));
    return run(() => acquired);
  };
  const entryFor = (resource) => entries.findLast((entry) => entry.resource === resource);
  const releaseEntry = async (entry, { deadline, label }) => {
    if (!entry || entry.released) return;
    entry.released = true;
    try {
      const operation = () => entry.release(entry.resource, deadline);
      if (deadline) await deadline.runUntilExpiration(operation, label);
      else await operation();
    } catch (error) {
      const failures = [error];
      try {
        await emergency(entry);
      } catch (emergencyError) {
        failures.push(emergencyError);
      }
      throw aggregatedFailure(failures, label);
    }
  };
  const release = (resource, options = {}) =>
    releaseEntry(entryFor(resource), { label: "Resource release", ...options });
  const emergencyRelease = (resource) => {
    const entry = entryFor(resource);
    if (!entry || entry.emergencyReleased) return;
    entry.released = true;
    return emergency(entry);
  };
  const emergencyReleaseAll = () => {
    status = "closed";
    const failures = [];
    for (const entry of entries.toReversed()) {
      if (entry.emergencyReleased) continue;
      entry.released = true;
      try {
        const result = emergency(entry);
        Promise.resolve(result).catch((error) => lateFailures.push(error));
      } catch (error) {
        failures.push(error);
      }
    }
    const failure = aggregatedFailure(failures, "Resource scope emergency cleanup");
    if (failure) throw failure;
  };
  const releaseAll = async (options = {}) => {
    if (status === "closed") return;
    status = "releasing";
    const failures = [];
    while (entries.some((entry) => !entry.released)) {
      const entry = entries.findLast((candidate) => !candidate.released);
      try {
        await releaseEntry(entry, { label: "Resource scope cleanup", ...options });
      } catch (error) {
        failures.push(error);
      }
    }
    status = "closed";
    failures.push(...lateFailures);
    const failure = aggregatedFailure(failures, options.label ?? "Resource scope cleanup");
    if (failure) throw failure;
  };
  return { acquire, emergencyRelease, emergencyReleaseAll, register, release, releaseAll };
}

export async function waitForDesktopHealth({
  url,
  childStatus,
  fetchResponse,
  timeoutMs = startupTimeoutMs,
  now = Date.now,
  delay = sleep,
  intervalMs = pollIntervalMs,
  perRequestTimeoutMs = requestTimeoutMs,
  signal,
}) {
  const startedAt = now();
  let lastFailure = "health endpoint did not respond";
  while (true) {
    signal?.throwIfAborted();
    const stopped = childStoppedError(childStatus(), "desktop health");
    if (stopped) throw stopped;
    try {
      const requestDuration = Math.min(
        perRequestTimeoutMs,
        Math.max(1, timeoutMs - (now() - startedAt)),
      );
      const response = await boundedPromise(
        Promise.resolve(fetchResponse(url, signal, requestDuration)),
        requestDuration,
        "Desktop health request",
        { signal },
      );
      let payload;
      try {
        payload = await boundedPromise(
          Promise.resolve(response.json()),
          requestDuration,
          "Desktop health JSON",
          { signal },
        );
      } catch (error) {
        throw new Error(`Packaged desktop health returned invalid JSON: ${errorMessage(error)}`);
      }
      return validateDesktopHealth(response.status, payload);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("returned status") ||
          error.message.includes("invalid JSON") ||
          error.message.includes("unhealthy JSON"))
      ) {
        throw error;
      }
      lastFailure = errorMessage(error);
    }
    const elapsed = now() - startedAt;
    if (elapsed >= timeoutMs) {
      throw new Error(timeoutMessage("Packaged desktop health", timeoutMs, lastFailure));
    }
    await delay(Math.min(intervalMs, timeoutMs - elapsed), signal);
  }
}

function pageTargetFor(targets, origin) {
  return targets.find((target) => {
    if (
      !target ||
      target.type !== "page" ||
      typeof target.url !== "string" ||
      typeof target.webSocketDebuggerUrl !== "string"
    ) {
      return false;
    }
    try {
      return new URL(target.url).origin === origin;
    } catch {
      return false;
    }
  });
}

export async function waitForPageTarget({
  origin,
  cdpPort,
  childStatus,
  fetchTargets,
  timeoutMs = cdpTimeoutMs,
  now = Date.now,
  delay = sleep,
  intervalMs = pollIntervalMs,
  perRequestTimeoutMs = requestTimeoutMs,
  signal,
}) {
  const startedAt = now();
  let lastFailure = "matching BrowserWindow target did not appear";
  while (true) {
    signal?.throwIfAborted();
    const stopped = childStoppedError(childStatus(), "CDP page target");
    if (stopped) throw stopped;
    try {
      const requestDuration = Math.min(
        perRequestTimeoutMs,
        Math.max(1, timeoutMs - (now() - startedAt)),
      );
      const targets = await boundedPromise(
        Promise.resolve(
          fetchTargets(`http://127.0.0.1:${cdpPort}/json/list`, signal, requestDuration),
        ),
        requestDuration,
        "CDP target request",
        { signal },
      );
      if (!Array.isArray(targets)) throw new Error("CDP target response is not an array");
      const target = pageTargetFor(targets, origin);
      if (target) return target;
    } catch (error) {
      lastFailure = errorMessage(error);
    }
    const elapsed = now() - startedAt;
    if (elapsed >= timeoutMs) {
      throw new Error(timeoutMessage("CDP page target", timeoutMs, lastFailure));
    }
    await delay(Math.min(intervalMs, timeoutMs - elapsed), signal);
  }
}

export async function executeSmokeLifecycle(
  operations,
  { cleanupReserveMs: reservedForCleanup = 0, deadline = createLifecycleDeadline() } = {},
) {
  const state = {};
  const scope = createResourceScope();
  let primaryFailure;
  scope.register(state, {
    emergencyRelease: () => operations.emergencyCleanup?.({ ...state, deadline, scope }),
    release: () => operations.cleanup?.({ ...state, deadline, scope }),
  });
  const run = async (name, key) => {
    const operation = () => operations[name]({ ...state, deadline, scope });
    const value =
      key === "context" || key === "launched"
        ? await scope.acquire(
            operation,
            {
              emergencyRelease: (lateValue) =>
                operations.emergencyCleanup?.({ ...state, [key]: lateValue, deadline, scope }),
              release: async () => {},
            },
            (pending) =>
              deadline.run(
                pending,
                "Packaged desktop smoke lifecycle",
                reservedForCleanup,
              ),
          )
        : await deadline.run(
            operation,
            "Packaged desktop smoke lifecycle",
            reservedForCleanup,
          );
    state[key] = value;
    return value;
  };
  try {
    await run("prepare", "context");
    await run("launch", "launched");
    await run("waitForPort", "port");
    await run("verifyHealth", "health");
    await run("verifyBridge", "bridge");
  } catch (error) {
    primaryFailure = error;
  }
  let cleanupFailure;
  try {
    await scope.releaseAll({ deadline, label: "Packaged desktop smoke cleanup" });
  } catch (error) {
    cleanupFailure = error;
  }
  deadline.dispose?.();
  if (primaryFailure && cleanupFailure) {
    throw new AggregateError(
      [primaryFailure, cleanupFailure],
      `${errorMessage(primaryFailure)}; cleanup failed: ${errorMessage(cleanupFailure)}`,
    );
  }
  if (primaryFailure) throw primaryFailure;
  if (cleanupFailure) throw cleanupFailure;
  return { bridge: state.bridge, health: state.health, port: state.port };
}

function sleep(duration, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Sleep aborted"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, duration);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function createBoundedOutput(limit = outputLimit) {
  const stdout = createDiagnosticClassifier(limit, true);
  const stderr = createDiagnosticClassifier(limit, true);
  return {
    stderr: stderr.write,
    stdout: stdout.write,
    snapshot: () => ({ stderr: stderr.finish(), stdout: stdout.finish() }),
  };
}

async function listenLoopback(server, options, signal) {
  await new Promise((resolveListen, reject) => {
    let settled = false;
    const settle = (operation, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      operation(value);
    };
    const abort = () => {
      closeServerImmediately(server);
      settle(reject, signal.reason ?? new Error("Loopback listener aborted"));
    };
    server.once("error", (error) => settle(reject, error));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    server.listen(options, () => {
      if (signal?.aborted || closingLoopbackServers.has(server)) {
        closeServerImmediately(server);
        settle(reject, signal?.reason ?? new Error("Loopback listener aborted"));
        return;
      }
      settle(resolveListen);
    });
  });
}

export async function allocateLoopbackPort(
  signal,
  resourceScope = createResourceScope(),
  createServer = createNetServer,
) {
  const server = resourceScope.register(createServer(), {
    emergencyRelease: closeServerImmediately,
    release: closeServer,
  });
  try {
    await listenLoopback(server, { exclusive: true, host: "127.0.0.1", port: 0 }, signal);
    const address = server.address();
    const port = address && typeof address === "object" ? address.port : null;
    if (!port) throw new Error("Failed to allocate a loopback CDP port");
    await resourceScope.release(server);
    return port;
  } catch (error) {
    try {
      await resourceScope.release(server);
    } catch (releaseError) {
      throw new AggregateError([error, releaseError], errorMessage(error));
    }
    throw error;
  }
}

function sensitiveFieldName(name) {
  return /(?:authorization|client[-_]?secret|cookie|credential|password|private[-_]?key|secret|signature|session[-_]?token|token|api[-_]?key)/iu.test(
    name,
  );
}

function requestCredentialSignals(request) {
  const signals = Object.keys(request.headers).filter(sensitiveFieldName);
  try {
    for (const name of new URL(request.url ?? "/", "http://127.0.0.1").searchParams.keys()) {
      if (sensitiveFieldName(name)) signals.push("sensitive-query");
    }
  } catch {
    signals.push("malformed-url");
  }
  return [...new Set(signals)];
}

async function closeServer(server) {
  closingLoopbackServers.add(server);
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
}

function closeServerImmediately(server) {
  closingLoopbackServers.add(server);
  if (!server.listening) return;
  server.closeAllConnections?.();
  server.close();
  server.unref?.();
}

function removablePathFinalizers(remove, removeImmediately) {
  const options = { force: true, maxRetries: 5, recursive: true, retryDelay: 100 };
  return {
    emergencyRelease: (path) => removeImmediately(path, options),
    release: (path) => remove(path, options),
  };
}

function recorderFinalizers() {
  return {
    emergencyRelease: (recorder) => recorder.emergencyClose?.() ?? recorder.close(),
    release: (recorder) => recorder.close(),
  };
}

export async function createLoopbackRecorder({
  createServer = createHttpServer,
  port = 0,
  resourceScope = createResourceScope(),
  responseStatus = 503,
  signal,
} = {}) {
  let requestCount = 0;
  const credentialSignals = new Set();
  const server = resourceScope.register(
    createServer((request, response) => {
      requestCount += 1;
      for (const signal of requestCredentialSignals(request)) credentialSignals.add(signal);
      request.resume();
      response.writeHead(responseStatus, {
        connection: "close",
        "content-type": "application/json",
      });
      response.end('{"ok":false}');
    }),
    { emergencyRelease: closeServerImmediately, release: closeServer },
  );
  try {
    await listenLoopback(server, { exclusive: true, host: "127.0.0.1", port }, signal);
    const address = server.address();
    if (!address || typeof address !== "object") {
      throw new Error("Failed to create an isolated loopback recorder");
    }
    return {
      close: () => resourceScope.release(server),
      emergencyClose: () => resourceScope.emergencyRelease(server),
      snapshot: () => ({ credentialSignals: [...credentialSignals], requestCount }),
      url: `http://127.0.0.1:${address.port}`,
    };
  } catch (error) {
    try {
      await resourceScope.release(server);
    } catch (releaseError) {
      throw new AggregateError([error, releaseError], errorMessage(error));
    }
    throw error;
  }
}

export async function prepareSmokeContext(
  executable,
  {
    createRecorder = createLoopbackRecorder,
    deadline,
    makeDirectory = mkdir,
    makeTemporaryDirectory = mkdtemp,
    remove = rm,
    removeImmediately = rmSync,
    resourceScope,
    temporaryDirectory = tmpdir,
  } = {},
) {
  const scope = resourceScope ?? createResourceScope();
  const ownsScope = !resourceScope;
  const acquire = (operation, finalizers, label) =>
    scope.acquire(operation, finalizers, (pending) =>
      deadline ? deadline.run(pending, label, cleanupReserveMs) : pending(),
    );
  try {
    const root = await acquire(
      () => makeTemporaryDirectory(join(temporaryDirectory(), "local-studio-desktop-smoke-")),
      removablePathFinalizers(remove, removeImmediately),
      "Smoke temporary directory",
    );
    const context = {
      cwd: join(root, "cwd"),
      data: join(root, "data"),
      executable,
      home: join(root, "home"),
      resourceScope: scope,
      root,
      temporary: join(root, "tmp"),
      userData: join(root, "user-data"),
    };
    for (const directory of [
      context.cwd,
      context.data,
      context.home,
      context.temporary,
      context.userData,
    ]) {
      await acquire(
        async () => {
          await makeDirectory(directory, { recursive: true });
          return directory;
        },
        removablePathFinalizers(remove, removeImmediately),
        "Smoke directory preparation",
      );
    }
    context.controllerSink = await acquire(
      () =>
        createRecorder({
          port: Number(new URL(smokeControllerUrl).port),
          resourceScope: scope,
          responseStatus: 503,
          signal: deadline?.signal,
        }),
      recorderFinalizers(),
      "Smoke controller sink",
    );
    context.productionSentinel = await acquire(
      () =>
        createRecorder({
          resourceScope: scope,
          responseStatus: 421,
          signal: deadline?.signal,
        }),
      recorderFinalizers(),
      "Production controller sentinel",
    );
    deadline?.signal.throwIfAborted();
    return context;
  } catch (error) {
    if (ownsScope) {
      try {
        await scope.releaseAll({ deadline, label: "Smoke preparation cleanup" });
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], errorMessage(error));
      }
    }
    throw error;
  }
}

export function selectedEnvironment(source, names) {
  return Object.fromEntries(
    names.flatMap((name) => (typeof source[name] === "string" ? [[name, source[name]]] : [])),
  );
}

function sentinelSourceEnvironment(source, sentinelUrl) {
  const environment = { ...source };
  for (const name of controllerUrlEnvironmentNames) environment[name] = sentinelUrl;
  for (const name of controllerKeyEnvironmentNames) environment[name] = sentinelCredential;
  return environment;
}

export function isolatedEnvironment(context, source = process.env) {
  const environment = {
    ...selectedEnvironment(source, inheritedEnvironmentNames),
    API_KEY: "",
    BACKEND_URL: context.controllerSink.url,
    HOME: context.home,
    INFERENCE_API_KEY: "",
    LOCAL_STUDIO_AGENT_CWD: context.cwd,
    LOCAL_STUDIO_API_KEY: "",
    LOCAL_STUDIO_BACKEND_URL: context.controllerSink.url,
    LOCAL_STUDIO_DATA_DIR: context.data,
    LOCAL_STUDIO_DESKTOP_APP_NAME: `Local Studio Smoke ${process.pid}`,
    LOCAL_STUDIO_DESKTOP_DISABLE_AUTO_UPDATE: "true",
    LOCAL_STUDIO_DESKTOP_USER_DATA_DIR: context.userData,
    NEXT_PUBLIC_API_URL: context.controllerSink.url,
    NEXT_PUBLIC_BACKEND_URL: context.controllerSink.url,
    NEXT_TELEMETRY_DISABLED: "1",
    TEMP: context.temporary,
    TMP: context.temporary,
    TMPDIR: context.temporary,
    XDG_CACHE_HOME: join(context.home, ".cache"),
    XDG_CONFIG_HOME: join(context.home, ".config"),
  };
  return environment;
}

function launchStatus(launched) {
  if (launched.error) return { error: launched.error };
  if (launched.child.exitCode !== null || launched.child.signalCode !== null) {
    return { code: launched.child.exitCode, signal: launched.child.signalCode };
  }
  return null;
}

async function launchPackagedDesktop(context, output, signal, resourceScope) {
  const cdpPort = await allocateLoopbackPort(signal, resourceScope);
  signal?.throwIfAborted();
  const sourceEnvironment = sentinelSourceEnvironment(process.env, context.productionSentinel.url);
  const child = spawn(
    context.executable,
    [
      `--remote-debugging-port=${cdpPort}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${context.userData}`,
      "--no-first-run",
      "--disable-background-networking",
      "--disable-component-update",
    ],
    {
      cwd: context.cwd,
      detached: process.platform !== "win32",
      env: isolatedEnvironment(context, sourceEnvironment),
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const launched = {
    browserWebSocketDebuggerUrl: null,
    cdpPort,
    child,
    embeddedPids: new Set(),
    error: null,
    groupId: process.platform === "win32" ? null : child.pid,
  };
  resourceScope.register(launched, {
    emergencyRelease: emergencyStopLaunchedDesktop,
    release: (value, deadline) =>
      releaseLaunchedDesktop(context, value, { deadline, resourceScope }),
  });
  child.once("error", (error) => {
    launched.error = error;
  });
  child.stdout?.on("data", output.stdout);
  child.stderr?.on("data", output.stderr);
  return launched;
}

async function fetchJson(url, timeoutMs = requestTimeoutMs, signal) {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, {
    headers: { "cache-control": "no-cache" },
    redirect: "manual",
    signal: requestSignal,
  });
  if (response.status !== 200) throw new Error(`${url} returned status ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${url} returned invalid JSON: ${errorMessage(error)}`);
  }
}

export async function createCdpSession(
  url,
  {
    WebSocketClass = globalThis.WebSocket,
    clearTimer = clearTimeout,
    resourceScope = createResourceScope(),
    setTimer = setTimeout,
    signal,
    timeoutMs = requestTimeoutMs,
  } = {},
) {
  if (typeof WebSocketClass !== "function") {
    throw new Error("Node.js WebSocket support is unavailable");
  }
  const pending = new Map();
  let closeDuration = timeoutMs;
  let id = 0;
  let opened = false;
  let resolveClosed;
  const closed = new Promise((resolveClose) => {
    resolveClosed = resolveClose;
  });
  const rejectPending = (reason) => {
    for (const request of pending.values()) {
      clearTimer(request.timer);
      request.reject(reason);
    }
    pending.clear();
  };
  const settlePendingOnClose = () => {
    for (const request of pending.values()) {
      clearTimer(request.timer);
      if (request.closeRace) request.resolve("close");
      else request.reject(new Error("CDP connection closed"));
    }
    pending.clear();
  };
  const emergencyCloseSocket = (target) => {
    rejectPending(new Error("CDP connection closed"));
    if (target.readyState !== 2 && target.readyState !== 3) target.close();
  };
  const closeSocket = async (target) => {
    emergencyCloseSocket(target);
    if (target.readyState !== 3 && closeDuration > 0) {
      await boundedPromise(closed, closeDuration, "CDP close", { clearTimer, setTimer });
    }
  };
  const socket = resourceScope.register(new WebSocketClass(url), {
    emergencyRelease: emergencyCloseSocket,
    release: closeSocket,
  });
  const abort = () => {
    rejectPending(signal.reason ?? new Error("CDP connection aborted"));
    resourceScope.emergencyRelease(socket);
  };
  signal?.addEventListener("abort", abort, { once: true });
  socket.addEventListener("close", () => {
    signal?.removeEventListener("abort", abort);
    settlePendingOnClose();
    resolveClosed();
  });
  socket.addEventListener("error", () => {
    rejectPending(new Error("CDP connection failed"));
  });
  const session = await boundedPromise(
    new Promise((resolve, reject) => {
      socket.addEventListener(
        "open",
        () => {
          opened = true;
          socket.addEventListener("message", (event) => {
            let message;
            try {
              message = JSON.parse(String(event.data));
            } catch {
              return;
            }
            if (!message.id || !pending.has(message.id)) return;
            const request = pending.get(message.id);
            if (message.error) {
              pending.delete(message.id);
              clearTimer(request.timer);
              request.reject(new Error(`CDP command failed: ${JSON.stringify(message.error)}`));
            } else {
              pending.delete(message.id);
              clearTimer(request.timer);
              request.resolve(request.closeRace ? "response" : message.result);
            }
          });
          const request = (method, params, closeRace) =>
            new Promise((requestResolve, requestReject) => {
              const requestId = (id += 1);
              const timer = setTimer(() => {
                pending.delete(requestId);
                if (closeRace) requestResolve("timeout");
                else requestReject(new Error(timeoutMessage(`CDP ${method}`, timeoutMs)));
              }, timeoutMs);
              pending.set(requestId, {
                closeRace,
                reject: requestReject,
                resolve: requestResolve,
                timer,
              });
              try {
                socket.send(JSON.stringify({ id: requestId, method, params }));
              } catch (error) {
                pending.delete(requestId);
                clearTimer(timer);
                requestReject(error);
              }
            });
          resolve({
            close: async (duration = timeoutMs) => {
              closeDuration = duration;
              await resourceScope.release(socket);
            },
            requestClose: () => request("Browser.close", {}, true),
            send: (method, params = {}) => request(method, params, false),
            waitForClose: (duration = timeoutMs) =>
              boundedPromise(closed, duration, "CDP close", { clearTimer, setTimer }),
          });
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          if (!opened) reject(new Error("Failed to connect to CDP"));
        },
        { once: true },
      );
    }),
    timeoutMs,
    "CDP connection",
    { clearTimer, setTimer, signal },
  ).catch(async (error) => {
    closeDuration = timeoutMs;
    await resourceScope.release(socket).catch(() => undefined);
    throw error;
  });
  return session;
}

async function verifyNativeBridge({ deadline, launched, port, scope }) {
  const origin = `http://127.0.0.1:${port}`;
  const timeoutMs = Math.min(cdpTimeoutMs, deadline.available(cleanupReserveMs));
  if (timeoutMs === 0)
    throw new Error(timeoutMessage("CDP bridge verification", deadline.timeoutMs));
  const target = await waitForPageTarget({
    cdpPort: launched.cdpPort,
    childStatus: () => launchStatus(launched),
    fetchTargets: (url, signal, duration) => fetchJson(url, duration, signal),
    origin,
    signal: deadline.signal,
    timeoutMs,
  });
  const version = await fetchJson(
    `http://127.0.0.1:${launched.cdpPort}/json/version`,
    Math.min(requestTimeoutMs, deadline.remaining("CDP version", cleanupReserveMs)),
    deadline.signal,
  );
  if (typeof version?.webSocketDebuggerUrl === "string") {
    launched.browserWebSocketDebuggerUrl = version.webSocketDebuggerUrl;
  }
  const session = await createCdpSession(target.webSocketDebuggerUrl, {
    resourceScope: scope,
    signal: deadline.signal,
    timeoutMs: Math.min(requestTimeoutMs, deadline.remaining("CDP session", cleanupReserveMs)),
  });
  try {
    return await waitForNativeBridge({
      childStatus: () => launchStatus(launched),
      evaluate: () =>
        session.send("Runtime.evaluate", {
          awaitPromise: true,
          expression: terminalStatusExpression,
          returnByValue: true,
        }),
      signal: deadline.signal,
      timeoutMs: Math.min(
        cdpTimeoutMs,
        deadline.remaining("CDP bridge readiness", cleanupReserveMs),
      ),
    });
  } finally {
    await session.close();
  }
}

async function recordEmbeddedPid(context, launched) {
  try {
    const value = String(
      await readFile(join(context.userData, "embedded-frontend.pid"), "utf8"),
    ).trim();
    if (/^\d+$/u.test(value)) launched.embeddedPids.add(Number(value));
  } catch {}
}

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processTreeAlive(launched) {
  if (!launched) return false;
  if (launched.groupId) return processAlive(-launched.groupId);
  return launchStatus(launched) === null;
}

async function waitForTreeExit(launched, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!processTreeAlive(launched)) return true;
    await sleep(pollIntervalMs);
  }
  return !processTreeAlive(launched);
}

function signalTree(launched, signal) {
  try {
    if (launched.groupId) {
      process.kill(-launched.groupId, signal);
    } else {
      launched.child.kill(signal);
    }
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function capturedFailure(operation) {
  try {
    operation();
    return [];
  } catch (error) {
    return [error];
  }
}

function emergencyStopLaunchedDesktop(
  launched,
  {
    isPidAlive = processAlive,
    isTreeAlive = processTreeAlive,
    kill = process.kill,
    signal = signalTree,
  } = {},
) {
  const failures = [];
  if (isTreeAlive(launched)) {
    failures.push(...capturedFailure(() => signal(launched, "SIGKILL")));
  }
  for (const pid of launched.embeddedPids ?? []) {
    if (isPidAlive(pid)) failures.push(...capturedFailure(() => kill(pid, "SIGKILL")));
  }
  const failure = aggregatedFailure(failures, "Packaged desktop emergency cleanup");
  if (failure) throw failure;
}

export function emergencyCleanupSmoke(
  { context, launched },
  {
    isPidAlive = processAlive,
    isTreeAlive = processTreeAlive,
    kill = process.kill,
    remove = rmSync,
    signal = signalTree,
  } = {},
) {
  const scope = createResourceScope();
  if (context?.root) scope.register(context.root, removablePathFinalizers(remove, remove));
  for (const recorder of [context?.controllerSink, context?.productionSentinel].filter(Boolean)) {
    scope.register(recorder, recorderFinalizers());
  }
  if (launched) {
    scope.register(launched, {
      emergencyRelease: (value) =>
        emergencyStopLaunchedDesktop(value, { isPidAlive, isTreeAlive, kill, signal }),
      release: async () => {},
    });
  }
  scope.emergencyReleaseAll();
}

async function requestGracefulQuit(launched, deadline, resourceScope) {
  if (!processTreeAlive(launched)) return;
  if (deadline && deadline.available() === 0) return;
  if (deadline?.signal.aborted) return;
  let debuggerUrl = launched.browserWebSocketDebuggerUrl;
  if (!debuggerUrl) {
    const timeoutMs = Math.min(requestTimeoutMs, deadline?.available() ?? requestTimeoutMs);
    if (timeoutMs === 0) return;
    const version = await fetchJson(
      `http://127.0.0.1:${launched.cdpPort}/json/version`,
      timeoutMs,
      deadline?.signal,
    );
    debuggerUrl = version?.webSocketDebuggerUrl;
  }
  if (!debuggerUrl) throw new Error("CDP browser debugger URL is unavailable");
  let session;
  try {
    const timeoutMs = Math.min(2_000, deadline?.available() ?? 2_000);
    if (timeoutMs === 0) return;
    session = await createCdpSession(debuggerUrl, {
      resourceScope,
      signal: deadline?.signal,
      timeoutMs,
    });
    await session.requestClose();
  } finally {
    await session?.close(Math.min(2_000, deadline?.available() ?? 2_000)).catch(() => undefined);
  }
}

function cleanupWaitDuration(deadline, maximum) {
  return Math.min(maximum, deadline?.available() ?? maximum);
}

async function stopLaunchedDesktop(
  context,
  launched,
  {
    deadline,
    isPidAlive,
    isTreeAlive,
    recordPid,
    requestQuit,
    resourceScope,
    signal,
    waitForExit,
  },
) {
  const failures = [];
  await recordPid(context, launched);
  try {
    await requestQuit(launched, deadline, resourceScope);
  } catch (error) {
    failures.push(error);
  }
  const gracefulDuration = cleanupWaitDuration(deadline, gracefulQuitTimeoutMs);
  if (gracefulDuration === 0 || !(await waitForExit(launched, gracefulDuration))) {
    try {
      signal(launched, "SIGTERM");
    } catch (error) {
      failures.push(error);
    }
  }
  const terminateDuration = cleanupWaitDuration(deadline, terminateTimeoutMs);
  if (
    isTreeAlive(launched) &&
    (terminateDuration === 0 || !(await waitForExit(launched, terminateDuration)))
  ) {
    try {
      signal(launched, "SIGKILL");
    } catch (error) {
      failures.push(error);
    }
  }
  const killDuration = cleanupWaitDuration(deadline, terminateTimeoutMs);
  if (
    isTreeAlive(launched) &&
    (killDuration === 0 || !(await waitForExit(launched, killDuration)))
  ) {
    failures.push(new Error("Packaged desktop process tree remained after SIGKILL"));
  }
  for (const pid of launched.embeddedPids) {
    if (isPidAlive(pid)) failures.push(new Error(`Embedded frontend process ${pid} remained`));
  }
  return failures;
}

async function releaseLaunchedDesktop(
  context,
  launched,
  {
    deadline,
    isPidAlive = processAlive,
    isTreeAlive = processTreeAlive,
    recordPid = recordEmbeddedPid,
    requestQuit = requestGracefulQuit,
    resourceScope,
    signal = signalTree,
    waitForExit = waitForTreeExit,
  } = {},
) {
  const failures = await stopLaunchedDesktop(context, launched, {
    deadline,
    isPidAlive,
    isTreeAlive,
    recordPid,
    requestQuit,
    resourceScope,
    signal,
    waitForExit,
  });
  const failure = aggregatedFailure(failures, "Packaged desktop process cleanup");
  if (failure) throw failure;
}

function registerStandaloneSmokeResources(context, launched, dependencies) {
  const scope = context.resourceScope ?? createResourceScope();
  if (!context.resourceScope) {
    scope.register(
      context.root,
      removablePathFinalizers(dependencies.remove, dependencies.removeImmediately),
    );
    for (const recorder of [context.controllerSink, context.productionSentinel].filter(Boolean)) {
      scope.register(recorder, recorderFinalizers());
    }
  }
  if (launched) {
    scope.register(launched, {
      emergencyRelease: (value) => emergencyStopLaunchedDesktop(value, dependencies),
      release: (value, deadline) =>
        releaseLaunchedDesktop(context, value, {
          ...dependencies,
          deadline,
          resourceScope: scope,
        }),
    });
  }
  return scope;
}

function controllerIsolationFailures(context) {
  const failures = [];
  const sentinel = context.productionSentinel?.snapshot();
  if (sentinel?.requestCount) {
    failures.push(
      new Error(`Production controller sentinel received ${sentinel.requestCount} request(s)`),
    );
  }
  const sink = context.controllerSink?.snapshot();
  if (sink?.credentialSignals.length) {
    failures.push(
      new Error(
        `Isolated controller sink received credential signals: ${sink.credentialSignals.join(", ")}`,
      ),
    );
  }
  return failures;
}

export async function cleanupSmoke(
  { context, deadline, launched, scope },
  {
    isPidAlive = processAlive,
    isTreeAlive = processTreeAlive,
    kill = process.kill,
    recordPid = recordEmbeddedPid,
    remove = rm,
    removeImmediately = rmSync,
    requestQuit = requestGracefulQuit,
    signal = signalTree,
    waitForExit = waitForTreeExit,
  } = {},
) {
  if (!context) return;
  const failures = [];
  if (!scope) {
    const cleanupScope = registerStandaloneSmokeResources(context, launched, {
      isPidAlive,
      isTreeAlive,
      kill,
      recordPid,
      remove,
      removeImmediately,
      requestQuit,
      signal,
      waitForExit,
    });
    try {
      await cleanupScope.releaseAll({ deadline, label: "Packaged desktop smoke cleanup" });
    } catch (error) {
      failures.push(error);
    }
  }
  failures.push(...controllerIsolationFailures(context));
  const failure = aggregatedFailure(failures, "Packaged desktop smoke cleanup");
  if (failure) throw failure;
}

async function runPackagedDesktopSmoke(executable, output) {
  const deadline = createLifecycleDeadline();
  return executeSmokeLifecycle(
    {
      cleanup: cleanupSmoke,
      launch: ({ context, deadline, scope }) =>
        launchPackagedDesktop(context, output, deadline.signal, scope),
      prepare: ({ deadline, scope }) =>
        prepareSmokeContext(executable, { deadline, resourceScope: scope }),
      verifyBridge: verifyNativeBridge,
      verifyHealth: async ({ context, deadline, launched, port }) => {
        const timeoutMs = deadline.remaining("Packaged desktop health", cleanupReserveMs);
        const health = await waitForDesktopHealth({
          childStatus: () => launchStatus(launched),
          fetchResponse: (url, signal, duration) =>
            fetch(url, {
              headers: { "cache-control": "no-cache" },
              redirect: "manual",
              signal: AbortSignal.any([signal, AbortSignal.timeout(duration)]),
            }),
          signal: deadline.signal,
          timeoutMs,
          url: `http://127.0.0.1:${port}/api/desktop-health`,
        });
        await recordEmbeddedPid(context, launched);
        return health;
      },
      waitForPort: ({ context, deadline, launched }) =>
        waitForEmbeddedPort({
          childStatus: () => launchStatus(launched),
          portFile: join(context.userData, "embedded-frontend.port"),
          signal: deadline.signal,
          timeoutMs: deadline.remaining("Embedded frontend port", cleanupReserveMs),
        }),
    },
    { cleanupReserveMs, deadline },
  );
}

const sensitiveAssignmentPattern =
  /(?:authorization|cookie|set[-_]?cookie|[A-Za-z0-9_-]*(?:api[-_]?key|credential|password|private[-_]?key|secret|signature|token)[A-Za-z0-9_-]*)\s*["']?\s*(?:=|:)\s*(["'`|>]?)\s*/iu;
const providerCredentialPattern =
  /(?:\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{12,}\b|\bgh[pousr]_[A-Za-z0-9_]{3,}\b|\bgithub_pat_[A-Za-z0-9_]{3,}\b|\b(?:gsk|hf|npm)_[A-Za-z0-9_-]{10,}\b|\bglpat-[A-Za-z0-9_-]{10,}\b|\bsk-[A-Za-z0-9_-]{3,}\b|\bxox[baprs]-[A-Za-z0-9-]{3,}\b|\bya29\.[A-Za-z0-9_-]{3,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----)/iu;
const authenticationValuePattern = /\b(?:Basic|Bearer)\s+[A-Za-z0-9+/._~=-]+/iu;
const sensitiveFlagPattern =
  /--[A-Za-z0-9_-]*(?:api[-_]?key|credential|password|secret|signature|token)[A-Za-z0-9_-]*\s+\S+/iu;

function diagnosticClassificationValue(value) {
  return value.replaceAll(diagnosticControlSeparator, "");
}

function diagnosticStructureValue(value) {
  return value.replaceAll(diagnosticControlSeparator, " ");
}

function diagnosticIndentation(value) {
  return diagnosticStructureValue(value).match(/^\s*/u)?.[0].length ?? 0;
}

function createDiagnosticNormalizer(consume) {
  let pendingCarriageReturn = false;
  const write = (value, finish = false) => {
    let normalized = "";
    for (const character of value) {
      if (pendingCarriageReturn) {
        normalized += character === "\n" ? "\n" : diagnosticControlSeparator;
        pendingCarriageReturn = false;
        if (character === "\n") continue;
      }
      if (character === "\r") pendingCarriageReturn = true;
      else normalized += character === "\0" ? diagnosticControlSeparator : character;
    }
    if (finish && pendingCarriageReturn) {
      normalized += diagnosticControlSeparator;
      pendingCarriageReturn = false;
    }
    if (normalized) consume(normalized);
  };
  return { finish: () => write("", true), write };
}

function hasClosingQuote(value, quote) {
  let escaped = false;
  for (const character of value) {
    if (character === quote && !escaped) return true;
    escaped = character === "\\" && !escaped;
    if (character !== "\\") escaped = false;
  }
  return false;
}

function sensitiveContinuation(line) {
  const classified = diagnosticClassificationValue(line);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/iu.test(classified)) return { privateKey: true };
  const assignment = classified.match(sensitiveAssignmentPattern);
  if (!assignment) return null;
  const marker = assignment[1];
  if (['"', "'", "`"].includes(marker)) {
    const remainder = classified.slice((assignment.index ?? 0) + assignment[0].length);
    return hasClosingQuote(remainder, marker) ? null : { quote: marker };
  }
  if (marker === "|" || marker === ">") {
    return { indentation: diagnosticIndentation(line) };
  }
  if (classified.trimEnd().endsWith("\\")) return { folded: true };
  const remainder = classified.slice((assignment.index ?? 0) + assignment[0].length);
  const indentation = diagnosticIndentation(line);
  if (remainder.trim() === "") return { indentation, pending: true };
  const field = /^\s*["']?([^"':\s]+)["']?\s*:/u.exec(classified)?.[1];
  return field && sensitiveFieldName(field) ? { indentation } : null;
}

function urlContainsCredential(value) {
  for (const match of value.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/giu)) {
    const candidate = match[0].replace(/[),.;\]}]+$/u, "");
    try {
      const url = new URL(candidate);
      if (url.username || url.password) return true;
      for (const name of url.searchParams.keys()) {
        if (sensitiveFieldName(name)) return true;
      }
      for (const name of new URLSearchParams(url.hash.slice(1)).keys()) {
        if (sensitiveFieldName(name)) return true;
      }
    } catch {
      if (/@|[?&][^=]*(?:key|secret|token|password|credential)=/iu.test(candidate)) return true;
    }
  }
  return false;
}

function unsafeDiagnosticLine(line) {
  const classified = diagnosticClassificationValue(line);
  return (
    sensitiveAssignmentPattern.test(classified) ||
    providerCredentialPattern.test(classified) ||
    authenticationValuePattern.test(classified) ||
    sensitiveFlagPattern.test(classified) ||
    urlContainsCredential(classified)
  );
}

function pendingValueContinuation(line, continuation) {
  const classified = diagnosticClassificationValue(line);
  if (diagnosticStructureValue(line).trim() === "") return continuation;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/iu.test(classified)) return { privateKey: true };
  const value = classified.trimStart();
  const quote = value[0];
  if (['"', "'", "`"].includes(quote)) {
    return hasClosingQuote(value.slice(1), quote) ? null : { quote };
  }
  if (value === "|" || value === ">") return { indentation: continuation.indentation };
  if (classified.trimEnd().endsWith("\\")) return { folded: true };
  const indentation = diagnosticIndentation(line);
  return indentation > continuation.indentation ? { indentation: continuation.indentation } : null;
}

function diagnosticContinuation(line, continuation) {
  const classified = diagnosticClassificationValue(line);
  if (continuation.privateKey) {
    return {
      continuation: /-----END [A-Z ]*PRIVATE KEY-----/iu.test(classified) ? null : continuation,
      skip: true,
    };
  }
  if (continuation.quote) {
    return {
      continuation: hasClosingQuote(classified, continuation.quote) ? null : continuation,
      skip: true,
    };
  }
  if (continuation.folded) {
    return {
      continuation: classified.trimEnd().endsWith("\\") ? continuation : null,
      skip: true,
    };
  }
  if (continuation.pending) {
    return { continuation: pendingValueContinuation(line, continuation), skip: true };
  }
  if (diagnosticStructureValue(line).trim() === "") return { continuation, skip: true };
  const indentation = diagnosticIndentation(line);
  return indentation > continuation.indentation
    ? { continuation, skip: true }
    : { continuation: null, skip: false };
}

function boundedUtf8(value, limit) {
  const encoded = Buffer.from(value);
  if (encoded.length <= limit) return value;
  let bounded = encoded.subarray(0, limit).toString("utf8");
  while (Buffer.byteLength(bounded) > limit) bounded = bounded.slice(0, -1);
  return bounded;
}

function boundedUtf8Tail(value, limit) {
  const encoded = Buffer.from(value);
  if (encoded.length <= limit) return value;
  let bounded = encoded.subarray(encoded.length - limit).toString("utf8");
  while (Buffer.byteLength(bounded) > limit) bounded = bounded.slice(1);
  return bounded;
}

function createDiagnosticLineState() {
  return {
    buffer: "",
    bytes: 0,
    classifiedTail: "",
    continuation: null,
    indentation: 0,
    indentationPending: true,
    overflow: false,
    unsafe: false,
  };
}

function updateDiagnosticIndentation(state, value) {
  if (!state.indentationPending) return;
  for (const character of value) {
    if (character !== diagnosticControlSeparator && !/\s/u.test(character)) {
      state.indentationPending = false;
      return;
    }
    state.indentation += 1;
  }
}

function classifyDiagnosticSegment(state, value, rawLineLimit) {
  updateDiagnosticIndentation(state, value);
  const candidate = `${state.classifiedTail}${value}`;
  const unsafe = unsafeDiagnosticLine(candidate);
  if (unsafe) {
    state.unsafe = true;
    state.continuation =
      sensitiveContinuation(candidate) ?? state.continuation ?? { indentation: state.indentation };
  }
  state.classifiedTail = boundedUtf8Tail(candidate, 4_096);
  if (state.overflow) return;
  state.buffer += value;
  state.bytes += Buffer.byteLength(value);
  if (state.bytes <= rawLineLimit) return;
  state.buffer = "";
  state.overflow = true;
}

function overflowContinuation(state, continuation) {
  if (!continuation) return { continuation: state.continuation, skip: false };
  if (continuation.indentation !== undefined) {
    return state.indentation > continuation.indentation
      ? { continuation, skip: true }
      : { continuation: state.continuation, skip: false };
  }
  return { continuation, skip: true };
}

export function createDiagnosticClassifier(limit = outputLimit, retainTail = false) {
  const decoder = new StringDecoder("utf8");
  let continuation;
  let finished = false;
  let lastRedacted = false;
  let line = createDiagnosticLineState();
  let output = "";
  const rawLineLimit = Math.max(4_096, limit * 4);
  const append = (value) => {
    const next = `${output}${value}`;
    output = retainTail ? boundedUtf8Tail(next, limit) : boundedUtf8(next, limit);
  };
  const redact = (terminated) => {
    if (lastRedacted) return;
    append(`[redacted diagnostic line]${terminated ? "\n" : ""}`);
    lastRedacted = true;
  };
  const processLine = (terminated) => {
    if (line.overflow) {
      const next = overflowContinuation(line, continuation);
      continuation = next.continuation;
      if (next.skip) return;
      if (line.unsafe) continuation = line.continuation;
      redact(terminated);
      return;
    }
    const value = line.buffer;
    if (continuation) {
      const next = diagnosticContinuation(value, continuation);
      continuation = next.continuation;
      if (next.skip) return;
    }
    if (line.unsafe) {
      continuation = sensitiveContinuation(value) ?? line.continuation;
      redact(terminated);
      return;
    }
    append(`${diagnosticStructureValue(value)}${terminated ? "\n" : ""}`);
    lastRedacted = false;
  };
  const consume = (value) => {
    let start = 0;
    for (let newline = value.indexOf("\n"); newline !== -1; newline = value.indexOf("\n", start)) {
      classifyDiagnosticSegment(line, value.slice(start, newline), rawLineLimit);
      processLine(true);
      line = createDiagnosticLineState();
      start = newline + 1;
    }
    classifyDiagnosticSegment(line, value.slice(start), rawLineLimit);
  };
  const normalizer = createDiagnosticNormalizer(consume);
  const write = (chunk) => {
    if (finished) return;
    normalizer.write(Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk));
  };
  const finish = () => {
    if (finished) return output;
    normalizer.write(decoder.end());
    normalizer.finish();
    processLine(false);
    finished = true;
    return output;
  };
  return { finish, write };
}

export function sanitizeDiagnostics(value, limit = outputLimit) {
  const sanitizer = createDiagnosticClassifier(limit);
  sanitizer.write(String(value));
  return sanitizer.finish();
}

export function formatSmokeDiagnostics(error, output) {
  const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const snapshot = output.snapshot();
  const classifier = createDiagnosticClassifier();
  for (const source of [
    "Packaged desktop smoke failed",
    stack,
    "stdout",
    snapshot.stdout || "<empty>",
    "stderr",
    snapshot.stderr || "<empty>",
  ]) {
    classifier.write(`${source}\n`);
  }
  return classifier.finish();
}

async function runCli() {
  const output = createBoundedOutput();
  await rm(artifactPath, { force: true });
  try {
    const architecture = resolveSmokeArchitecture();
    const executable = resolvePackagedExecutable({ arch: architecture });
    await assertNativeExecutableArchitecture({ architecture, executable });
    const result = await runPackagedDesktopSmoke(executable, output);
    console.log(
      `Packaged desktop smoke passed: health=200 port=${result.port} nativePty=${result.bridge.available}`,
    );
  } catch (error) {
    const report = formatSmokeDiagnostics(error, output);
    try {
      await mkdir(dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, report, { mode: 0o600 });
    } catch {}
    console.error(report);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await runCli();
}
