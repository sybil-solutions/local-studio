// CRITICAL
import type { Hono } from "hono";
import { unlinkSync } from "node:fs";
import type { AppContext } from "../types/context";
import { badRequest, notFound } from "../core/errors";
import { streamAsyncStrings, buildSseHeaders } from "../http/sse";
import { Event } from "../services/event-manager";
import { isRecipeRunning } from "../services/recipe-matching";
import {
  cleanupLogFiles,
  fallbackLogPathFor,
  getLogCleanupDefaultsFromEnvironment,
  listLogFiles,
  primaryLogPathFor,
  resolveExistingLogPath,
  sanitizeLogSessionId,
  tailFileLines,
} from "../core/log-files";

/**
 * Register log and SSE routes.
 * @param app - Hono app.
 * @param context - App context.
 */
export const registerLogsRoutes = (app: Hono, context: AppContext): void => {
  let lastCleanupAt = 0;

  const maybeCleanup = (): void => {
    const now = Date.now();
    if (now - lastCleanupAt < 60_000) return;
    lastCleanupAt = now;
    cleanupLogFiles(context.config.data_dir, getLogCleanupDefaultsFromEnvironment());
  };

  /**
   * Resolve log file path for a session id.
   * @param sessionId - Session identifier.
   * @returns Path to log file.
   */
  const assertSafeSessionId = (sessionId: string): string => {
    const safe = sanitizeLogSessionId(sessionId);
    if (!safe) throw badRequest("Invalid log session id");
    return safe;
  };

  app.get("/logs", async (ctx) => {
    maybeCleanup();
    const current = await context.processManager.findInferenceProcess(context.config.inference_port);
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
        current
        && recipe
        && isRecipeRunning(recipe, current, { allowCurrentContainsRecipePath: true })
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
      } catch {
        // ignore
      }
    }
    if (!deleted) {
      throw notFound("Log not found");
    }
    return ctx.json({ success: true });
  });

  app.get("/events", async (_ctx) => {
    const stream = streamAsyncStrings((async function* (): AsyncGenerator<string> {
      for await (const event of context.eventManager.subscribe()) {
        yield event.toSse();
      }
    })());
    return new Response(stream, {
      headers: buildSseHeaders(),
    });
  });

  app.get("/logs/:sessionId/stream", async (ctx) => {
    const sessionId = assertSafeSessionId(ctx.req.param("sessionId"));
    const replayLimit = Math.min(Math.max(Number(ctx.req.query("tail") ?? 2000), 0), 20000);
    const path = resolveExistingLogPath(context.config.data_dir, sessionId);
    const stream = streamAsyncStrings((async function* (): AsyncGenerator<string> {
      if (path && replayLimit > 0) {
        const lines = tailFileLines(path, replayLimit);
        for (const line of lines) {
          if (!line) continue;
          yield new Event("log", { session_id: sessionId, line }).toSse();
        }
      }
      for await (const event of context.eventManager.subscribe(`logs:${sessionId}`)) {
        yield event.toSse();
      }
    })());

    return new Response(stream, {
      headers: buildSseHeaders({ "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" }),
    });
  });

  app.get("/events/stats", async (ctx) => {
    return ctx.json(context.eventManager.getStats());
  });
};
