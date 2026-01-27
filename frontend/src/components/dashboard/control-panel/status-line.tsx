"use client";

import type { ProcessInfo, RecipeWithStatus, Metrics, GPU } from "@/lib/types";
import { toGB } from "@/lib/formatters";

interface StatusLineProps {
  currentProcess: ProcessInfo | null;
  currentRecipe: RecipeWithStatus | null;
  isConnected: boolean;
  metrics: Metrics | null;
  gpus: GPU[];
  inferencePort?: number;
  onNavigateChat: () => void;
  onNavigateLogs: () => void;
  onBenchmark: () => void;
  benchmarking: boolean;
  onStop: () => void;
}

export function StatusLine({
  currentProcess,
  currentRecipe,
  isConnected,
  metrics,
  gpus,
  inferencePort,
  onNavigateChat,
  onNavigateLogs,
  onBenchmark,
  benchmarking,
  onStop,
}: StatusLineProps) {
  const modelName = currentRecipe?.name || currentProcess?.model_path?.split("/").pop();
  const isRunning = !!currentProcess;

  const totalPower = gpus.reduce((sum, g) => sum + (g.power_draw || 0), 0);
  const totalMemUsed = gpus.reduce((sum, g) => sum + toGB(g.memory_used_mb ?? g.memory_used ?? 0), 0);
  
  const totalCost = metrics?.lifetime_energy_kwh ? (metrics.lifetime_energy_kwh * 0.5).toFixed(2) : null;
  const sessionInput = metrics?.prompt_tokens_total || 0;
  const sessionOutput = metrics?.generation_tokens_total || 0;

  return (
    <div className="border-b border-foreground/10 pb-6">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        {/* Left - Model Status */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-2 h-2 ${isRunning ? "bg-(--success)" : "bg-foreground/30"}`} />
            <span className="text-xs uppercase tracking-widest text-foreground/40">
              {isRunning ? "Active" : "Standby"}
            </span>
            {!isConnected && (
              <span className="text-xs text-(--warning)">[offline]</span>
            )}
          </div>
          
          <h1 className="text-3xl font-light tracking-tight">
            {modelName || "No Model"}
          </h1>
          
          {isRunning && (
            <div className="mt-2 text-sm text-foreground/50 font-mono">
              {currentProcess.backend} // PID {currentProcess.pid}
            </div>
          )}
        </div>

        {/* Right - Analytics & Actions */}
        <div className="flex flex-col items-start lg:items-end gap-4">
          {/* Analytics Row */}
          <div className="flex items-center gap-6 text-xs font-mono">
            {sessionInput > 0 && (
              <span className="text-foreground/40">
                in: {formatTokens(sessionInput)}
              </span>
            )}
            {sessionOutput > 0 && (
              <span className="text-foreground/40">
                out: {formatTokens(sessionOutput)}
              </span>
            )}
            <span className="text-foreground/40">
              {Math.round(totalPower)}W
            </span>
            <span className="text-foreground/40">
              {totalMemUsed.toFixed(1)}GB
            </span>
            {totalCost && (
              <span className="text-(--success)">
                {totalCost} PLN
              </span>
            )}
            {inferencePort && (
              <span className="text-foreground/30">
                port {inferencePort}
              </span>
            )}
          </div>

          {/* Actions */}
          {isRunning && (
            <div className="flex items-center gap-1">
              <Action text="chat" onClick={onNavigateChat} />
              <Action text="logs" onClick={onNavigateLogs} />
              <Action text={benchmarking ? "running..." : "benchmark"} onClick={onBenchmark} disabled={benchmarking} />
              <span className="text-foreground/20 mx-1">|</span>
              <Action text="stop" onClick={onStop} danger />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Action({ text, onClick, disabled, danger }: { text: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1 text-xs uppercase tracking-wider transition-colors ${
        danger
          ? "text-foreground/40 hover:text-(--error)"
          : "text-foreground/40 hover:text-foreground/70"
      } disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {text}
    </button>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}
