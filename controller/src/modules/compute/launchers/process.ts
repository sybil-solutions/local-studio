import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { Effect } from "effect";
import type { HandleReference, InstanceRecord, LaunchPlan } from "../contracts";
import { realProcessPlatform, type ProcessPlatform } from "../../../core/process-platform";
import { readLogTail, spawnFailed, type Launcher } from "./launcher";

/**
 * Detached-daemon launcher, exo-style: stdout+stderr straight into a log file, the whole
 * process *group* signalled on stop (vLLM forks an EngineCore that holds the VRAM — the
 * leader dying does not free the GPU), and ownership proven before any signal is sent.
 */

const STOP_POLL_MS = 250;

export const makeProcessLauncher = (
  logPathFor: (record: InstanceRecord) => string,
  processPlatform: ProcessPlatform = realProcessPlatform,
): Launcher => ({
  start: (plan: LaunchPlan, record: InstanceRecord) =>
    Effect.gen(function* () {
      const [binary, ...args] = plan.argv;
      if (!binary) return yield* spawnFailed("plan.argv is empty");
      const logFd = yield* Effect.try({
        try: () => openSync(logPathFor(record), "w"),
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          spawnFailed(`cannot open log file for ${record.name}: ${String(error)}`),
        ),
      );
      const child = spawn(binary, args, {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: { ...process.env, ...plan.env },
        ...(plan.workdir ? { cwd: plan.workdir } : {}),
      });
      const pid = yield* Effect.callback<number, never>((resume) => {
        child.on("error", () => resume(Effect.succeed(-1)));
        child.on("spawn", () => resume(Effect.succeed(child.pid ?? -1)));
      });
      closeSync(logFd);
      if (pid <= 0) return yield* spawnFailed(`failed to spawn ${binary}`);
      child.unref();
      return {
        kind: "process",
        pid,
        startToken: processPlatform.inspect(pid)?.startToken ?? null,
      } as const;
    }),

  alive: (reference: HandleReference) =>
    Effect.sync(() =>
      reference.kind === "process" ? processPlatform.alive(reference.pid) : false,
    ),

  owns: (reference: HandleReference, record: InstanceRecord) =>
    Effect.sync(() => {
      if (reference.kind !== "process") return false;
      if (!processPlatform.alive(reference.pid)) return false;
      const identity = processPlatform.inspect(reference.pid);
      if (!identity) return false;
      // Start token is decisive where the OS provides one.
      if (reference.startToken !== null) return identity.startToken === reference.startToken;
      // Elsewhere the pid's command line must still carry our unmistakable argument:
      // every plan passes `--port <port>`, and the port is unique per node. A recycled
      // pid belonging to something else will not be serving on our port.
      return identity.commandLine.includes(`--port ${record.port}`);
    }),

  stop: (reference: HandleReference, graceMs: number) =>
    Effect.gen(function* () {
      if (reference.kind !== "process") return;
      const { pid } = reference;
      // The group first: -pid reaches children even when the leader is already gone.
      processPlatform.terminateTree(pid, false);
      const deadline = Date.now() + graceMs;
      while (processPlatform.alive(pid) && Date.now() < deadline) {
        yield* Effect.sleep(STOP_POLL_MS);
      }
      processPlatform.terminateTree(pid, true);
    }),

  logTail: (reference: HandleReference, record: InstanceRecord) =>
    Effect.sync(() => readLogTail(logPathFor(record))),
});
