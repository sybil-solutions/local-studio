// CRITICAL
"use client";

import { useState } from "react";
import type { CompatibilityReport, ConfigData } from "@/lib/types";
import { CompatibilityPanel } from "@/components/compatibility/compatibility-panel";
import type { ApiConnectionSettings, ConnectionStatus } from "../hooks/use-configs";
import { ApiConnectionSection } from "./api-connection-section";
import { ConfigCards } from "./config-cards";
import { ConfigsHeader } from "./configs-header";
import { ConfigsTabBar, type ConfigTabId } from "./configs-tab-bar";
import { ConnectionFlow } from "./connection-flow";
import { NoBackendState } from "./no-backend-state";
import { ServiceTopology } from "./service-topology";
import { ThemeSelector } from "./theme-selector";

interface ConfigsViewProps {
  data: ConfigData | null;
  compatibilityReport: CompatibilityReport | null;
  loading: boolean;
  error: string | null;
  apiSettings: ApiConnectionSettings;
  apiSettingsLoading: boolean;
  showApiKey: boolean;
  saving: boolean;
  testing: boolean;
  connectionStatus: ConnectionStatus;
  statusMessage: string;
  hasConfigData: boolean;
  isInitialLoading: boolean;
  onReload: () => void;
  onApiSettingsChange: (nextSettings: ApiConnectionSettings) => void;
  onToggleApiKey: () => void;
  onTestConnection: () => void;
  onSaveSettings: () => void;
}

export function ConfigsView({
  data,
  compatibilityReport,
  loading,
  error,
  apiSettings,
  apiSettingsLoading,
  showApiKey,
  saving,
  testing,
  connectionStatus,
  statusMessage,
  hasConfigData,
  isInitialLoading,
  onReload,
  onApiSettingsChange,
  onToggleApiKey,
  onTestConnection,
  onSaveSettings,
}: ConfigsViewProps) {
  const [activeTab, setActiveTab] = useState<ConfigTabId>("connection");
  const showBackendUnavailable = !hasConfigData;

  const buildNoBackendState = (helperText?: string) => (
    <NoBackendState
      error={error}
      isInitialLoading={isInitialLoading}
      loading={loading}
      onRetry={onReload}
      helperText={helperText}
    />
  );

  return (
    <div className="min-h-full overflow-y-auto overflow-x-hidden bg-(--surface) text-(--fg)">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6 w-full">
        <ConfigsHeader loading={loading} onReload={onReload} />
        <ConfigsTabBar activeTab={activeTab} onSelectTab={setActiveTab} />

        <div className="space-y-6">
          {activeTab === "connection" && (
            <section className="space-y-6">
              <ApiConnectionSection
                apiSettingsLoading={apiSettingsLoading}
                apiSettings={apiSettings}
                showApiKey={showApiKey}
                testing={testing}
                saving={saving}
                connectionStatus={connectionStatus}
                statusMessage={statusMessage}
                onApiSettingsChange={onApiSettingsChange}
                onToggleApiKey={onToggleApiKey}
                onTestConnection={onTestConnection}
                onSave={onSaveSettings}
              />
              {showBackendUnavailable && buildNoBackendState()}
            </section>
          )}

          {activeTab === "services" && (
            <section className="space-y-6">
              {data ? (
                <div className="grid lg:grid-cols-2 gap-6">
                  <ServiceTopology services={data.services} />
                  <ConnectionFlow />
                </div>
              ) : (
                buildNoBackendState("Connect to the backend in the Connection tab and retry to load services.")
              )}
            </section>
          )}

          {activeTab === "system" && (
            <section className="space-y-6">
              {data ? (
                <>
                  <CompatibilityPanel report={compatibilityReport} />
                  <ConfigCards data={data} />
                </>
              ) : (
                buildNoBackendState("Connect to the backend in the Connection tab and retry to load system details.")
              )}
            </section>
          )}

          {activeTab === "appearance" && (
            <section className="max-w-2xl">
              <ThemeSelector />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
