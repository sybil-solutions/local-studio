"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  HardDrive,
  Pause,
  Play,
  XCircle,
} from "@/ui/icon-registry";
import { Button, Card } from "@/ui";
import type { ModelDownload } from "@/lib/types";
import { countAdditionalQueuedDownloads } from "../setup-downloads";
import { formatBytes, progressPercent } from "./utils";

export function StepDownload({
  selectedModel,
  modelsDir,
  downloads,
  activeDownload,
  pauseDownload,
  resumeDownload,
  cancelDownload,
  continueToLaunch,
  backToModels,
}: {
  selectedModel: string;
  modelsDir: string;
  downloads: ModelDownload[];
  activeDownload: ModelDownload | null;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
  cancelDownload: (id: string) => void;
  continueToLaunch: () => void;
  backToModels: () => void;
}) {
  const additionalQueuedDownloads = countAdditionalQueuedDownloads(downloads, activeDownload?.id);

  return (
    <div className="space-y-5">
      <Card padding="lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-(--dim) uppercase tracking-wider">Download</div>
            <h2 className="text-lg font-medium">Fetching {selectedModel || "model"}</h2>
          </div>
          {activeDownload && <span className="text-xs text-(--dim)">{activeDownload.status}</span>}
        </div>
        {activeDownload ? (
          <div className="mt-4 space-y-3">
            <div className="h-2 bg-(--surface) rounded-full">
              <div
                className="h-2 rounded-full bg-(--hl1) transition-all"
                style={{ width: `${progressPercent(activeDownload)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-(--dim)">
              <span>
                {formatBytes(activeDownload.downloaded_bytes)} /{" "}
                {formatBytes(activeDownload.total_bytes)}
              </span>
              <span>{progressPercent(activeDownload)}%</span>
            </div>
            {activeDownload.error && (
              <div className="text-xs text-(--err)">{activeDownload.error}</div>
            )}
            <div className="flex items-center gap-3">
              {activeDownload.status === "downloading" && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => pauseDownload(activeDownload.id)}
                  icon={<Pause className="h-3.5 w-3.5" />}
                >
                  Pause
                </Button>
              )}
              {(activeDownload.status === "paused" || activeDownload.status === "failed") && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => resumeDownload(activeDownload.id)}
                  icon={<Play className="h-3.5 w-3.5" />}
                >
                  Resume
                </Button>
              )}
              {activeDownload.status !== "completed" && activeDownload.status !== "canceled" && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => cancelDownload(activeDownload.id)}
                  icon={<XCircle className="h-3.5 w-3.5" />}
                >
                  Cancel
                </Button>
              )}
              {activeDownload.status === "canceled" && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={backToModels}
                  icon={<ChevronLeft className="h-3.5 w-3.5" />}
                >
                  Back to model selection
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-sm text-(--dim) mt-4">No active download yet.</div>
        )}
      </Card>

      <Card padding="lg" className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-(--dim)">
          {activeDownload?.status === "completed" ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-(--hl2)" />
              Weights are ready. Continue to bind a runtime and create the Serve.
            </>
          ) : (
            <>
              <HardDrive className="h-4 w-4 text-(--dim)" />
              Controller destination: {modelsDir}
            </>
          )}
        </div>
        <Button
          onClick={continueToLaunch}
          disabled={activeDownload?.status !== "completed"}
          icon={<ChevronRight className="h-4 w-4" />}
        >
          Configure Serve
        </Button>
      </Card>

      {additionalQueuedDownloads > 0 && (
        <div className="text-xs text-(--dim)">
          Additional downloads in queue: {additionalQueuedDownloads}
        </div>
      )}
    </div>
  );
}
