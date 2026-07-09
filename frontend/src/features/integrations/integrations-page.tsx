"use client";

import { useState } from "react";
import { GraduationCap, Plug, type LucideIcon } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { SkillsSettings } from "@/features/settings/agent-settings-sections";
import { ConnectorsSection } from "@/features/settings/connectors-section";
import { SettingsLayout, type SettingsSectionDef } from "@/features/settings/settings-ui";
import { integrationSectionFromHash, type IntegrationSectionId } from "./integration-navigation";

const sectionIcon = (Icon: LucideIcon) => <Icon className="h-3.5 w-3.5" />;

const SECTIONS: SettingsSectionDef<IntegrationSectionId>[] = [
  {
    id: "connectors",
    label: "Connectors",
    description: "MCP tools, services, and remote machines.",
    icon: sectionIcon(Plug),
  },
  {
    id: "skills",
    label: "Skills",
    description: "Reusable instructions discovered on this machine.",
    icon: sectionIcon(GraduationCap),
  },
];

export function IntegrationsPage() {
  const [activeSection, setActiveSection] = useState<IntegrationSectionId>(() =>
    typeof window === "undefined" ? "connectors" : integrationSectionFromHash(window.location.hash),
  );
  const [revision, setRevision] = useState(0);

  useMountSubscription(() => {
    const onHashChange = () => setActiveSection(integrationSectionFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const selectSection = (section: IntegrationSectionId) => {
    setActiveSection(section);
    window.history.replaceState(null, "", `#${section}`);
  };

  return (
    <SettingsLayout
      sections={SECTIONS}
      activeSection={activeSection}
      title="Integrations"
      status="local capabilities"
      loading={false}
      onReload={() => setRevision((value) => value + 1)}
      onSelectSection={selectSection}
    >
      <div key={`${activeSection}-${revision}`}>
        {activeSection === "connectors" ? <ConnectorsSection /> : <SkillsSettings />}
      </div>
    </SettingsLayout>
  );
}
