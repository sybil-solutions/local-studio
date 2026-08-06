import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync, readdirSync, readSync, statSync } from "node:fs";
import { Effect } from "effect";
import type { HandleReference, InstanceRecord, LaunchPlan } from "../contracts";
import { LOG_TAIL_BYTES, spawnFailed, type Launcher } from "./launcher";

/**
 * Detached-daemon launcher, exo-style: stdout+stderr straight into a log file, the whole
 * process *group* signalled on stop (vLLM forks an EngineCore that holds the VRAM — the
 * leader dying does not free the GPU), and ownership proven before any signal is sent.
 */

const STOP_POLL_MS = 250;
const LAUNCH_MARKER = "LOCAL_STUDIO_LAUNCH_NONCE";
const localChildren = new Map<number, ChildProcess>();

export interface ProcessIdentity { readonly pid: number; readonly processGroupId: number; readonly sessionId: number; readonly startToken: string; readonly launchMarker: string | null }

export interface ProcessLauncherRuntime { readonly platform: NodeJS.Platform; readonly readIdentity: (pid: number) => ProcessIdentity | null; readonly readGroup: (processGroupId: number) => readonly ProcessIdentity[] | null; readonly signalGroup: (processGroupId: number, signal: NodeJS.Signals) => void }

const readLinuxIdentity = (pid: number): ProcessIdentity | null => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const processGroupId = Number(afterComm[2]);
    const sessionId = Number(afterComm[3]);
    const startToken = afterComm[19] ?? "";
    if (![pid, processGroupId, sessionId].every(Number.isSafeInteger) || !startToken) return null;
    const prefix = `${LAUNCH_MARKER}=`;
    let launchMarker: string | null = null;
    try { launchMarker = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").find((entry) => entry.startsWith(prefix))?.slice(prefix.length) ?? null; } catch {}
    return { pid, processGroupId, sessionId, startToken, launchMarker };
  } catch {
    return null;
  }
};

const readLinuxGroup = (processGroupId: number): readonly ProcessIdentity[] | null => {
  try {
    return readdirSync("/proc")
      .filter((entry) => /^\d+$/.test(entry))
      .map((entry) => readLinuxIdentity(Number(entry)))
      .filter((identity): identity is ProcessIdentity => identity !== null && identity.processGroupId === processGroupId);
  } catch {
    return null;
  }
};

const realRuntime: ProcessLauncherRuntime = {
  platform: process.platform,
  readIdentity: readLinuxIdentity,
  readGroup: readLinuxGroup,
  signalGroup: (processGroupId, signal) => { try { process.kill(-processGroupId, signal); } catch {} },
};

const readTailBytes = (path: string, bytes: number): string => {
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - bytes);
    const length = size - start;
    if (length <= 0) return "";
    const buffer = Buffer.alloc(length);
    const fd = openSync(path, "r");
    try {
      readSync(fd, buffer, 0, length, start);
    } finally {
      closeSync(fd);
    }
    return buffer.toString("utf8");
  } catch {
    return "";
  }
};

const sameProcessReference = (reference: HandleReference, record: InstanceRecord): boolean => {
  const stored = record.ref;
  return reference.kind === "process" && stored?.kind === "process" && reference.pid === stored.pid && reference.processGroupId === stored.processGroupId && reference.sessionId === stored.sessionId && reference.startToken === stored.startToken;
};
const currentChild = (reference: HandleReference, record: InstanceRecord): ChildProcess | null => sameProcessReference(reference, record) && reference.kind === "process" ? localChildren.get(reference.pid) ?? null : null;
const childRunning = (child: ChildProcess): boolean => child.exitCode === null && child.signalCode === null;

const ownership = (reference: HandleReference, record: InstanceRecord, runtime: ProcessLauncherRuntime): "owned" | "gone" | "unknown" => {
  if (
    runtime.platform !== "linux" ||
    reference.kind !== "process" ||
    !sameProcessReference(reference, record) ||
    reference.processGroupId !== reference.pid ||
    reference.sessionId !== reference.pid ||
    reference.startToken === null
  ) {
    return "unknown";
  }
  const members = runtime.readGroup(reference.processGroupId);
  if (members === null) return "unknown";
  if (members.length === 0) return "gone";
  if (new Set(members.map((member) => member.pid)).size !== members.length) return "unknown";
  const roots = members.filter((member) => member.pid === reference.pid);
  if (roots.length > 1 || (roots[0] && roots[0].startToken !== reference.startToken)) {
    return "unknown";
  }
  return members.every(
    (member) =>
      member.processGroupId === reference.processGroupId &&
      member.sessionId === reference.sessionId &&
      member.launchMarker === record.nonce,
  )
    ? "owned"
    : "unknown";
};

