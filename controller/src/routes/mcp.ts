import type { Hono } from "hono";
import type { AppContext } from "../types/context";
import type { McpServer } from "../types/models";
import { badRequest, notFound, HttpStatus } from "../core/errors";
import { runMcpCommand } from "../services/mcp-runner";

/**
 * Register MCP routes.
 * @param app - Hono app.
 * @param context - App context.
 */
export const registerMcpRoutes = (app: Hono, context: AppContext): void => {
  /**
   * Sanitize tool arguments for known constraints.
   * @param toolName - Tool name.
   * @param args - Arguments object.
   * @returns Sanitized arguments.
   */
  const sanitizeToolArguments = (toolName: string, args: Record<string, unknown>): Record<string, unknown> => {
    const sanitized = { ...args };
    if (toolName === "get_code_context_exa") {
      const tokensNumber = Number(sanitized["tokensNum"] ?? 0);
      if (tokensNumber < 1000) {
        sanitized["tokensNum"] = 5000;
      }
    }
    return sanitized;
  };

  app.get("/mcp/servers", async (ctx) => {
    const enabledOnly = ctx.req.query("enabled_only") === "true";
    const servers = context.stores.mcpStore.list(enabledOnly);
    return ctx.json(servers);
  });

  app.get("/mcp/servers/:serverId", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const server = context.stores.mcpStore.get(serverId);
    if (!server) {
      throw notFound(`Server '${serverId}' not found`);
    }
    return ctx.json(server);
  });

  app.post("/mcp/servers", async (ctx) => {
    const body = (await ctx.req.json()) as Record<string, unknown>;
    if (typeof body["id"] !== "string" || typeof body["name"] !== "string" || typeof body["command"] !== "string") {
      throw badRequest("Invalid MCP server payload");
    }
    const server: McpServer = {
      id: body["id"],
      name: body["name"],
      enabled: body["enabled"] !== undefined ? Boolean(body["enabled"]) : true,
      command: body["command"],
      args: Array.isArray(body["args"]) ? body["args"].map(String) : [],
      env: typeof body["env"] === "object" && body["env"]
        ? Object.fromEntries(Object.entries(body["env"] as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
        : {},
      description: typeof body["description"] === "string" ? body["description"] : null,
      url: typeof body["url"] === "string" ? body["url"] : null,
    };
    context.stores.mcpStore.save(server);
    return ctx.json(server);
  });

  app.put("/mcp/servers/:serverId", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const existing = context.stores.mcpStore.get(serverId);
    if (!existing) {
      throw notFound(`Server '${serverId}' not found`);
    }
    const body = (await ctx.req.json()) as Record<string, unknown>;
    const updated: McpServer = {
      id: serverId,
      name: typeof body["name"] === "string" ? body["name"] : existing.name,
      enabled: body["enabled"] !== undefined ? Boolean(body["enabled"]) : existing.enabled,
      command: typeof body["command"] === "string" ? body["command"] : existing.command,
      args: Array.isArray(body["args"]) ? body["args"].map(String) : existing.args,
      env: typeof body["env"] === "object" && body["env"]
        ? Object.fromEntries(Object.entries(body["env"] as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
        : existing.env,
      description: typeof body["description"] === "string" ? body["description"] : existing.description,
      url: typeof body["url"] === "string" ? body["url"] : existing.url,
    };
    context.stores.mcpStore.save(updated);
    return ctx.json(updated);
  });

  app.delete("/mcp/servers/:serverId", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const deleted = context.stores.mcpStore.delete(serverId);
    if (!deleted) {
      throw notFound(`Server '${serverId}' not found`);
    }
    return ctx.json({ status: "deleted", id: serverId });
  });

  app.post("/mcp/servers/:serverId/enable", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const updated = context.stores.mcpStore.setEnabled(serverId, true);
    if (!updated) {
      throw notFound(`Server '${serverId}' not found`);
    }
    return ctx.json({ status: "enabled", id: serverId });
  });

  app.post("/mcp/servers/:serverId/disable", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const updated = context.stores.mcpStore.setEnabled(serverId, false);
    if (!updated) {
      throw notFound(`Server '${serverId}' not found`);
    }
    return ctx.json({ status: "disabled", id: serverId });
  });

  app.get("/mcp/servers/:serverId/tools", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const server = context.stores.mcpStore.get(serverId);
    if (!server) {
      throw notFound(`Server '${serverId}' not found`);
    }
    if (!server.enabled) {
      throw badRequest(`Server '${serverId}' is disabled`);
    }
    try {
      const result = await runMcpCommand(server, "tools/list");
      const tools = Array.isArray(result["tools"]) ? result["tools"] : [];
      const withServer = tools.map((tool) => ({ ...tool, server: serverId }));
      return ctx.json({ server: serverId, tools: withServer });
    } catch (error) {
      throw new HttpStatus(500, String(error));
    }
  });

  app.get("/mcp/tools", async (ctx) => {
    const servers = context.stores.mcpStore.list(true);
    const tools: Array<Record<string, unknown>> = [];
    const errors: Array<Record<string, unknown>> = [];
    for (const server of servers) {
      try {
        const result = await runMcpCommand(server, "tools/list");
        const serverTools = Array.isArray(result["tools"]) ? result["tools"] : [];
        for (const tool of serverTools) {
          tools.push({ ...tool, server: server.id });
        }
      } catch (error) {
        errors.push({ server: server.id, error: String(error) });
      }
    }
    return ctx.json({ tools, errors: errors.length > 0 ? errors : null });
  });

  const callServerTool = async (
    serverId: string,
    toolName: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const server = context.stores.mcpStore.get(serverId);
    if (!server) {
      throw notFound(`Server '${serverId}' not found`);
    }
    if (!server.enabled) {
      throw badRequest(`Server '${serverId}' is disabled`);
    }
    const sanitized = sanitizeToolArguments(toolName, body);
    try {
      const result = await runMcpCommand(server, "tools/call", { name: toolName, arguments: sanitized });
      const content = Array.isArray(result["content"]) ? result["content"] : [];
      if (content.length > 0) {
        const textParts: string[] = [];
        for (const item of content) {
          if (item && typeof item === "object" && (item as Record<string, unknown>)["type"] === "text") {
            textParts.push(String((item as Record<string, unknown>)["text"] ?? ""));
          }
        }
        if (textParts.length > 0) {
          return { result: textParts.join("\n") };
        }
      }
      return { result };
    } catch (error) {
      throw new HttpStatus(500, String(error));
    }
  };

  app.post("/mcp/servers/:serverId/tools/:toolName", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const toolName = ctx.req.param("toolName");
    let body: Record<string, unknown> = {};
    try {
      body = (await ctx.req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const result = await callServerTool(serverId, toolName, body);
    return ctx.json(result);
  });

  app.post("/mcp/tools/:serverId/:toolName", async (ctx) => {
    const serverId = ctx.req.param("serverId");
    const toolName = ctx.req.param("toolName");
    let body: Record<string, unknown> = {};
    try {
      body = (await ctx.req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const result = await callServerTool(serverId, toolName, body);
    return ctx.json(result);
  });
};
