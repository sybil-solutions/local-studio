import { NextResponse, type NextRequest } from "next/server";
import { Effect, Schema } from "effect";
import { PluginEnabledInputSchema } from "@local-studio/agent-runtime/plugin-runtime-contract";
import { setManagedPluginEnabled } from "@local-studio/agent-runtime/settings-management";
import { denyEmbeddedDesktopHttp } from "@/lib/auth/embedded-desktop-http";
import { requireApiAccess } from "@/lib/auth/guard";
import { settingsManagementFailure } from "@/lib/settings-management-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const exact = { onExcessProperty: "error" } as const;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const desktopDenied = denyEmbeddedDesktopHttp();
  if (desktopDenied) return desktopDenied;
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let body: typeof PluginEnabledInputSchema.Type;
  try {
    body = Schema.decodeUnknownSync(PluginEnabledInputSchema, exact)(await request.json());
  } catch {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    return NextResponse.json(
      await Effect.runPromise(setManagedPluginEnabled({ id, enabled: body.enabled })),
    );
  } catch (error) {
    return settingsManagementFailure(error, "Plugin activation failed");
  }
}
