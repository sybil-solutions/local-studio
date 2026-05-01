// CRITICAL
"use client";

import { useCallback, useState } from "react";
import { ArrowUpCircle, Check, Loader2, XCircle } from "lucide-react";
import { useRealtimeStatus } from "@/hooks/use-realtime-status";
import api from "@/lib/api";
import type { RuntimeBackendInfo, SystemRuntimeInfo } from "@/lib/types";

const ENGINE_META: Record<string, { label: string; description: string }> = {
  vllm: { label: "vLLM", description: "High-throughput LLM serving (CUDA)" },
  sglang: { label: "SGLang", description: "Fast structured generation engine" },
  llamacpp: { label: "llama.cpp", description: "CPU / Metal / CUDA GGUF inference" },
  exllamav3: { label: "ExLlama v3", description: "EXL3 quantized inference" },
};

type UpgradeState = { status: "idle" | "upgrading" | "success" | "error"; message?: string };

function EngineCard({
  id,
  info,
  active,
  onUpgrade,
}: {
  id: string;
  info: RuntimeBackendInfo;
  active?: boolean;
  onUpgrade?: () => Promise<void>;
}) {
  const meta = ENGINE_META[id] ?? { label: id, description: "" };
  const [state, setState] = useState<UpgradeState>({ status: "idle" });

  const handleUpgrade = useCallback(async () => {
    if (!onUpgrade) return;
    setState({ status: "upgrading" });
    try {
      await onUpgrade();
      setState({ status: "success", message: "Upgrade complete" });
      setTimeout(() => setState({ status: "idle" }), 4000);
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Upgrade failed" });
      setTimeout(() => setState({ status: "idle" }), 6000);
    }
  }, [onUpgrade]);

  return (
    <div className="px-4 py-3.5 rounded-xl bg-(--surface) border border-(--border)/30">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full shrink-0 ${
              info.installed ? "bg-(--hl2)" : "bg-(--dim)/30"
            }`}
          />
          <span className="text-sm font-semibold text-(--fg)">{meta.label}</span>
        </div>
        <div className="flex items-center gap-2">
          {active && (
            <span className="rounded border border-(--hl2)/30 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-(--hl2)">
              active
            </span>
          )}
          {onUpgrade && info.upgrade_command_available && (
          <button
            onClick={handleUpgrade}
            disabled={state.status === "upgrading"}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors bg-(--fg)/[0.05] hover:bg-(--fg)/[0.1] text-(--fg)/70 disabled:opacity-50"
          >
            {state.status === "upgrading" ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Upgrading...</span>
              </>
            ) : state.status === "success" ? (
              <>
                <Check className="w-3 h-3 text-(--hl2)" />
                <span>Done</span>
              </>
            ) : state.status === "error" ? (
              <>
                <XCircle className="w-3 h-3 text-(--err)" />
                <span>Failed</span>
              </>
            ) : (
              <>
                <ArrowUpCircle className="w-3 h-3" />
                <span>{info.installed ? "Update" : "Install"}</span>
              </>
            )}
          </button>
          )}
        </div>
      </div>

      <div className="text-[11px] text-(--dim)/60 mb-2">{meta.description}</div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-(--dim)">Version</span>
          <span
            className={`text-[12px] font-mono ${
              info.installed ? "text-(--fg)" : "text-(--dim)/40"
            }`}
          >
            {info.installed ? (info.version ?? "installed") : "not installed"}
          </span>
        </div>
        {info.python_path && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-[11px] text-(--dim) shrink-0">Python</span>
            <span className="text-[11px] font-mono text-(--dim)/60 truncate">
              {info.python_path}
            </span>
          </div>
        )}
        {info.binary_path && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-[11px] text-(--dim) shrink-0">Binary</span>
            <span className="text-[11px] font-mono text-(--dim)/60 truncate">
              {info.binary_path}
            </span>
          </div>
        )}
      </div>

      {state.status === "error" && state.message && (
        <div className="mt-2 text-[10px] text-(--err)/80 font-mono truncate">{state.message}</div>
      )}
    </div>
  );
}

export function EnginesSection({ runtime }: { runtime?: SystemRuntimeInfo | null }) {
  const { runtimeSummary, status, lease } = useRealtimeStatus();

  const backends = runtime?.backends ?? runtimeSummary?.backends;
  const gpuMon = runtime?.gpu_monitoring ?? runtimeSummary?.gpu_monitoring;
  const activeBackend = status?.process?.backend;

  const upgradeHandlers: Record<string, (() => Promise<void>) | undefined> = {
    vllm: async () => {
      await api.upgradeVllmRuntime();
    },
    sglang: async () => {
      await api.upgradeSglangRuntime();
    },
    llamacpp: async () => {
      await api.upgradeLlamacppRuntime();
    },
  };

  return (
    <div className="space-y-6">
      {/* Inference engines */}
      <div>
        <h3 className="text-[11px] uppercase tracking-[0.12em] font-medium text-(--dim) mb-3">
          Inference Engines
        </h3>
        {backends ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(["vllm", "sglang", "llamacpp", "exllamav3"] as const).map((key) => {
              const b = backends[key];
              if (!b) return null;
              return (
                <EngineCard
                  key={key}
                  id={key}
                  info={b}
                  active={activeBackend === key}
                  onUpgrade={upgradeHandlers[key]}
                />
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-(--dim)">Waiting for runtime data...</div>
        )}
      </div>

      {/* GPU Monitoring */}
      {gpuMon && (
        <div>
          <h3 className="text-[11px] uppercase tracking-[0.12em] font-medium text-(--dim) mb-3">
            GPU Monitoring
          </h3>
          <div className="px-4 py-3 rounded-xl bg-(--surface) border border-(--border)/30">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${gpuMon.available ? "bg-(--hl2)" : "bg-(--dim)/30"}`}
              />
              <span
                className={`text-sm font-mono ${gpuMon.available ? "text-(--fg)" : "text-(--dim)/50"}`}
              >
                {gpuMon.available ? (gpuMon.tool ?? "available") : "unavailable"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Lease */}
      {lease?.holder && (
        <div>
          <h3 className="text-[11px] uppercase tracking-[0.12em] font-medium text-(--dim) mb-3">
            GPU Lease
          </h3>
          <div className="px-4 py-3 rounded-xl bg-(--surface) border border-(--border)/30">
            <span className="text-sm font-mono text-(--fg)">{lease.holder}</span>
          </div>
        </div>
      )}
    </div>
  );
}
