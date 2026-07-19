import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, rmSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { Deferred, Effect, Schema, Semaphore } from "effect";
import {
  CHATTERBOX_BACKEND,
  CHATTERBOX_MODEL_REVISION,
  CHATTERBOX_PACKAGE_VERSION,
} from "@local-studio/contracts/speech";
import {
  chatterboxRuntimePaths,
  chatterboxWorkerEnvironment,
  type ChatterboxRuntimePaths,
} from "./runtime";
import { prepareChatterboxStorage } from "./storage";

const MAX_TEXT_CHARACTERS = 4096;
const MAX_PROTOCOL_LINE_BYTES = 64 * 1024;
const DEFAULT_STARTUP_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_SYNTHESIS_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 2_000;
const DEFAULT_SHUTDOWN_KILL_TIMEOUT_MS = 5_000;
const MAX_PENDING_PROTOCOL_LINES = 8;
const MAX_PENDING_STDERR_LINES = 16;
const MAX_STDERR_LINE_BYTES = 4 * 1024;
const MAX_WORKER_STDERR_BYTES = 64 * 1024;

const SynthesizeRequestSchema = Schema.Struct({
  type: Schema.Literal("synthesize"),
  id: Schema.String,
  text: Schema.String,
  voice_path: Schema.String,
  output_path: Schema.String,
});

const ShutdownRequestSchema = Schema.Struct({
  type: Schema.Literal("shutdown"),
  id: Schema.String,
});

export const SpeechWorkerRequestSchema = Schema.Union([
  SynthesizeRequestSchema,
  ShutdownRequestSchema,
]);

const ReadyResponseSchema = Schema.Struct({
  type: Schema.Literal("ready"),
  backend: Schema.Literal(CHATTERBOX_BACKEND),
  package_version: Schema.Literal(CHATTERBOX_PACKAGE_VERSION),
  model_revision: Schema.Literal(CHATTERBOX_MODEL_REVISION),
  cuda_devices: Schema.Literal(1),
  sample_rate: Schema.Number,
});

const SynthesizeResponseSchema = Schema.Struct({
  type: Schema.Literal("synthesize"),
  id: Schema.String,
  output_path: Schema.String,
  sample_rate: Schema.Number,
});

const ShutdownResponseSchema = Schema.Struct({
  type: Schema.Literal("shutdown"),
  id: Schema.String,
});

const ErrorResponseSchema = Schema.Struct({
  type: Schema.Literal("error"),
  id: Schema.NullOr(Schema.String),
  message: Schema.String,
});

export const SpeechWorkerResponseSchema = Schema.Union([
  ReadyResponseSchema,
  SynthesizeResponseSchema,
  ShutdownResponseSchema,
  ErrorResponseSchema,
]);

export type SpeechWorkerRequest = typeof SpeechWorkerRequestSchema.Type;
export type SpeechWorkerResponse = typeof SpeechWorkerResponseSchema.Type;
type ReadyResponse = typeof ReadyResponseSchema.Type;

export type SpeechWorkerSpawnOptions = {
  readonly command: string;
  readonly args: string[];
  readonly env: NodeJS.ProcessEnv;
};

