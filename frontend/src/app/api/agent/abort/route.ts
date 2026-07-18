import { NextRequest } from "next/server";
import { Schema } from "effect";
import { connectorApprovalBroker } from "@local-studio/agent-runtime/connector-approval";
import { requireApiAccess } from "@/lib/auth/guard";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AgentAbortApprovalSchema = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
  piSessionId: Schema.optional(Schema.String),
});

export async function POST(request: NextRequest): Promise<Response> {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  try {
    const body = Schema.decodeUnknownSync(AgentAbortApprovalSchema)(await request.clone().json());
    for (const sessionId of new Set([body.sessionId, body.piSessionId])) {
      if (sessionId?.trim()) connectorApprovalBroker.cancelSession(sessionId.trim());
    }
  } catch {}
  return proxyToAgentRuntime(request);
}
