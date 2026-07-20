import { NextResponse, type NextRequest } from "next/server";
import { Effect } from "effect";
import {
  decodeConnectorUpsertPayload,
  listConnectors,
  removeConnector,
  toConnectorView,
} from "@local-studio/agent-runtime/connectors-service";
import { closePooledConnection } from "@local-studio/agent-runtime/connector-pool";
import { saveManagedConnector } from "@local-studio/agent-runtime/settings-management";
import { denyEmbeddedDesktopHttp } from "@/lib/auth/embedded-desktop-http";
import { requireApiAccess } from "@/lib/auth/guard";
import { settingsManagementFailure } from "@/lib/settings-management-http";

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
  try {
    return connectorsResponse(await listConnectors());
  } catch (error) {
    return settingsManagementFailure(error, "Connector discovery failed");
  }
}

export async function POST(request: NextRequest) {
  const desktopDenied = denyEmbeddedDesktopHttp();
  if (desktopDenied) return desktopDenied;
  const denied = requireApiAccess(request);
  if (denied) return denied;
  try {
    const input = decodeConnectorUpsertPayload(await request.text());
    const connectors = await Effect.runPromise(saveManagedConnector(input));
    return connectorsResponse(connectors);
  } catch (error) {
    return settingsManagementFailure(error, "Connector could not be saved");
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