export interface SpeechWorkerTransport {
  write(line: string): void;
  closeInput(): void;
  kill(): void;
  onLine(listener: (line: string) => void): () => void;
  onStderr(listener: (line: string) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void;
}

export type SpeechWorkerSpawner = (options: SpeechWorkerSpawnOptions) => SpeechWorkerTransport;

export type ChatterboxWorkerClientOptions = {
  readonly dataDirectory: string;
  readonly gpuUuid: string;
  readonly workerPath?: string | undefined;
  readonly voiceDirectory?: string | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
  readonly spawnWorker?: SpeechWorkerSpawner | undefined;
  readonly randomId?: (() => string) | undefined;
  readonly startupTimeoutMs?: number | undefined;
  readonly synthesisTimeoutMs?: number | undefined;
  readonly shutdownGraceMs?: number | undefined;
  readonly shutdownKillTimeoutMs?: number | undefined;
  readonly onStderr?: ((line: string) => void) | undefined;
};

export type ChatterboxSynthesisInput = {
  readonly text: string;
  readonly voicePath: string;
};

export type ChatterboxSynthesisResult = {
  readonly path: string;
  readonly sampleRate: number;
};

export class SpeechWorkerError extends Error {
  constructor(
    readonly code: "input" | "spawn" | "protocol" | "timeout" | "worker",
    message: string,
  ) {
    super(message);
    this.name = "SpeechWorkerError";
  }
}

type PendingResponse = {
  readonly id: string;
  readonly deferred: Deferred.Deferred<SpeechWorkerResponse, SpeechWorkerError>;
};

type WorkerSession = {
  readonly transport: SpeechWorkerTransport;
  readonly ready: Deferred.Deferred<ReadyResponse, SpeechWorkerError>;
  readonly exited: Deferred.Deferred<void>;
  readonly unsubscribe: Array<() => void>;
  pending: PendingResponse | null;
  readySeen: boolean;
  closed: boolean;
};

const removeListener =
  <A>(listeners: Set<A>, listener: A): (() => void) =>
  () => {
    listeners.delete(listener);
  };

const boundedLineDecoder = (
  maximumBytes: number,
  onLine: (line: string) => void,
  onOversize: () => void,
): ((chunk: Buffer) => void) => {
  let buffered = Buffer.alloc(0);
  let oversized = false;
  return (chunk): void => {
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline === -1 ? chunk.length : newline;
      const segment = chunk.subarray(offset, end);
      if (!oversized && buffered.length + segment.length <= maximumBytes) {
        buffered =
          buffered.length === 0
            ? Buffer.from(segment)
            : Buffer.concat([buffered, segment], buffered.length + segment.length);
      } else if (!oversized) {
        buffered = Buffer.alloc(0);
        oversized = true;
        onOversize();
      }
      if (newline === -1) return;
      if (!oversized) {
        const line = buffered.at(-1) === 13 ? buffered.subarray(0, -1) : buffered;
        onLine(line.toString("utf8"));
      }
      buffered = Buffer.alloc(0);
      oversized = false;
      offset = newline + 1;
    }
  };
};

export const spawnNodeSpeechWorker: SpeechWorkerSpawner = ({ command, args, env }) => {
  const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
  const lines = new Set<(line: string) => void>();
  const stderrLines = new Set<(line: string) => void>();
  const errors = new Set<(error: Error) => void>();
  const exits = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
  const pendingLines: string[] = [];
  const pendingStderr: string[] = [];
  let stderrBytes = 0;
  let stderrTruncated = false;
  let terminalError: Error | null = null;
  let terminalExit: readonly [number | null, NodeJS.Signals | null] | null = null;

  const emitLine = (line: string): void => {
    if (lines.size > 0) lines.forEach((listener) => listener(line));
    else if (pendingLines.length < MAX_PENDING_PROTOCOL_LINES) pendingLines.push(line);
    else failTransport(new Error("Speech worker emitted too many queued frames"));
  };
  const dispatchStderr = (line: string): void => {
    if (stderrLines.size > 0) stderrLines.forEach((listener) => listener(line));
    else {
      pendingStderr.push(line);
      if (pendingStderr.length > MAX_PENDING_STDERR_LINES) pendingStderr.shift();
    }
  };
  const truncateStderr = (): void => {
    if (stderrTruncated) return;
    stderrTruncated = true;
    dispatchStderr("Speech worker stderr truncated");
  };
  const emitStderr = (line: string): void => {
    if (stderrTruncated) return;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (stderrBytes + lineBytes > MAX_WORKER_STDERR_BYTES) {
      truncateStderr();
      return;
    }
    stderrBytes += lineBytes;
    dispatchStderr(line);
  };
  const failTransport = (error: Error): void => {
    if (terminalError) return;
    terminalError = error;
    errors.forEach((listener) => listener(error));
    child.kill("SIGKILL");
  };
  child.stdout.on(
    "data",
    boundedLineDecoder(MAX_PROTOCOL_LINE_BYTES, emitLine, () =>
      failTransport(new Error("Speech worker emitted an oversized frame")),
    ),
  );
  child.stderr.on("data", boundedLineDecoder(MAX_STDERR_LINE_BYTES, emitStderr, truncateStderr));
  child.on("error", (error) => {
    failTransport(error);
  });
  child.on("exit", (code, signal) => {
    terminalExit = [code, signal];
    exits.forEach((listener) => listener(code, signal));
  });

  return {
    write: (line): void => {
      if (!child.stdin.write(line)) child.stdin.once("drain", (): void => {});
    },
    closeInput: (): void => {
      child.stdin.end();
    },
    kill: (): void => {
      child.kill("SIGKILL");
    },
    onLine: (listener): (() => void) => {
      lines.add(listener);
      pendingLines.splice(0).forEach(listener);
      return removeListener(lines, listener);
    },
    onStderr: (listener): (() => void) => {
      stderrLines.add(listener);
      pendingStderr.splice(0).forEach(listener);
      return removeListener(stderrLines, listener);
    },
    onError: (listener): (() => void) => {
      errors.add(listener);
      if (terminalError) listener(terminalError);
      return removeListener(errors, listener);
    },
    onExit: (listener): (() => void) => {
      exits.add(listener);
      if (terminalExit) listener(...terminalExit);
      return removeListener(exits, listener);
    },
  };
};

