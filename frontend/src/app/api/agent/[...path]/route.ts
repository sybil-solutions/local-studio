import { NextRequest } from "next/server";
import { requireApiAccess } from "@/lib/auth/guard";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";
import { AGENT_TURN_BODY_LIMIT_BYTES } from "@shared/agent/agent-turn-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every agent API path whose Next route did nothing but re-check the access
// token and hand the request to the agent runtime is a table row here instead
// of its own file. Paths that validate input, touch the local filesystem, or
// stream (SSE) keep their own route.ts; Next matches those first, so this
// catch-all never sees them.

type ForwardRoute = {
  methods: readonly string[];
  auth?: true;
  bodyLimitBytes?: number;
};

const SIXTY_FOUR_KB = 64 * 1024;

// Paths relative to /api/agent, matched literally. Static segments win over
// the patterns below, mirroring Next's own route precedence.
const EXACT_ROUTES = new Map<string, ForwardRoute>([
  ["abort", { methods: ["POST"], auth: true }],
  ["accounts/google", { methods: ["GET", "PUT", "DELETE"], auth: true }],
  ["accounts/google/authorize", { methods: ["POST", "DELETE"], auth: true }],
  ["automations", { methods: ["GET", "POST"], auth: true }],
  ["browser/engine", { methods: ["POST"] }],
  ["browser/engines", { methods: ["GET"] }],
  ["browser/fetch", { methods: ["GET"] }],
  ["browser/frame", { methods: ["GET"] }],
  ["browser/history", { methods: ["GET"] }],
  ["browser/input", { methods: ["POST"] }],
  ["browser/localhosts", { methods: ["GET"] }],
  ["browser/state", { methods: ["GET"] }],
  ["browser/viewport", { methods: ["POST"] }],
  ["compact", { methods: ["POST"], auth: true }],
  ["connectors", { methods: ["GET", "POST", "DELETE"], auth: true }],
  ["connectors/call", { methods: ["GET", "POST"], auth: true }],
  ["connectors/grants", { methods: ["GET", "PUT", "DELETE"], auth: true }],
  ["connectors/ssh-server-path", { methods: ["GET"], auth: true }],
  ["connectors/test", { methods: ["POST"], auth: true }],
  ["goal", { methods: ["GET", "PUT", "DELETE"], auth: true }],
  ["models", { methods: ["GET", "POST"], bodyLimitBytes: SIXTY_FOUR_KB }],
  ["oauth", { methods: ["DELETE"], auth: true }],
  ["oauth/authorize", { methods: ["POST", "DELETE"], auth: true }],
  ["oauth/client", { methods: ["PUT"], auth: true }],
  ["oauth/status", { methods: ["GET"], auth: true }],
  ["plugins", { methods: ["GET", "POST", "DELETE"], auth: true }],
  ["plugins/source", { methods: ["GET"], auth: true }],
  ["projects", { methods: ["GET", "POST", "DELETE"] }],
  ["prompt-templates", { methods: ["GET"] }],
  ["prompt-templates/load", { methods: ["GET"] }],
  ["providers", { methods: ["GET"], auth: true }],
  ["runtime/extension-ui", { methods: ["POST"], auth: true, bodyLimitBytes: 40_000 }],
  ["runtime/sessions", { methods: ["GET"] }],
  ["runtime/status", { methods: ["GET"] }],
  ["sessions", { methods: ["GET", "DELETE"] }],
  ["sessions/all", { methods: ["GET"] }],
  ["setup-checks", { methods: ["GET"] }],
  ["skills", { methods: ["GET"] }],
  ["skills/load", { methods: ["GET"] }],
  ["subagents", { methods: ["GET", "POST"], auth: true }],
  ["turn", { methods: ["POST"], auth: true, bodyLimitBytes: AGENT_TURN_BODY_LIMIT_BYTES }],
]);

// ":name" matches exactly one segment. First match wins, so a pattern with the
// longer literal prefix has to be declared before a rival that would also fit.
const PATTERN_ROUTES: ReadonlyArray<readonly [string, ForwardRoute]> = [
  ["automations/:id", { methods: ["PATCH", "DELETE"], auth: true }],
  ["automations/:id/run", { methods: ["POST"], auth: true }],
  ["providers/login/:jobId", { methods: ["GET"], auth: true }],
  ["providers/login/:jobId/cancel", { methods: ["POST"], auth: true }],
  ["providers/login/:jobId/respond", { methods: ["POST"], auth: true }],
  ["providers/:providerId/login", { methods: ["POST"], auth: true }],
  ["providers/:providerId/logout", { methods: ["POST"], auth: true }],
  ["sessions/:id", { methods: ["GET", "PATCH"], bodyLimitBytes: SIXTY_FOUR_KB }],
  ["subagents/:runId", { methods: ["GET"], auth: true }],
  ["subagents/:runId/stop", { methods: ["POST"], auth: true }],
  ["browser/:verb", { methods: ["POST"] }],
];

function matchRoute(segments: readonly string[]): ForwardRoute | undefined {
  const exact = EXACT_ROUTES.get(segments.join("/"));
  if (exact) return exact;
  return PATTERN_ROUTES.find(([pattern]) => {
    const parts = pattern.split("/");
    return (
      parts.length === segments.length &&
      parts.every((part, index) => part.startsWith(":") || part === segments[index])
    );
  })?.[1];
}

type RouteContext = { params: Promise<{ path: string[] }> };

async function forward(
  request: NextRequest,
  context: RouteContext,
  method: string,
): Promise<Response> {
  const { path } = await context.params;
  const route = matchRoute(path);
  if (!route) return Response.json({ error: "Not found" }, { status: 404 });
  if (!route.methods.includes(method)) {
    return Response.json(
      { error: `Method ${method} not allowed` },
      { status: 405, headers: { allow: route.methods.join(", ") } },
    );
  }
  if (route.auth) {
    const denied = requireApiAccess(request);
    if (denied) return denied;
  }
  return proxyToAgentRuntime(request, { bodyLimitBytes: route.bodyLimitBytes });
}

export function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return forward(request, context, "GET");
}

export function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return forward(request, context, "POST");
}

export function PUT(request: NextRequest, context: RouteContext): Promise<Response> {
  return forward(request, context, "PUT");
}

export function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  return forward(request, context, "PATCH");
}

export function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  return forward(request, context, "DELETE");
}
