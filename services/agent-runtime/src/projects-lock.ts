import { randomInt, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Schema } from "effect";
import {
  ensureOwnerDirectory,
  readOwnerFile,
  syncOwnerDirectory,
} from "./owner-files";

const LockOwnerSchema = Schema.Struct({
  pid: Schema.Number,
  startIdentity: Schema.String,
  token: Schema.String,
  createdAt: Schema.Number,
});

const LOCK_ATTEMPTS = 2_000;
const LOCK_RETRY_MS = 5;
const LOCK_RETRY_JITTER_MS = 11;

let cachedProcessStartIdentity: string | null = null;

export type LockOwner = typeof LockOwnerSchema.Type;

export type LockProcessInspection = {
  startIdentity: (pid: number) => string | null;
  exists: (pid: number) => boolean;
};

type OwnedClaim = {
  filePath: string;
  owner: LockOwner;
};

type ClaimState = {
  active: OwnedClaim[];
  inactive: string[];
};

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

function ownerPayload(owner: LockOwner): string {
  return `${JSON.stringify(owner)}\n`;
}

function validStartIdentity(owner: LockOwner): boolean {
  const runtime = /^runtime:(\d+):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.exec(
    owner.startIdentity,
  );
  if (runtime) return Number(runtime[1]) === owner.pid;
  return /^[a-z0-9]+:\d+$/i.test(owner.startIdentity);
}

function validToken(token: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    token,
  );
}

function decodedOwner(content: string): LockOwner | null {
  try {
    const owner = Schema.decodeUnknownSync(LockOwnerSchema)(JSON.parse(content));
    return Number.isSafeInteger(owner.pid) &&
      owner.pid > 0 &&
      validStartIdentity(owner) &&
      validToken(owner.token) &&
      Number.isFinite(owner.createdAt) &&
      owner.createdAt > 0
      ? owner
      : null;
  } catch {
    return null;
  }
}

function observeClaim(filePath: string): LockOwner | null {
  try {
    const content = readOwnerFile(filePath).content.toString("utf8");
    const owner = decodedOwner(content);
    if (!owner || path.basename(filePath) !== `${owner.token}.claim`) {
      throw new Error(`Invalid projects registry lock owner: ${filePath}`);
    }
    return owner;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function ownersMatch(left: LockOwner | null, right: LockOwner): boolean {
  return (
    left?.pid === right.pid &&
    left.startIdentity === right.startIdentity &&
    left.token === right.token
  );
}

function linuxStartIdentity(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 0) return null;
    const token = stat
      .slice(commandEnd + 1)
      .trim()
      .split(/\s+/)[19];
    return token && /^\d+$/.test(token) ? `linux:${token}` : null;
  } catch {
    return null;
  }
}

function windowsStartIdentity(pid: number): string | null {
  const command = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", timeout: 2_000, windowsHide: true },
  );
  const value = result.status === 0 ? result.stdout.trim() : "";
  return /^\d+$/.test(value) ? `windows:${value}` : null;
}

function psStartIdentity(pid: number): string | null {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
    env: { LANG: "C", LC_ALL: "C", NODE_ENV: process.env.NODE_ENV },
    timeout: 2_000,
  });
  const value = result.status === 0 ? result.stdout.trim().replace(/\s+/g, " ") : "";
  const startedAt = Date.parse(value);
  return Number.isFinite(startedAt) ? `${process.platform}:${startedAt}` : null;
}

function processStartIdentity(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (process.platform === "linux") return linuxStartIdentity(pid);
  if (process.platform === "win32") return windowsStartIdentity(pid);
  return psStartIdentity(pid);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

const defaultProcessInspection: LockProcessInspection = {
  startIdentity: processStartIdentity,
  exists: processExists,
};

export function lockOwnerIsActive(
  owner: LockOwner,
  inspection: LockProcessInspection = defaultProcessInspection,
): boolean {
  if (owner.startIdentity.startsWith(`runtime:${owner.pid}:`)) {
    return inspection.exists(owner.pid);
  }
  const identity = inspection.startIdentity(owner.pid);
  if (identity) return identity === owner.startIdentity;
  return inspection.exists(owner.pid);
}

function currentProcessStartIdentity(): string {
  if (cachedProcessStartIdentity) return cachedProcessStartIdentity;
  cachedProcessStartIdentity =
    processStartIdentity(process.pid) ?? `runtime:${process.pid}:${randomUUID()}`;
  return cachedProcessStartIdentity;
}

function removeClaim(filePath: string): void {
  try {
    unlinkSync(filePath);
    syncOwnerDirectory(path.dirname(filePath));
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

function createOwnedClaim(directory: string): OwnedClaim {
  const owner = {
    pid: process.pid,
    startIdentity: currentProcessStartIdentity(),
    token: randomUUID(),
    createdAt: Date.now(),
  };
  const filePath = path.join(directory, `${owner.token}.claim`);
  const pendingPath = path.join(directory, `${owner.token}.pending`);
  let descriptor: number | undefined;
  let published = false;
  try {
    descriptor = openSync(
      pendingPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, ownerPayload(owner));
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(pendingPath, filePath);
    published = true;
    syncOwnerDirectory(directory);
    return { filePath, owner };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (published) removeClaim(filePath);
    throw error;
  } finally {
    removeClaim(pendingPath);
  }
}

function releaseOwnedClaim(claim: OwnedClaim): void {
  removeClaim(claim.filePath);
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function claimPaths(directory: string): string[] {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".claim"))
    .sort()
    .map((entry) => path.join(directory, entry));
}

function claimState(directory: string): ClaimState {
  const active: OwnedClaim[] = [];
  const inactive: string[] = [];
  for (const filePath of claimPaths(directory)) {
    const owner = observeClaim(filePath);
    if (!owner) continue;
    if (lockOwnerIsActive(owner)) active.push({ filePath, owner });
    else inactive.push(filePath);
  }
  return { active, inactive };
}

function tryAcquireLock(directory: string): OwnedClaim | null {
  const claim = createOwnedClaim(directory);
  try {
    const { active, inactive } = claimState(directory);
    if (
      active.length === 1 &&
      active[0]?.filePath === claim.filePath &&
      ownersMatch(active[0].owner, claim.owner)
    ) {
      inactive.forEach(removeClaim);
      return claim;
    }
  } catch (error) {
    releaseOwnedClaim(claim);
    throw error;
  }
  releaseOwnedClaim(claim);
  return null;
}

function acquireLock(filePath: string): OwnedClaim {
  const directory = `${filePath}.lock-claims`;
  ensureOwnerDirectory(directory);
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    const lock = tryAcquireLock(directory);
    if (lock) return lock;
    sleepSync(LOCK_RETRY_MS + randomInt(LOCK_RETRY_JITTER_MS));
  }
  throw new Error(`Timed out waiting for projects registry lock: ${directory}`);
}

export function withProjectsFileTransaction<T>(filePath: string, callback: () => T): T {
  const lock = acquireLock(filePath);
  try {
    return callback();
  } finally {
    releaseOwnedClaim(lock);
  }
}
