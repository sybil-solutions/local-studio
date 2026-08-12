"use client";

import { Button, Checkbox } from "@/ui";
import { SettingsGroup, SettingsNotice } from "@/features/settings/settings-ui";
import {
  ManagedRuntimeInstallRows,
  RuntimeTargetRows,
  isManagedRuntimeTarget,
  managedRuntimeBackendsFor,
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
      : managedRuntimeBackendsFor(runtimeTargets);
  const visibleTargets = runtimeTargets
    .filter(
      (target) =>
        !isManagedRuntimeTarget(target) &&
        (target.installed || target.active || target.source === "configured"),
    )
    .slice(0, 8);

  const facts: readonly [string, string][] = [
    ["CPU", hardware.cpu],
    ["Memory", hardware.memory],
    ["GPU", hardware.gpu],
    ["VRAM", hardware.vram],
  ];

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[10px] border border-(--ui-border) bg-(--ui-surface)/40">
        {facts.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between border-b border-(--ui-border)/60 px-5 py-3 last:border-b-0"
          >
            <span className="text-[length:var(--fs-sm)] text-(--ui-muted)">{label}</span>
            <span className="font-mono text-[length:var(--fs-sm)] text-(--fg)">{value}</span>
          </div>
        ))}
      </div>

      <SettingsGroup
        title="Runtimes"
        description="Managed engines for this hardware. Install what the model you pick needs — or let the next step decide."
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

      <div className="flex items-center justify-between gap-4">
        <Checkbox
          checked={hardwareConfirmed}
          onChange={setHardwareConfirmed}
          label="This is the machine that will run models."
          labelClassName="font-normal"
        />
        <Button onClick={continueFromHardware} disabled={!hardwareConfirmed || upgrading}>
          Continue
        </Button>
      </div>
    </div>
  );
}
