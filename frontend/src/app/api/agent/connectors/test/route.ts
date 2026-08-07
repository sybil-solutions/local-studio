import { NextResponse, type NextRequest } from "next/server";
import { Schema } from "effect";
import { ConnectorTestInputSchema } from "@local-studio/agent-runtime/connector-contract";
import {
  ConnectorProbeDeniedError,
  probePersistedConnector,
  UnknownConnectorError,
} from "@local-studio/agent-runtime/connector-pool";
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
  let result: Awaited<ReturnType<typeof probePersistedConnector>>;
  try {
    result = await probePersistedConnector(body.id, request.signal);
  } catch (error) {
    if (error instanceof UnknownConnectorError) {
      return NextResponse.json({ error: "unknown connector" }, { status: 404 });
    }
    if (error instanceof ConnectorProbeDeniedError) {
      return NextResponse.json({ error: "connector is not approved" }, { status: 403 });
    }
    throw error;
  }
  return NextResponse.json({
    ok: result.ok,
    tool_count: result.tools.length,
    tool_names: result.tools.map((tool) => tool.name).slice(0, 40),
    ...(result.error ? { error: result.error } : {}),
  });
}
