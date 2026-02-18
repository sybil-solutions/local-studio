"use client";

import { useEffect, useState } from "react";
import { ConfigsView } from "./_components/configs-view";
import { SetupView } from "../setup/_components/setup-view";
import { useConfigs } from "./hooks/use-configs";
import { useSetup } from "../setup/hooks/use-setup";

export default function ConfigsPage() {
  const configs = useConfigs();
  const setup = useSetup();
  const [setupComplete] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return localStorage.getItem("vllm-studio-setup-complete") === "true";
  });

  useEffect(() => {
    if (configs.hasConfigData && !setupComplete) {
      localStorage.setItem("vllm-studio-setup-complete", "true");
    }
  }, [configs.hasConfigData, setupComplete]);

  // Show setup wizard only when backend is confirmed offline and setup has not been completed.
  const showSetupWizard = !configs.isInitialLoading && configs.backendOnline === false && !setupComplete && !configs.hasConfigData;

  if (showSetupWizard) {
    return <SetupView {...setup} />;
  }

  return (
    <ConfigsView
      data={configs.data}
      compatibilityReport={configs.compatibilityReport}
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
