// CRITICAL
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
}

export interface RuntimeSummaryData {
  platform: { kind: RuntimePlatformKind; vendor: "nvidia" | "amd" | null };
  gpu_monitoring: RuntimeGpuMonitoringInfo;
  backends: {
    vllm: RuntimeBackendInfo;
    sglang: RuntimeBackendInfo;
    llamacpp: RuntimeBackendInfo;
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

export interface JobEntry {
  id: string;
  type: string;
  status: string;
  progress: number;
  updated_at: string;
}

export interface RealtimeStatusSnapshot {
  status: StatusData | null;
  gpus: GPU[];
  metrics: Metrics | null;
  launchProgress: LaunchProgressData | null;
  platformKind: RuntimePlatformKind | null;
  runtimeSummary: RuntimeSummaryData | null;
  services: ServiceEntry[];
  lease: LeaseInfo | null;
  jobs: JobEntry[];
  lastEventAt: number;
}
