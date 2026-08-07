import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { closeSync, createReadStream, fstatSync, ftruncateSync, writeSync } from "node:fs";
import { Readable, type Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Effect, Schema, Stream } from "effect";
import { LogProxyReadySchema, type LogProxyReady } from "@local-studio/contracts/log-proxy";
import { openPrivateLogFile } from "./log-files";
import { redactLogLine } from "./log-redaction";

const maximumPendingCharacters = 64 * 1024;
const maximumProtocolBytes = 1024;
const maximumPersistedLogBytes = 10 * 1024 * 1024;
const protocolTimeoutMs = 10_000;
const forwardStreamsMode = "--forward-streams";
const spawnCommandMode = "--spawn-command";
type RedactionState = { readonly pending: string; readonly dropping: boolean };
type VoidEffect = Effect.Effect<void>;

export const logProxyModuleUrl = import.meta.url;

const childExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

const waitForChildSpawn = (child: ChildProcess): Effect.Effect<void, Error> =>
  Effect.callback<void, Error>((resume) => {
    if (child.pid) {
      resume(Effect.void);
      return;
    }
    const cleanup = (): void => {
      child.off("spawn", onSpawn);
      child.off("error", onError);
    };
    const onSpawn = (): void => {
      cleanup();
      resume(Effect.void);
    };
    const onError = (error: Error): void => {
      cleanup();
      resume(Effect.fail(error));
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
    return Effect.sync(cleanup);
  });

const waitForChild = (child: ChildProcess): Effect.Effect<void> =>
  Effect.callback<void, never>((resume) => {
    if (childExited(child)) {
      resume(Effect.void);
      return;
    }
    const complete = (): void => {
      child.off("close", complete);
      resume(Effect.void);
    };
    child.once("close", complete);
    return Effect.sync(() => child.off("close", complete));
  });

export const readLogProxyProtocolLine = (readable: Readable): Effect.Effect<string, Error> =>
  Effect.callback<string, Error>((resume) => {
    let buffered = Buffer.alloc(0);
    let complete = false;
    const cleanup = (): void => {
      readable.off("data", onData);
      readable.off("end", onEnd);
      readable.off("error", onError);
    };
    const finish = (effect: Effect.Effect<string, Error>): void => {
      if (complete) return;
      complete = true;
      cleanup();
      resume(effect);
    };
    const onData = (value: Buffer | string): void => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const newline = chunk.indexOf(10);
      const segment = newline < 0 ? chunk : chunk.subarray(0, newline);
      if (buffered.length + segment.length > maximumProtocolBytes) {
        finish(Effect.fail(new Error("Log proxy protocol frame is too large")));
        return;
      }
      buffered = Buffer.concat([buffered, segment], buffered.length + segment.length);
      if (newline < 0) return;
      if (chunk.subarray(newline + 1).some((byte) => byte !== 13 && byte !== 10)) {
        finish(Effect.fail(new Error("Log proxy emitted trailing protocol data")));
        return;
      }
      const line = buffered.at(-1) === 13 ? buffered.subarray(0, -1) : buffered;
      finish(Effect.succeed(line.toString("utf8")));
    };
    const onEnd = (): void => finish(Effect.fail(new Error("Log proxy protocol ended early")));
    const onError = (error: Error): void => finish(Effect.fail(error));
    readable.on("data", onData);
    readable.once("end", onEnd);
    readable.once("error", onError);
    return Effect.sync(cleanup);
  }).pipe(
    Effect.timeoutOrElse({
      duration: protocolTimeoutMs,
      orElse: () => Effect.fail(new Error("Log proxy protocol timed out")),
    }),
  );

const decodeOutput = (readable: Readable): Stream.Stream<string> =>
  Stream.fromReadableStream({
    evaluate: () => Readable.toWeb(readable) as unknown as ReadableStream<Uint8Array>,
    onError: (cause) => cause,
  }).pipe(
    Stream.decodeText,
    Stream.catchCause(() => Stream.empty),
  );

