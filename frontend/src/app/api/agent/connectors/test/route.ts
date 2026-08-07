import { NextResponse, type NextRequest } from "next/server";
import { Schema } from "effect";
import { ConnectorTestInputSchema } from "@local-studio/agent-runtime/connector-contract";
import { listConnectors } from "@local-studio/agent-runtime/connectors-service";
import { probeConnector } from "@local-studio/agent-runtime/connector-pool";
import { connectorToolPermissions } from "@local-studio/agent-runtime/connector-policy";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let body: typeof ConnectorTestInputSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ConnectorTestInputSchema)(await request.json());
  } catch {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const connector = (await listConnectors()).find((entry) => entry.id === body.id);
  if (!connector) return NextResponse.json({ error: "unknown connector" }, { status: 404 });
  const result = await probeConnector(connector);
  return NextResponse.json({
    ok: result.ok,
    tool_count: result.tools.length,
    tool_names: result.tools.map((tool) => tool.name).slice(0, 40),
    tools: connectorToolPermissions(connector, result.tools),
    ...(result.error ? { error: result.error } : {}),
  });
}
