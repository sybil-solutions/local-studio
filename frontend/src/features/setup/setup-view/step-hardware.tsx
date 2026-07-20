"use client";

import { ChevronRight, Cpu } from "@/ui/icon-registry";
import { Button, Card, Checkbox } from "@/ui";
import { SettingsGroup, SettingsNotice } from "@/features/settings/settings-ui";
import { FactGrid } from "@/features/setup/fact-grid";
import {
  MANAGED_RUNTIME_BACKENDS,
  ManagedRuntimeInstallRows,
  RuntimeTargetRows,
  isManagedRuntimeTarget,
  type ManagedRuntimeInstallBackend,
} from "@/features/settings/runtime-targets";
import type { EngineJob, RuntimeTarget, StudioDiagnostics } from "@/lib/types";
import { buildHardwareSummary } from "./step-hardware-model";

export function StepHardware({
  diagnostics,
  runtimeTargets,
  runtimeJobs,
  installRuntime,
  updateRuntimeTarget,
  upgrading,
  hardwareConfirmed,
  setHardwareConfirmed,
  continueFromHardware,
}: {
  diagnostics: StudioDiagnostics | null;
  runtimeTargets: RuntimeTarget[];
  runtimeJobs: EngineJob[];
  installRuntime: (backend: ManagedRuntimeInstallBackend) => void;
  updateRuntimeTarget: (target: RuntimeTarget) => void;
  upgrading: boolean;
  hardwareConfirmed: boolean;
  setHardwareConfirmed: (value: boolean) => void;
  continueFromHardware: () => void;
}) {
  const hardware = buildHardwareSummary(diagnostics);
  const managedBackends =
    diagnostics?.platform === "darwin" && diagnostics.arch === "arm64"
      ? (["mlx"] as const)
      : MANAGED_RUNTIME_BACKENDS;
  const visibleTargets = runtimeTargets
    .filter(
      (target) =>
        !isManagedRuntimeTarget(target) &&
        (target.installed || target.active || target.source === "configured"),
    )
    .slice(0, 8);

  return (
    <div className="grid gap-6">
      <Card padding="lg" className="space-y-4">
        <div className="flex items-center gap-3">
          <Cpu className="h-5 w-5 text-(--hl1)" />
          <h2 className="text-lg font-medium">Hardware Check</h2>
        </div>
        <FactGrid
          items={[
            { label: "CPU", value: hardware.cpu },
            { label: "Memory", value: hardware.memory },
            { label: "GPU", value: hardware.gpu },
            { label: "VRAM", value: hardware.vram },
          ]}
        />
      </Card>

      <Card padding="lg" className="space-y-4">
        <Checkbox
          checked={hardwareConfirmed}
          onChange={setHardwareConfirmed}
          className="rounded-lg border border-(--ui-border) bg-(--ui-surface)/40 px-4 py-3"
          label="Configure models and runtimes on this controller."
          labelClassName="font-normal"
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={continueFromHardware}
            disabled={!hardwareConfirmed || upgrading}
            icon={<ChevronRight className="h-4 w-4" />}
          >
            Choose a model
          </Button>
        </div>
      </Card>

      <SettingsGroup
        title="Runtime setup"
        description="Controller-managed Python environments for guided inference on the active target."
      >
        <ManagedRuntimeInstallRows
          backends={managedBackends}
          jobs={runtimeJobs}
          targets={runtimeTargets}
          onInstall={installRuntime}
          onUpdateTarget={updateRuntimeTarget}
        />
        {visibleTargets.length > 0 ? (
          <RuntimeTargetRows
            targets={visibleTargets}
            jobs={runtimeJobs}
            onAction={updateRuntimeTarget}
          />
        ) : (
          <SettingsNotice tone="info" className="m-3">
            {hardware.runtime}
          </SettingsNotice>
        )}
      </SettingsGroup>
    </div>
  );
}
