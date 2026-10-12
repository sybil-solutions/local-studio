"use client";

import { SettingsView } from "@/features/settings/settings-view";
import { useSettings } from "@/features/settings/use-settings";

// Settings is always Settings. The first-run wizard used to take this page
// over when the controller looked offline, which meant a flaky probe replaced
// the one page that can FIX a bad connection with a wizard the user never
// asked for. The rail's own Setup section covers first-run checks.
export default function SettingsPage() {
  const configs = useSettings();

  return (
    <SettingsView
      data={configs.data}
      compatibilityReport={configs.compatibilityReport}
      loading={configs.loading}
      error={configs.error}
      apiSettings={configs.apiSettings}
      apiSettingsLoading={configs.apiSettingsLoading}
      saving={configs.saving}
      testing={configs.testing}
      connectionStatus={configs.connectionStatus}
      statusMessage={configs.statusMessage}
      hasConfigData={configs.hasConfigData}
      isInitialLoading={configs.isInitialLoading}
      onReload={configs.loadConfig}
      onApiSettingsChange={configs.setApiSettings}
      onTestConnection={configs.testConnection}
      onSaveSettings={configs.saveApiSettings}
      onSystemSectionActive={configs.ensureConfigLoaded}
    />
  );
}
