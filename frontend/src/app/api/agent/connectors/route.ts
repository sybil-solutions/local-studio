import { NextResponse, type NextRequest } from "next/server";
import { Schema } from "effect";
import { ConnectorUpsertInputSchema } from "@local-studio/agent-runtime/connector-contract";
import {
  ConnectorConfigurationError,
  isValidConnectorId,
  listConnectors,
  removeConnector,
  toConnectorView,
  upsertConnectorInput,
} from "@local-studio/agent-runtime/connectors-service";
import { closePooledConnection } from "@local-studio/agent-runtime/connector-pool";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function connectorFailure(error: unknown, fallback: string): NextResponse {
  if (error instanceof ConnectorConfigurationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: fallback }, { status: 409 });
}

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  try {
    const connectors = await listConnectors();
    return NextResponse.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return connectorFailure(error, "Connector discovery failed");
  }
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
  try {
    const connectors = await upsertConnectorInput(body);
    closePooledConnection(body.id);
    return NextResponse.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return connectorFailure(error, "Connector could not be saved");
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
    return connectorFailure(error, "Connector could not be removed");
  }
}
