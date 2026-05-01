import {
  createStateMachine,
  type StateMachineContainer,
  type StateMachineTransition,
} from "@/lib/state-machine";
import type {
  RuntimeBackendInfo,
  RuntimeCudaInfo,
  RuntimeRocmInfo,
  RuntimeUpgradeResult,
  VllmRuntimeConfig,
  VllmRuntimeInfo,
  VllmUpgradeResult,
} from "@/lib/types";

export type RuntimeBackendKind = "vllm" | "sglang" | "llamacpp" | "cuda" | "rocm";

export interface RuntimeCard {
  backend: RuntimeBackendKind;
  title: string;
  installed: boolean;
  version: string | null;
  pathLabel: string;
  pathValue: string | null;
  canUpgrade: boolean;
  upgrading: boolean;
  disabledReason?: string;
}

export interface RuntimePanelState {
  vllmRuntime: VllmRuntimeInfo | null;
  sglangRuntime: RuntimeBackendInfo | null;
  llamacppRuntime: RuntimeBackendInfo | null;
  cudaRuntime: RuntimeCudaInfo | null;
  rocmRuntime: RuntimeRocmInfo | null;
  runtimeConfig: VllmRuntimeConfig | null;
  runtimeError: string | null;
  runtimeLoading: boolean;
  runtimeConfigLoading: boolean;
  upgradeResult: UpgradeResultState | null;
  upgrading: RuntimeBackendKind | null;
}

export interface UpgradeResultState {
  backend: RuntimeBackendKind;
  result: VllmUpgradeResult | RuntimeUpgradeResult;
}

interface RuntimePanelRuntimePayload {
  vllmRuntime: VllmRuntimeInfo;
  sglangRuntime: RuntimeBackendInfo;
  llamacppRuntime: RuntimeBackendInfo;
  cudaRuntime: RuntimeCudaInfo;
  rocmRuntime: RuntimeRocmInfo;
}

type RuntimePanelEffect = never;

type RuntimePanelContext = undefined;

const getDisabledReason = (flag: boolean | undefined, message: string): string | undefined =>
  flag === false ? message : undefined;

export type RuntimePanelEvent =
  | { type: "runtime/load/request" }
  | { type: "runtime/load/success"; payload: RuntimePanelRuntimePayload }
  | { type: "runtime/load/failure"; error: string }
  | { type: "runtime/config/load/request" }
  | { type: "runtime/config/load/success"; runtimeConfig: VllmRuntimeConfig }
  | { type: "runtime/config/load/failure"; error: string }
  | { type: "upgrade/request"; backend: RuntimeBackendKind }
  | {
      type: "upgrade/success";
      backend: RuntimeBackendKind;
      result: VllmUpgradeResult | RuntimeUpgradeResult;
    }
  | {
      type: "upgrade/failure";
      backend: RuntimeBackendKind;
      error: string;
    }
  | {
      type: "upgrade/clear-result";
      backend?: RuntimeBackendKind;
    };

export function createInitialRuntimePanelState(): RuntimePanelState {
  return {
    vllmRuntime: null,
    sglangRuntime: null,
    llamacppRuntime: null,
    cudaRuntime: null,
    rocmRuntime: null,
    runtimeConfig: null,
    runtimeError: null,
    runtimeLoading: false,
    runtimeConfigLoading: false,
    upgradeResult: null,
    upgrading: null,
  };
}

export const transitionRuntimePanel: StateMachineTransition<
  RuntimePanelState,
  RuntimePanelEvent,
  RuntimePanelContext,
  RuntimePanelEffect
> = (state, _, event) => {
  switch (event.type) {
    case "runtime/load/request":
      return {
        state: {
          ...state,
          runtimeLoading: true,
          runtimeError: null,
        },
        effects: [],
      };

    case "runtime/load/success":
      return {
        state: {
          ...state,
          runtimeLoading: false,
          vllmRuntime: event.payload.vllmRuntime,
          sglangRuntime: event.payload.sglangRuntime,
          llamacppRuntime: event.payload.llamacppRuntime,
          cudaRuntime: event.payload.cudaRuntime,
          rocmRuntime: event.payload.rocmRuntime,
        },
        effects: [],
      };

    case "runtime/load/failure":
      return {
        state: {
          ...state,
          runtimeLoading: false,
          runtimeError: event.error,
        },
        effects: [],
      };

    case "runtime/config/load/request":
      return {
        state: {
          ...state,
          runtimeConfigLoading: true,
        },
        effects: [],
      };

    case "runtime/config/load/success":
      return {
        state: {
          ...state,
          runtimeConfigLoading: false,
          runtimeConfig: event.runtimeConfig,
        },
        effects: [],
      };

    case "runtime/config/load/failure":
      return {
        state: {
          ...state,
          runtimeConfigLoading: false,
          runtimeConfig: {
            config: null,
            error: event.error,
          },
        },
        effects: [],
      };

    case "upgrade/request":
      return {
        state: {
          ...state,
          upgrading: event.backend,
          upgradeResult: null,
        },
        effects: [],
      };

    case "upgrade/success":
      return {
        state: {
          ...state,
          upgrading: null,
          upgradeResult: {
            backend: event.backend,
            result: event.result,
          },
        },
        effects: [],
      };

    case "upgrade/failure":
      return {
        state: {
          ...state,
          upgrading: null,
          upgradeResult: {
            backend: event.backend,
            result: {
              success: false,
              version: null,
              output: null,
              error: event.error,
              used_command: null,
            },
          },
        },
        effects: [],
      };

    case "upgrade/clear-result":
      return {
        state: {
          ...state,
          upgrading: event.backend ?? state.upgrading,
          upgradeResult: null,
        },
        effects: [],
      };

    default: {
      return {
        state,
        effects: [],
      };
    }
  }
};

