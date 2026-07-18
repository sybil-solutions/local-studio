import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Effect, Fiber, Schema } from "effect";
import { Type } from "typebox";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

const FRONTEND_BASE = process.env.LOCAL_STUDIO_FRONTEND_BASE ?? "http://127.0.0.1:3000";
const CALL_TIMEOUT_MS = 120_000;

const InventoryToolSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  inputSchema: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

const InventoryConnectorSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  tools: Schema.Array(InventoryToolSchema),
  error: Schema.optional(Schema.String),
});

const InventoryResponseSchema = Schema.Struct({
  connectors: Schema.Array(InventoryConnectorSchema),
});

const ToolCallResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
});

const McpContentBlockSchema = Schema.Struct({
  type: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
});

const McpResultSchema = Schema.Struct({
  content: Schema.optional(Schema.Array(McpContentBlockSchema)),
});

const textResult = (text: string, details: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text }],
  details,
});

function timedSignal(timeoutMs: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) controller.abort();
  const timer = Effect.runFork(
    Effect.gen(function* () {
      yield* Effect.sleep(timeoutMs);
      controller.abort();
    }),
  );
  return {
    signal: controller.signal,
    close: () => {
      parent?.removeEventListener("abort", abort);
      void Effect.runPromise(Fiber.interrupt(timer));
    },
  };
}

function renderMcpResult(result: unknown): string {
  try {
    const blocks = Schema.decodeUnknownSync(McpResultSchema)(result).content;
    if (blocks) {
      return (
        blocks
          .map((block) =>
            block.type === "text" && block.text ? block.text : (JSON.stringify(block) ?? ""),
          )
          .join("\n") || "(empty result)"
      );
    }
  } catch {}
  return JSON.stringify(result ?? null) ?? "null";
}

async function cancelSessionApprovals(sessionId: string): Promise<void> {
  const timed = timedSignal(10_000);
  try {
    await fetch(
      `${FRONTEND_BASE}/api/agent/connectors/approvals?session_id=${encodeURIComponent(sessionId)}`,
      { method: "DELETE", signal: timed.signal },
    ).catch(() => undefined);
  } finally {
    timed.close();
  }
}

async function callConnectorTool(
  sessionId: string,
  connectorId: string,
  tool: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const timed = timedSignal(CALL_TIMEOUT_MS, signal);
  try {
    const response = await fetch(`${FRONTEND_BASE}/api/agent/connectors/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, connector_id: connectorId, tool, args }),
      signal: timed.signal,
    });
    const payload = Schema.decodeUnknownSync(ToolCallResponseSchema)(await response.json());
    if (!response.ok || !payload.ok) {
      return textResult(`${connectorId}/${tool} failed: ${payload.error ?? response.status}`, {
        connectorId,
        tool,
        failed: true,
      });
    }
    return textResult(renderMcpResult(payload.result), { connectorId, tool });
  } catch (error) {
    if (timed.signal.aborted) await cancelSessionApprovals(sessionId);
    const message = error instanceof Error ? error.message : String(error);
    return textResult(`${connectorId}/${tool} failed: ${message}`, {
      connectorId,
      tool,
      error: message,
      failed: true,
    });
  } finally {
    timed.close();
  }
}

export default async function connectorsExtension(pi: ExtensionAPI): Promise<void> {
  let inventory: readonly (typeof InventoryConnectorSchema.Type)[];
  const timed = timedSignal(30_000);
  try {
    const response = await fetch(`${FRONTEND_BASE}/api/agent/connectors/call`, {
      signal: timed.signal,
    });
    inventory = Schema.decodeUnknownSync(InventoryResponseSchema)(await response.json()).connectors;
  } catch {
    return;
  } finally {
    timed.close();
  }

  pi.on("session_shutdown", async (_event, ctx) => {
    await cancelSessionApprovals(ctx.sessionManager.getSessionId());
  });

  for (const connector of inventory) {
    for (const tool of connector.tools) {
      const qualifiedName = `${connector.id.replace(/-/g, "_")}_${tool.name.replace(/[^A-Za-z0-9_]/g, "_")}`;
      pi.registerTool({
        name: qualifiedName,
        label: `${connector.name}: ${tool.name}`,
        description: tool.description || `${tool.name} via the ${connector.name} connector`,
        parameters: Type.Unsafe<Record<string, unknown>>(
          tool.inputSchema ?? { type: "object", properties: {} },
        ),
        async execute(_id, params, signal, _onUpdate, ctx) {
          return callConnectorTool(
            ctx.sessionManager.getSessionId(),
            connector.id,
            tool.name,
            params ?? {},
            signal,
          );
        },
      });
    }
  }
}
