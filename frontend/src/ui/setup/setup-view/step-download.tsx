"use client";

import { CheckCircle2, ChevronRight, HardDrive, Pause, Play, XCircle } from "lucide-react";
import { Button, Card } from "@/ui";
import type { ModelDownload } from "@/lib/types";
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
}: {
  selectedModel: string;
  modelsDir: string;
  downloads: ModelDownload[];
  activeDownload: ModelDownload | null;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
  cancelDownload: (id: string) => void;
  continueToLaunch: () => void;
}) {
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
              {activeDownload.status !== "completed" && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => cancelDownload(activeDownload.id)}
                  icon={<XCircle className="h-3.5 w-3.5" />}
                >
                  Cancel
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
              Model ready. Continue to configure the starter recipe and launch it.
            </>
          ) : (
            <>
              <HardDrive className="h-4 w-4 text-(--dim)" />
              Downloading to {modelsDir}
            </>
          )}
        </div>
        <Button
          onClick={continueToLaunch}
          disabled={activeDownload?.status !== "completed"}
          icon={<ChevronRight className="h-4 w-4" />}
        >
          Continue to Launch
        </Button>
      </Card>

      {downloads.length > 1 && (
        <div className="text-xs text-(--dim)">
          Additional downloads in queue: {downloads.length - 1}
        </div>
      )}
    </div>
  );
}