export const createRuntimePanelMachine = (
  initialState: RuntimePanelState = createInitialRuntimePanelState(),
): StateMachineContainer<RuntimePanelState, RuntimePanelEvent, RuntimePanelContext, RuntimePanelEffect> =>
  createStateMachine<
    RuntimePanelState,
    RuntimePanelEvent,
    RuntimePanelContext,
    RuntimePanelEffect
  >({
    initialState,
    transition: transitionRuntimePanel,
  });

export function getRuntimePanelCards(state: RuntimePanelState): {
  vllmCards: RuntimeCard[];
  backendCards: Array<RuntimeCard & { backend: "cuda" | "rocm" }>;
} {
  const vllmUpgradeConfigured = state.vllmRuntime?.upgrade_command_available;
  const sglangUpgradeConfigured = state.sglangRuntime?.upgrade_command_available;
  const llamaUpgradeConfigured = state.llamacppRuntime?.upgrade_command_available;
  const cudaUpgradeConfigured = state.cudaRuntime?.upgrade_command_available;
  const rocmUpgradeConfigured = state.rocmRuntime?.upgrade_command_available;

  const vllmCards: RuntimeCard[] = [
    {
      backend: "vllm",
      title: "vLLM Runtime",
      installed: state.vllmRuntime?.installed ?? false,
      version: state.vllmRuntime?.version ?? null,
      pathLabel: "Python Runtime",
      pathValue: state.vllmRuntime?.python_path ?? "Not detected",
      canUpgrade: vllmUpgradeConfigured === true,
      disabledReason: getDisabledReason(
        vllmUpgradeConfigured,
        "Set a valid VLLM runtime Python path to enable vLLM upgrades.",
      ),
      upgrading: state.upgrading === "vllm",
    },
    {
      backend: "sglang",
      title: "sglang Runtime",
      installed: state.sglangRuntime?.installed ?? false,
      version: state.sglangRuntime?.version ?? null,
      pathLabel: "Python Runtime",
      pathValue: state.sglangRuntime?.python_path ?? "Not detected",
      canUpgrade: sglangUpgradeConfigured === true,
      disabledReason: getDisabledReason(
        sglangUpgradeConfigured,
        "Set a valid SGLang Python path to enable sGLang upgrades.",
      ),
      upgrading: state.upgrading === "sglang",
    },
    {
      backend: "llamacpp",
      title: "llama.cpp Runtime",
      installed: state.llamacppRuntime?.installed ?? false,
      version: state.llamacppRuntime?.version ?? null,
      pathLabel: "Binary",
      pathValue: state.llamacppRuntime?.binary_path ?? "Not detected",
      canUpgrade: llamaUpgradeConfigured === true,
      disabledReason: getDisabledReason(
        llamaUpgradeConfigured,
        "Set VLLM_STUDIO_LLAMACPP_UPGRADE_CMD on the controller to enable upgrades.",
      ),
      upgrading: state.upgrading === "llamacpp",
    },
  ];

  const backendCards: Array<RuntimeCard & { backend: "cuda" | "rocm" }> = [
    {
      backend: "cuda",
      title: "CUDA Runtime",
      installed: true,
      version: state.cudaRuntime?.cuda_version ?? null,
      pathLabel: "Driver",
      pathValue: state.cudaRuntime?.driver_version ?? "Not detected",
      canUpgrade: cudaUpgradeConfigured === true,
      disabledReason: getDisabledReason(
        cudaUpgradeConfigured,
        "Set VLLM_STUDIO_CUDA_UPGRADE_CMD on the controller to enable upgrades.",
      ),
      upgrading: state.upgrading === "cuda",
    },
    {
      backend: "rocm",
      title: "ROCm Runtime",
      installed: true,
      version: state.rocmRuntime?.rocm_version ?? null,
      pathLabel: "SMI Tool",
      pathValue: state.rocmRuntime?.smi_tool ?? "Not detected",
      canUpgrade: rocmUpgradeConfigured === true,
      disabledReason: getDisabledReason(
        rocmUpgradeConfigured,
        "Set VLLM_STUDIO_ROCM_UPGRADE_CMD on the controller to enable upgrades.",
      ),
      upgrading: state.upgrading === "rocm",
    },
  ];

  return { vllmCards, backendCards };
}

