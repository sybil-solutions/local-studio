import { NextResponse } from "next/server";
import { SettingsManagementError } from "@local-studio/agent-runtime/settings-management";

export function settingsManagementFailure(error: unknown, fallback: string): NextResponse {
  return NextResponse.json(
    { error: error instanceof SettingsManagementError ? error.message : fallback },
    { status: error instanceof SettingsManagementError ? error.status : 500 },
  );
}
