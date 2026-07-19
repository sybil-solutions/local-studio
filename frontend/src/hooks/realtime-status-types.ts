import type {
  GPU,
  LaunchProgressData,
  Metrics,
  ProcessInfo,
  RuntimeGpuMonitoringInfo,
  RuntimeBackendInfo,
  RuntimePlatformKind,
} from "@/lib/types";

export interface StatusData {
  running: boolean;
  process: ProcessInfo | null;
  inference_port: number;
  launching: string | null;
}

export interface RuntimeSummaryData {
  platform: { kind: RuntimePlatformKind; vendor: "nvidia" | "amd" | "apple" | null };
  gpu_monitoring: RuntimeGpuMonitoringInfo;
  backends: {
    vllm: RuntimeBackendInfo;
    sglang: RuntimeBackendInfo;
    llamacpp: RuntimeBackendInfo;
    mlx?: RuntimeBackendInfo;
  };
}

export interface ServiceEntry {
  id: string;
  kind: string;
  status: string;
  last_error?: string | null;
}

export interface LeaseInfo {
  holder: string | null;
  since: string | null;
}

export interface RealtimeStatusSnapshot {
  status: StatusData | null;
  statusLoading: boolean;
  /** Controller reachability: the last poll succeeded or a live event arrived. */
  connected: boolean;
  gpus: GPU[];
  metrics: Metrics | null;
  launchProgress: LaunchProgressData | null;
  platformKind: RuntimePlatformKind | null;
  runtimeSummary: RuntimeSummaryData | null;
  services: ServiceEntry[];
  lease: LeaseInfo | null;
  lastEventAt: number;
}

// Pure derivations over the realtime status snapshot. No state, no IO — the
// realtime-status-store owns the data; consumers derive their views here.

export function isActiveLaunchStage(
  stage: LaunchProgressData["stage"] | null | undefined,
): boolean {
  return (
    stage === "preempting" || stage === "evicting" || stage === "launching" || stage === "waiting"
  );
}

export type SidebarStatusSnapshot = {
  online: boolean;
  inferenceOnline: boolean;
  model: string | null;
  activityLine: string;
};

function computeModelName(process: ProcessInfo | null | undefined): string | null {
  if (!process) return null;
  const served = process.served_model_name;
  if (typeof served === "string" && served.trim()) return served.trim();
  const modelPath = process.model_path;
  if (typeof modelPath === "string" && modelPath.trim())
    return modelPath.split("/").pop() ?? modelPath;
  return null;
}

export function sidebarStatusFromSnapshot(
  snapshot: Pick<RealtimeStatusSnapshot, "connected" | "status" | "launchProgress">,
): SidebarStatusSnapshot {
  const { connected, status, launchProgress } = snapshot;
  const inferenceOnline = Boolean(status?.running || status?.process);
  const model = computeModelName(status?.process);
  const launchMessage =
    launchProgress && isActiveLaunchStage(launchProgress.stage) ? launchProgress.message : null;

  const activityLine = launchMessage
    ? launchMessage
    : inferenceOnline
      ? model || "Ready"
      : connected
        ? "No model"
        : "Offline";

  return { online: connected, inferenceOnline, model, activityLine };
}
