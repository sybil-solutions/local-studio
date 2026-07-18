import { NextResponse, type NextRequest } from "next/server";
import {
  decodeConnectorUpsertPayload,
  listConnectors,
  removeConnector,
  toConnectorView,
  upsertConnectorInput,
} from "@local-studio/agent-runtime/connectors-service";
import { closePooledConnection } from "@local-studio/agent-runtime/connector-pool";
import { denyEmbeddedDesktopHttp } from "@/lib/auth/embedded-desktop-http";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function connectorsResponse(connectors: Awaited<ReturnType<typeof listConnectors>>): NextResponse {
  return NextResponse.json(
    { connectors: connectors.map(toConnectorView) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  const desktopDenied = denyEmbeddedDesktopHttp();
  if (desktopDenied) return desktopDenied;
  const denied = requireApiAccess(request);
  if (denied) return denied;
  return connectorsResponse(await listConnectors());
}

export async function POST(request: NextRequest) {
  const desktopDenied = denyEmbeddedDesktopHttp();
  if (desktopDenied) return desktopDenied;
  const denied = requireApiAccess(request);
  if (denied) return denied;
  try {
    const input = decodeConnectorUpsertPayload(await request.text());
    const connectors = await upsertConnectorInput(input);
    closePooledConnection(input.id);
    return connectorsResponse(connectors);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connector could not be saved" },
      { status: 409 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const desktopDenied = denyEmbeddedDesktopHttp();
  if (desktopDenied) return desktopDenied;
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    const connectors = await removeConnector(id);
    closePooledConnection(id);
    return connectorsResponse(connectors);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Connector could not be removed" },
      { status: 409 },
    );
  }
}
