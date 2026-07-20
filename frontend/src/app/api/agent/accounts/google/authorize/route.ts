import { NextResponse, type NextRequest } from "next/server";
import { Effect, Schema } from "effect";
import { GoogleAccountInputSchema } from "@local-studio/agent-runtime/google-account-contract";
import {
  beginManagedGoogleAuthorization,
  cancelManagedGoogleAuthorization,
} from "@local-studio/agent-runtime/settings-management";
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
  let input: typeof GoogleAccountInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleAccountInputSchema, exact)(await request.json());
  } catch {
    return NextResponse.json({ error: "account is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await Effect.runPromise(beginManagedGoogleAuthorization(input)));
  } catch (error) {
    return settingsManagementFailure(error, "Google sign-in failed");
  }
}

export async function DELETE(request: NextRequest) {
  const desktopDenied = denyEmbeddedDesktopHttp();
  if (desktopDenied) return desktopDenied;
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let input: typeof GoogleAccountInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleAccountInputSchema, exact)(await request.json());
  } catch {
    return NextResponse.json({ error: "account is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await Effect.runPromise(cancelManagedGoogleAuthorization(input)));
  } catch (error) {
    return settingsManagementFailure(error, "Google sign-in cancellation failed");
  }
}
