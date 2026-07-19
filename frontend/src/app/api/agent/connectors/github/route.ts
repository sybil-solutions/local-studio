import { NextResponse, type NextRequest } from "next/server";
import { Effect, Schema } from "effect";
import {
  getManagedGitHubConnectorArtifactStatus,
  installManagedGitHubConnectorArtifact,
} from "@local-studio/agent-runtime/settings-management";
import { denyEmbeddedDesktopHttp } from "@/lib/auth/embedded-desktop-http";
import { requireApiAccess } from "@/lib/auth/guard";
import { settingsManagementFailure } from "@/lib/settings-management-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const InstallRequestSchema = Schema.Struct({ action: Schema.Literal("install") });
const exact = { onExcessProperty: "error" } as const;

function response(status: Awaited<ReturnType<typeof managedStatus>>): NextResponse {
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}

async function managedStatus() {
  return Effect.runPromise(getManagedGitHubConnectorArtifactStatus());
}

function rejectedInstallRequest(status: number): NextResponse {
  return NextResponse.json(
    { error: status === 415 ? "JSON content required" : "Forbidden" },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function installRequestDenied(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const crossSite = fetchSite === "cross-site" || fetchSite === "same-site";
  try {
    if (crossSite || (origin && new URL(origin).origin !== request.nextUrl.origin)) {
      return rejectedInstallRequest(403);
    }
  } catch {
    return rejectedInstallRequest(403);
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return contentType === "application/json" ? null : rejectedInstallRequest(415);
}

async function invalidInstallBody(request: NextRequest): Promise<NextResponse | null> {
  try {
    Schema.decodeUnknownSync(InstallRequestSchema, exact)(await request.json());
    return null;
  } catch {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: NextRequest) {
  const desktopDenied = denyEmbeddedDesktopHttp();
  if (desktopDenied) return desktopDenied;
  const denied = requireApiAccess(request);
  if (denied) return denied;
  try {
    return response(await managedStatus());
  } catch (error) {
    return settingsManagementFailure(error, "GitHub MCP status failed");
  }
}

export async function POST(request: NextRequest) {
  const desktopDenied = denyEmbeddedDesktopHttp();
  if (desktopDenied) return desktopDenied;
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const requestDenied = installRequestDenied(request);
  if (requestDenied) return requestDenied;
  const invalidBody = await invalidInstallBody(request);
  if (invalidBody) return invalidBody;
  try {
    return response(await Effect.runPromise(installManagedGitHubConnectorArtifact()));
  } catch (error) {
    return settingsManagementFailure(error, "GitHub MCP installation failed");
  }
}
