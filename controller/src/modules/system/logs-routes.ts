import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { Effect, Schema, Stream } from "effect";
import type { AppContext } from "../../app-context";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { badRequest, notFound } from "../../core/errors";
import { findObservedInferenceProcess } from "../../core/function-observability";
import { buildSseHeaders, toReadableByteStream, withSseHeartbeat } from "../../http/sse";
import { effectHandler } from "../../http/effect-handler";
import { CONTROLLER_EVENTS } from "@local-studio/contracts/controller-events";
import { Event } from "./event-manager";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import {
  cleanupLogFiles,
  fallbackLogPathFor,
  getLogCleanupDefaultsFromEnvironment,
  listLogFiles,
  primaryLogPathFor,
  resolveExistingLogPath,
  sanitizeLogSessionId,
  tailFileLines,
} from "../../core/log-files";
import {
  createLogPayloadRedactor,
  createLogRecordRedactor,
  redactLogLine,
  type LogRecordRedactor,
} from "../../core/log-redaction";
import { runCommandAsyncEffect } from "../../core/command";

const LogLimitQuerySchema = Schema.Struct({
  limit: Schema.optionalKey(
    Schema.FiniteFromString.pipe(
      Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 20_000 })),
    ),
  ),
});
const LogTailQuerySchema = Schema.Struct({
  tail: Schema.optionalKey(
    Schema.FiniteFromString.pipe(
      Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 20_000 })),
    ),
  ),
});

const abortEffect = (signal: AbortSignal): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    if (signal.aborted) {
      resume(Effect.void);
      return;
    }
    const abort = (): void => resume(Effect.void);
    signal.addEventListener("abort", abort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", abort));
  });

const waitForChildExit = (child: ReturnType<typeof spawn>): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.void);
      return;
    }
    const exited = (): void => resume(Effect.void);
    child.once("close", exited);
    return Effect.sync(() => child.removeListener("close", exited));
  });

const terminateChild = (child: ReturnType<typeof spawn>): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (child.exitCode !== null || child.signalCode !== null) return;
    yield* Effect.try({
      try: () => child.kill("SIGTERM"),
      catch: (error) => error,
    }).pipe(Effect.catch(() => Effect.void));
    const exited = yield* Effect.raceFirst(
      waitForChildExit(child).pipe(Effect.as(true)),
      Effect.sleep(1_000).pipe(Effect.as(false)),
    );
    if (exited || child.exitCode !== null || child.signalCode !== null) return;
    yield* Effect.try({
      try: () => child.kill("SIGKILL"),
      catch: (error) => error,
    }).pipe(Effect.catch(() => Effect.void));
    yield* Effect.raceFirst(waitForChildExit(child), Effect.sleep(1_000));
  });

const REDACTED = "[redacted]";
const MAX_DOCKER_LOG_RECORD_CHARS = 64 * 1024;
export const DOCKER_LOG_CONTEXT_LINES = 256;

export interface DockerLogSnapshot {
  readonly lines: readonly string[];
  readonly complete: boolean;
  readonly cursor: string;
  readonly overlap: readonly string[];
}

export interface DockerLogSource {
  snapshot: (container: string, limit: number) => Effect.Effect<DockerLogSnapshot, unknown>;
  follow: (
    container: string,
    snapshot: DockerLogSnapshot,
    signal: AbortSignal,
  ) => Stream.Stream<string, unknown>;
}

interface DockerLogRecord {
  readonly timestamp: string | null;
  readonly line: string;
}

interface RedactedDockerSnapshot {
  readonly snapshot: DockerLogSnapshot;
  readonly redactor: LogRecordRedactor;
  readonly lines: readonly string[];
}

interface LogsRouteDependencies {
  readonly dockerLogs: DockerLogSource;
  readonly dockerContainer: (
    sessionId: string,
    context: AppContext,
  ) => Effect.Effect<string | null, unknown>;
}

const dockerLogRecord = (line: string): DockerLogRecord => {
  const boundary = line.indexOf(" ");
  if (boundary < 1) return { timestamp: null, line };
  const timestamp = line.slice(0, boundary);
  return Number.isNaN(Date.parse(timestamp))
    ? { timestamp: null, line }
    : { timestamp, line: line.slice(boundary + 1) };
};

