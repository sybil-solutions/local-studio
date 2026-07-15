"use client";

import { useState, type ReactNode } from "react";
import {
  AppPage,
  ErrorBox,
  PageContainer,
  PageHeader,
  RefreshButton,
  StatusPill,
  Tabs,
} from "@/ui";
import { Boxes, ChevronRight, Server } from "@/ui/icon-registry";
import { useConfigure } from "./use-configure";
import { RigsSection } from "./rigs-section";
import { ModelsSection } from "./models-section";

type ConfigureSectionId = "overview" | "rig" | "models";

const CONFIGURE_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "rig", label: "Machines" },
  { id: "models", label: "Model Profiles" },
] satisfies Array<{ id: ConfigureSectionId; label: string }>;

const initialSection = (): ConfigureSectionId => {
  if (typeof window === "undefined") return "overview";
  if (window.location.hash === "#rig") return "rig";
  if (window.location.hash === "#models") return "models";
  return "overview";
};

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
  ready: boolean;
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
          <StatusPill tone={ready ? "good" : "default"}>{ready ? "Ready" : "Not set"}</StatusPill>
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
  const [section, setSection] = useState<ConfigureSectionId>(initialSection);

  const selectSection = (next: ConfigureSectionId) => {
    setSection(next);
    window.history.replaceState(null, "", next === "overview" ? "#overview" : `#${next}`);
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
  const runningProfiles = state.recipes.filter((recipe) => recipe.status === "running").length;

  return (
    <AppPage>
      <PageContainer width="sm" className="pt-6 sm:pt-8">
        <PageHeader
          eyebrow="Workspace"
          title="Configure"
          description="Manage the machines and model profiles available to Local Studio."
          actions={
            <RefreshButton
              onRefresh={state.reload}
              loading={state.refreshing || state.loading}
              className="h-8 w-8"
            />
          }
        />

        <div className="mt-7 border-b border-(--ui-separator)">
          <Tabs
            items={CONFIGURE_SECTIONS}
            activeTab={section}
            onSelectTab={selectSection}
            className="-mb-px"
          />
        </div>

        <div className="mt-8">
          {state.error ? <ErrorBox>{state.error}</ErrorBox> : null}

          {section === "overview" ? (
            <div className="space-y-7">
              <section>
                <h2 className="text-[length:var(--fs-xl)] font-medium text-(--ui-fg)">
                  Configuration
                </h2>
                <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">
                  Everything Local Studio needs to run models, in one place.
                </p>
                <div className="mt-4 divide-y divide-(--ui-separator) overflow-hidden rounded-xl border border-(--ui-border) bg-(--ui-surface)">
                  <OverviewRow
                    icon={<Server className="h-5 w-5" />}
                    title="Machines"
                    description="Computers that provide CPU, memory, and GPUs for inference."
                    detail={`${machines.length} machine${machines.length === 1 ? "" : "s"}${gpuMemory ? ` · ${gpuMemory} GB GPU` : ""}`}
                    ready={machines.length > 0}
                    onOpen={() => selectSection("rig")}
                  />
                  <OverviewRow
                    icon={<Boxes className="h-5 w-5" />}
                    title="Model profiles"
                    description="Saved launch configurations for engines, GPUs, and context limits."
                    detail={`${state.recipes.length} saved${runningProfiles ? ` · ${runningProfiles} running` : ""}`}
                    ready={state.recipes.length > 0}
                    onOpen={() => selectSection("models")}
                  />
                </div>
              </section>

              <section className="rounded-xl border border-(--ui-border) bg-(--ui-surface) px-5 py-4">
                <h3 className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">
                  Automatic by default
                </h3>
                <p className="mt-1 max-w-[42rem] text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
                  Local hardware stays synchronized automatically. You only need to add a machine
                  when another computer contributes GPUs, or edit a model profile when its launch
                  behavior needs to change.
                </p>
              </section>
            </div>
          ) : null}

          {section === "rig" ? (
            <section>
              <h2 className="text-[length:var(--fs-2xl)] font-medium tracking-[-0.015em] text-(--ui-fg)">
                Machines
              </h2>
              <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">
                Hardware available for running models. Detected specifications update automatically.
              </p>
              <div className="mt-6">
                <RigsSection state={state} />
              </div>
            </section>
          ) : null}

          {section === "models" ? (
            <section>
              <h2 className="text-[length:var(--fs-2xl)] font-medium tracking-[-0.015em] text-(--ui-fg)">
                Model Profiles
              </h2>
              <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">
                Saved configurations that define how each model launches and appears in the API.
              </p>
              <div className="mt-6">
                <ModelsSection state={state} />
              </div>
            </section>
          ) : null}
        </div>
      </PageContainer>
    </AppPage>
  );
}
