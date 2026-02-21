// CRITICAL

import { useCallback, useEffect, useState } from "react";
import { ArrowUpCircle, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import type {
  RuntimeBackendInfo,
  RuntimeCommandPayload,
  RuntimeCudaInfo,
  RuntimeRocmInfo,
  RuntimeUpgradeResult,
  VllmRuntimeConfig,
  VllmRuntimeInfo,
  VllmUpgradeResult,
} from "@/lib/types";

type RuntimeBackendKind = "vllm" | "sglang" | "llamacpp" | "cuda" | "rocm";

type RuntimeCard = {
  backend: RuntimeBackendKind;
  title: string;
  installed: boolean;
  version: string | null;
  pathLabel: string;
  pathValue: string | null;
  canUpgrade: boolean;
  upgrading: boolean;
  disabledReason?: string;
};

type UpgradeResultState = {
  backend: RuntimeBackendKind;
  result: VllmUpgradeResult | RuntimeUpgradeResult;
};

export function VllmRuntimePanel() {
  const [vllmRuntime, setVllmRuntime] = useState<VllmRuntimeInfo | null>(null);
  const [sglangRuntime, setSglangRuntime] = useState<RuntimeBackendInfo | null>(null);
  const [llamacppRuntime, setLlamacppRuntime] = useState<RuntimeBackendInfo | null>(null);
  const [cudaRuntime, setCudaRuntime] = useState<RuntimeCudaInfo | null>(null);
  const [rocmRuntime, setRocmRuntime] = useState<RuntimeRocmInfo | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<VllmRuntimeConfig | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeConfigLoading, setRuntimeConfigLoading] = useState(false);
  const [upgradeResult, setUpgradeResult] = useState<UpgradeResultState | null>(null);
  const [upgrading, setUpgrading] = useState<RuntimeBackendKind | null>(null);

  const loadRuntime = useCallback(async () => {
    setRuntimeLoading(true);
    setRuntimeError(null);

    try {
      const [vllm, sglang, llamacpp, cuda, rocm] = await Promise.all([
        api.getVllmRuntime(),
        api.getSglangRuntime(),
        api.getLlamacppRuntime(),
        api.getCudaRuntime(),
        api.getRocmRuntime(),
      ]);
      setVllmRuntime(vllm);
      setSglangRuntime(sglang);
      setLlamacppRuntime(llamacpp);
      setCudaRuntime(cuda);
      setRocmRuntime(rocm);
    } catch (e) {
      setRuntimeError((e as Error).message);
    } finally {
      setRuntimeLoading(false);
    }
  }, []);

  const loadRuntimeConfig = useCallback(async () => {
    setRuntimeConfigLoading(true);
    try {
      const config = await api.getVllmRuntimeConfig();
      setRuntimeConfig(config);
    } catch (e) {
      setRuntimeConfig({ config: null, error: (e as Error).message });
    } finally {
      setRuntimeConfigLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    void loadRuntime();
    void loadRuntimeConfig();
  }, [loadRuntime, loadRuntimeConfig]);

  const triggerUpgrade = useCallback(
    async (backend: RuntimeBackendKind, payload: RuntimeCommandPayload = {}) => {
      setUpgrading(backend);
      setUpgradeResult(null);

      try {
        let result: VllmUpgradeResult | RuntimeUpgradeResult;
        switch (backend) {
          case "vllm":
            result = await api.upgradeVllmRuntime(true);
            break;
          case "sglang":
            result = await api.upgradeSglangRuntime();
            break;
          case "llamacpp":
            result = await api.upgradeLlamacppRuntime(payload);
            break;
          case "cuda":
            result = await api.upgradeCudaRuntime(payload);
            break;
          case "rocm":
            result = await api.upgradeRocmRuntime(payload);
            break;
          default:
            throw new Error(`Unsupported backend: ${backend}`);
        }

        setUpgradeResult({ backend, result });
        await loadRuntime();
        if (backend === "vllm") {
          await loadRuntimeConfig();
        }
      } catch (e) {
        setUpgradeResult({
          backend,
          result: {
            success: false,
            version: null,
            output: null,
            error: (e as Error).message,
            used_command: null,
          },
        });
      } finally {
        setUpgrading(null);
      }
    },
    [loadRuntime, loadRuntimeConfig]
  );

  useEffect(() => {
    handleRefresh();
  }, [handleRefresh]);

  const getDisabledReason = (flag: boolean | undefined, message: string): string | undefined =>
    flag === false ? message : undefined;

  const vllmUpgradeConfigured = vllmRuntime?.upgrade_command_available;
  const sglangUpgradeConfigured = sglangRuntime?.upgrade_command_available;
  const llamaUpgradeConfigured = llamacppRuntime?.upgrade_command_available;
  const cudaUpgradeConfigured = cudaRuntime?.upgrade_command_available;
  const rocmUpgradeConfigured = rocmRuntime?.upgrade_command_available;

  const vllmCards: RuntimeCard[] = [
    {
      backend: "vllm",
      title: "vLLM Runtime",
      installed: vllmRuntime?.installed ?? false,
      version: vllmRuntime?.version ?? null,
      pathLabel: "Python Runtime",
      pathValue: vllmRuntime?.python_path ?? "Not detected",
      canUpgrade: vllmUpgradeConfigured === true,
      disabledReason: getDisabledReason(
        vllmUpgradeConfigured,
        "Set a valid VLLM runtime Python path to enable vLLM upgrades."
      ),
      upgrading: upgrading === "vllm",
    },
    {
      backend: "sglang",
      title: "sglang Runtime",
      installed: sglangRuntime?.installed ?? false,
      version: sglangRuntime?.version ?? null,
      pathLabel: "Python Runtime",
      pathValue: sglangRuntime?.python_path ?? "Not detected",
      canUpgrade: sglangUpgradeConfigured === true,
      disabledReason: getDisabledReason(
        sglangUpgradeConfigured,
        "Set a valid SGLang Python path to enable sGLang upgrades."
      ),
      upgrading: upgrading === "sglang",
    },
    {
      backend: "llamacpp",
      title: "llama.cpp Runtime",
      installed: llamacppRuntime?.installed ?? false,
      version: llamacppRuntime?.version ?? null,
      pathLabel: "Binary",
      pathValue: llamacppRuntime?.binary_path ?? "Not detected",
      canUpgrade: llamaUpgradeConfigured === true,
      disabledReason: getDisabledReason(
        llamaUpgradeConfigured,
        "Set VLLM_STUDIO_LLAMACPP_UPGRADE_CMD on the controller to enable upgrades."
      ),
      upgrading: upgrading === "llamacpp",
    },
  ];

  const backendCards: Array<RuntimeCard & { backend: "cuda" | "rocm" }> = [
    {
      backend: "cuda",
      title: "CUDA Runtime",
      installed: true,
      version: cudaRuntime?.cuda_version ?? null,
      pathLabel: "Driver",
      pathValue: cudaRuntime?.driver_version ?? "Not detected",
      canUpgrade: cudaUpgradeConfigured === true,
      disabledReason: getDisabledReason(
        cudaUpgradeConfigured,
        "Set VLLM_STUDIO_CUDA_UPGRADE_CMD on the controller to enable upgrades."
      ),
      upgrading: upgrading === "cuda",
    },
    {
      backend: "rocm",
      title: "ROCm Runtime",
      installed: true,
      version: rocmRuntime?.rocm_version ?? null,
      pathLabel: "SMI Tool",
      pathValue: rocmRuntime?.smi_tool ?? "Not detected",
      canUpgrade: rocmUpgradeConfigured === true,
      disabledReason: getDisabledReason(
        rocmUpgradeConfigured,
        "Set VLLM_STUDIO_ROCM_UPGRADE_CMD on the controller to enable upgrades."
      ),
      upgrading: upgrading === "rocm",
    },
  ];

  return (
    <div style={{ padding: "1.5rem" }} className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Runtime Management</h2>
          <p className="text-sm text-(--dim)">
            Manage vLLM, SGLang, llama.cpp, and platform runtimes from one screen.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={runtimeLoading || runtimeConfigLoading}
          className="flex items-center gap-2 px-3 py-2 bg-(--surface) hover:bg-(--surface) border border-(--border) rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${runtimeLoading || runtimeConfigLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {runtimeError && (
        <div className="p-4 bg-(--err)/10 border border-(--err)/30 rounded-lg text-sm text-(--err)">
          {runtimeError}
        </div>
      )}

      <section className="space-y-3">
        <div className="text-sm font-medium">Inference Backends</div>
        <div className="grid grid-cols-1 gap-4">
          {vllmCards.map((card) => {
            return (
              <div key={card.title} className="bg-(--surface) border border-(--border) rounded-lg p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-(--dim) font-medium">{card.title}</div>
                    <div className="mt-2 text-lg font-semibold">
                      {card.installed ? card.version ?? "Version unknown" : "Not installed"}
                    </div>
                    <div className="text-xs text-(--dim) mt-2">
                      {card.pathLabel}: {card.pathValue}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <button
                      onClick={() => void triggerUpgrade(card.backend)}
                      disabled={card.upgrading || !card.canUpgrade}
                      className="flex items-center gap-2 px-3 py-2 bg-(--accent) hover:bg-(--accent) text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                    >
                      <ArrowUpCircle className="w-4 h-4" />
                      {card.upgrading ? "Upgrading..." : "Upgrade"}
                    </button>
                    {card.disabledReason && (
                      <span className="text-xs text-(--dim) text-right max-w-[12rem]">{card.disabledReason}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="text-sm font-medium">Platform Runtimes</div>
        <div className="grid grid-cols-1 gap-4">
          {backendCards.map((card) => {
            return (
              <div key={card.title} className="bg-(--surface) border border-(--border) rounded-lg p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-(--dim) font-medium">{card.title}</div>
                    <div className="mt-2 text-lg font-semibold">
                      {card.version ?? "Not detected"}
                    </div>
                    <div className="text-xs text-(--dim) mt-2">
                      {card.pathLabel}: {card.pathValue}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <button
                      onClick={() => void triggerUpgrade(card.backend)}
                      disabled={card.upgrading || !card.canUpgrade}
                      className="flex items-center gap-2 px-3 py-2 bg-(--accent) hover:bg-(--accent) text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                    >
                      <ArrowUpCircle className="w-4 h-4" />
                      {card.upgrading ? "Upgrading..." : "Upgrade"}
                    </button>
                    {card.disabledReason && (
                      <span className="text-xs text-(--dim) text-right max-w-[12rem]">{card.disabledReason}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="bg-(--surface) border border-(--border) rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">vLLM CLI Config (vllm serve --help)</h3>
          <button
            onClick={() => {
              void loadRuntimeConfig();
            }}
            disabled={runtimeConfigLoading}
            className="px-3 py-1.5 bg-(--border) hover:bg-(--surface) rounded-lg text-xs transition-colors disabled:opacity-50"
          >
            {runtimeConfigLoading ? "Loading..." : "Refresh"}
          </button>
        </div>
        {runtimeConfig?.error && <div className="text-xs text-(--err)">{runtimeConfig.error}</div>}
        <pre className="max-h-72 overflow-auto text-xs text-(--fg) whitespace-pre-wrap">
          {runtimeConfig?.config || "No config available."}
        </pre>
      </div>

      {upgradeResult && (
        <div
          className={`p-4 border rounded-lg text-sm ${
            upgradeResult.result.success
              ? "bg-(--hl2)/10 border-(--hl2)/30 text-(--hl2)"
              : "bg-(--err)/10 border-(--err)/30 text-(--err)"
          }`}
        >
          <div className="font-medium">
            {upgradeResult.result.success ? "Upgrade complete" : "Upgrade failed"} (
            {upgradeResult.backend})
            {upgradeResult.result.version ? ` (v ${upgradeResult.result.version})` : ""}
          </div>
          {"used_command" in upgradeResult.result && upgradeResult.result.used_command && (
            <div className="text-xs mt-1 break-all">Command: {upgradeResult.result.used_command}</div>
          )}
          {"used_wheel" in upgradeResult.result && upgradeResult.result.used_wheel && (
            <div className="text-xs mt-1">Wheel: {upgradeResult.result.used_wheel}</div>
          )}
          {upgradeResult.result.error && (
            <div className="text-xs mt-2 whitespace-pre-wrap text-(--err)">{upgradeResult.result.error}</div>
          )}
          {upgradeResult.result.output && (
            <pre className="text-xs mt-2 whitespace-pre-wrap text-(--fg)">{upgradeResult.result.output}</pre>
          )}
        </div>
      )}
    </div>
  );
}
