import type {
  GPU,
  LaunchProgressData,
  Metrics,
  ProcessInfo,
  RuntimePlatformKind,
  RuntimeGpuMonitoringInfo,
  RuntimeBackendInfo,
} from "@/lib/types";

export interface StatusData {
  running: boolean;
  process: ProcessInfo | null;
  inference_port: number;
  launching: string | null;
}

export interface RuntimeSummaryData {
  platform: { kind: RuntimePlatformKind; vendor: "nvidia" | "amd" | null };
  gpu_monitoring: RuntimeGpuMonitoringInfo;
  backends: {
    vllm: RuntimeBackendInfo;
    sglang: RuntimeBackendInfo;
    llamacpp: RuntimeBackendInfo;
    mlx?: RuntimeBackendInfo;
    exllamav3?: RuntimeBackendInfo;
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
  gpus: GPU[];
  metrics: Metrics | null;
  launchProgress: LaunchProgressData | null;
  platformKind: RuntimePlatformKind | null;
  runtimeSummary: RuntimeSummaryData | null;
  services: ServiceEntry[];
  lease: LeaseInfo | null;
  lastEventAt: number;
}
