"use client";

import { ChevronLeft, DownloadCloud, Zap } from "@/ui/icon-registry";
import { Button, Card, Input, Select } from "@/ui";
import type { ModelRecommendation, StarterPreset } from "@/lib/types";
import type { GgufFileOption } from "../setup-model-files";

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
  recommendations,
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
  beginDownload,
  submitManualModel,
  setStep,
}: {
  recommendations: ModelRecommendation[];
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
  beginDownload: (modelId: string) => void;
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

      {recommendations.length > 0 && (
        <details className="group" open={presets.length === 0}>
          <summary className="flex cursor-pointer items-center justify-between list-none">
            <div className="flex items-baseline gap-2">
              <span className="text-sm text-(--dim) uppercase tracking-wider">
                {presets.length > 0 ? "More models" : "Recommended"}
              </span>
              <span className="text-xs text-(--dim)">
                {recommendations.length} for your hardware
              </span>
            </div>
            <span className="text-xs text-(--dim)">
              Detected VRAM: {maxVram ? `${maxVram.toFixed(1)} GB` : "CPU"}
            </span>
          </summary>
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            {recommendations.map((model) => (
              <Card key={model.id} padding="md">
                <div className="text-sm font-medium">{model.name}</div>
                <div className="text-xs text-(--dim)">{model.id}</div>
                <p className="text-xs text-(--dim) mt-2">{model.description}</p>
                <div className="flex items-center gap-2 text-xs text-(--dim) mt-3">
                  <span>{model.size_gb ?? "-"} GB</span>
                  <span>·</span>
                  <span>{model.min_vram_gb ?? "-"} GB VRAM</span>
                </div>
                <Button
                  size="sm"
                  onClick={() => beginDownload(model.id)}
                  className="mt-3"
                  icon={<DownloadCloud className="h-3.5 w-3.5" />}
                >
                  Download
                </Button>
              </Card>
            ))}
          </div>
        </details>
      )}

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
