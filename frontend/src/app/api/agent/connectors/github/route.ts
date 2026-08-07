import { NextResponse, type NextRequest } from "next/server";
import { Effect, Schema } from "effect";
import {
  GitHubConnectorArtifactError,
  getGitHubConnectorArtifactStatus,
  installGitHubConnectorArtifact,
} from "@local-studio/agent-runtime/connector-artifacts";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InstallRequestSchema = Schema.Struct({ action: Schema.Literal("install") });
const exact = { onExcessProperty: "error" } as const;
const headers = { "Cache-Control": "no-store" };

function failure(error: unknown): NextResponse {
  if (error instanceof GitHubConnectorArtifactError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers });
  }
  return NextResponse.json({ error: "GitHub MCP operation failed" }, { status: 500, headers });
}

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await Effect.runPromise(getGitHubConnectorArtifactStatus()), {
      headers,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return NextResponse.json({ error: "JSON content required" }, { status: 415, headers });
  }
  try {
    Schema.decodeUnknownSync(InstallRequestSchema, exact)(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid install request" }, { status: 400, headers });
  }
  try {
    return NextResponse.json(await Effect.runPromise(installGitHubConnectorArtifact()), {
      headers,
    });
  } catch (error) {
    return failure(error);
  }
}