const validGpuUuid = (gpuUuid: string): boolean =>
  /^GPU-[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$/.test(gpuUuid);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const completeSuccess = <A, E>(deferred: Deferred.Deferred<A, E>, value: A): void => {
  Deferred.doneUnsafe(deferred, Effect.succeed(value));
};

const completeFailure = <A, E>(deferred: Deferred.Deferred<A, E>, error: E): void => {
  Deferred.doneUnsafe(deferred, Effect.fail(error));
};

const controlledVoicePath = (voiceDirectory: string, candidate: string): string => {
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    throw new SpeechWorkerError("input", "The voice reference is unavailable");
  }
  const root = realpathSync(voiceDirectory);
  const path = realpathSync(candidate);
  const childPath = relative(root, path);
  if (!childPath || childPath.startsWith("..") || isAbsolute(childPath)) {
    throw new SpeechWorkerError("input", "The voice reference is outside managed speech storage");
  }
  return path;
};

const validatedText = (text: string): string => {
  if (!text.trim()) throw new SpeechWorkerError("input", "Speech text is required");
  if (Array.from(text).length > MAX_TEXT_CHARACTERS) {
    throw new SpeechWorkerError(
      "input",
      `Speech text cannot exceed ${MAX_TEXT_CHARACTERS} characters`,
    );
  }
  return text;
};

const protocolLine = (request: SpeechWorkerRequest): string => {
  const validated = Schema.decodeUnknownSync(SpeechWorkerRequestSchema)(request);
  return `${JSON.stringify(validated)}\n`;
};

const decodeResponse = (line: string): SpeechWorkerResponse => {
  if (!line || Buffer.byteLength(line, "utf8") > MAX_PROTOCOL_LINE_BYTES) {
    throw new SpeechWorkerError("protocol", "The speech worker returned an invalid frame");
  }
  try {
    return Schema.decodeUnknownSync(SpeechWorkerResponseSchema)(JSON.parse(line));
  } catch {
    throw new SpeechWorkerError("protocol", "The speech worker returned an invalid frame");
  }
};

export class ChatterboxWorkerClient {
  readonly paths: ChatterboxRuntimePaths;
  private readonly gpuUuid: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly spawnWorker: SpeechWorkerSpawner;
  private readonly randomId: () => string;
  private readonly startupTimeoutMs: number;
  private readonly synthesisTimeoutMs: number;
  private readonly shutdownGraceMs: number;
  private readonly shutdownKillTimeoutMs: number;
  private readonly onStderr: (line: string) => void;
  private readonly voiceDirectory: string;
  private readonly semaphore = Semaphore.makeUnsafe(1);
  private session: WorkerSession | null = null;
  private terminatingSession: WorkerSession | null = null;

  constructor(options: ChatterboxWorkerClientOptions) {
    if (!validGpuUuid(options.gpuUuid)) {
      throw new SpeechWorkerError("input", "A full NVIDIA GPU UUID is required");
    }
    this.paths = chatterboxRuntimePaths(options.dataDirectory, options.workerPath);
    this.gpuUuid = options.gpuUuid;
    this.environment = options.environment ?? process.env;
    this.spawnWorker = options.spawnWorker ?? spawnNodeSpeechWorker;
    this.randomId = options.randomId ?? randomUUID;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.synthesisTimeoutMs = options.synthesisTimeoutMs ?? DEFAULT_SYNTHESIS_TIMEOUT_MS;
    this.shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
    this.shutdownKillTimeoutMs = options.shutdownKillTimeoutMs ?? DEFAULT_SHUTDOWN_KILL_TIMEOUT_MS;
    this.onStderr = options.onStderr ?? ((): void => {});
    this.voiceDirectory = options.voiceDirectory ?? this.paths.voiceDirectory;
    prepareChatterboxStorage({ ...this.paths, voiceDirectory: this.voiceDirectory });
  }

