"use client";
import { useMemo, useState } from "react";
import {
  Archive,
  Cable,
  Cpu,
  Keyboard,
  type LucideIcon,
  Paintbrush,
  ServerCog,
  Terminal,
} from "@/ui/icon-registry";
import { SettingsLayout, type SettingsSectionDef, type SettingsSectionId } from "./settings-ui";
import type { CompatibilityReport, ConfigData } from "@/lib/types";
import type { ApiConnectionSettings, ConnectionStatus } from "./types";
import { ApiConnectionSection } from "./api-connection-section";
import { ArchivedChatsSettings, SetupChecksSettings } from "./agent-settings-sections";
import { AppearanceSettings } from "./appearance-settings";
import { QuickPanelSettings } from "./quick-panel-settings";
import { TerminalSettings } from "./terminal-settings";
import { EnginesSection } from "./engines-section";
import { ServicesSettings, SystemSettings } from "./system-settings-section";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
interface SettingsViewProps {
  data: ConfigData | null;
  compatibilityReport: CompatibilityReport | null;
  loading: boolean;
  error: string | null;
  apiSettings: ApiConnectionSettings;
  apiSettingsLoading: boolean;
  saving: boolean;
  testing: boolean;
  connectionStatus: ConnectionStatus;
  statusMessage: string;
  hasConfigData: boolean;
  isInitialLoading: boolean;
  onReload: () => void;
  onApiSettingsChange: (nextSettings: ApiConnectionSettings) => void;
  onTestConnection: () => void;
  onSaveSettings: () => void;
  onSystemSectionActive: () => void;
}
const sectionIcon = (Icon: LucideIcon) => <Icon className="h-3.5 w-3.5" />;
const SECTIONS: SettingsSectionDef[] = [
  ["connection", "Connection", "Controller URL and API key.", Cable],
  ["system", "System", "Runtime targets, services, storage, hardware.", Cpu],
  ["appearance", "Appearance", "Theme variables, typography, density.", Paintbrush],
  ["desktop", "Desktop", "Quick panel hotkey and desktop app behavior.", Keyboard],
  ["terminal", "Terminal", "Terminal shortcuts and text size.", Terminal],
  ["archive", "Archived chats", "Pi sessions kept out of normal chat lists.", Archive],
  ["setup", "Setup", "First-run checks for Pi, controller, and local directories.", ServerCog],
].map(([id, label, description, Icon]) => ({
  id: id as SettingsSectionId,
  label: label as string,
  description: description as string,
  icon: sectionIcon(Icon as LucideIcon),
}));
const isSectionId = (value: string): value is SettingsSectionId =>
  SECTIONS.some((section) => section.id === value);
const normalizeSectionId = (value: string): SettingsSectionId | null => {
  if (isSectionId(value)) return value;
  if (value === "engines" || value === "services") return "system";
  return null;
};
export function SettingsView({
  data,
  compatibilityReport,
  loading,
  error,
  apiSettings,
  apiSettingsLoading,
  saving,
  testing,
  connectionStatus,
  statusMessage,
  hasConfigData,
  isInitialLoading,
  onReload,
  onApiSettingsChange,
  onTestConnection,
  onSaveSettings,
  onSystemSectionActive,
}: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() => {
    if (typeof window === "undefined") return "connection";
    const hash = window.location.hash.replace("#", "");
    return normalizeSectionId(hash) ?? "connection";
  });
  useMountSubscription(() => {
    if (activeSection === "system") onSystemSectionActive();
    if (typeof window === "undefined") return;
    const onHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      const normalized = normalizeSectionId(hash);
      if (!normalized) return;
      setActiveSection(normalized);
      if (normalized === "system") onSystemSectionActive();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const selectSection = (section: SettingsSectionId) => {
    setActiveSection(section);
    if (section === "system") onSystemSectionActive();
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${section}`);
    }
  };
  const layoutStatus = useMemo(() => {
    if (isInitialLoading) return "checking controller";
    if (loading) return "refreshing";
    if (hasConfigData) return "controller synced";
    if (error) return "local fallbacks";
    return "ready";
  }, [error, hasConfigData, isInitialLoading, loading]);
  return (
    <SettingsLayout
      sections={SECTIONS}
      activeSection={activeSection}
      title="Settings"
      status={layoutStatus}
      loading={loading}
      onReload={onReload}
      onSelectSection={selectSection}
    >
      {activeSection === "connection" ? (
        <ApiConnectionSection
          apiSettingsLoading={apiSettingsLoading}
          apiSettings={apiSettings}
          testing={testing}
          saving={saving}
          connectionStatus={connectionStatus}
          statusMessage={statusMessage}
          onApiSettingsChange={onApiSettingsChange}
          onTestConnection={onTestConnection}
          onSave={onSaveSettings}
        />
      ) : null}
      {activeSection === "system" ? (
        <div className="space-y-8">
          <EnginesSection runtime={data?.runtime ?? null} />
          <ServicesSettings data={data} apiSettings={apiSettings} loading={loading} error={error} />
          <SystemSettings
            data={data}
            compatibilityReport={compatibilityReport}
            loading={loading}
            error={error}
          />
        </div>
      ) : null}
      {activeSection === "appearance" ? <AppearanceSettings /> : null}
      {activeSection === "desktop" ? <QuickPanelSettings /> : null}
      {activeSection === "terminal" ? <TerminalSettings /> : null}
      {activeSection === "archive" ? <ArchivedChatsSettings /> : null}
      {activeSection === "setup" ? <SetupChecksSettings /> : null}
    </SettingsLayout>
  );
}