export const makeProcessLauncher = (
  logPathFor: (name: string) => string,
  runtime: ProcessLauncherRuntime = realRuntime,
): Launcher => ({
  start: (plan: LaunchPlan, record: InstanceRecord) =>
    Effect.gen(function* () {
      const [binary, ...args] = plan.argv;
      if (!binary) return yield* spawnFailed("plan.argv is empty");
      const logFd = yield* Effect.try({
        try: () => openSync(logPathFor(record.name), "w"),
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          spawnFailed(`cannot open log file for ${record.name}: ${String(error)}`),
        ),
      );
      const child = spawn(binary, args, {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: { ...process.env, ...plan.env, [LAUNCH_MARKER]: record.nonce },
        ...(plan.workdir ? { cwd: plan.workdir } : {}),
      });
      const pid = yield* Effect.callback<number, never>((resume) => {
        child.on("error", () => resume(Effect.succeed(-1)));
        child.on("spawn", () => resume(Effect.succeed(child.pid ?? -1)));
      });
      closeSync(logFd);
      if (pid <= 0) return yield* spawnFailed(`failed to spawn ${binary}`);
      if (runtime.platform !== "linux") localChildren.set(pid, child);
      child.unref();
      let proved: ProcessIdentity | null = null;
      for (let attempt = 0; runtime.platform === "linux" && attempt < 20 && proved === null; attempt += 1) {
        const identity = runtime.readIdentity(pid);
        if (identity?.pid === pid && identity.processGroupId === pid && identity.sessionId === pid && identity.launchMarker === record.nonce) proved = identity;
        if (!proved) yield* Effect.sleep(25);
      }
      if (runtime.platform === "linux" && !proved) {
        child.kill("SIGKILL"); localChildren.delete(pid); return yield* spawnFailed("spawned process identity could not be proved");
      }
      return {
        kind: "process",
        pid,
        processGroupId: proved?.processGroupId ?? null,
        sessionId: proved?.sessionId ?? null,
        startToken: proved?.startToken ?? null,
      } as const;
    }),

  alive: (reference, record) => Effect.sync(() => {
    if (reference.kind !== "process") return false;
    if (runtime.platform === "linux") return ownership(reference, record, runtime) !== "gone";
    const child = currentChild(reference, record);
    return child ? childRunning(child) : true;
  }),

  owns: (reference, record) => Effect.sync(() => {
    if (runtime.platform === "linux") return ownership(reference, record, runtime) === "owned";
    const child = currentChild(reference, record);
    return child !== null && childRunning(child);
  }),

  stop: (reference, record, graceMs) =>
    Effect.gen(function* () {
      if (reference.kind !== "process") return;
      if (runtime.platform !== "linux") {
        const child = currentChild(reference, record);
        if (!child || !childRunning(child)) return;
        child.kill("SIGTERM");
        const deadline = Date.now() + graceMs;
        while (childRunning(child) && Date.now() < deadline) yield* Effect.sleep(STOP_POLL_MS);
        if (childRunning(child)) child.kill("SIGKILL");
        while (childRunning(child) && Date.now() < deadline + 1_000) yield* Effect.sleep(25); return;
      }
      if (reference.processGroupId === null) return;
      const term = yield* Effect.sync(() => {
        if (ownership(reference, record, runtime) !== "owned") return false;
        runtime.signalGroup(reference.processGroupId as number, "SIGTERM");
        return true;
      });
      if (!term) return;
      const deadline = Date.now() + graceMs;
      while (Date.now() < deadline) {
        const current = ownership(reference, record, runtime);
        if (current !== "owned") return;
        yield* Effect.sleep(STOP_POLL_MS);
      }
      yield* Effect.sync(() => {
        if (ownership(reference, record, runtime) === "owned") {
          runtime.signalGroup(reference.processGroupId as number, "SIGKILL");
        }
      });
    }),

  logTail: (reference: HandleReference, record: InstanceRecord) =>
    Effect.sync(() => readTailBytes(logPathFor(record.name), LOG_TAIL_BYTES)),
});
