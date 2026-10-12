"use client";

import { ErrorBox } from "@/ui";
import { MachinesSection } from "@/features/configure/machines-section";
import { useConfigure } from "@/features/configure/use-configure";
import { ServerContent } from "@/features/logs/server-view";
import { ConnectorsSection } from "@/features/integrations/connectors-section";
import { ConnectorAccessSection } from "@/features/integrations/connector-access-section";
import { PluginsSection } from "@/features/integrations/plugins-section";
import { SkillsSection } from "@/features/integrations/skills-section";
import { GoogleAccountsSection } from "@/features/integrations/google-accounts-section";
import { ModelProvidersSection } from "@/features/integrations/model-providers-section";
import UsagePage from "@/features/usage/usage-page";

/**
 * The sections that moved into Settings when Configure, Usage and the
 * Integrations page collapsed into it (docs/cursor-restructure-plan.md §A).
 * Each wrapper mounts the feature's existing component unchanged — this file
 * is placement, not behavior.
 */

export function MachinesSettingsSection() {
  const state = useConfigure();
  return (
    <>
      {state.error ? <ErrorBox>{state.error}</ErrorBox> : null}
      <MachinesSection state={state} />
    </>
  );
}

export function ServerLogsSection() {
  return <ServerContent embedded />;
}

/** MCP servers with connector access folded beneath them: what a session can
 *  reach, and which models are allowed to reach it, one section. */
export function ToolsMcpSection() {
  return (
    <div className="space-y-10">
      <ConnectorsSection />
      <ConnectorAccessSection />
    </div>
  );
}

export function ExtendSection() {
  return (
    <div className="space-y-10">
      <SkillsSection />
      <PluginsSection />
    </div>
  );
}

export function AccountsSettingsSection() {
  return <GoogleAccountsSection />;
}

export function ModelAccountsSection() {
  return <ModelProvidersSection />;
}

export function UsageSettingsSection() {
  return <UsagePage embedded />;
}
