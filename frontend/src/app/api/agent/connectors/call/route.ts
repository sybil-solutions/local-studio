import { NextResponse, type NextRequest } from "next/server";
import { Effect, Schema } from "effect";
import {
  ConnectorToolCallSchema,
  type ConnectorApprovalState,
} from "@local-studio/agent-runtime/connector-contract";
import {
  authorizedConnectorTool,
  callConnectorTool,
  CONNECTOR_CALL_ERROR,
  ConnectorToolDeniedError,
  listConnectorTools,
} from "@local-studio/agent-runtime/connector-pool";
import { enabledConnectors } from "@local-studio/agent-runtime/connectors-service";
import { connectorApprovalBroker } from "@local-studio/agent-runtime/connector-approval";
import { connectorToolRisk } from "@local-studio/agent-runtime/connector-policy";
import { refreshEnabledPluginConnectors } from "@local-studio/agent-runtime/plugin-runtime";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function approvalError(state: ConnectorApprovalState): string {
  if (state === "denied") return "Connector action was denied";
  if (state === "expired") return "Connector approval expired";
  if (state === "cancelled") return "Connector approval was cancelled";
  return "Connector approval is invalid";
}

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  await Effect.runPromise(refreshEnabledPluginConnectors());
  const connectors = await enabledConnectors();
  const inventory = await Promise.all(
    connectors.map(async (connector) => {
      try {
        const tools = (await listConnectorTools(connector.id)).map((tool) => ({
          ...tool,
          risk: connectorToolRisk(connector, tool.name),
        }));
        return { id: connector.id, name: connector.name, tools };
      } catch (error) {
        return {
          id: connector.id,
          name: connector.name,
          tools: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return NextResponse.json({ connectors: inventory });
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let body: typeof ConnectorToolCallSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ConnectorToolCallSchema)(await request.json());
  } catch {
    return NextResponse.json(
      { error: "session_id, connector_id, tool, and JSON arguments are required" },
      { status: 400 },
    );
  }
  if (!body.session_id.trim() || !body.connector_id.trim() || !body.tool.trim()) {
    return NextResponse.json(
      { error: "session_id, connector_id, and tool are required" },
      { status: 400 },
    );
  }
  const args = body.args ?? {};
  try {
    const pluginOrigin = (await enabledConnectors()).find(
      (connector) => connector.id === body.connector_id && connector.origin?.kind === "plugin",
    )?.origin;
    if (pluginOrigin?.kind === "plugin") {
      await Effect.runPromise(
        refreshEnabledPluginConnectors(undefined, new Set([pluginOrigin.id])),
      );
    }
    const connector = await authorizedConnectorTool(body.connector_id, body.tool);
    const risk = connectorToolRisk(connector, body.tool);
    if (risk !== "read") {
      const input = {
        sessionId: body.session_id,
        connectorId: connector.id,
        connectorName: connector.name,
        tool: body.tool,
        risk,
        args,
        configuration: connector,
      };
      const pending = connectorApprovalBroker.begin(input, request.signal);
      const state = await pending.wait;
      if (state !== "approved") {
        return NextResponse.json({ ok: false, error: approvalError(state) }, { status: 403 });
      }
      const current = await authorizedConnectorTool(body.connector_id, body.tool);
      const currentInput = {
        ...input,
        connectorName: current.name,
        risk: connectorToolRisk(current, body.tool),
        configuration: current,
      };
      if (!connectorApprovalBroker.consume(pending.approval.id, currentInput)) {
        return NextResponse.json(
          { ok: false, error: "Connector approval did not match this action" },
          { status: 403 },
        );
      }
      const result = await callConnectorTool(current, body.tool, args);
      return NextResponse.json({ ok: true, result });
    }
    const result = await callConnectorTool(connector, body.tool, args);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const status = error instanceof ConnectorToolDeniedError ? 403 : 500;
    const message =
      error instanceof ConnectorToolDeniedError ? error.message : CONNECTOR_CALL_ERROR;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
