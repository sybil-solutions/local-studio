import { NextResponse, type NextRequest } from "next/server";
import { Effect } from "effect";
import { listManagedPlugins } from "@local-studio/agent-runtime/settings-management";
import { denyEmbeddedDesktopHttp } from "@/lib/auth/embedded-desktop-http";
import { requireApiAccess } from "@/lib/auth/guard";
import { settingsManagementFailure } from "@/lib/settings-management-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const desktopDenied = denyEmbeddedDesktopHttp();
  if (desktopDenied) return desktopDenied;
  const denied = requireApiAccess(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await Effect.runPromise(listManagedPlugins()));
  } catch (error) {
    return settingsManagementFailure(error, "Plugin discovery failed");
  }
}