const redactStream = (outputStream: Readable): Stream.Stream<string> =>
  decodeOutput(outputStream).pipe(
    Stream.mapAccum(
      (): RedactionState => ({ pending: "", dropping: false }),
      (state, chunk) => {
        let output = "";
        let value = chunk;
        if (state.dropping) {
          const newline = value.indexOf("\n");
          if (newline < 0) return [state, []] as const;
          output = "\n";
          value = value.slice(newline + 1);
        }
        const combined = `${state.pending}${value}`;
        const newline = combined.lastIndexOf("\n");
        const complete = newline < 0 ? "" : combined.slice(0, newline + 1);
        const pending = newline < 0 ? combined : combined.slice(newline + 1);
        output += redactLogLine(complete);
        if (pending.length > maximumPendingCharacters) {
          return [{ pending: "", dropping: true }, [output, "[redacted]"]] as const;
        }
        return [{ pending, dropping: false }, output ? [output] : []] as const;
      },
      {
        onHalt: (state) => (state.pending && !state.dropping ? [redactLogLine(state.pending)] : []),
      },
    ),
  );

export const writeBoundedLogOutput = (
  descriptor: number,
  output: string,
  maximumBytes = maximumPersistedLogBytes,
): void => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error("Maximum persisted log bytes must be a positive safe integer");
  }
  const encoded = Buffer.from(output);
  const bounded =
    encoded.length <= maximumBytes ? encoded : encoded.subarray(encoded.length - maximumBytes);
  if (fstatSync(descriptor).size + bounded.length > maximumBytes) ftruncateSync(descriptor, 0);
  writeSync(descriptor, bounded);
};

const redactOutput = (outputStream: Readable, descriptor: number): VoidEffect =>
  redactStream(outputStream).pipe(
    Stream.runForEach((output) =>
      Effect.sync(() => {
        try {
          writeBoundedLogOutput(descriptor, output);
        } catch {}
      }),
    ),
  );

const writeReady = (): Effect.Effect<void, Error> =>
  Effect.try({
    try: () => {
      const frame: LogProxyReady = { type: "ready", pid: process.pid };
      writeSync(3, `${JSON.stringify(frame)}\n`);
      closeSync(3);
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error("Log proxy protocol failed")),
  });

const runForwardProxy = (descriptor: number): Effect.Effect<void, unknown> => {
  const stdout = createReadStream("", { fd: 4, autoClose: false });
  const stderr = createReadStream("", { fd: 5, autoClose: false });
  return Effect.all(
    [writeReady(), redactOutput(stdout, descriptor), redactOutput(stderr, descriptor)],
    { concurrency: "unbounded", discard: true },
  );
};

const runCommandProxy = (
  descriptor: number,
  binary: string,
  args: readonly string[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const child = yield* Effect.try({
      try: () => spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] }),
      catch: (cause) => cause,
    });
    yield* waitForChildSpawn(child);
    if (!child.stdout || !child.stderr) {
      return yield* Effect.fail(new Error("Redacted command streams are unavailable"));
    }
    yield* writeReady();
    yield* Effect.all(
      [
        redactOutput(child.stdout, descriptor),
        redactOutput(child.stderr, descriptor),
        waitForChild(child),
      ],
      { concurrency: "unbounded", discard: true },
    );
  });

const runLogProxy = (): Effect.Effect<void, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const mode = process.argv[2];
      const path = process.argv[3];
      if (!mode || !path) return yield* Effect.fail(new Error("Missing log proxy arguments"));
      const descriptor = yield* Effect.acquireRelease(
        Effect.try({
          try: () => openPrivateLogFile(path),
          catch: (cause) => cause,
        }),
        (openDescriptor) => Effect.sync(() => closeSync(openDescriptor)),
      );
      if (mode === forwardStreamsMode) return yield* runForwardProxy(descriptor);
      const binary = process.argv[4];
      if (mode !== spawnCommandMode || !binary) {
        return yield* Effect.fail(new Error("Invalid log proxy mode"));
      }
      yield* runCommandProxy(descriptor, binary, process.argv.slice(5));
    }),
  );

