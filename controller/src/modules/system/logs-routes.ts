import { spawn, spawnSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import type { Hono } from "hono";
import type { AppContext } from "../../app-context";
import type { RouteRegistrar } from "../../http/route-registrar";
import { badRequest, notFound } from "../../core/errors";
import { findObservedInferenceProcess } from "../../core/function-observability";
import { streamAsyncStrings, buildSseHeaders, withSseHeartbeat } from "../../http/sse";
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
  type LogRecordRedactor,
} from "../../core/log-redaction";

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
  snapshot: (container: string, limit: number) => DockerLogSnapshot;
  follow: (
    container: string,
    snapshot: DockerLogSnapshot,
    signal: AbortSignal,
  ) => AsyncIterable<string>;
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
  readonly dockerContainer: (sessionId: string, context: AppContext) => string | null;
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

const readDockerLogSnapshot = (container: string, limit: number): DockerLogSnapshot => {
  const cursor = new Date().toISOString();
  const result = spawnSync("docker", ["logs", "--timestamps", "--tail", String(limit), container], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const records = dockerLogLines(`${result.stdout || ""}${result.stderr || ""}`).map(
    dockerLogRecord,
  );
  const cursorTime = Date.parse(cursor);
  return {
    lines: records.map((record) => record.line),
    complete: result.error === undefined && records.length < limit,
    cursor,
    overlap: records.flatMap((record) => {
      const identity = dockerLogIdentity(record);
      return identity !== null && Date.parse(record.timestamp ?? "") >= cursorTime
        ? [identity]
        : [];
    }),
  };
};

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

async function* streamDockerLogLines(
  container: string,
  snapshot: DockerLogSnapshot,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const child = spawn(
    "docker",
    ["logs", "--timestamps", "--since", snapshot.cursor, "--follow", container],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const output = new PassThrough();
  const overlaps = overlapCounts(snapshot);
  let openStreams = 0;
  for (const readable of [child.stdout, child.stderr]) {
    if (!readable) continue;
    openStreams += 1;
    readable.pipe(output, { end: false });
    readable.once("end", () => {
      openStreams -= 1;
      if (openStreams === 0) output.end();
    });
  }
  const close = (): void => {
    try {
      child.kill("SIGTERM");
    } catch {}
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    const lines = createInterface({ input: output, crlfDelay: Infinity });
    for await (const line of lines) {
      if (signal.aborted) return;
      const record = dockerLogRecord(line);
      if (!isSnapshotOverlap(overlaps, record)) yield record.line;
    }
  } finally {
    signal.removeEventListener("abort", close);
    close();
  }
}

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
): RedactedDockerSnapshot => {
  const snapshot = source.snapshot(container, limit + DOCKER_LOG_CONTEXT_LINES);
  const redactor = createLogRecordRedactor(snapshot.complete);
  const redacted = snapshot.lines.map((line) => redactDockerLine(redactor, line));
  return {
    snapshot,
    redactor,
    lines: limit === 0 ? [] : redacted.slice(-limit),
  };
};

const registerLogsRoutesWithDependencies = (
  app: Hono,
  context: AppContext,
  dependencies: Partial<LogsRouteDependencies> = {},
): void => {
  const dockerLogs = dependencies.dockerLogs ?? systemDockerLogs;
  let lastCleanupAt = 0;

  const maybeCleanup = (): void => {
    const now = Date.now();
    if (now - lastCleanupAt < 60_000) return;
    lastCleanupAt = now;
    cleanupLogFiles(context.config.data_dir, getLogCleanupDefaultsFromEnvironment());
  };

  const assertSafeSessionId = (sessionId: string): string => {
    const safe = sanitizeLogSessionId(sessionId);
    if (!safe) throw badRequest("Invalid log session id");
    return safe;
  };

  const getDockerContainerForSession = (sessionId: string): string | null => {
    if (dependencies.dockerContainer) return dependencies.dockerContainer(sessionId, context);
    const recipe = context.stores.recipeStore.get(sessionId);
    const extraArguments = recipe?.extra_args ?? {};
    const value =
      extraArguments["docker-container"] ??
      extraArguments["docker_container"] ??
      extraArguments["container-name"] ??
      extraArguments["container_name"];
    if (typeof value !== "string") return null;
    const container = value.trim();
    return /^[a-zA-Z0-9_.-]+$/.test(container) ? container : null;
  };

  app.get("/logs", async (ctx) => {
    maybeCleanup();
    const current = await findObservedInferenceProcess(context, "logs");
    const entries = listLogFiles(context.config.data_dir);
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
      const recipe = context.stores.recipeStore.get(sessionId);
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
  });

  app.get("/logs/:sessionId", async (ctx) => {
    const sessionId = assertSafeSessionId(ctx.req.param("sessionId"));
    const limit = Math.min(Math.max(Number(ctx.req.query("limit") ?? 2000), 1), 20000);
    const dockerContainer = getDockerContainerForSession(sessionId);
    if (dockerContainer) {
      const dockerLines = redactedDockerSnapshot(dockerLogs, dockerContainer, limit).lines;
      if (dockerLines.length > 0) {
        return ctx.json({ id: sessionId, logs: dockerLines, content: dockerLines.join("\n") });
      }
    }
    const path = resolveExistingLogPath(context.config.data_dir, sessionId);
    if (!path) throw notFound("Log not found");
    const lines = tailFileLines(path, limit).map((line) => line.replace(/\n$/, ""));
    return ctx.json({ id: sessionId, logs: lines, content: lines.join("\n") });
  });

  app.delete("/logs/:sessionId", async (ctx) => {
    const sessionId = assertSafeSessionId(ctx.req.param("sessionId"));
    if (sessionId === "controller") {
      throw badRequest("controller logs cannot be deleted via API");
    }
    const primary = primaryLogPathFor(context.config.data_dir, sessionId);
    const fallback = fallbackLogPathFor(sessionId);

    let deleted = false;
    for (const path of [primary, fallback]) {
      try {
        unlinkSync(path);
        deleted = true;
      } catch {}
    }
    if (!deleted) {
      throw notFound("Log not found");
    }
    return ctx.json({ success: true });
  });

  app.get("/events", async (ctx) => {
    const signal = ctx.req.raw.signal;
    const stream = streamAsyncStrings(
      withSseHeartbeat(
        (async function* (): AsyncGenerator<string> {
          for await (const event of context.eventManager.subscribe("default", signal)) {
            yield event.toSse();
          }
        })(),
        15_000,
        signal,
      ),
    );
    return new Response(stream, {
      headers: buildSseHeaders(),
    });
  });

  app.get("/logs/:sessionId/stream", async (ctx) => {
    const sessionId = assertSafeSessionId(ctx.req.param("sessionId"));
    const replayLimit = Math.min(Math.max(Number(ctx.req.query("tail") ?? 2000), 0), 20000);
    const path = resolveExistingLogPath(context.config.data_dir, sessionId);
    const dockerContainer = getDockerContainerForSession(sessionId);
    const signal = ctx.req.raw.signal;
    const stream = streamAsyncStrings(
      (async function* (): AsyncGenerator<string> {
        if (dockerContainer) {
          const replay = redactedDockerSnapshot(dockerLogs, dockerContainer, replayLimit);
          for (const line of replay.lines) {
            if (signal.aborted) return;
            yield new Event(CONTROLLER_EVENTS.LOG, {
              session_id: sessionId,
              line,
            }).toSse();
          }
          for await (const line of dockerLogs.follow(dockerContainer, replay.snapshot, signal)) {
            if (signal.aborted) return;
            yield new Event(CONTROLLER_EVENTS.LOG, {
              session_id: sessionId,
              line: redactDockerLine(replay.redactor, line),
            }).toSse();
          }
          return;
        }
        const redactor = createLogPayloadRedactor();
        if (path && replayLimit > 0) {
          const lines = tailFileLines(path, replayLimit);
          for (const line of lines) {
            if (!line) continue;
            if (signal.aborted) return;
            yield new Event(CONTROLLER_EVENTS.LOG, {
              session_id: sessionId,
              line: redactor.redactLine(line),
            }).toSse();
          }
        }
        for await (const event of context.eventManager.subscribe(`logs:${sessionId}`, signal)) {
          if (event.type === CONTROLLER_EVENTS.LOG && typeof event.data["line"] === "string") {
            yield new Event(CONTROLLER_EVENTS.LOG, {
              ...event.data,
              line: redactor.redactLine(event.data["line"] as string),
            }).toSse();
          } else {
            yield event.toSse();
          }
        }
      })(),
    );

    return new Response(stream, {
      headers: buildSseHeaders({
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      }),
    });
  });
};

export const createLogsRouteRegistrar =
  (dependencies: Partial<LogsRouteDependencies> = {}): RouteRegistrar =>
  (app, context) =>
    registerLogsRoutesWithDependencies(app, context, dependencies);

export const registerLogsRoutes = createLogsRouteRegistrar();
