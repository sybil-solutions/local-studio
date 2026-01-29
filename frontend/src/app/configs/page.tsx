"use client";

import { ConfigsView } from "./_components/configs-view";
import { SetupView } from "../setup/_components/setup-view";
import { useConfigs } from "./hooks/use-configs";
import { useSetup } from "../setup/hooks/use-setup";

export default function ConfigsPage() {
  const configs = useConfigs();
  const setup = useSetup();

  // Show setup wizard only when backend is confirmed offline (not just when config fails)
  const showSetupWizard = configs.backendOnline === false && !configs.isInitialLoading;

  if (showSetupWizard) {
    return <SetupView {...setup} />;
  }

  return (
    <ConfigsView
      data={configs.data}
      loading={configs.loading}
      error={configs.error}
      apiSettings={configs.apiSettings}
      apiSettingsLoading={configs.apiSettingsLoading}
      showApiKey={configs.showApiKey}
      saving={configs.saving}
      testing={configs.testing}
      connectionStatus={configs.connectionStatus}
      statusMessage={configs.statusMessage}
      hasConfigData={configs.hasConfigData}
      isInitialLoading={configs.isInitialLoading}
      onReload={configs.loadConfig}
      onApiSettingsChange={configs.setApiSettings}
      onToggleApiKey={() => configs.setShowApiKey(!configs.showApiKey)}
      onTestConnection={configs.testConnection}
      onSaveSettings={configs.saveApiSettings}
    />
  );
}
