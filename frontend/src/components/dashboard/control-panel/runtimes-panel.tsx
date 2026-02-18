// CRITICAL
"use client";

import type { RuntimeSummaryData, ServiceEntry, LeaseInfo } from "@/hooks/realtime-status-store/types";

interface RuntimesPanelProps {
  runtimeSummary?: RuntimeSummaryData | null;
  services?: ServiceEntry[];
  lease?: LeaseInfo | null;
}

export function RuntimesPanel({ runtimeSummary, services = [], lease }: RuntimesPanelProps) {
  const backends = runtimeSummary?.backends;
  const gpuMon = runtimeSummary?.gpu_monitoring;

  return (
    <div className="space-y-4">
      <h3 className="text-xs uppercase tracking-widest text-foreground/40">Runtimes</h3>

      {/* GPU Monitoring */}
      {gpuMon && (
        <div className="text-xs font-mono text-foreground/50">
          gpu monitoring:{" "}
          <span className={gpuMon.available ? "text-(--hl2)" : "text-(--err)"}>
            {gpuMon.available ? gpuMon.tool ?? "available" : "unavailable"}
          </span>
        </div>
      )}

      {/* Backends */}
      {backends && (
        <div className="grid grid-cols-3 gap-2">
          {(["vllm", "sglang", "llamacpp"] as const).map((key) => {
            const b = backends[key];
            return (
              <div
                key={key}
                className="px-2 py-1.5 border border-foreground/10 rounded text-xs font-mono"
              >
                <div className="text-foreground/60">{key}</div>
                <div className={b.installed ? "text-(--hl2)" : "text-foreground/30"}>
                  {b.installed ? b.version ?? "installed" : "—"}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Services */}
      {services.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-widest text-foreground/40 mt-2">Services</div>
          {services.map((svc) => (
            <div
              key={svc.id}
              className="flex items-center justify-between text-xs font-mono px-2 py-1 border border-foreground/10 rounded"
            >
              <span className="text-foreground/60">{svc.id}</span>
              <span
                className={
                  svc.status === "running"
                    ? "text-(--hl2)"
                    : svc.status === "error"
                      ? "text-(--err)"
                      : "text-foreground/40"
                }
              >
                {svc.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Lease */}
      {lease && lease.holder && (
        <div className="text-xs font-mono text-foreground/50">
          gpu lease: <span className="text-(--hl1)">{lease.holder}</span>
        </div>
      )}

      {/* Empty state */}
      {!runtimeSummary && services.length === 0 && (
        <div className="text-xs text-foreground/30 font-mono">
          Waiting for runtime summary…
        </div>
      )}
    </div>
  );
}
