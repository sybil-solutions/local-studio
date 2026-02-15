// CRITICAL
import type { Hono } from "hono";
import type { AppContext } from "../types/context";
import { getUsageFromChatDatabase } from "./usage/chat-database";
import { getUsageFromPostgres } from "./usage/postgres";
import { getUsageFromSqliteSpendLogs } from "./usage/sqlite-spend-logs";
import { emptyResponse } from "./usage/usage-utilities";

/**
 * Register usage analytics routes.
 * Uses LiteLLM spend logs (Postgres preferred) with SQLite/chat fallbacks.
 * Falls back to empty data if no sources are available.
 * @param app - Hono app.
 * @param context - App context.
 */
export const registerUsageRoutes = (app: Hono, context: AppContext): void => {
  app.get("/usage", async (ctx) => {
    try {
      const postgresUsage = await getUsageFromPostgres(context);
      if (postgresUsage) return ctx.json(postgresUsage);

      const sqliteUsage = getUsageFromSqliteSpendLogs(context.config.db_path);
      if (sqliteUsage) return ctx.json(sqliteUsage);

      const chatUsage = getUsageFromChatDatabase(context.config.data_dir);
      if (chatUsage) return ctx.json(chatUsage);

      return ctx.json(emptyResponse());
    } catch (error) {
      console.error("[Usage] Error fetching usage stats:", error);
      try {
        const chatUsage = getUsageFromChatDatabase(context.config.data_dir);
        if (chatUsage) return ctx.json(chatUsage);
      } catch (fallbackError) {
        console.error("[Usage] Fallback also failed:", fallbackError);
      }
      return ctx.json(emptyResponse());
    }
  });
};
