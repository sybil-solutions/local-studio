"use client";

import { ChevronRight, Cpu, DownloadCloud, HardDrive, Loader2 } from "lucide-react";
import { Button, Card, Checkbox } from "@/ui";
import type { StudioDiagnostics, VllmUpgradeResult } from "@/lib/types";
import { buildHardwareSummary, buildUpgradeMessage } from "./step-hardware-model";

export function StepHardware({
  diagnostics,
  upgradeRuntime,
  upgrading,
  upgradeResult,
  hardwareConfirmed,
  setHardwareConfirmed,
  continueFromHardware,
}: {
  diagnostics: StudioDiagnostics | null;
  upgradeRuntime: () => void;
  upgrading: boolean;
  upgradeResult: VllmUpgradeResult | null;
  hardwareConfirmed: boolean;
  setHardwareConfirmed: (value: boolean) => void;
  continueFromHardware: () => void;
}) {
  const hardware = buildHardwareSummary(diagnostics);
  const upgradeMessage = buildUpgradeMessage(upgradeResult);

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

      <Card padding="lg" className="space-y-4">
        <div className="flex items-center gap-3">
          <HardDrive className="h-5 w-5 text-(--hl1)" />
          <h2 className="text-lg font-medium">Runtime</h2>
        </div>
        <div className="text-sm text-(--dim)">{hardware.runtime}</div>
        {upgradeMessage && (
          <div className={`text-xs ${upgradeMessage.toneClassName}`}>{upgradeMessage.text}</div>
        )}
        <Checkbox
          checked={hardwareConfirmed}
          onChange={setHardwareConfirmed}
          className="rounded-lg border border-(--ui-border) bg-(--ui-surface)/40 px-4 py-3"
          label="I confirmed this hardware summary matches the device I am onboarding, and I want vLLM Studio to continue using these detected capabilities."
          labelClassName="font-normal"
        />
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={upgradeRuntime}
            disabled={upgrading}
            icon={
              upgrading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <DownloadCloud className="h-4 w-4" />
              )
            }
          >
            Install / Upgrade vLLM
          </Button>
          <Button
            onClick={continueFromHardware}
            disabled={!hardwareConfirmed}
            icon={<ChevronRight className="h-4 w-4" />}
          >
            Continue
          </Button>
        </div>
      </Card>
    </div>
  );
}
