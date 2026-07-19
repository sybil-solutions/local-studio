import { NextResponse } from "next/server";
import { ConnectorConfigurationError } from "@local-studio/agent-runtime/connectors-service";
import { SettingsManagementError } from "@local-studio/agent-runtime/settings-management";

export function settingsManagementFailure(error: unknown, fallback: string): NextResponse {
  const connectorError = error instanceof ConnectorConfigurationError;
  return NextResponse.json(
    {
      error: error instanceof SettingsManagementError || connectorError ? error.message : fallback,
    },
    {
      status: error instanceof SettingsManagementError || connectorError ? error.status : 500,
    },
  );
}
