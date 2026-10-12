import { NextRequest, NextResponse } from "next/server";
import {
  applySettingsUpdate,
  getApiSettings,
  InvalidSettingsError,
  maskedSettingsView,
  type ApiSettings,
} from "@local-studio/agent-runtime/settings-service";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(maskedSettingsView(await getApiSettings()));
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load settings", details: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  try {
    const update = (await request.json()) as Partial<ApiSettings>;
    const saved = await applySettingsUpdate(update);
    return NextResponse.json({ success: true, ...maskedSettingsView(saved) });
  } catch (error) {
    if (error instanceof InvalidSettingsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Failed to save settings", details: String(error) },
      { status: 500 },
    );
  }
}
