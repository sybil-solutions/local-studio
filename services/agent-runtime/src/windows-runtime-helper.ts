import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import executableIdentity from "./executable-identity.cjs";

const { AUDITED_WINDOWS_HELPER_IDENTITY, signingStableExecutableIdentity } = executableIdentity;
const WINDOWS_RUNTIME_HELPER_TIMEOUT_MS = 2_000;
const WINDOWS_RUNTIME_HELPER_OUTPUT_BYTES = 4_096;

export type WindowsSnapshotEntryKind = "directory" | "file";
export type WindowsSnapshotEntryAccess = "private" | "snapshot";
export type WindowsSnapshotSecurity = {
  protect(
    entry: string,
    kind: WindowsSnapshotEntryKind,
    access: WindowsSnapshotEntryAccess,
  ): Promise<void>;
  verify(
    entry: string,
    kind: WindowsSnapshotEntryKind,
    access: WindowsSnapshotEntryAccess,
  ): Promise<void>;
};
export type WindowsRuntimeHelperSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;
export type WindowsRuntimeHelperDependencies = {
  helperPath?: string;
  spawn?: WindowsRuntimeHelperSpawn;
  timeoutMs?: number;
};

function helperFailure(): Error {
  return new Error("Windows runtime helper failed");
}

function verifiedHelper(candidate: string): string | null {
  try {
    const requested = path.resolve(candidate);
    const stat = lstatSync(requested);
    if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(requested) !== requested)
      return null;
    const identity = signingStableExecutableIdentity(readFileSync(requested), "win32");
    return JSON.stringify(identity) === JSON.stringify(AUDITED_WINDOWS_HELPER_IDENTITY)
      ? requested
      : null;
  } catch {
    return null;
  }
}

function helperCandidates(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const runtime = process.env.LOCAL_STUDIO_NODE_RUNTIME?.trim();
  return [
    ...(runtime && path.isAbsolute(runtime)
      ? [path.join(path.dirname(runtime), "windows-runtime-helper.exe")]
      : []),
    path.resolve(moduleDir, "../native/windows-runtime-helper.exe"),
    path.resolve(moduleDir, "../../../../native/windows-runtime-helper.exe"),
    path.resolve(process.cwd(), "native/windows-runtime-helper.exe"),
    path.resolve(process.cwd(), "services/agent-runtime/native/windows-runtime-helper.exe"),
  ];
}

export function trustedWindowsRuntimeHelperPath(): string {
  for (const candidate of helperCandidates()) {
    const trusted = verifiedHelper(candidate);
    if (trusted) return trusted;
  }
  throw helperFailure();
}

function helperEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    ...Object.fromEntries(
      ["SystemRoot", "WINDIR", "TEMP", "TMP"].flatMap((key) =>
        process.env[key] === undefined ? [] : [[key, process.env[key]]],
      ),
    ),
  };
}

function successfulResponse(output: string): boolean {
  try {
    const decoded: unknown = JSON.parse(output.trim());
    return (
      decoded !== null &&
      typeof decoded === "object" &&
      Object.keys(decoded).length === 1 &&
      Reflect.get(decoded, "ok") === true
    );
  } catch {
    return false;
  }
}

function invokeHelper(
  helper: string,
  args: readonly string[],
  dependencies: WindowsRuntimeHelperDependencies,
): Promise<void> {
  const spawnHelper = dependencies.spawn ?? spawn;
  const timeoutMs = dependencies.timeoutMs ?? WINDOWS_RUNTIME_HELPER_TIMEOUT_MS;
  return new Promise<void>((resolve, reject) => {
    let output = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    let child: ChildProcess;
    try {
      child = spawnHelper(helper, args, {
        env: helperEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      reject(helperFailure());
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish(helperFailure());
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      output += String(chunk);
      if (Buffer.byteLength(output) <= WINDOWS_RUNTIME_HELPER_OUTPUT_BYTES) return;
      child.kill();
      finish(helperFailure());
    });
    child.once("error", () => finish(helperFailure()));
    child.once("close", (code) =>
      finish(code === 0 && successfulResponse(output) ? undefined : helperFailure()),
    );
  });
}

export function createWindowsSnapshotSecurity(
  dependencies: WindowsRuntimeHelperDependencies = {},
): WindowsSnapshotSecurity {
  const helper = dependencies.helperPath ?? trustedWindowsRuntimeHelperPath();
  return {
    protect: (entry, kind, access) =>
      invokeHelper(helper, ["protect-acl", access, kind, entry], dependencies),
    verify: (entry, kind, access) =>
      invokeHelper(helper, ["verify-acl", access, kind, entry], dependencies),
  };
}

export function windowsJobCommand(): { command: string; args: string[] } {
  return { command: trustedWindowsRuntimeHelperPath(), args: ["run-job"] };
}
