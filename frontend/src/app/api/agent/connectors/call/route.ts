import { NextResponse, type NextRequest } from "next/server";
import { Effect, Schema } from "effect";
import { ConnectorToolCallSchema } from "@local-studio/agent-runtime/connector-contract";
import {
  ConnectorToolDeniedError,
  listConnectorTools,
} from "@local-studio/agent-runtime/connector-pool";
import {
  ConnectorApprovalError,
  executeConnectorTool,
} from "@local-studio/agent-runtime/connector-approval";
import { enabledConnectors } from "@local-studio/agent-runtime/connectors-service";
import { refreshEnabledPluginConnectors } from "@local-studio/agent-runtime/plugin-runtime";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  await Effect.runPromise(refreshEnabledPluginConnectors());
  const connectors = await enabledConnectors();
  const inventory = await Promise.all(
    connectors.map(async (connector) => {
      try {
        const tools = await listConnectorTools(connector.id);
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
  try {
    const result = await executeConnectorTool({
      sessionId: body.session_id,
      connectorId: body.connector_id,
      tool: body.tool,
      args: body.args ?? {},
      signal: request.signal,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const status =
      error instanceof ConnectorToolDeniedError || error instanceof ConnectorApprovalError
        ? 403
        : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
