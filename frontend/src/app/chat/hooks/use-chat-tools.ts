// CRITICAL
"use client";

import { useCallback } from "react";
import { api } from "@/lib/api";
import type { MCPTool, MCPServer, ToolResult } from "@/lib/types";
import { useAppStore } from "@/store";

interface UseChatToolsOptions {
  mcpEnabled: boolean;
}

export function useChatTools({ mcpEnabled }: UseChatToolsOptions) {
  const mcpTools = useAppStore((state) => state.mcpTools);
  const mcpServers = useAppStore((state) => state.mcpServers);
  const executingTools = useAppStore((state) => state.executingTools);
  const toolResultsMap = useAppStore((state) => state.toolResultsMap);
  const setMcpTools = useAppStore((state) => state.setMcpTools);
  const setMcpServers = useAppStore((state) => state.setMcpServers);
  const setExecutingTools = useAppStore((state) => state.setExecutingTools);
  const updateExecutingTools = useAppStore((state) => state.updateExecutingTools);
  const setToolResultsMap = useAppStore((state) => state.setToolResultsMap);
  const updateToolResultsMap = useAppStore((state) => state.updateToolResultsMap);

  const loadMCPServers = useCallback(async () => {
    try {
      const { servers } = await api.getMCPServers();
      const normalizedServers: MCPServer[] = servers.map((server: MCPServer) => ({
        name: server.name,
        enabled: server.enabled ?? true,
        icon: server.icon,
        command: server.command,
        args: server.args || [],
        env: server.env || {},
      }));
      setMcpServers(normalizedServers);
    } catch (err) {
      console.error("Failed to load MCP servers:", err);
    }
  }, [setMcpServers]);

  const loadMCPTools = useCallback(async (): Promise<MCPTool[]> => {
    if (!mcpEnabled) {
      setMcpTools([]);
      return [];
    }
    try {
      const enabledServers = mcpServers.filter((server) => server.enabled ?? true);
      let tools: MCPTool[] = [];

      if (enabledServers.length > 0) {
        const serverTools = await Promise.all(
          enabledServers.map(async (server) => {
            try {
              const result = await api.getMCPServerTools(server.name);
              return result.tools;
            } catch (err) {
              console.warn(`[MCP] failed to load tools from ${server.name}`, err);
              return [];
            }
          }),
        );
        tools = serverTools.flat();
      }

      if (tools.length === 0) {
        const data = await api.getMCPTools();
        tools = data.tools || [];

        if (data.errors && data.errors.length > 0) {
          console.warn("[MCP] tool discovery errors", data.errors);
        }

        if (tools.length === 0) {
          const { servers } = await api.getMCPServers();
          const enabledServers = servers.filter((server) => server.enabled ?? true);
          const serverTools = await Promise.all(
            enabledServers.map(async (server) => {
              try {
                const result = await api.getMCPServerTools(server.name);
                return result.tools;
              } catch (err) {
                console.warn(`[MCP] failed to load tools from ${server.name}`, err);
                return [];
              }
            }),
          );
          tools = serverTools.flat();
        }
      }

      setMcpTools(tools);
      console.info("[MCP] loaded tools", { count: tools.length });
      return tools;
    } catch (err) {
      console.error("Failed to load MCP tools:", err);
      return [];
    }
  }, [mcpEnabled, mcpServers, setMcpTools]);

  const getToolDefinitions = useCallback(
    (toolsOverride?: MCPTool[]): MCPTool[] => {
      if (!mcpEnabled) return [];
      const toolsList = toolsOverride ?? mcpTools;
      const enabledServers =
        mcpServers.length > 0
          ? new Set(mcpServers.filter((server) => server.enabled).map((server) => server.name))
          : new Set<string>();
      const shouldFilter = enabledServers.size > 0;
      const filteredTools = shouldFilter
        ? toolsList.filter((tool) => enabledServers.has(tool.server))
        : toolsList;
      if (shouldFilter && filteredTools.length === 0 && toolsList.length > 0) {
        console.warn("[MCP] no enabled servers matched tools; using all tools");
        return toolsList.map((tool: MCPTool) => ({
          name: `${tool.server}__${tool.name}`,
          server: tool.server,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));
      }
      return filteredTools.map((tool: MCPTool) => ({
        name: `${tool.server}__${tool.name}`,
        server: tool.server,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    },
    [mcpEnabled, mcpTools, mcpServers],
  );

  const executeTool = useCallback(
    async (toolCall: { toolCallId: string; toolName: string; args?: Record<string, unknown> }) => {
      const { toolCallId, toolName: rawToolName, args } = toolCall;

      updateExecutingTools((prev) => new Set(prev).add(toolCallId));

      try {
        const nameParts = rawToolName.split("__");
        const resolvedToolName = nameParts.length > 1 ? nameParts.slice(1).join("__") : rawToolName;
        const serverFromName = nameParts.length > 1 ? nameParts[0] : "";
        const tool = mcpTools.find(
          (t) => t.name === resolvedToolName && (!serverFromName || t.server === serverFromName),
        );
        const server = serverFromName || tool?.server || "default";

        const result = await api.callMCPTool(server, resolvedToolName, args || {});

        const toolResult: ToolResult = {
          tool_call_id: toolCallId,
          content:
            typeof result.result === "string" ? result.result : JSON.stringify(result.result),
          isError: false,
        };

        updateToolResultsMap((prev) => new Map(prev).set(toolCallId, toolResult));
        return toolResult;
      } catch (err) {
        const errorResult: ToolResult = {
          tool_call_id: toolCallId,
          content: err instanceof Error ? err.message : "Tool execution failed",
          isError: true,
        };
        updateToolResultsMap((prev) => new Map(prev).set(toolCallId, errorResult));
        return errorResult;
      } finally {
        updateExecutingTools((prev) => {
          const next = new Set(prev);
          next.delete(toolCallId);
          return next;
        });
      }
    },
    [mcpTools, updateExecutingTools, updateToolResultsMap],
  );

  const addMcpServer = useCallback(
    async (server: MCPServer) => {
      await api.addMCPServer(server);
      await loadMCPServers();
    },
    [loadMCPServers],
  );

  const updateMcpServer = useCallback(
    async (server: MCPServer) => {
      await api.updateMCPServer(server.name, server);
      await loadMCPServers();
    },
    [loadMCPServers],
  );

  const removeMcpServer = useCallback(
    async (name: string) => {
      await api.removeMCPServer(name);
      await loadMCPServers();
    },
    [loadMCPServers],
  );

  const clearToolResults = useCallback(() => {
    setToolResultsMap(new Map());
    setExecutingTools(new Set());
  }, [setExecutingTools, setToolResultsMap]);

  return {
    mcpTools,
    mcpServers,
    executingTools,
    toolResultsMap,
    loadMCPServers,
    loadMCPTools,
    getToolDefinitions,
    executeTool,
    addMcpServer,
    updateMcpServer,
    removeMcpServer,
    clearToolResults,
    setMcpServers,
  };
}
