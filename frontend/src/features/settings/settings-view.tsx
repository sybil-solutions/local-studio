"use client";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  Archive,
  Cable,
  Cpu,
  GraduationCap,
  Plug,
  type LucideIcon,
  Paintbrush,
  ServerCog,
} from "@/ui/icon-registry";
import { SettingsLayout, type SettingsSectionDef, type SettingsSectionId } from "@/ui";
import type { CompatibilityReport, ConfigData } from "@/lib/types";
import type { ApiConnectionSettings, ConnectionStatus } from "./types";
import { ApiConnectionSection } from "./api-connection-section";
import {
  ArchivedChatsSettings,
  SetupChecksSettings,
  SkillsSettings,
} from "./agent-settings-sections";
import { AppearanceSettings } from "./appearance-settings";
import { EnginesSection } from "./engines-section";
import { PluginsSettingsSection } from "@/features/plugins/plugins-page";
import { ServicesSettings, SystemSettings } from "./system-settings-section";
import { getSettingsViewSnapshot } from "./settings-view-snapshot";
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
}
const sectionIcon = (Icon: LucideIcon) => <Icon className="h-3.5 w-3.5" />;
const SECTIONS: SettingsSectionDef[] = [
  ["connection", "Connection", "Controller URL, API key, voice defaults.", Cable],
  ["system", "System", "Runtime targets, services, storage, hardware.", Cpu],
  ["appearance", "Appearance", "Theme variables, typography, density.", Paintbrush],
  ["archive", "Archived chats", "Pi sessions kept out of normal chat lists.", Archive],
  ["plugins", "Plugins", "MCP server catalog, OAuth connections, and composer availability.", Plug],
  [
    "skills",
    "Skills",
    "Normalized local skills from Codex, Pi, Claude, Factory, OpenCode.",
    GraduationCap,
  ],
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
}: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() => {
    if (typeof window === "undefined") return "connection";
    const hash = window.location.hash.replace("#", "");
    return normalizeSectionId(hash) ?? "connection";
  });
  const subscribeHashSection = useCallback((_notify: () => void) => {
    if (typeof window === "undefined") return () => {};
    const onHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      const normalized = normalizeSectionId(hash);
      if (normalized) setActiveSection(normalized);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useSyncExternalStore(subscribeHashSection, getSettingsViewSnapshot, getSettingsViewSnapshot);
  const selectSection = (section: SettingsSectionId) => {
    setActiveSection(section);
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
      {activeSection === "archive" ? <ArchivedChatsSettings /> : null}
      {activeSection === "plugins" ? <PluginsSettingsSection /> : null}
      {activeSection === "skills" ? <SkillsSettings /> : null}
      {activeSection === "setup" ? <SetupChecksSettings /> : null}
    </SettingsLayout>
  );
}
