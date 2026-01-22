import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { AppContext } from "../types/context";
import { notFound } from "../core/errors";

/**
 * Register chat session routes.
 * @param app - Hono app.
 * @param context - App context.
 */
export const registerChatsRoutes = (app: Hono, context: AppContext): void => {
  app.get("/chats", async (ctx) => {
    return ctx.json(context.stores.chatStore.listSessions());
  });

  app.get("/chats/:sessionId", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    const session = context.stores.chatStore.getSession(sessionId);
    if (!session) {
      throw notFound("Session not found");
    }
    return ctx.json({ session });
  });

  app.post("/chats", async (ctx) => {
    const body = (await ctx.req.json()) as Record<string, unknown>;
    const sessionId = randomUUID();
    const title = typeof body["title"] === "string" ? body["title"] : "New Chat";
    const model = typeof body["model"] === "string" ? body["model"] : undefined;
    const session = context.stores.chatStore.createSession(sessionId, title, model);
    return ctx.json({ session });
  });

  app.put("/chats/:sessionId", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    const body = (await ctx.req.json()) as Record<string, unknown>;
    const title = typeof body["title"] === "string" ? body["title"] : undefined;
    const model = typeof body["model"] === "string" ? body["model"] : undefined;
    const updated = context.stores.chatStore.updateSession(sessionId, title, model);
    if (!updated) {
      throw notFound("Session not found");
    }
    return ctx.json({ success: true });
  });

  app.delete("/chats/:sessionId", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    const deleted = context.stores.chatStore.deleteSession(sessionId);
    if (!deleted) {
      throw notFound("Session not found");
    }
    return ctx.json({ success: true });
  });

  app.post("/chats/:sessionId/messages", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    const body = (await ctx.req.json()) as Record<string, unknown>;
    const messageId = typeof body["id"] === "string" ? body["id"] : randomUUID();
    const role = typeof body["role"] === "string" ? body["role"] : "user";
    const content = typeof body["content"] === "string" ? body["content"] : undefined;
    const model = typeof body["model"] === "string" ? body["model"] : undefined;
    const toolCalls = Array.isArray(body["tool_calls"]) ? body["tool_calls"] : undefined;
    const promptTokens = typeof body["request_prompt_tokens"] === "number" ? body["request_prompt_tokens"] : undefined;
    const toolsTokens = typeof body["request_tools_tokens"] === "number" ? body["request_tools_tokens"] : undefined;
    const totalInputTokens = typeof body["request_total_input_tokens"] === "number" ? body["request_total_input_tokens"] : undefined;
    const completionTokens = typeof body["request_completion_tokens"] === "number" ? body["request_completion_tokens"] : undefined;

    const message = context.stores.chatStore.addMessage(
      sessionId,
      messageId,
      role,
      content,
      model,
      toolCalls,
      promptTokens,
      toolsTokens,
      totalInputTokens,
      completionTokens,
    );
    return ctx.json(message);
  });

  app.get("/chats/:sessionId/usage", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    return ctx.json(context.stores.chatStore.getUsage(sessionId));
  });

  app.post("/chats/:sessionId/fork", async (ctx) => {
    const sessionId = ctx.req.param("sessionId");
    const body = (await ctx.req.json()) as Record<string, unknown>;
    const newId = randomUUID();
    const messageId = typeof body["message_id"] === "string" ? body["message_id"] : undefined;
    const model = typeof body["model"] === "string" ? body["model"] : undefined;
    const title = typeof body["title"] === "string" ? body["title"] : undefined;
    const session = context.stores.chatStore.forkSession(sessionId, newId, messageId, model, title);
    if (!session) {
      throw notFound("Session not found");
    }
    return ctx.json({ session });
  });
};