const dockerLogLines = (output: string): string[] => {
  if (output.length === 0) return [];
  const lines = output.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

const dockerLogIdentity = (record: DockerLogRecord): string | null =>
  record.timestamp === null ? null : `${record.timestamp}\u0000${record.line}`;

const readDockerLogSnapshot = (
  container: string,
  limit: number,
): Effect.Effect<DockerLogSnapshot, unknown> =>
  Effect.gen(function* () {
    const cursor = new Date().toISOString();
    const result = yield* runCommandAsyncEffect(
      "docker",
      ["logs", "--timestamps", "--tail", String(limit), container],
      { timeoutMs: 30_000, maxOutputBytes: 10 * 1024 * 1024 },
    );
    const records = dockerLogLines(`${result.stdout || ""}${result.stderr || ""}`).map(
      dockerLogRecord,
    );
    const cursorTime = Date.parse(cursor);
    return {
      lines: records.map((record) => record.line),
      complete: result.status === 0 && records.length < limit,
      cursor,
      overlap: records.flatMap((record) => {
        const identity = dockerLogIdentity(record);
        return identity !== null && Date.parse(record.timestamp ?? "") >= cursorTime
          ? [identity]
          : [];
      }),
    };
  });

const overlapCounts = (snapshot: DockerLogSnapshot): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const identity of snapshot.overlap) counts.set(identity, (counts.get(identity) ?? 0) + 1);
  return counts;
};

const isSnapshotOverlap = (counts: Map<string, number>, record: DockerLogRecord): boolean => {
  const identity = dockerLogIdentity(record);
  if (identity === null) return false;
  const count = counts.get(identity) ?? 0;
  if (count === 0) return false;
  if (count === 1) counts.delete(identity);
  else counts.set(identity, count - 1);
  return true;
};

const streamDockerLogLines = (
  container: string,
  snapshot: DockerLogSnapshot,
  signal: AbortSignal,
): Stream.Stream<string, unknown> => {
  const overlaps = overlapCounts(snapshot);
  return Stream.scoped(
    Stream.unwrap(
      Effect.acquireRelease(
        Effect.try({
          try: () => {
            const child = spawn(
              "docker",
              ["logs", "--timestamps", "--since", snapshot.cursor, "--follow", container],
              { stdio: ["ignore", "pipe", "pipe"] },
            );
            const output = new PassThrough();
            const readers: Array<{
              readonly readable: NonNullable<typeof child.stdout>;
              readonly end: () => void;
              readonly error: (cause: Error) => void;
            }> = [];
            let openStreams = 0;
            for (const readable of [child.stdout, child.stderr]) {
              if (!readable) continue;
              openStreams += 1;
              readable.pipe(output, { end: false });
              const end = (): void => {
                openStreams -= 1;
                if (openStreams === 0) output.end();
              };
              const error = (cause: Error): void => {
                output.destroy(cause);
              };
              readable.once("end", end);
              readable.once("error", error);
              readers.push({ readable, end, error });
            }
            if (openStreams === 0) output.end();
            const childError = (cause: Error): void => {
              output.destroy(cause);
            };
            child.once("error", childError);
            const lines = createInterface({ input: output, crlfDelay: Infinity });
            return { child, childError, lines, output, readers };
          },
          catch: (error) => error,
        }),
        ({ child, childError, lines, output, readers }) =>
          Effect.gen(function* () {
            lines.close();
            for (const { readable, end, error } of readers) {
              readable.removeListener("end", end);
              readable.removeListener("error", error);
              readable.unpipe(output);
            }
            output.destroy();
            yield* terminateChild(child);
            child.removeListener("error", childError);
          }),
      ).pipe(Effect.map(({ lines }) => Stream.fromAsyncIterable(lines, (error) => error))),
    ),
  ).pipe(
    Stream.map(dockerLogRecord),
    Stream.filter((record) => !isSnapshotOverlap(overlaps, record)),
    Stream.map((record) => record.line),
    Stream.interruptWhen(abortEffect(signal)),
  );
};

const systemDockerLogs: DockerLogSource = {
  snapshot: readDockerLogSnapshot,
  follow: streamDockerLogLines,
};

const redactDockerLine = (redactor: LogRecordRedactor, line: string): string => {
  if (line.length <= MAX_DOCKER_LOG_RECORD_CHARS) return redactor.redactLine(line);
  redactor.failClosed();
  return REDACTED;
};

const redactedDockerSnapshot = (
  source: DockerLogSource,
  container: string,
  limit: number,
): Effect.Effect<RedactedDockerSnapshot, unknown> =>
  source.snapshot(container, limit + DOCKER_LOG_CONTEXT_LINES).pipe(
    Effect.map((snapshot) => {
      const redactor = createLogRecordRedactor(snapshot.complete);
      const redacted = snapshot.lines.map((line) => redactDockerLine(redactor, line));
      return {
        snapshot,
        redactor,
        lines: limit === 0 ? [] : redacted.slice(-limit),
      };
    }),
  );