const startProxy = (
  args: readonly string[],
  stdio: StdioOptions,
): Effect.Effect<ChildProcess, Error> =>
  Effect.gen(function* () {
    const child = yield* Effect.try({
      try: (): ChildProcess =>
        spawn(process.execPath, [fileURLToPath(logProxyModuleUrl), ...args], {
          detached: true,
          stdio: stdio as StdioOptions,
        }),
      catch: (cause) => (cause instanceof Error ? cause : new Error("Log proxy spawn failed")),
    });
    return yield* Effect.gen(function* () {
      yield* waitForChildSpawn(child);
      const protocol = child.stdio[3];
      if (!child.pid || !(protocol instanceof Readable)) {
        return yield* Effect.fail(new Error("Log proxy did not expose its protocol"));
      }
      const line = yield* readLogProxyProtocolLine(protocol);
      const frame = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(LogProxyReadySchema))(
        line,
      );
      if (frame.pid !== child.pid) {
        return yield* Effect.fail(new Error("Log proxy identity did not match"));
      }
      closeParentPipe(protocol);
      child.unref();
      return child;
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          if (!childExited(child)) child.kill("SIGKILL");
        }),
      ),
    );
  }).pipe(
    Effect.mapError((cause) => (cause instanceof Error ? cause : new Error("Log proxy failed"))),
  );

const closeParentPipe = (stream: Readable | Writable | null | undefined): void => {
  const handle = (
    stream as (Readable | Writable) & { readonly _handle?: { readonly close?: () => void } }
  )?._handle;
  handle?.close?.();
  stream?.destroy();
};

const parentPipeDescriptor = (stream: Writable | null | undefined): number | null => {
  const candidate = (stream as Writable & { readonly _handle?: { readonly fd?: unknown } })?._handle
    ?.fd;
  return Number.isSafeInteger(candidate) && Number(candidate) >= 0 ? Number(candidate) : null;
};

export const startRedactedStreamProxy = (
  path: string,
): Effect.Effect<
  {
    readonly child: ChildProcess;
    readonly stdoutDescriptor: number;
    readonly stderrDescriptor: number;
    readonly unref: () => void;
    readonly finish: () => void;
  },
  Error
> =>
  Effect.gen(function* () {
    const child = yield* startProxy(
      [forwardStreamsMode, path],
      ["ignore", "ignore", "ignore", "pipe", "pipe", "pipe"],
    );
    const streams = child.stdio as Array<Readable | Writable | null | undefined>;
    const stdout = streams[4] as Writable | null | undefined;
    const stderr = streams[5] as Writable | null | undefined;
    const stdoutDescriptor = parentPipeDescriptor(stdout);
    const stderrDescriptor = parentPipeDescriptor(stderr);
    if (stdoutDescriptor === null || stderrDescriptor === null) {
      closeParentPipe(stdout);
      closeParentPipe(stderr);
      child.kill("SIGKILL");
      return yield* Effect.fail(new Error("Log proxy pipes are unavailable"));
    }
    let finished = false;
    return {
      child,
      stdoutDescriptor,
      stderrDescriptor,
      unref: (): void => {
        (stdout as Writable & { readonly unref?: () => void }).unref?.();
        (stderr as Writable & { readonly unref?: () => void }).unref?.();
      },
      finish: (): void => {
        if (finished) return;
        finished = true;
        stdout?.end(() => closeParentPipe(stdout));
        stderr?.end(() => closeParentPipe(stderr));
      },
    };
  });

export const startRedactedCommandProxy = (
  path: string,
  binary: string,
  args: readonly string[],
): Effect.Effect<ChildProcess, Error> =>
  startProxy([spawnCommandMode, path, binary, ...args], ["ignore", "ignore", "ignore", "pipe"]);

if (import.meta.main) {
  void Effect.runPromise(runLogProxy()).catch(() => (process.exitCode = 1));
}
