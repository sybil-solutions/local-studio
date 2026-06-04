"use client";

import { ChevronRight, Cpu } from "lucide-react";
import {
  Button,
  Card,
  Checkbox,
  ManagedRuntimeInstallRows,
  RuntimeTargetRows,
  SETUP_RUNTIME_BACKENDS,
  SettingsGroup,
  SettingsNotice,
  isManagedRuntimeTarget,
  type ManagedRuntimeInstallBackend,
} from "@/ui";
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
        <div className="grid md:grid-cols-2 gap-4 text-sm text-(--dim)">
          <div>
            <div className="text-xs text-(--dim) mb-1">CPU</div>
            <div>{hardware.cpu}</div>
          </div>
          <div>
            <div className="text-xs text-(--dim) mb-1">Memory</div>
            <div>{hardware.memory}</div>
          </div>
          <div>
            <div className="text-xs text-(--dim) mb-1">GPU</div>
            <div>{hardware.gpu}</div>
          </div>
          <div>
            <div className="text-xs text-(--dim) mb-1">VRAM</div>
            <div>{hardware.vram}</div>
          </div>
        </div>
      </Card>

      <SettingsGroup
        title="Runtime setup"
        description="Controller-managed Python environments for guided local inference."
      >
        <ManagedRuntimeInstallRows
          backends={SETUP_RUNTIME_BACKENDS}
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

      <Card padding="lg" className="space-y-4">
        <Checkbox
          checked={hardwareConfirmed}
          onChange={setHardwareConfirmed}
          className="rounded-lg border border-(--ui-border) bg-(--ui-surface)/40 px-4 py-3"
          label="I confirmed this hardware summary matches the device I am onboarding, and I want vLLM Studio to continue using these detected capabilities."
          labelClassName="font-normal"
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={continueFromHardware}
            disabled={!hardwareConfirmed || upgrading}
            icon={<ChevronRight className="h-4 w-4" />}
          >
            Continue
          </Button>
        </div>
      </Card>
    </div>
  );
}
