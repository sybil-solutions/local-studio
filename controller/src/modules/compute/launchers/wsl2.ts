import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { posix, resolve } from "node:path";
import { Effect } from "effect";
import type { HandleReference, InstanceRecord } from "../contracts";
import { listRunningWslDistributions, runInWsl } from "../wsl-platform";
import { readLogTail, spawnFailed, type Launcher } from "./launcher";

const START_TIMEOUT_MS = 10_000;
const STOP_POLL_MS = 250;
const WRAPPER =
  'pid_file=$1; workdir=$2; nonce=$3; log_file=$4; binary_dir=$5; shift 5; if [ -n "$workdir" ]; then cd -- "$workdir" || exit 126; fi; if [ -n "$binary_dir" ]; then PATH="$binary_dir:$PATH"; export PATH; fi; start_token=$(/usr/bin/awk \'{print $22}\' /proc/$$/stat) || exit 126; /usr/bin/printf \'%s %s %s\\n\' "$$" "$start_token" "$nonce" > "$pid_file" || exit 126; exec >> "$log_file" 2>&1; exec "$@"';

interface WslIdentity {
  readonly pid: number;
  readonly startToken: string;
  readonly nonce: string;
}

export const isWindowsAbsolutePath = (value: string): boolean =>
  /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value);

