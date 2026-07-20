"use client";

import { useState, type ReactNode } from "react";
import { RefreshButton, Tabs } from "@/ui";
import { Boxes, Brain, GraduationCap, Plug } from "@/ui/icon-registry";
import { SkillsSettings } from "@/features/settings/agent-settings-sections";
import { ConnectorsSection } from "@/features/settings/connectors-section";
import { PluginsSection } from "./plugins-section";
import { ModelProvidersSection } from "./model-providers-section";
import { integrationSectionFromHash, type IntegrationSectionId } from "./integration-navigation";

const INTEGRATION_TABS = [
  { id: "plugins", label: "Plugins", icon: <Boxes className="h-3.5 w-3.5" /> },
  { id: "connectors", label: "Connectors", icon: <Plug className="h-3.5 w-3.5" /> },
  { id: "models", label: "Models", icon: <Brain className="h-3.5 w-3.5" /> },
  { id: "skills", label: "Skills", icon: <GraduationCap className="h-3.5 w-3.5" /> },
] satisfies Array<{ id: IntegrationSectionId; label: string; icon: ReactNode }>;

const initialSection = (): IntegrationSectionId => {
  if (typeof window === "undefined") return "plugins";
  const section = new URLSearchParams(window.location.search).get("integration") ?? "";
  return integrationSectionFromHash(section);
};

export function IntegrationsContent() {
  const [activeSection, setActiveSection] = useState<IntegrationSectionId>(initialSection);
  const [revision, setRevision] = useState(0);

  const selectSection = (section: IntegrationSectionId) => {
    setActiveSection(section);
    const url = new URL(window.location.href);
    url.searchParams.set("integration", section);
    url.hash = "integrations";
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-separator) pb-3">
        <Tabs
          variant="pill"
          items={INTEGRATION_TABS}
          activeTab={activeSection}
          onSelectTab={selectSection}
        />
        <RefreshButton
          onRefresh={() => setRevision((value) => value + 1)}
          label="Refresh integrations"
          className="h-8 w-8"
        />
      </div>
      <div key={`${activeSection}-${revision}`}>
        {activeSection === "plugins" ? <PluginsSection /> : null}
        {activeSection === "connectors" ? <ConnectorsSection /> : null}
        {activeSection === "models" ? <ModelProvidersSection /> : null}
        {activeSection === "skills" ? <SkillsSettings /> : null}
      </div>
    </div>
  );
}