  synthesizeEffect(
    input: ChatterboxSynthesisInput,
  ): Effect.Effect<ChatterboxSynthesisResult, SpeechWorkerError> {
    return this.semaphore.withPermit(
      Effect.suspend(() => {
        const id = this.randomId();
        if (!/^[A-Za-z0-9-]+$/.test(id)) {
          return Effect.fail(new SpeechWorkerError("input", "Could not allocate speech output"));
        }
        return Effect.try({
          try: () => ({
            id,
            text: validatedText(input.text),
            voicePath: controlledVoicePath(this.voiceDirectory, input.voicePath),
            outputPath: join(realpathSync(this.paths.outputDirectory), `${id}.wav`),
          }),
          catch: (error) =>
            error instanceof SpeechWorkerError
              ? error
              : new SpeechWorkerError("input", errorMessage(error)),
        }).pipe(
          Effect.flatMap((request) => this.synthesizeRequestEffect(request)),
          Effect.tapError(() =>
            Effect.sync(() =>
              rmSync(join(resolve(this.paths.outputDirectory), `${id}.wav`), { force: true }),
            ),
          ),
        );
      }),
    );
  }

  synthesize(
    input: ChatterboxSynthesisInput,
  ): Effect.Effect<ChatterboxSynthesisResult, SpeechWorkerError> {
    return this.synthesizeEffect(input);
  }

  shutdownEffect(): Effect.Effect<void, SpeechWorkerError> {
    const client = this;
    let activeSession: WorkerSession | null = null;
    const shutdown = Effect.gen(function* () {
      const session = client.session;
      activeSession = session ?? client.terminatingSession;
      if (!session || session.closed) {
        yield* client.settleTerminationEffect();
        return;
      }
      const id = client.randomId();
      const response = yield* client
        .sendRequestEffect(session, { type: "shutdown", id }, 10_000)
        .pipe(
          Effect.catch((error) =>
            client.settleTerminationEffect().pipe(Effect.andThen(Effect.fail(error))),
          ),
        );
      if (response.type !== "shutdown" || response.id !== id) {
        const error = new SpeechWorkerError("protocol", "Invalid shutdown response");
        client.failSession(session, error, true);
        yield* client.settleTerminationEffect();
        return yield* Effect.fail(error);
      }
      client.closeSession(session, true);
      const closeFailure = yield* Effect.match(
        Effect.try({
          try: () => session.transport.closeInput(),
          catch: (error) =>
            new SpeechWorkerError("worker", `Could not stop speech worker: ${errorMessage(error)}`),
        }),
        {
          onFailure: (error): SpeechWorkerError => {
            session.transport.kill();
            return error;
          },
          onSuccess: (): null => null,
        },
      );
      if (!closeFailure) {
        const graceful = yield* Deferred.await(session.exited).pipe(
          Effect.as(true),
          Effect.timeoutOrElse({
            duration: client.shutdownGraceMs,
            orElse: () => Effect.succeed(false),
          }),
        );
        if (!graceful) session.transport.kill();
      }
      yield* client.settleTerminationEffect();
      if (closeFailure) return yield* Effect.fail(closeFailure);
    }).pipe(
      Effect.onInterrupt(() =>
        activeSession ? client.interruptSessionEffect(activeSession) : Effect.void,
      ),
    );
    return this.semaphore.withPermit(shutdown);
  }

  settleTerminationEffect(): Effect.Effect<void, SpeechWorkerError> {
    const session = this.terminatingSession;
    if (!session) return Effect.void;
    return Deferred.await(session.exited).pipe(
      Effect.timeoutOrElse({
        duration: this.shutdownKillTimeoutMs,
        orElse: () =>
          Effect.sync(() => session.transport.kill()).pipe(
            Effect.andThen(
              Effect.fail(
                new SpeechWorkerError("timeout", "Speech worker did not exit after kill"),
              ),
            ),
          ),
      }),
      Effect.tap(() =>
        Effect.sync(() => {
          if (this.terminatingSession === session) this.terminatingSession = null;
          this.cleanupSession(session);
        }),
      ),
      Effect.onInterrupt(() => this.interruptSessionEffect(session)),
    );
  }

