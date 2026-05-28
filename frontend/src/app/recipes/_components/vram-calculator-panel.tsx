import { useState } from "react";
import api from "@/lib/api";
import type { ModelInfo, VRAMCalculation } from "@/lib/types";

type KvDtype = "auto" | "fp16" | "fp8";

export function VramCalculatorPanel({
  availableModels,
  modelServedNames,
}: {
  availableModels: ModelInfo[];
  modelServedNames: Record<string, string>;
}) {
  const [vramModel, setVramModel] = useState("");
  const [contextLength, setContextLength] = useState(32768);
  const [tpSize, setTpSize] = useState(8);
  const [kvDtype, setKvDtype] = useState<KvDtype>("auto");
  const [vramResult, setVramResult] = useState<VRAMCalculation | null>(null);
  const [calculating, setCalculating] = useState(false);

  const calculateVRAM = async () => {
    if (!vramModel.trim()) return;
    setCalculating(true);
    try {
      const result = await api.calculateVRAM({
        model: vramModel,
        context_length: contextLength,
        tp_size: tpSize,
        kv_dtype: kvDtype,
      });
      setVramResult(result);
    } catch (e) {
      alert("Failed to calculate VRAM: " + (e as Error).message);
    } finally {
      setCalculating(false);
    }
  };

  return (
    <div style={{ padding: "1.5rem" }} className="max-w-2xl">
      <h2 className="text-lg font-semibold mb-4">VRAM Calculator</h2>
      <div className="space-y-4 bg-(--surface) border border-(--border) rounded-lg p-6">
        <div>
          <label className="block text-sm text-(--dim) mb-2">Model</label>
          <select
            value={vramModel}
            onChange={(e) => setVramModel(e.target.value)}
            className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-lg text-sm focus:outline-none focus:border-(--accent)"
          >
            <option value="">Select a model...</option>
            {availableModels.map((model) => {
              const servedName = modelServedNames[model.path];
              return (
                <option key={model.path} value={model.path}>
                  {servedName ? `${servedName} (${model.name})` : model.name}
                </option>
              );
            })}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-(--dim) mb-2">Context Length</label>
            <input
              type="number"
              value={contextLength}
              onChange={(e) => setContextLength(Number(e.target.value))}
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-lg text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
          <div>
            <label className="block text-sm text-(--dim) mb-2">TP Size</label>
            <input
              type="number"
              value={tpSize}
              onChange={(e) => setTpSize(Number(e.target.value))}
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-lg text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
          <div>
            <label className="block text-sm text-(--dim) mb-2">KV Dtype</label>
            <select
              value={kvDtype}
              onChange={(e) => setKvDtype(e.target.value as KvDtype)}
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-lg text-sm focus:outline-none focus:border-(--accent)"
            >
              <option value="auto">Auto</option>
              <option value="fp16">FP16</option>
              <option value="fp8">FP8</option>
            </select>
          </div>
        </div>
        <button
          onClick={calculateVRAM}
          disabled={calculating || !vramModel.trim()}
          className="w-full py-2 bg-(--accent) hover:bg-(--accent) text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {calculating ? "Calculating..." : "Calculate VRAM"}
        </button>

        {vramResult && (
          <div className="mt-6 space-y-3 pt-6 border-t border-(--border)">
            <div className="flex justify-between text-sm">
              <span className="text-(--dim)">Model Size</span>
              <span className="font-medium">
                {vramResult.breakdown.model_weights_gb.toFixed(2)} GB
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-(--dim)">KV Cache</span>
              <span className="font-medium">{vramResult.breakdown.kv_cache_gb.toFixed(2)} GB</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-(--dim)">Activations</span>
              <span className="font-medium">
                {vramResult.breakdown.activations_gb.toFixed(2)} GB
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-(--dim)">Per GPU</span>
              <span className="font-medium">{vramResult.breakdown.per_gpu_gb.toFixed(2)} GB</span>
            </div>
            <div className="flex justify-between text-sm font-semibold pt-3 border-t border-(--border)">
              <span>Total VRAM</span>
              <span className={vramResult.fits ? "text-(--hl2)" : "text-(--err)"}>
                {vramResult.breakdown.total_gb.toFixed(2)} GB
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-(--dim)">Utilization</span>
              <span className="font-medium">{vramResult.utilization_percent.toFixed(1)}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
