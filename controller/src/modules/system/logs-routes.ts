import type { Hono } from "hono";
import { spawn, spawnSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import type { AppContext } from "../../types/context";
import { badRequest, notFound } from "../../core/errors";
import { observeControllerFunction } from "../../core/function-observability";
import { streamAsyncStrings, buildSseHeaders } from "../../http/sse";
import { CONTROLLER_EVENTS } from "../../contracts/controller-events";
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

export const registerLogsRoutes = (app: Hono, context: AppContext): void => {
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

  const readDockerLogLines = (container: string, limit: number): string[] => {
    const result = spawnSync("docker", ["logs", "--tail", String(limit), container], {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    if (!output.trim()) return [];
    const lines = output.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.slice(Math.max(0, lines.length - limit));
  };

  /**
   * Stream Docker logs for a container-backed recipe.
   * @param container - Docker container name.
   * @param replayLimit - Initial tail line count.
   * @param signal - Request abort signal.
   * @returns Docker log line stream.
   */
  async function* streamDockerLogLines(
    container: string,
    replayLimit: number,
    signal: AbortSignal
  ): AsyncGenerator<string> {
    const child = spawn("docker", ["logs", "--tail", String(replayLimit), "--follow", container], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = new PassThrough();
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
        yield line;
      }
    } finally {
      signal.removeEventListener("abort", close);
      close();
    }
  }

  app.get("/logs", async (ctx) => {
    maybeCleanup();
    const current = await observeControllerFunction(context, "logs.findInferenceProcess", () =>
      context.processManager.findInferenceProcess(context.config.inference_port)
    );
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
      const dockerLines = readDockerLogLines(dockerContainer, limit);
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
      (async function* (): AsyncGenerator<string> {
        for await (const event of context.eventManager.subscribe("default", signal)) {
          yield event.toSse();
        }
      })()
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
          for await (const line of streamDockerLogLines(dockerContainer, replayLimit, signal)) {
            if (signal.aborted) return;
            yield new Event(CONTROLLER_EVENTS.LOG, { session_id: sessionId, line }).toSse();
          }
          return;
        }
        if (path && replayLimit > 0) {
          const lines = tailFileLines(path, replayLimit);
          for (const line of lines) {
            if (!line) continue;
            if (signal.aborted) return;
            yield new Event(CONTROLLER_EVENTS.LOG, { session_id: sessionId, line }).toSse();
          }
        }
        for await (const event of context.eventManager.subscribe(`logs:${sessionId}`, signal)) {
          yield event.toSse();
        }
      })()
    );

    return new Response(stream, {
      headers: buildSseHeaders({
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      }),
    });
  });

  app.get("/events/stats", async (ctx) => {
    return ctx.json(context.eventManager.getStats());
  });
};
