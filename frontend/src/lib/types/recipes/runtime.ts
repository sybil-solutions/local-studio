import type { RuntimeUpgradeResult } from "../../../../../shared/contracts/system";

export interface VllmRuntimeInfo {
  installed: boolean;
  version: string | null;
  python_path: string | null;
  vllm_bin: string | null;
  upgrade_command_available?: boolean;
  bundled_wheel: {
    path: string;
    version: string | null;
  } | null;
}

export interface VllmRuntimeConfig {
  config: string | null;
  error?: string | null;
}

export type { RuntimeUpgradeResult } from "../../../../../shared/contracts/system";

export interface RuntimeJobResponse {
  job_id: string;
  job: import("../system/config").EngineJob;
}

export interface VllmUpgradeResult extends RuntimeUpgradeResult {
  used_wheel: string | null;
}

export interface RuntimeCommandPayload {
  command?: string;
  args?: string[];
}
