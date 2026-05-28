/**
 * App-level settings + diagnostics.
 */

import type { GPU } from "./metrics";
import type { SystemConfig } from "./config";

export interface StudioSettings {
  config_path: string;
  persisted: {
    models_dir?: string;
    ui_preferences?: Record<string, string>;
  };
  effective: {
    models_dir: string;
  };
}

export interface StudioDiagnostics {
  app_version: string;
  timestamp: string;
  platform: string;
  arch: string;
  release: string;
  cpu_model: string | null;
  cpu_cores: number;
  memory_total: number;
  memory_free: number;
  gpus: GPU[];
  runtime: {
    vllm_installed: boolean;
    vllm_version: string | null;
    python_path: string | null;
    vllm_bin: string | null;
  };
  disks: Array<{
    path: string;
    total_bytes: number | null;
    free_bytes: number | null;
    available_bytes: number | null;
  }>;
  config: SystemConfig;
}
