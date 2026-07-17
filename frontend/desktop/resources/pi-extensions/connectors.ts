// Connector bridge extension for Local Studio.
//
// At session start it asks the frontend for the tool inventory of every
// enabled connector (MCP servers configured in Settings → Connectors) and
// registers each MCP tool as `<connectorId>_<toolName>`. Tool calls proxy
// through the frontend's pooled MCP connections, so one stdio server serves
// every session.
//
// Loaded by pi-runtime only when at least one connector is enabled.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runtimeFrontendOrigin } from "./frontend-callback-origin";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

const FRONTEND_BASE = runtimeFrontendOrigin();
const CALL_TIMEOUT_MS = 120_000;

interface InventoryTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface InventoryConnector {
  id: string;
  name: string;
  tools: InventoryTool[];
  error?: string;
}

const textResult = (text: string, details: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text }],
  details,
});

/** Render an MCP tools/call result (content blocks) as plain text. */
const renderMcpResult = (result: unknown): string => {
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as { content?: unknown[] }).content)
  ) {
    const blocks = (result as { content: Array<{ type?: string; text?: string }> }).content;
    const texts = blocks
      .map((block) => (block.type === "text" && block.text ? block.text : JSON.stringify(block)))
      .join("\n");
    return texts || "(empty result)";
  }
  return JSON.stringify(result ?? null);
};

async function callConnectorTool(
  connectorId: string,
  tool: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ToolResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  try {
    const response = await fetch(`${FRONTEND_BASE}/api/agent/connectors/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connector_id: connectorId, tool, args }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as { ok?: boolean; result?: unknown; error?: string };
    if (!response.ok || !payload.ok) {
      return textResult(`${connectorId}/${tool} failed: ${payload.error ?? response.status}`, {
        connectorId,
        tool,
        failed: true,
      });
    }
    return textResult(renderMcpResult(payload.result), { connectorId, tool });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResult(`${connectorId}/${tool} failed: ${message}`, {
      connectorId,
      tool,
      error: message,
      failed: true,
    });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export default async function connectorsExtension(pi: ExtensionAPI): Promise<void> {
  let inventory: InventoryConnector[] = [];
  try {
    const response = await fetch(`${FRONTEND_BASE}/api/agent/connectors/call`, {
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json()) as { connectors?: InventoryConnector[] };
    inventory = payload.connectors ?? [];
  } catch {
    // Frontend unreachable or no connectors — register nothing.
    return;
  }

  for (const connector of inventory) {
    for (const tool of connector.tools) {
      const qualifiedName = `${connector.id.replace(/-/g, "_")}_${tool.name.replace(/[^A-Za-z0-9_]/g, "_")}`;
      pi.registerTool({
        name: qualifiedName,
        label: `${connector.name}: ${tool.name}`,
        description: tool.description || `${tool.name} via the ${connector.name} connector`,
        // MCP tools carry their own JSON Schema; pass it through untyped.
        parameters: Type.Unsafe<Record<string, unknown>>(
          tool.inputSchema ?? { type: "object", properties: {} },
        ),
        async execute(_id, params, signal) {
          return callConnectorTool(
            connector.id,
            tool.name,
            (params ?? {}) as Record<string, unknown>,
            signal,
          );
        },
      });
    }
  }
}
