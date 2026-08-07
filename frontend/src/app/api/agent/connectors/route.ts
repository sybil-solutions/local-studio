import { NextResponse, type NextRequest } from "next/server";
import { Schema } from "effect";
import { ConnectorUpsertInputSchema } from "@local-studio/agent-runtime/connector-contract";
import { githubMcpConnectorConfiguration } from "@local-studio/agent-runtime/connector-artifacts";
import {
  isValidConnectorId,
  listConnectors,
  removeConnector,
  toConnectorView,
  upsertConnector,
  type ConnectorConfig,
} from "@local-studio/agent-runtime/connectors-service";
import { closePooledConnection } from "@local-studio/agent-runtime/connector-pool";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConnectorUpsertInput = typeof ConnectorUpsertInputSchema.Type;

class InvalidConnectorPayloadError extends Error {}

function customConnector(
  body: Extract<ConnectorUpsertInput, { transport: string }>,
): ConnectorConfig {
  if (body.transport === "stdio" && !body.command) {
    throw new InvalidConnectorPayloadError("command is required for stdio");
  }
  if (body.transport === "http" && !body.url) {
    throw new InvalidConnectorPayloadError("url is required for http");
  }
  return {
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
    enabled: body.enabled ?? true,
  };
}

function connectorFromInput(body: ConnectorUpsertInput): ConnectorConfig {
  if (!("catalogId" in body)) return customConnector(body);
  return githubMcpConnectorConfiguration({
    env: body.env,
    enabled: body.enabled ?? true,
  });
}

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
  try {
    const connector = connectorFromInput(body);
    const connectors = await upsertConnector(connector);
    await closePooledConnection(connector.id);
    return NextResponse.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connector could not be saved" },
      { status: error instanceof InvalidConnectorPayloadError ? 400 : 409 },
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
    await closePooledConnection(id);
    return NextResponse.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connector could not be removed" },
      { status: 409 },
    );
  }
}