export const buildWslLaunchArguments = (
  distribution: string,
  pidFile: string,
  workdir: string,
  nonce: string,
  logFile: string,
  argv: readonly string[],
  env: Readonly<Record<string, string>>,
): string[] => [
  "--distribution",
  distribution,
  "--exec",
  "/usr/bin/setsid",
  "--wait",
  "/bin/sh",
  "-c",
  WRAPPER,
  "local-studio",
  pidFile,
  workdir,
  nonce,
  logFile,
  argv[0]?.includes("/") ? posix.dirname(argv[0]) : "",
  "/usr/bin/env",
  ...Object.entries(env)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`),
  ...argv,
];

const parseIdentity = (value: string): WslIdentity | null => {
  const match = value.trim().match(/^(\d+)\s+(\S+)\s+(\S+)$/);
  if (!match) return null;
  const pid = Number(match[1]);
  const startToken = match[2] ?? "";
  const nonce = match[3] ?? "";
  return Number.isInteger(pid) && pid > 0 && startToken && nonce
    ? { pid, startToken, nonce }
    : null;
};

const includesDistribution = (names: readonly string[], distribution: string): boolean =>
  names.some((name) => name.toLowerCase() === distribution.toLowerCase());

const translateValue = (distribution: string, value: string): Effect.Effect<string, string> => {
  if (!isWindowsAbsolutePath(value)) return Effect.succeed(value);
  return runInWsl(distribution, ["/usr/bin/wslpath", "-a", "-u", value]).pipe(
    Effect.flatMap((result) =>
      result.status === 0 && result.stdout.trim()
        ? Effect.succeed(result.stdout.trim())
        : Effect.fail(result.stderr || `cannot translate Windows path ${value}`),
    ),
  );
};

const resolveLinuxBinary = (distribution: string, binary: string): Effect.Effect<string, string> =>
  runInWsl(distribution, [
    "/bin/sh",
    "-lc",
    'candidate=$1; case "$candidate" in "~/"*) candidate="$HOME/${candidate#??}";; esac; command -v -- "$candidate"',
    "local-studio",
    binary,
  ]).pipe(
    Effect.flatMap((result) =>
      result.status === 0 && result.stdout.trim()
        ? Effect.succeed(result.stdout.trim().split(/\r?\n/).at(-1) ?? binary)
        : Effect.fail(result.stderr || `${binary} is not installed in ${distribution}`),
    ),
  );

const awaitSpawn = (child: ChildProcess): Effect.Effect<number | null> =>
  Effect.callback((resume) => {
    let settled = false;
    const finish = (pid: number | null): void => {
      if (settled) return;
      settled = true;
      resume(Effect.succeed(pid));
    };
    child.once("error", () => finish(null));
    child.once("spawn", () => finish(child.pid ?? null));
  });

const readIdentity = (distribution: string, pidFile: string): Effect.Effect<WslIdentity | null> =>
  runInWsl(distribution, ["/bin/cat", pidFile]).pipe(
    Effect.map((result) => (result.status === 0 ? parseIdentity(result.stdout) : null)),
  );

const identityAlive = (
  reference: Extract<HandleReference, { kind: "wsl2" }>,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const running = yield* listRunningWslDistributions();
    if (!includesDistribution(running, reference.distribution)) return false;
    const result = yield* runInWsl(reference.distribution, [
      "/bin/sh",
      "-c",
      'test -r "/proc/$1/stat" || exit 1; current=$(/usr/bin/awk \'{print $22}\' "/proc/$1/stat") || exit 1; test "$current" = "$2"',
      "local-studio",
      String(reference.pid),
      reference.startToken,
    ]);
    return result.status === 0;
  });

const removePidFile = (distribution: string, pidFile: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const running = yield* listRunningWslDistributions();
    if (!includesDistribution(running, distribution)) return;
    yield* runInWsl(distribution, ["/bin/rm", "-f", pidFile]).pipe(Effect.ignore);
  });

const cleanupLaunch = (distribution: string, pidFile: string): Effect.Effect<void> =>
  removePidFile(distribution, pidFile);

export const makeWsl2Launcher = (logPathFor: (record: InstanceRecord) => string): Launcher => ({
  start: (plan, record) =>
    Effect.gen(function* () {
      const distribution = plan.wslDistribution?.trim();
      if (!distribution) return yield* spawnFailed("WSL2 launch requires a distribution");
      if (process.platform !== "win32") {
        return yield* spawnFailed("WSL2 launch is available only from a Windows controller");
      }
      const pidFile = `/tmp/local-studio-${record.nonce}.pid`;
      const translated = yield* Effect.all(
        plan.argv.map((value) => translateValue(distribution, value)),
      ).pipe(
        Effect.catch((detail) =>
          cleanupLaunch(distribution, pidFile).pipe(
            Effect.andThen(spawnFailed(detail)),
          ),
        ),
      );
      const [requestedBinary, ...args] = translated;
      if (!requestedBinary) {
        yield* cleanupLaunch(distribution, pidFile);
        return yield* spawnFailed("plan.argv is empty");
      }
      const binary = yield* resolveLinuxBinary(distribution, requestedBinary).pipe(
        Effect.catch((detail) =>
          cleanupLaunch(distribution, pidFile).pipe(
            Effect.andThen(spawnFailed(detail)),
          ),
        ),
      );
      const workdir = plan.workdir
        ? yield* translateValue(distribution, plan.workdir).pipe(
            Effect.catch((detail) =>
              cleanupLaunch(distribution, pidFile).pipe(
                Effect.andThen(spawnFailed(detail)),
              ),
            ),
          )
        : "";
      const translatedEnvironment = Object.fromEntries(
        yield* Effect.all(
          Object.entries(plan.env).map(([key, value]) =>
            translateValue(distribution, value).pipe(
              Effect.map((translatedValue) => [key, translatedValue] as const),
            ),
          ),
        ).pipe(
          Effect.catch((detail) =>
            cleanupLaunch(distribution, pidFile).pipe(
              Effect.andThen(spawnFailed(detail)),
            ),
          ),
        ),
      );
      const logPath = resolve(logPathFor(record));
      const logFile = yield* translateValue(distribution, logPath).pipe(
        Effect.catch((detail) =>
          cleanupLaunch(distribution, pidFile).pipe(
            Effect.andThen(spawnFailed(detail)),
          ),
        ),
      );
      const logDescriptor = yield* Effect.try({
        try: () => openSync(logPath, "w"),
        catch: (error) => String(error),
      }).pipe(
        Effect.catch((detail) =>
          cleanupLaunch(distribution, pidFile).pipe(
            Effect.andThen(spawnFailed(detail)),
          ),
        ),
      );
      closeSync(logDescriptor);
      let child: ChildProcess;
      try {
        child = spawn(
          "wsl.exe",
          buildWslLaunchArguments(
            distribution,
            pidFile,
            workdir,
            record.nonce,
            logFile,
            [binary, ...args],
            translatedEnvironment,
          ),
          {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          },
        );
      } catch (error) {
        yield* cleanupLaunch(distribution, pidFile);
        return yield* spawnFailed(String(error));
      }
      const spawnedPid = yield* awaitSpawn(child);
      if (!spawnedPid) {
        yield* cleanupLaunch(distribution, pidFile);
        return yield* spawnFailed("failed to spawn wsl.exe");
      }
      const deadline = Date.now() + START_TIMEOUT_MS;
      let identity: WslIdentity | null = null;
      while (!identity && Date.now() < deadline) {
        identity = yield* readIdentity(distribution, pidFile);
        if (!identity) yield* Effect.sleep(100);
      }
      if (!identity || identity.nonce !== record.nonce) {
        child.kill();
        yield* cleanupLaunch(distribution, pidFile);
        return yield* spawnFailed(`WSL2 process identity was not created in ${distribution}`);
      }
      child.unref();
      return {
        kind: "wsl2",
        distribution,
        pid: identity.pid,
        startToken: identity.startToken,
        pidFile,
        nonce: identity.nonce,
      } as const;
    }),

  alive: (reference) =>
    reference.kind === "wsl2" ? identityAlive(reference) : Effect.succeed(false),

  owns: (reference, record) =>
    Effect.succeed(reference.kind === "wsl2" && reference.nonce === record.nonce),

  stop: (reference, graceMs) =>
    reference.kind !== "wsl2"
      ? Effect.void
      : Effect.gen(function* () {
          if (yield* identityAlive(reference)) {
            yield* runInWsl(reference.distribution, [
              "/usr/bin/kill",
              "-TERM",
              "--",
              `-${reference.pid}`,
            ]).pipe(Effect.ignore);
            const deadline = Date.now() + graceMs;
            while ((yield* identityAlive(reference)) && Date.now() < deadline) {
              yield* Effect.sleep(STOP_POLL_MS);
            }
            if (yield* identityAlive(reference)) {
              yield* runInWsl(reference.distribution, [
                "/usr/bin/kill",
                "-KILL",
                "--",
                `-${reference.pid}`,
              ]).pipe(Effect.ignore);
            }
          }
          yield* cleanupLaunch(reference.distribution, reference.pidFile);
        }),

  logTail: (_reference, record) => Effect.sync(() => readLogTail(logPathFor(record))),
});
