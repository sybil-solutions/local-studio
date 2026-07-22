"use client";

import { useCallback } from "react";
import { ChevronLeft, DownloadCloud, Zap } from "@/ui/icon-registry";
import { Button, Card, Input, Select } from "@/ui";
import type { ModelDownload, StarterPreset } from "@/lib/types";
import type { ModelIndexVariant } from "@/lib/api/studio";
import { TierSection, useModelIndex } from "@/features/recipes/recipes-content/picks-shared";
import type { GgufFileOption } from "../setup-model-files";

const NO_DOWNLOADS: Map<string, ModelDownload> = new Map();
const NO_STARTING: Set<string> = new Set();

function ModelIndexCatalog({
  presetsCount,
  maxVram,
  beginVariantDownload,
}: {
  presetsCount: number;
  maxVram: number;
  beginVariantDownload: (modelId: string, allowPatterns?: string[]) => void;
}) {
  const { data } = useModelIndex();
  const tiers = data?.tiers ?? [];

  const handleDownload = useCallback(
    (variant: ModelIndexVariant) =>
      beginVariantDownload(
        variant.repo,
        variant.allow_patterns?.length ? variant.allow_patterns : undefined,
      ),
    [beginVariantDownload],
  );

  if (tiers.length === 0) return null;

  const modelCount = tiers.reduce((count, tier) => count + tier.models.length, 0);

  return (
    <details className="group" open={presetsCount === 0}>
      <summary className="flex cursor-pointer items-center justify-between list-none">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-(--dim) uppercase tracking-wider">
            {presetsCount > 0 ? "More models" : "Curated catalog"}
          </span>
          <span className="text-xs text-(--dim)">
            {modelCount} models in {tiers.length} {tiers.length === 1 ? "tier" : "tiers"}
          </span>
        </div>
        <span className="text-xs text-(--dim)">
          Detected VRAM: {maxVram ? `${maxVram.toFixed(1)} GB` : "CPU"}
        </span>
      </summary>
      <div className="mt-4 space-y-5">
        {tiers.map((tier) => (
          <TierSection
            key={tier.id}
            tier={tier}
            poolGb={maxVram}
            downloadsByModel={NO_DOWNLOADS}
            startingModelIds={NO_STARTING}
            onDownload={handleDownload}
          />
        ))}
      </div>
    </details>
  );
}

function PresetCard({
  preset,
  beginPresetSetup,
  remoteApiKey,
  setRemoteApiKey,
  connectingRemote,
  remoteError,
  connectRemotePreset,
}: {
  preset: StarterPreset;
  beginPresetSetup: (preset: StarterPreset) => void;
  remoteApiKey: string;
  setRemoteApiKey: (value: string) => void;
  connectingRemote: boolean;
  remoteError: string | null;
  connectRemotePreset: (preset: StarterPreset) => void;
}) {
  const isRemote = preset.kind === "remote";
  return (
    <Card padding="md">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{preset.name}</div>
        <span className="text-[10px] uppercase tracking-wider text-(--dim)">
          {isRemote ? "remote" : (preset.backend ?? "local")}
        </span>
      </div>
      <div className="font-mono text-[11px] text-(--dim)">
        {preset.model_id ?? preset.remote?.model}
      </div>
      <p className="text-xs text-(--dim) mt-2">{preset.description}</p>
      {!isRemote && (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.08em] text-(--dim) mt-3">
            <span>{preset.size_gb ? `${preset.size_gb} GB` : "—"}</span>
            {preset.min_vram_gb ? (
              <>
                <span>·</span>
                <span>{preset.min_vram_gb} GB VRAM</span>
              </>
            ) : null}
            {preset.fits === false && (
              <>
                <span>·</span>
                <span className="text-(--err)">tight fit</span>
              </>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => beginPresetSetup(preset)}
            className="mt-3"
            icon={<DownloadCloud className="h-3.5 w-3.5" />}
          >
            Download
          </Button>
        </>
      )}
      {isRemote && (
        <div className="mt-3 space-y-2">
          <Input
            type="password"
            value={remoteApiKey}
            onChange={(event) => setRemoteApiKey(event.target.value)}
            placeholder="API key"
          />
          {remoteError && <div className="text-xs text-(--err)">{remoteError}</div>}
          <Button
            size="sm"
            onClick={() => connectRemotePreset(preset)}
            disabled={connectingRemote}
            icon={<Zap className="h-3.5 w-3.5" />}
          >
            {connectingRemote ? "Connecting…" : "Connect"}
          </Button>
        </div>
      )}
    </Card>
  );
}

