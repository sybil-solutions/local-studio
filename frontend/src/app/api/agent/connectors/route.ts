import { NextResponse, type NextRequest } from "next/server";
import { Schema } from "effect";
import { ConnectorUpsertInputSchema } from "@local-studio/agent-runtime/connector-contract";
import {
  isValidConnectorId,
  listConnectors,
  removeConnector,
  toConnectorView,
  upsertConnector,
  type ConnectorConfig,
} from "@local-studio/agent-runtime/connectors-service";
import { closePooledConnection } from "@local-studio/agent-runtime/connector-pool";
import { catalogConnectorConfiguration } from "@local-studio/agent-runtime/connector-policy";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const connectors = await listConnectors();
  return NextResponse.json({ connectors: connectors.map(toConnectorView) });
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let body: typeof ConnectorUpsertInputSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ConnectorUpsertInputSchema)(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid connector payload" }, { status: 400 });
  }
  if (!isValidConnectorId(body.id)) {
    return NextResponse.json({ error: "invalid connector id" }, { status: 400 });
  }
  if (body.transport === "stdio" && !body.command) {
    return NextResponse.json({ error: "command is required for stdio" }, { status: 400 });
  }
  if (body.transport === "http" && !body.url) {
    return NextResponse.json({ error: "url is required for http" }, { status: 400 });
  }
  const existing = (await listConnectors()).find((entry) => entry.id === body.id);
  const supplied: ConnectorConfig = {
    id: body.id,
    name: body.name?.trim() || body.id,
    transport: body.transport,
    ...(body.command ? { command: body.command } : {}),
    ...(body.args ? { args: body.args } : {}),
    ...(body.env ? { env: body.env } : {}),
    ...(body.cwd ? { cwd: body.cwd } : {}),
    ...(body.url ? { url: body.url } : {}),
    ...(body.headers ? { headers: body.headers } : {}),
    ...(body.allowTools ? { allowTools: body.allowTools } : {}),
    permissionReviewed: body.permissionReviewed ?? false,
    enabled: body.enabled ?? true,
  };
  const connector = body.catalogId
    ? catalogConnectorConfiguration(supplied, body.catalogId)
    : existing?.origin
      ? {
          ...existing,
          allowTools: body.allowTools ?? existing.allowTools ?? [],
          permissionReviewed: body.permissionReviewed ?? existing.permissionReviewed ?? false,
          enabled: body.enabled ?? existing.enabled,
        }
      : supplied;
  try {
    const connectors = await upsertConnector(connector);
    closePooledConnection(connector.id);
    return NextResponse.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connector could not be saved" },
      { status: 409 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    const connectors = await removeConnector(id);
    closePooledConnection(id);
    return NextResponse.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connector could not be removed" },
      { status: 409 },
    );
  }
}
