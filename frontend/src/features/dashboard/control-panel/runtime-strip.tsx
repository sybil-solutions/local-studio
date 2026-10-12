"use client";

import type { LeaseInfo, RuntimeSummaryData, ServiceEntry } from "@/hooks/realtime-status-types";
import type { RuntimeBackendInfo } from "@/lib/types";
import { formatRelativeTime } from "@/lib/formatters";

/**
 * What this box is, on one line.
 *
 * `runtimeSummary`, `services` and `lease` were declared on the dashboard
 * props, populated on every poll, and then rendered nowhere — the reader had no
 * way to answer "which engines are even installed here" or "is something else
 * holding the lease" without opening Configure. This is that answer, kept to a
 * single quiet rule so it cannot grow into a status card.
 */
export function RuntimeStrip({
  runtimeSummary,
  services,
  lease,
}: {
  runtimeSummary?: RuntimeSummaryData | null;
  services?: ServiceEntry[];
  lease?: LeaseInfo | null;
}) {
  const backends = runtimeSummary ? backendFacts(runtimeSummary) : [];
  const platform = runtimeSummary ? platformFact(runtimeSummary) : null;
  const degraded = (services ?? []).filter((service) => service.status !== "ok");
  const hasAnything = backends.length > 0 || platform || lease?.holder || (services ?? []).length > 0;
  if (!hasAnything) return null;

  return (
    <section className="mt-4 border-t border-(--separator) px-2 pt-2.5 pb-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[length:var(--fs-xs)] text-(--dim)/75">
        {backends.map((fact) => (
          <Fact key={fact.label} label={fact.label} value={fact.value} title={fact.title} />
        ))}
        {platform ? <Fact label={platform.label} value={platform.value} /> : null}
        {lease?.holder ? (
          <Fact
            label="lease"
            value={lease.since ? `${lease.holder} · ${formatRelativeTime(lease.since)}` : lease.holder}
            title="Which host currently owns the right to launch models"
          />
        ) : null}
        {services && services.length > 0 ? (
          <span
            className={degraded.length > 0 ? "text-(--err)" : undefined}
            title={
              degraded.length > 0
                ? degraded.map((s) => `${s.id}: ${s.last_error ?? s.status}`).join(" | ")
                : services.map((s) => `${s.id}: ${s.status}`).join(" | ")
            }
          >
            {services.length - degraded.length}/{services.length} services ok
          </span>
        ) : null}
      </div>
    </section>
  );
}

function Fact({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span title={title}>
      <span className="text-(--dim)/50">{label} </span>
      <span className="text-(--fg)/75">{value}</span>
    </span>
  );
}

function backendFacts(summary: RuntimeSummaryData) {
  const entries: Array<[string, RuntimeBackendInfo | undefined]> = [
    ["vllm", summary.backends.vllm],
    ["sglang", summary.backends.sglang],
    ["exllamav3", summary.backends.exllamav3],
  ];
  return entries
    .filter(([, info]) => Boolean(info))
    .map(([label, info]) => ({
      label,
      value: backendValue(info),
      title: info?.installed ? undefined : "Not installed on this host",
    }));
}

function backendValue(info: RuntimeBackendInfo | undefined): string {
  if (!info) return "—";
  if (!info.installed) return "—";
  return info.version?.trim() || "ok";
}

function platformFact(summary: RuntimeSummaryData) {
  const vendor = summary.platform.vendor ?? summary.platform.kind;
  const monitoring = summary.gpu_monitoring;
  const tool = monitoring?.tool ?? null;
  const ok = monitoring?.available ?? false;
  return { label: vendor, value: tool ? `${tool} ${ok ? "ok" : "down"}` : ok ? "ok" : "down" };
}
