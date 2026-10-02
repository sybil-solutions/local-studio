import type { ProviderDriverKind } from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Deferred from "effect/Deferred";
import type * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ProviderAdapterRequestError } from "../Errors.ts";

export type PiFrame = Readonly<Record<string, unknown>>;

export const asRecord = (value: unknown): PiFrame =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as PiFrame) : {};

export const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const STDERR_TAIL_CHARS = 2_000;

export interface PiRpc {
  readonly request: (
    command: PiFrame,
    timeoutMs?: number,
  ) => Effect.Effect<PiFrame, ProviderAdapterRequestError>;
  readonly write: (frame: PiFrame) => Effect.Effect<void>;
}

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
  let stderrTail = "";
  let sequence = 0;

  const requestError = (method: string, detail: string) =>
    new ProviderAdapterRequestError({ provider: input.provider, method, detail });

  const handleLine = (line: string) => {
    let frame: PiFrame;
    try {
      frame = asRecord(JSON.parse(line));
    } catch {
      return Effect.void;
    }
    const waiter = frame.type === "response" ? pending.get(String(frame.id)) : undefined;
    if (!waiter) return input.onFrame(frame);
    const method = asString(frame.command) ?? "rpc";
    return frame.success === false
      ? Deferred.fail(waiter, requestError(method, asString(frame.error) ?? "Command failed."))
      : Deferred.succeed(waiter, frame);
  };

  yield* child.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
      }),
    ),
    Effect.ignore,
    Effect.forkIn(scope),
  );

  yield* child.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach(handleLine),
    Effect.ignore,
    Effect.andThen(child.exitCode.pipe(Effect.orElseSucceed(() => -1))),
    Effect.flatMap((code) => {
      const reason = `${input.command} exited with code ${code}${
        stderrTail.trim() ? `: ${stderrTail.trim()}` : ""
      }`;
      const waiters = Array.from(pending.values());
      pending.clear();
      return Effect.forEach(
        waiters,
        (waiter) => Deferred.fail(waiter, requestError("rpc", reason)),
        {
          discard: true,
        },
      ).pipe(Effect.andThen(input.onExit(reason)));
    }),
    Effect.forkIn(scope),
  );

  yield* Effect.addFinalizer(() =>
    Queue.end(inbox).pipe(
      Effect.andThen(child.kill({ forceKillAfter: "1 second" })),
      Effect.ignore,
    ),
  );

  const write: PiRpc["write"] = (frame) =>
    Queue.offer(inbox, `${JSON.stringify(frame)}\n`).pipe(Effect.asVoid);

  const request: PiRpc["request"] = (command, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) =>
    Effect.gen(function* () {
      sequence += 1;
      const id = `t3-${sequence}`;
      const method = asString(command.type) ?? "rpc";
      const waiter = yield* Deferred.make<PiFrame, ProviderAdapterRequestError>();
      pending.set(id, waiter);
      yield* write({ ...command, id });
      const response = yield* Deferred.await(waiter).pipe(
        Effect.timeoutOption(Duration.millis(timeoutMs)),
        Effect.ensuring(Effect.sync(() => pending.delete(id))),
      );
      return yield* Option.match(response, {
        onNone: () => Effect.fail(requestError(method, `Timed out after ${timeoutMs}ms.`)),
        onSome: Effect.succeed,
      });
    });

  return { request, write } satisfies PiRpc;
});
