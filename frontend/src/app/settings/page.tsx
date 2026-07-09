"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SettingsView } from "@/features/settings/settings-view";
import { useSettings } from "@/features/settings/use-settings";
import { SetupView } from "@/features/setup/setup-view/setup-view";
import { useSetup } from "@/features/setup/use-setup";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { legacyIntegrationHref } from "@/features/integrations/integration-navigation";

const hasSettingsHash = () => {
  if (typeof window === "undefined") return true;
  return window.location.hash.length > 1;
};

export default function SettingsPage() {
  const router = useRouter();
  const configs = useSettings();
  const setup = useSetup();
  const [setupComplete] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("local-studio-setup-complete") === "true";
  });

  useMountSubscription(() => {
    const integrationHref = legacyIntegrationHref(window.location.hash);
    if (integrationHref) router.replace(integrationHref);
  }, [router]);

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
