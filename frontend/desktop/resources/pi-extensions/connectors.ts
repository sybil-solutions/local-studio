// Connector bridge extension for Local Studio.
//
// At session start it asks the frontend for the tool inventory of every
// enabled connector (MCP servers configured on the Integrations page) and
// registers each MCP tool as `<connectorId>_<toolName>`. Tool calls proxy
// through the frontend's pooled MCP connections, so one stdio server serves
// every session.
//
// Loaded by pi-runtime only when at least one connector is enabled.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { frontendBase, textResult, withTimeout, type ToolResult } from "./bridge.ts";
import { Type } from "./schema.ts";

const FRONTEND_BASE = frontendBase();
const CALL_TIMEOUT_MS = 120_000;
// The model this session runs on. Connector access is granted per model, so the
// frontend both filters the inventory by it and re-checks it on every call.
//
// Read per call, never at module scope: pi evaluates an extension module once
// per project directory and caches it, then registers it per session, and
// pi-runtime re-injects LOCAL_STUDIO_MODEL_ID for each session. A module-scope
// const would freeze the first session's model and silently apply its grants to
// every later session in that project.
function modelId(): string {
  return process.env.LOCAL_STUDIO_MODEL_ID ?? "";
}

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
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  const bounded = withTimeout(signal, CALL_TIMEOUT_MS);
  try {
    const response = await fetch(`${FRONTEND_BASE}/api/agent/connectors/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connector_id: connectorId, tool, args, model_id: modelId() }),
      signal: bounded.signal,
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
    bounded.done();
  }
}

export default async function connectorsExtension(pi: ExtensionAPI): Promise<void> {
  let inventory: InventoryConnector[] = [];
  try {
    const inventoryUrl = `${FRONTEND_BASE}/api/agent/connectors/call?model_id=${encodeURIComponent(modelId())}`;
    const response = await fetch(inventoryUrl, { signal: AbortSignal.timeout(30_000) });
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
