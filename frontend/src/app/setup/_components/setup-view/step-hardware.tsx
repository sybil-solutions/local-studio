"use client";

import { ChevronRight, Cpu, DownloadCloud, HardDrive, Loader2 } from "lucide-react";
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
      <div className="bg-(--bg) border border-(--surface) rounded-lg p-6 space-y-4">
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
      </div>

      <div className="bg-(--bg) border border-(--surface) rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-3">
          <HardDrive className="h-5 w-5 text-(--hl1)" />
          <h2 className="text-lg font-medium">Runtime</h2>
        </div>
        <div className="text-sm text-(--dim)">{hardware.runtime}</div>
        {upgradeMessage && (
          <div className={`text-xs ${upgradeMessage.toneClassName}`}>{upgradeMessage.text}</div>
        )}
        <label className="flex items-start gap-3 rounded-lg border border-(--surface) bg-(--surface)/40 px-4 py-3 text-sm text-(--dim)">
          <input
            type="checkbox"
            checked={hardwareConfirmed}
            onChange={(event) => setHardwareConfirmed(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-(--border) bg-(--bg)"
          />
          <span>
            I confirmed this hardware summary matches the device I am onboarding, and I want vLLM
            Studio to continue using these detected capabilities.
          </span>
        </label>
        <div className="flex items-center gap-3">
          <button
            onClick={upgradeRuntime}
            disabled={upgrading}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-(--surface) text-sm hover:bg-(--surface) disabled:opacity-60"
          >
            {upgrading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <DownloadCloud className="h-4 w-4" />
            )}
            Install / Upgrade vLLM
          </button>
          <button
            onClick={continueFromHardware}
            disabled={!hardwareConfirmed}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-(--hl1) text-white text-sm hover:opacity-90 disabled:opacity-50"
          >
            Continue
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
