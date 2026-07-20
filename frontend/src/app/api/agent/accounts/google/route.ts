import { NextResponse, type NextRequest } from "next/server";
import { Effect, Schema } from "effect";
import {
  GoogleAccountInputSchema,
  GoogleClientInputSchema,
} from "@local-studio/agent-runtime/google-account-contract";
import {
  disconnectManagedGoogleAccount,
  getManagedGoogleAccount,
  saveManagedGoogleClient,
} from "@local-studio/agent-runtime/settings-management";
import { denyEmbeddedDesktopHttp } from "@/lib/auth/embedded-desktop-http";
import { requireApiAccess } from "@/lib/auth/guard";
import { settingsManagementFailure } from "@/lib/settings-management-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const exact = { onExcessProperty: "error" } as const;

export async function GET(request: NextRequest) {
  const desktopDenied = denyEmbeddedDesktopHttp();
  if (desktopDenied) return desktopDenied;
  const denied = requireApiAccess(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await Effect.runPromise(getManagedGoogleAccount()));
  } catch (error) {
    return settingsManagementFailure(error, "Google account failed");
  }
}

export async function PUT(request: NextRequest) {
  const desktopDenied = denyEmbeddedDesktopHttp();
  if (desktopDenied) return desktopDenied;
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let input: typeof GoogleClientInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(GoogleClientInputSchema, exact)(await request.json());
  } catch {
    return NextResponse.json({ error: "clientId must be a string" }, { status: 400 });
  }
  try {
    return NextResponse.json(await Effect.runPromise(saveManagedGoogleClient(input)));
  } catch (error) {
    return settingsManagementFailure(error, "Google account failed");
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
    return NextResponse.json(await Effect.runPromise(disconnectManagedGoogleAccount(input)));
  } catch (error) {
    return settingsManagementFailure(error, "Google account failed");
  }
}
