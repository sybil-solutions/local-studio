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

export interface RuntimeUpgradeResult {
  success: boolean;
  version: string | null;
  output: string | null;
  error: string | null;
  used_command: string | null;
}

export interface VllmUpgradeResult extends RuntimeUpgradeResult {
  used_wheel: string | null;
}

export interface RuntimeCommandPayload {
  command?: string;
  args?: string[];
}
