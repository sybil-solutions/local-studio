import { NextResponse, type NextRequest } from "next/server";
import { Effect, Schema } from "effect";
import {
  callConnectorTool,
  ConnectorToolDeniedError,
  listConnectorTools,
} from "@local-studio/agent-runtime/connector-pool";
import { enabledConnectors } from "@local-studio/agent-runtime/connectors-service";
import { refreshEnabledPluginConnectors } from "@local-studio/agent-runtime/plugin-runtime";
import { requireCallbackOrApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ConnectorToolCallSchema = Schema.Struct({
  connector_id: Schema.String,
  tool: Schema.String,
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

export async function GET(request: NextRequest) {
  const denied = requireCallbackOrApiAccess(request);
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
  const denied = requireCallbackOrApiAccess(request);
  if (denied) return denied;
  let body: typeof ConnectorToolCallSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ConnectorToolCallSchema)(await request.json());
  } catch {
    return NextResponse.json({ error: "connector_id and tool are required" }, { status: 400 });
  }
  if (!body.connector_id.trim() || !body.tool.trim()) {
    return NextResponse.json({ error: "connector_id and tool are required" }, { status: 400 });
  }
  try {
    const result = await callConnectorTool(body.connector_id, body.tool, body.args ?? {});
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const status = error instanceof ConnectorToolDeniedError ? 403 : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
