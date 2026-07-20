import { NextResponse, type NextRequest } from "next/server";
import { Effect, Schema } from "effect";
import { ConnectorTestInputSchema } from "@local-studio/agent-runtime/connector-contract";
import { probeManagedConnector } from "@local-studio/agent-runtime/settings-management";
import { denyEmbeddedDesktopHttp } from "@/lib/auth/embedded-desktop-http";
import { requireApiAccess } from "@/lib/auth/guard";
import { settingsManagementFailure } from "@/lib/settings-management-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const exact = { onExcessProperty: "error" } as const;

export async function POST(request: NextRequest) {
  const desktopDenied = denyEmbeddedDesktopHttp();
  if (desktopDenied) return desktopDenied;
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let body: typeof ConnectorTestInputSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ConnectorTestInputSchema, exact)(await request.json());
  } catch {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await Effect.runPromise(probeManagedConnector(body.id)));
  } catch (error) {
    return settingsManagementFailure(error, "Connector discovery failed");
  }
}