export function StepModel({
  presets,
  beginPresetSetup,
  remoteApiKey,
  setRemoteApiKey,
  connectingRemote,
  remoteError,
  connectRemotePreset,
  maxVram,
  manualModelId,
  setManualModelId,
  manualGgufOptions,
  manualGgufFile,
  setManualGgufFile,
  resolvingManualModel,
  beginVariantDownload,
  submitManualModel,
  setStep,
}: {
  presets: StarterPreset[];
  beginPresetSetup: (preset: StarterPreset) => void;
  remoteApiKey: string;
  setRemoteApiKey: (value: string) => void;
  connectingRemote: boolean;
  remoteError: string | null;
  connectRemotePreset: (preset: StarterPreset) => void;
  maxVram: number;
  manualModelId: string;
  setManualModelId: (value: string) => void;
  manualGgufOptions: GgufFileOption[];
  manualGgufFile: string;
  setManualGgufFile: (value: string) => void;
  resolvingManualModel: boolean;
  beginVariantDownload: (modelId: string, allowPatterns?: string[]) => void;
  submitManualModel: () => void;
  setStep: (step: number) => void;
}) {
  return (
    <div className="space-y-6">
      {presets.length > 0 && (
        <Card padding="lg">
          <div className="text-sm text-(--dim) uppercase tracking-wider">Recommended paths</div>
          <h2 className="text-lg font-medium">Choose a starting point</h2>
          <div className="grid md:grid-cols-3 gap-4 mt-4">
            {presets.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                beginPresetSetup={beginPresetSetup}
                remoteApiKey={remoteApiKey}
                setRemoteApiKey={setRemoteApiKey}
                connectingRemote={connectingRemote}
                remoteError={remoteError}
                connectRemotePreset={connectRemotePreset}
              />
            ))}
          </div>
        </Card>
      )}

      <ModelIndexCatalog
        presetsCount={presets.length}
        maxVram={maxVram}
        beginVariantDownload={beginVariantDownload}
      />

      <Card padding="lg">
        <div className="text-sm text-(--dim) uppercase tracking-wider">Hugging Face</div>
        <h3 className="text-lg font-medium">Use an exact model ID</h3>
        <div className="flex flex-col sm:flex-row gap-3 mt-3">
          <div className="flex-1">
            <Input
              value={manualModelId}
              onChange={(event) => setManualModelId(event.target.value)}
              placeholder="e.g. meta-llama/Llama-3.1-8B-Instruct"
            />
          </div>
          <Button
            variant="secondary"
            onClick={submitManualModel}
            disabled={resolvingManualModel}
            icon={<DownloadCloud className="h-4 w-4" />}
          >
            {resolvingManualModel ? "Inspecting…" : "Download"}
          </Button>
        </div>
        {manualGgufOptions.length > 1 ? (
          <div className="mt-3">
            <Select
              label="GGUF weights file"
              value={manualGgufFile}
              onChange={(event) => setManualGgufFile(event.target.value)}
              placeholder="Choose one quantization"
              options={manualGgufOptions}
            />
            <p className="mt-2 text-xs text-(--dim)">
              This repository contains multiple weight variants. Local Studio downloads only the
              file you select.
            </p>
          </div>
        ) : null}
        <div className="flex items-center gap-3 mt-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setStep(1)}
            icon={<ChevronLeft className="h-3.5 w-3.5" />}
          >
            Back
          </Button>
        </div>
      </Card>
    </div>
  );
}
