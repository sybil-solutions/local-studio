// CRITICAL
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Hono } from "hono";
import type { AppContext } from "../../types/context";
import { getUsageFromChatDatabases, mergeUsagePayloads } from "./usage/chat-database";
import { getUsageFromPiSessions } from "./usage/pi-sessions";
import { emptyResponse } from "./usage/usage-utilities";

const usageDatabasePaths = (context: AppContext): string[] => {
  const primary = resolve(context.config.db_path);
  const legacyChats = resolve(context.config.data_dir, "chats.db");
  return [...new Set([primary, legacyChats])].filter((path) => existsSync(path));
};

/**
 * Register usage analytics routes.
 * Uses current controller DB plus the legacy chats DB, when present, so older
 * chat history remains visible after the unified controller DB migration.
 * @param app - Hono app.
 * @param context - App context.
 */
export const registerUsageRoutes = (app: Hono, context: AppContext): void => {
  app.get("/usage", async (ctx) => {
    try {
      const usage = mergeUsagePayloads(
        [getUsageFromChatDatabases(usageDatabasePaths(context)), getUsageFromPiSessions()].filter(
          (payload): payload is Record<string, unknown> => Boolean(payload)
        )
      );
      if (usage) return ctx.json(usage);

      return ctx.json(emptyResponse());
    } catch (error) {
      console.error("[Usage] Error fetching usage stats:", error);
      return ctx.json(emptyResponse());
    }
  });
};
