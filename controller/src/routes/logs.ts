import type { Hono } from "hono";
import { readFileSync, unlinkSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AppContext } from "../types/context";
import { badRequest, notFound } from "../core/errors";
import { streamAsyncStrings, buildSseHeaders } from "../http/sse";
import { Event } from "../services/event-manager";

/**
 * Register log and SSE routes.
 * @param app - Hono app.
 * @param context - App context.
 */
export const registerLogsRoutes = (app: Hono, context: AppContext): void => {
  /**
   * Resolve log file path for a session id.
   * @param sessionId - Session identifier.
   * @returns Path to log file.
   */
  const logPathFor = (sessionId: string): string => {
    const safe = Array.from(sessionId).filter((char) => /[a-zA-Z0-9._-]/.test(char)).join("");
    if (!safe) {
      throw badRequest("Invalid log session id");
    }
    return join("/tmp", `vllm_${safe}.log`);
  };

  /**
   * Tail the last N lines of a file.
   * @param path - Log file path.
   * @param limit - Line limit.
   * @returns Array of lines.
   */
  const tailLines = (path: string, limit: number): string[] => {
    if (!existsSync(path)) {
      throw notFound("Log not found");
    }
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n");
    return lines.slice(Math.max(0, lines.length - limit));
  };

  app.get("/logs", async (ctx) => {
    const current = await context.processManager.findInferenceProcess(context.config.inference_port);
    const entries = readdirSync("/tmp")
      .filter((name) => name.startsWith("vllm_") && name.endsWith(".log"))
      .map((name) => ({ name, mtime: statSync(join("/tmp", name)).mtimeMs }))
      .sort((left, right) => right.mtime - left.mtime)
      .map((entry) => entry.name);
    const sessions = [];
    for (const filename of entries) {
      const sessionId = filename.replace(/^vllm_/, "").replace(/\.log$/, "");
      const recipe = context.stores.recipeStore.get(sessionId);
      const stat = statSync(join("/tmp", filename));
      const modifiedAt = new Date(stat.mtimeMs).toISOString();
      let status = "stopped";
      if (current && recipe && current.model_path && recipe.model_path && current.model_path.includes(recipe.model_path)) {
        status = "running";
      } else if (current && recipe && current.served_model_name && recipe.served_model_name === current.served_model_name) {
        status = "running";
      }
      sessions.push({
        id: sessionId,
        recipe_id: recipe?.id ?? sessionId,
        recipe_name: recipe?.name ?? null,
        model_path: recipe?.model_path ?? null,
        model: recipe ? (recipe.served_model_name ?? recipe.name) : sessionId,
        backend: recipe?.backend ?? null,
        created_at: modifiedAt,
        status,
      });
    }
    return ctx.json({ sessions });
  });

  app.get("/logs/:sessionId", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    const limit = Math.min(Math.max(Number(ctx.req.query("limit") ?? 2000), 1), 20000);
    const path = logPathFor(sessionId);
    const lines = tailLines(path, limit).map((line) => line.replace(/\n$/, ""));
    return ctx.json({ id: sessionId, logs: lines, content: lines.join("\n") });
  });

  app.delete("/logs/:sessionId", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    const path = logPathFor(sessionId);
    try {
      unlinkSync(path);
    } catch {
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
    const sessionId = ctx.req.param("sessionId");
    const path = logPathFor(sessionId);
    const stream = streamAsyncStrings((async function* (): AsyncGenerator<string> {
      if (existsSync(path)) {
        const content = readFileSync(path, "utf-8");
        for (const line of content.split("\n")) {
          if (line.length === 0) {
            continue;
          }
          const event = new Event("log", { line });
          yield event.toSse();
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
