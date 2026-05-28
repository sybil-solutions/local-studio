"use client";

import { ChevronLeft, DownloadCloud } from "lucide-react";
import { Button, Card, Input } from "@/ui";
import type { ModelRecommendation } from "@/lib/types";

export function StepModel({
  recommendations,
  maxVram,
  manualModelId,
  setManualModelId,
  beginDownload,
  submitManualModel,
  setStep,
}: {
  recommendations: ModelRecommendation[];
  maxVram: number;
  manualModelId: string;
  setManualModelId: (value: string) => void;
  beginDownload: (modelId: string) => void;
  submitManualModel: () => void;
  setStep: (step: number) => void;
}) {
  return (
    <div className="space-y-6">
      <Card padding="lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-(--dim) uppercase tracking-wider">Recommended</div>
            <h2 className="text-lg font-medium">Pick a starter model</h2>
          </div>
          <div className="text-xs text-(--dim)">
            Detected VRAM: {maxVram ? `${maxVram.toFixed(1)} GB` : "CPU"}
          </div>
        </div>
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
      </Card>

      <Card padding="lg">
        <div className="text-sm text-(--dim) uppercase tracking-wider">Manual</div>
        <h3 className="text-lg font-medium">Download by model ID</h3>
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
            icon={<DownloadCloud className="h-4 w-4" />}
          >
            Download
          </Button>
        </div>
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
