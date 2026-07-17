"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ErrorBox, StatusPill } from "@/ui";
import {
  Boxes,
  ChevronRight,
  Gauge,
  Monitor,
  Plug,
  Server,
  type LucideIcon,
} from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { SettingsLayout, type SettingsSectionDef } from "@/features/settings/settings-ui";
import { RecipesContent } from "@/features/recipes/recipes-content/recipes-content";
import { IntegrationsContent } from "@/features/integrations/integrations-page";
import { ServerContent } from "@/features/logs/server-view";
import { useConfigure } from "./use-configure";
import { RigsSection } from "./rigs-section";
import { configureSectionFromHash, type ConfigureSectionId } from "./configure-navigation";

const sectionIcon = (Icon: LucideIcon) => <Icon className="h-3.5 w-3.5" />;

const CONFIGURE_SECTIONS: SettingsSectionDef<ConfigureSectionId>[] = [
  {
    id: "overview",
    label: "Overview",
    description: "Workspace hardware, models, integrations, and controller tools.",
    icon: sectionIcon(Gauge),
  },
  {
    id: "rig",
    label: "Machines",
    description: "Hardware available for running local and remote models.",
    icon: sectionIcon(Monitor),
  },
  {
    id: "models",
    label: "Models",
    description: "Find weights, manage serves, and monitor downloads.",
    icon: sectionIcon(Boxes),
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "Plugins, connectors, accounts, and reusable skills.",
    icon: sectionIcon(Plug),
  },
  {
    id: "server",
    label: "Server",
    description: "Controller health, runtime details, logs, and API docs.",
    icon: sectionIcon(Server),
  },
];

function OverviewRow({
  icon,
  title,
  description,
  detail,
  ready,
  onOpen,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  detail: string;
  ready?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-4 px-5 py-5 text-left transition-colors hover:bg-(--ui-hover)/40"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-(--ui-border) bg-(--surface-3) text-(--ui-muted)">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[length:var(--fs-lg)] font-medium text-(--ui-fg)">{title}</span>
          {ready === undefined ? null : (
            <StatusPill tone={ready ? "good" : "default"}>{ready ? "Ready" : "Not set"}</StatusPill>
          )}
        </span>
        <span className="mt-1 block text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
          {description}
        </span>
      </span>
      <span className="hidden shrink-0 text-right sm:block">
        <span className="block text-[length:var(--fs-sm)] font-medium text-(--ui-fg)">
          {detail}
        </span>
        <span className="mt-0.5 block text-[length:var(--fs-xs)] text-(--ui-muted)">Manage</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-(--ui-muted) transition-transform group-hover:translate-x-0.5 group-hover:text-(--ui-fg)" />
    </button>
  );
}

export default function ConfigurePage() {
  const state = useConfigure();
  const searchParams = useSearchParams();
  const requestedSection = configureSectionFromHash(searchParams.get("section") ?? "");
  const [section, setSection] = useState<ConfigureSectionId>(requestedSection);

  useMountSubscription(() => {
    const syncSection = () => {
      const hashSection = configureSectionFromHash(window.location.hash);
      setSection(hashSection === "overview" ? requestedSection : hashSection);
    };
    syncSection();
    const onHashChange = () => syncSection();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [requestedSection]);

  const selectSection = (next: ConfigureSectionId) => {
    setSection(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "overview") params.delete("section");
    else params.set("section", next);
    const query = params.size ? `?${params.toString()}` : "";
    window.history.replaceState(null, "", `${window.location.pathname}${query}#${next}`);
  };

  const machines = state.rigs.flatMap((rig) => rig.nodes);
  const gpuMemory = machines.reduce(
    (sum, node) =>
      sum +
      node.accelerators.reduce(
        (nodeSum, accelerator) => nodeSum + (accelerator.memory_gb ?? 0) * accelerator.count,
        0,
      ),
    0,
  );
  const machineSection = section === "overview" || section === "rig";

  return (
    <SettingsLayout
      sections={CONFIGURE_SECTIONS}
      activeSection={section}
      title="Configure"
      eyebrow="Workspace"
      width="wide"
      loading={state.refreshing || state.loading}
      showRefresh={machineSection}
      onReload={state.reload}
      onSelectSection={selectSection}
    >
      {machineSection && state.error ? <ErrorBox>{state.error}</ErrorBox> : null}

      {section === "overview" ? (
        <div className="space-y-7">
          <section>
            <h2 className="text-[length:var(--fs-xl)] font-medium text-(--ui-fg)">Configuration</h2>
            <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">
              Everything Local Studio needs to run models, in one place.
            </p>
            <div className="mt-4 divide-y divide-(--ui-separator) overflow-hidden rounded-xl border border-(--ui-border) bg-(--ui-surface)">
              <OverviewRow
                icon={<Monitor className="h-5 w-5" />}
                title="Machines"
                description="Computers that provide CPU, memory, and GPUs for inference."
                detail={`${machines.length} machine${machines.length === 1 ? "" : "s"}${gpuMemory ? ` · ${gpuMemory} GB GPU` : ""}`}
                ready={machines.length > 0}
                onOpen={() => selectSection("rig")}
              />
              <OverviewRow
                icon={<Boxes className="h-5 w-5" />}
                title="Models"
                description="Find weights, create serving profiles, and manage downloads."
                detail="Get · serve · download"
                onOpen={() => selectSection("models")}
              />
              <OverviewRow
                icon={<Plug className="h-5 w-5" />}
                title="Integrations"
                description="Connect capability bundles, tools, services, accounts, and skills."
                detail="Plugins · connectors · skills"
                onOpen={() => selectSection("integrations")}
              />
              <OverviewRow
                icon={<Server className="h-5 w-5" />}
                title="Server"
                description="Inspect the controller, inference runtime, logs, and API reference."
                detail="Health · logs · API docs"
                onOpen={() => selectSection("server")}
              />
            </div>
          </section>

          <section className="rounded-xl border border-(--ui-border) bg-(--ui-surface) px-5 py-4">
            <h3 className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">
              Automatic by default
            </h3>
            <p className="mt-1 max-w-[42rem] text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
              Local hardware stays synchronized automatically. You only need to add a machine when
              another computer contributes GPUs, or edit a model profile when its launch behavior
              needs to change.
            </p>
          </section>
        </div>
      ) : null}

      {section === "rig" ? <RigsSection state={state} /> : null}

      {section === "models" ? <RecipesContent embedded /> : null}
      {section === "integrations" ? <IntegrationsContent /> : null}
      {section === "server" ? <ServerContent embedded /> : null}
    </SettingsLayout>
  );
}
