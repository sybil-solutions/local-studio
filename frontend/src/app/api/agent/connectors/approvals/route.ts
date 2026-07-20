import { NextResponse, type NextRequest } from "next/server";
import { Schema } from "effect";
import { ConnectorApprovalDecisionSchema } from "@local-studio/agent-runtime/connector-contract";
import { connectorApprovalBroker } from "@local-studio/agent-runtime/connector-approval";
import { denyEmbeddedDesktopHttp } from "@/lib/auth/embedded-desktop-http";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const desktopDenied = denyEmbeddedDesktopHttp();
  if (desktopDenied) return desktopDenied;
  const denied = requireApiAccess(request);
  if (denied) return denied;
  return NextResponse.json(
    { approvals: connectorApprovalBroker.pending() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const desktopDenied = denyEmbeddedDesktopHttp();
  if (desktopDenied) return desktopDenied;
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let body: typeof ConnectorApprovalDecisionSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ConnectorApprovalDecisionSchema)(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid connector approval decision" }, { status: 400 });
  }
  if (!connectorApprovalBroker.decide(body.request_id, body.decision)) {
    return NextResponse.json({ error: "connector approval is no longer pending" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

export function DELETE(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const sessionId = request.nextUrl.searchParams.get("session_id")?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    cancelled: connectorApprovalBroker.cancelSession(sessionId),
  });
}
