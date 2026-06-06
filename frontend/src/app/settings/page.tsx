"use client";

import { useState } from "react";
import { ConfigsView } from "@/ui/configs/configs-view";
import { useConfigs } from "../configs/hooks/use-configs";
import { SetupView } from "@/ui/setup/setup-view";
import { useSetup } from "../setup/hooks/use-setup";

const hasSettingsHash = () => {
  if (typeof window === "undefined") return true;
  return window.location.hash.length > 1;
};

export default function SettingsPage() {
  const configs = useConfigs();
  const setup = useSetup();
  const [setupComplete] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("vllm-studio-setup-complete") === "true";
  });

  const showSetupWizard =
    !hasSettingsHash() &&
    !configs.isInitialLoading &&
    configs.backendOnline === false &&
    !setupComplete &&
    !configs.hasConfigData;

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
    />
  );
}
