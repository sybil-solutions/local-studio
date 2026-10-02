import type { ProviderDriverKind } from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Deferred from "effect/Deferred";
import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ProviderAdapterRequestError } from "../Errors.ts";

export type PiFrame = Readonly<Record<string, unknown>>;

export const asRecord = (value: unknown): PiFrame =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as PiFrame) : {};

export const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export type PiRpc = Effect.Success<ReturnType<typeof spawnPiRpc>>;

export const spawnPiRpc = Effect.fn("spawnPiRpc")(function* (input: {
  readonly provider: ProviderDriverKind;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly onFrame: (frame: PiFrame) => Effect.Effect<void>;
  readonly onExit: (reason: string) => Effect.Effect<void>;
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const scope = yield* Effect.scope;
  const spawnCommand = yield* resolveSpawnCommand(input.command, input.args, { env: input.env });
  const inbox = yield* Queue.unbounded<string, Cause.Done>();
  const child = yield* spawner.spawn(
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      cwd: input.cwd,
      env: input.env,
      shell: spawnCommand.shell,
      stdin: { stream: Stream.fromQueue(inbox).pipe(Stream.encodeText) },
    }),
  );
  const pending = new Map<string, Deferred.Deferred<PiFrame, ProviderAdapterRequestError>>();
  const requestError = (method: string, detail: string) =>
    new ProviderAdapterRequestError({ provider: input.provider, method, detail });
  let stderrTail = "";
  let sequence = 0;

  const handleLine = (line: string) => {
    const frame = asRecord(JSON.parse(line));
    const waiter = frame.type === "response" ? pending.get(String(frame.id)) : undefined;
    if (!waiter) return input.onFrame(frame);
    return frame.success === false
      ? Deferred.fail(waiter, requestError(asString(frame.command) ?? "rpc", asString(frame.error) ?? "Command failed."))
      : Deferred.succeed(waiter, frame);
  };

  yield* child.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) => Effect.sync(() => (stderrTail = (stderrTail + chunk).slice(-2_000)))),
    Effect.ignore,
    Effect.forkIn(scope),
  );
  yield* child.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach((line) => Effect.suspend(() => handleLine(line)).pipe(Effect.catchDefect(() => Effect.void))),
    Effect.ignore,
    Effect.andThen(child.exitCode.pipe(Effect.orElseSucceed(() => -1))),
    Effect.flatMap((code) => {
      const reason = `${input.command} exited with code ${code}${stderrTail.trim() ? `: ${stderrTail.trim()}` : ""}`;
      const waiters = [...pending.values()];
      pending.clear();
      return Effect.forEach(waiters, (waiter) => Deferred.fail(waiter, requestError("rpc", reason)), {
        discard: true,
      }).pipe(Effect.andThen(input.onExit(reason)));
    }),
    Effect.forkIn(scope),
  );
  yield* Effect.addFinalizer(() =>
    Queue.end(inbox).pipe(Effect.andThen(child.kill({ forceKillAfter: "1 second" })), Effect.ignore),
  );

  const write = (frame: PiFrame) => Queue.offer(inbox, `${JSON.stringify(frame)}\n`).pipe(Effect.asVoid);
  const request = (command: PiFrame, timeoutMs = 30_000) =>
    Effect.gen(function* () {
      const id = `t3-${++sequence}`;
      const waiter = yield* Deferred.make<PiFrame, ProviderAdapterRequestError>();
      pending.set(id, waiter);
      yield* write({ ...command, id });
      return yield* Deferred.await(waiter).pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () => Effect.fail(requestError(asString(command.type) ?? "rpc", `Timed out after ${timeoutMs}ms.`)),
        }),
        Effect.ensuring(Effect.sync(() => pending.delete(id))),
      );
    });
  return { request, write };
});
