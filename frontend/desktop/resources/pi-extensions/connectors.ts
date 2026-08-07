// Connector bridge extension for Local Studio.
//
// At session start it asks the frontend for the tool inventory of every
// enabled connector (MCP servers configured in Settings → Connectors) and
// registers each MCP tool as `<connectorId>_<toolName>`.
//
// Loaded by pi-runtime only when at least one connector is enabled.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  ConnectorApprovalBridge,
  ConnectorApprovalView,
} from "../../../../services/agent-runtime/src/connector-contract.js";
import { Type } from "typebox";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

const connectorBridge = (): ConnectorApprovalBridge | null => {
  const registry = (
    globalThis as typeof globalThis & {
      __localStudioAgentRuntimeInstances?: Map<string, unknown>;
    }
  ).__localStudioAgentRuntimeInstances;
  const bridge = registry?.get("connectorApprovalBridge") as
    | Partial<ConnectorApprovalBridge>
    | undefined;
  return typeof bridge?.execute === "function" && typeof bridge.cancel === "function"
    ? (bridge as ConnectorApprovalBridge)
    : null;
};

const FRONTEND_BASE = process.env.LOCAL_STUDIO_FRONTEND_BASE ?? "http://127.0.0.1:3000";
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
  sessionId: string,
  connectorId: string,
  tool: string,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
  approve: (view: ConnectorApprovalView) => Promise<boolean>,
  bridge: ConnectorApprovalBridge,
): Promise<ToolResult> {
  const callSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)])
    : AbortSignal.timeout(CALL_TIMEOUT_MS);
  try {
    const result = await bridge.execute({
      sessionId,
      connectorId,
      tool,
      args,
      signal: callSignal,
      approve,
    });
    return textResult(renderMcpResult(result), { connectorId, tool });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResult(`${connectorId}/${tool} failed: ${message}`, {
      connectorId,
      tool,
      error: message,
      failed: true,
    });
  }
}

export default async function connectorsExtension(pi: ExtensionAPI): Promise<void> {
  const bridge = connectorBridge();
  if (!bridge) return;
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

  pi.on("session_shutdown", (_event, ctx) => {
    bridge.cancel(ctx.sessionManager.getSessionId());
  });

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
        async execute(_id, params, signal, _onUpdate, ctx) {
          return callConnectorTool(
            ctx.sessionManager.getSessionId(),
            connector.id,
            tool.name,
            (params ?? {}) as Record<string, unknown>,
            signal,
            (approval) =>
              ctx.ui.confirm(
                "Approve connector action",
                [
                  `${approval.connectorName} requests ${approval.risk} access to ${approval.tool}.`,
                  ...approval.argumentSummary,
                ].join("\n"),
                { timeout: 60_000, signal },
              ),
            bridge,
          );
        },
      });
    }
  }
}