const registerLogsRoutesWithDependencies = (dependencies: Partial<LogsRouteDependencies> = {}) =>
  defineRoutes((app, context) => {
    const dockerLogs = dependencies.dockerLogs ?? systemDockerLogs;
    let lastCleanupAt = 0;

    const maybeCleanup = (): void => {
      const now = Date.now();
      if (now - lastCleanupAt < 60_000) return;
      lastCleanupAt = now;
      cleanupLogFiles(context.config.data_dir, getLogCleanupDefaultsFromEnvironment());
    };

    const decodeSessionId = (
      sessionId: string,
    ): Effect.Effect<string, ReturnType<typeof badRequest>> => {
      const safe = sanitizeLogSessionId(sessionId);
      return safe ? Effect.succeed(safe) : Effect.fail(badRequest("Invalid log session id"));
    };

    const getDockerContainerForSession = (
      sessionId: string,
    ): Effect.Effect<string | null, unknown> =>
      dependencies.dockerContainer
        ? dependencies.dockerContainer(sessionId, context)
        : context.stores.recipeStore.get(sessionId).pipe(
            Effect.map((recipe) => {
              const extraArguments = recipe?.extra_args ?? {};
              const value =
                extraArguments["docker-container"] ??
                extraArguments["docker_container"] ??
                extraArguments["container-name"] ??
                extraArguments["container_name"];
              if (typeof value !== "string") return null;
              const container = value.trim();
              return /^[a-zA-Z0-9_.-]+$/.test(container) ? container : null;
            }),
          );

    return mergeRoutes(
      app.get(
        "/logs",
        documentRoute,
        effectHandler((ctx) =>
          Effect.gen(function* () {
            yield* Effect.sync(maybeCleanup);
            const current = yield* findObservedInferenceProcess(context, "logs");
            const entries = yield* Effect.try({
              try: () => listLogFiles(context.config.data_dir),
              catch: (error) => error,
            });
            type LogSessionRow = {
              id: string;
              recipe_id: string;
              recipe_name: string | null;
              model_path: string | null;
              model: string;
              backend: string | null;
              created_at: string;
              status: string;
            };
            const sessions: LogSessionRow[] = [];
            let controllerSession: LogSessionRow | null = null;
            for (const entry of entries) {
              const sessionId = entry.sessionId;
              const recipe = yield* context.stores.recipeStore.get(sessionId);
              const modifiedAt = new Date(entry.mtimeMs).toISOString();
              let status = "stopped";
              if (
                current &&
                recipe &&
                isRecipeRunning(recipe, current, { allowCurrentContainsRecipePath: true })
              ) {
                status = "running";
              }
              const row = {
                id: sessionId,
                recipe_id: recipe?.id ?? sessionId,
                recipe_name: recipe?.name ?? null,
                model_path: recipe?.model_path ?? null,
                model: recipe ? (recipe.served_model_name ?? recipe.name) : sessionId,
                backend: recipe?.backend ?? null,
                created_at: modifiedAt,
                status,
              };
              if (sessionId === "controller") {
                controllerSession = row;
              } else {
                sessions.push(row);
              }
            }
            if (controllerSession) sessions.push(controllerSession);
            return ctx.json({ sessions });
          }),
        ),
      ),

      app.get(
        "/logs/:sessionId",
        documentRoute,
        effectHandler((ctx) =>
          Effect.gen(function* () {
            const sessionId = yield* decodeSessionId(ctx.req.param("sessionId") ?? "");
            const limitRaw = ctx.req.query("limit");
            const query = yield* Schema.decodeUnknownEffect(LogLimitQuerySchema)(
              limitRaw === undefined ? {} : { limit: limitRaw },
            ).pipe(Effect.mapError(() => badRequest("Invalid log limit")));
            const limit = query.limit ?? 2000;
            const dockerContainer = yield* getDockerContainerForSession(sessionId);
            if (dockerContainer) {
              const dockerLines = (yield* redactedDockerSnapshot(
                dockerLogs,
                dockerContainer,
                limit,
              )).lines;
              if (dockerLines.length > 0) {
                return ctx.json({
                  id: sessionId,
                  logs: dockerLines,
                  content: dockerLines.join("\n"),
                });
              }
            }
            const path = yield* Effect.sync(() =>
              resolveExistingLogPath(context.config.data_dir, sessionId),
            );
            if (!path) return yield* Effect.fail(notFound("Log not found"));
            const redactor = createLogPayloadRedactor();
            const lines = (yield* Effect.try({
              try: () => tailFileLines(path, limit),
              catch: (error) => error,
            }))
              .map((line) => line.replace(/\n$/, ""))
              .map((line) => redactor.redactLine(line));
            return ctx.json({ id: sessionId, logs: lines, content: lines.join("\n") });
          }),
        ),
      ),

      app.delete(
        "/logs/:sessionId",
        documentRoute,
        effectHandler((ctx) =>
          Effect.gen(function* () {
            const sessionId = yield* decodeSessionId(ctx.req.param("sessionId") ?? "");
            if (sessionId === "controller") {
              return yield* Effect.fail(badRequest("controller logs cannot be deleted via API"));
            }
            const primary = primaryLogPathFor(context.config.data_dir, sessionId);
            const fallback = fallbackLogPathFor(sessionId);
            const removals = yield* Effect.forEach([primary, fallback], (path) =>
              Effect.tryPromise({ try: () => unlink(path), catch: (error) => error }).pipe(
                Effect.as(true),
                Effect.catch(() => Effect.succeed(false)),
              ),
            );
            const deleted = removals.some(Boolean);
            if (!deleted) return yield* Effect.fail(notFound("Log not found"));
            return ctx.json({ success: true });
          }),
        ),
      ),

      app.get(
        "/events",
        documentRoute,
        effectHandler((ctx) =>
          Effect.sync(() => {
            const signal = ctx.req.raw.signal;
            const frames = context.eventManager
              .subscribe("default", signal)
              .pipe(Stream.map((event) => event.toSse()));
            return new Response(toReadableByteStream(withSseHeartbeat(frames, 15_000, signal)), {
              headers: buildSseHeaders(),
            });
          }),
        ),
      ),

      app.get(
        "/logs/:sessionId/stream",
        documentRoute,
        effectHandler((ctx) =>
          Effect.gen(function* () {
            const sessionId = yield* decodeSessionId(ctx.req.param("sessionId") ?? "");
            const tailRaw = ctx.req.query("tail");
            const query = yield* Schema.decodeUnknownEffect(LogTailQuerySchema)(
              tailRaw === undefined ? {} : { tail: tailRaw },
            ).pipe(Effect.mapError(() => badRequest("Invalid log tail")));
            const replayLimit = query.tail ?? 2000;
            const path = yield* Effect.sync(() =>
              resolveExistingLogPath(context.config.data_dir, sessionId),
            );
            const dockerContainer = yield* getDockerContainerForSession(sessionId);
            const signal = ctx.req.raw.signal;
            const frameForLine = (line: string): string =>
              new Event(CONTROLLER_EVENTS.LOG, {
                session_id: sessionId,
                line,
              }).toSse();
            const fileRedactor = createLogPayloadRedactor();
            const dockerReplay = dockerContainer
              ? yield* redactedDockerSnapshot(dockerLogs, dockerContainer, replayLimit)
              : null;
            const replay =
              dockerReplay && dockerContainer
                ? Stream.fromIterable(dockerReplay.lines).pipe(
                    Stream.concat(
                      dockerLogs
                        .follow(dockerContainer, dockerReplay.snapshot, signal)
                        .pipe(Stream.map((line) => redactDockerLine(dockerReplay.redactor, line))),
                    ),
                    Stream.map(frameForLine),
                  )
                : path && replayLimit > 0
                  ? Stream.fromEffect(
                      Effect.try({
                        try: () => tailFileLines(path, replayLimit),
                        catch: (error) => error,
                      }),
                    ).pipe(
                      Stream.flatMap(Stream.fromIterable),
                      Stream.filter((line) => line.length > 0),
                      Stream.map((line) => frameForLine(fileRedactor.redactLine(line))),
                    )
                  : Stream.empty;
            const live = dockerContainer
              ? Stream.empty
              : context.eventManager.subscribe(`logs:${sessionId}`, signal).pipe(
                  Stream.map((event) => {
                    if (
                      event.type === CONTROLLER_EVENTS.LOG &&
                      typeof event.data["line"] === "string"
                    ) {
                      return new Event(CONTROLLER_EVENTS.LOG, {
                        ...event.data,
                        line: fileRedactor.redactLine(event.data["line"]),
                      }).toSse();
                    }
                    return event.toSse();
                  }),
                );
            const frames = replay.pipe(
              Stream.concat(live),
              Stream.catch((error) =>
                Stream.succeed(
                  new Event(CONTROLLER_EVENTS.LOG, {
                    session_id: sessionId,
                    line: redactLogLine(`Log stream failed: ${String(error)}`),
                  }).toSse(),
                ),
              ),
            );
            return new Response(toReadableByteStream(withSseHeartbeat(frames, 15_000, signal)), {
              headers: buildSseHeaders({
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
              }),
            });
          }),
        ),
      ),
    );
  });

export const createLogsRouteRegistrar = (dependencies: Partial<LogsRouteDependencies> = {}) =>
  registerLogsRoutesWithDependencies(dependencies);

export const registerLogsRoutes = createLogsRouteRegistrar();