  settleTermination(): Effect.Effect<void, SpeechWorkerError> {
    return this.settleTerminationEffect();
  }

  terminateEffect(): Effect.Effect<void, SpeechWorkerError> {
    const session = this.session ?? this.terminatingSession;
    return session ? this.interruptSessionEffect(session) : Effect.void;
  }

  terminate(): Effect.Effect<void, SpeechWorkerError> {
    return this.terminateEffect();
  }

  shutdown(): Effect.Effect<void, SpeechWorkerError> {
    return this.shutdownEffect();
  }

  private synthesizeRequestEffect(request: {
    readonly id: string;
    readonly text: string;
    readonly voicePath: string;
    readonly outputPath: string;
  }): Effect.Effect<ChatterboxSynthesisResult, SpeechWorkerError> {
    const client = this;
    let activeSession: WorkerSession | null = null;
    return Effect.gen(function* () {
      const session = yield* client.readySessionEffect();
      activeSession = session;
      const response = yield* client.sendRequestEffect(
        session,
        {
          type: "synthesize",
          id: request.id,
          text: request.text,
          voice_path: request.voicePath,
          output_path: request.outputPath,
        },
        client.synthesisTimeoutMs,
      );
      if (
        response.type !== "synthesize" ||
        response.id !== request.id ||
        resolve(response.output_path) !== resolve(request.outputPath)
      ) {
        return yield* Effect.fail(new SpeechWorkerError("protocol", "Invalid synthesis response"));
      }
      return { path: request.outputPath, sampleRate: response.sample_rate };
    }).pipe(
      Effect.onInterrupt(() =>
        activeSession ? client.interruptSessionEffect(activeSession) : Effect.void,
      ),
    );
  }

  private readySessionEffect(): Effect.Effect<WorkerSession, SpeechWorkerError> {
    const client = this;
    return Effect.gen(function* () {
      yield* client.settleTerminationEffect();
      const session =
        client.session && !client.session.closed ? client.session : yield* client.spawnEffect();
      yield* client.awaitWithTimeout(
        session,
        Deferred.await(session.ready),
        client.startupTimeoutMs,
        "Speech worker startup timed out",
      );
      return session;
    });
  }

  private spawnEffect(): Effect.Effect<WorkerSession, SpeechWorkerError> {
    return Effect.try({
      try: () => {
        const transport = this.spawnWorker({
          command: this.paths.pythonPath,
          args: ["-u", this.paths.workerPath],
          env: chatterboxWorkerEnvironment(this.paths, this.gpuUuid, this.environment),
        });
        const session: WorkerSession = {
          transport,
          ready: Deferred.makeUnsafe<ReadyResponse, SpeechWorkerError>(),
          exited: Deferred.makeUnsafe<void>(),
          unsubscribe: [],
          pending: null,
          readySeen: false,
          closed: false,
        };
        this.session = session;
        session.unsubscribe.push(
          transport.onLine((line) => this.receiveLine(session, line)),
          transport.onStderr(this.onStderr),
          transport.onError((error) =>
            this.failSession(session, new SpeechWorkerError("worker", error.message), true),
          ),
          transport.onExit((code, signal) => this.workerExited(session, code, signal)),
        );
        return session;
      },
      catch: (error) =>
        new SpeechWorkerError("spawn", `Could not start speech worker: ${errorMessage(error)}`),
    });
  }

  private sendRequestEffect(
    session: WorkerSession,
    request: SpeechWorkerRequest,
    timeoutMs: number,
  ): Effect.Effect<SpeechWorkerResponse, SpeechWorkerError> {
    if (session.pending) {
      return Effect.fail(new SpeechWorkerError("worker", "Speech worker is already busy"));
    }
    const deferred = Deferred.makeUnsafe<SpeechWorkerResponse, SpeechWorkerError>();
    session.pending = { id: request.id, deferred };
    return Effect.try({
      try: () => session.transport.write(protocolLine(request)),
      catch: (error) => {
        const failure = new SpeechWorkerError(
          "worker",
          `Could not write to speech worker: ${errorMessage(error)}`,
        );
        this.failSession(session, failure, true);
        return failure;
      },
    }).pipe(
      Effect.andThen(
        this.awaitWithTimeout(
          session,
          Deferred.await(deferred),
          timeoutMs,
          "Speech synthesis timed out",
        ),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (session.pending?.id === request.id) session.pending = null;
        }),
      ),
    );
  }

  private awaitWithTimeout<A>(
    session: WorkerSession,
    effect: Effect.Effect<A, SpeechWorkerError>,
    timeoutMs: number,
    message: string,
  ): Effect.Effect<A, SpeechWorkerError> {
    return effect.pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () => {
          const error = new SpeechWorkerError("timeout", message);
          return Effect.sync(() => this.failSession(session, error, true)).pipe(
            Effect.andThen(Effect.fail(error)),
          );
        },
      }),
      Effect.onInterrupt(() => this.interruptSessionEffect(session)),
    );
  }

  private interruptSessionEffect(session: WorkerSession): Effect.Effect<void, SpeechWorkerError> {
    return Effect.sync(() => {
      const error = new SpeechWorkerError("worker", "Speech operation was interrupted");
      if (session.closed) session.transport.kill();
      else this.failSession(session, error, true);
    }).pipe(
      Effect.andThen(Deferred.await(session.exited)),
      Effect.timeoutOrElse({
        duration: this.shutdownKillTimeoutMs,
        orElse: () =>
          Effect.sync(() => session.transport.kill()).pipe(
            Effect.andThen(
              Effect.fail(
                new SpeechWorkerError("timeout", "Speech worker did not exit after termination"),
              ),
            ),
          ),
      }),
      Effect.tap(() =>
        Effect.sync(() => {
          if (this.terminatingSession === session) this.terminatingSession = null;
          this.cleanupSession(session);
        }),
      ),
    );
  }

  private receiveLine(session: WorkerSession, line: string): void {
    if (session.closed) return;
    let response: SpeechWorkerResponse;
    try {
      response = decodeResponse(line);
    } catch (error) {
      this.failSession(
        session,
        error instanceof SpeechWorkerError
          ? error
          : new SpeechWorkerError("protocol", errorMessage(error)),
        true,
      );
      return;
    }
    if (response.type === "ready") {
      if (session.readySeen) {
        this.failSession(session, new SpeechWorkerError("protocol", "Duplicate ready frame"), true);
        return;
      }
      session.readySeen = true;
      completeSuccess(session.ready, response);
      return;
    }
    if (response.type === "error") {
      if (response.id === null) {
        this.failSession(session, new SpeechWorkerError("worker", response.message), true);
        return;
      }
      if (session.pending?.id === response.id) {
        this.failSession(session, new SpeechWorkerError("worker", response.message), true);
        return;
      }
      this.failSession(session, new SpeechWorkerError("protocol", "Unexpected error frame"), true);
      return;
    }
    if (session.pending?.id !== response.id) {
      this.failSession(
        session,
        new SpeechWorkerError("protocol", "Unexpected response frame"),
        true,
      );
      return;
    }
    completeSuccess(session.pending.deferred, response);
  }

  private closeSession(session: WorkerSession, terminating: boolean): void {
    if (this.session === session) this.session = null;
    if (terminating) this.terminatingSession = session;
    session.closed = true;
  }

  private cleanupSession(session: WorkerSession): void {
    session.unsubscribe.splice(0).forEach((unsubscribe) => unsubscribe());
  }

  private workerExited(
    session: WorkerSession,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    completeSuccess(session.exited, undefined);
    if (!session.closed) {
      const detail = signal ?? (code === null ? "unknown status" : `code ${code}`);
      this.failSession(
        session,
        new SpeechWorkerError("worker", `Speech worker exited with ${detail}`),
        false,
      );
    }
    if (this.terminatingSession === session) this.terminatingSession = null;
    this.cleanupSession(session);
  }

  private failSession(session: WorkerSession, error: SpeechWorkerError, kill: boolean): void {
    if (session.closed) return;
    this.closeSession(session, kill);
    completeFailure(session.ready, error);
    if (session.pending) completeFailure(session.pending.deferred, error);
    session.pending = null;
    if (kill) session.transport.kill();
  }
}
