"use client";

import { useMemo } from "react";
import { ModelButton } from "@/ui";
import { ModelLogo } from "@/ui/model-logo";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { formatMs, formatNumber } from "@/lib/formatters";
import type { UsageStats } from "@/lib/types";
import { UsageBarRow, type UsageBar } from "./usage-bars";

export type UsageModel = UsageStats["by_model"][number];

/** "org/name" → the pieces the logo needs; a bare name keeps an empty owner. */
export function modelIdentity(modelId: string): { owner: string; name: string } {
  const parts = modelId.split("/").filter(Boolean);
  if (parts.length < 2) return { owner: "", name: modelId };
  return { owner: parts[0] ?? "", name: parts.slice(1).join("/") };
}

const tps = (value: number | null): string => (value === null ? "—" : `${value.toFixed(1)} tok/s`);

/**
 * One model's row, opened out.
 *
 * The table can afford nine columns; it cannot afford thirteen, so the fields
 * that describe *how* a number came about — the prompt/completion split behind
 * a token total, the average behind a p50 — live here rather than widening
 * every row for the one row someone is actually asking about.
 */
export function UsageModelDrawer({
  model,
  dailyByModel,
  onClose,
}: {
  model: UsageModel;
  dailyByModel: UsageStats["daily_by_model"];
  onClose: () => void;
}) {
  const identity = modelIdentity(model.model);

  const trend = useMemo<UsageBar[]>(() => {
    const rows = (dailyByModel ?? [])
      .filter((row) => row.model === model.model)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-45);
    return rows.map((row) => ({
      key: row.date,
      label: row.date.slice(8),
      value: row.total_tokens,
      title: `${row.date} — ${formatNumber(row.total_tokens)} tokens · ${formatNumber(row.requests)} requests`,
    }));
  }, [dailyByModel, model.model]);

  return (
    <ResourceDrawer
      title={identity.name}
      icon={
        <ModelLogo
          modelId={model.model}
          author={identity.owner || null}
          label={identity.name}
          size="sm"
        />
      }
      status={`${formatNumber(model.requests)} requests · ${formatNumber(model.total_tokens)} tokens`}
      footer={<ModelButton onClick={onClose}>Done</ModelButton>}
      onClose={onClose}
    >
      <p className="font-mono text-[length:var(--fs-xs)] break-all text-(--ui-muted)">
        {model.model}
      </p>

      <div className="mt-5">
        <ResourceDrawerSection
          title="Tokens"
          description="What this model was actually asked to do: how much context it read against how much it wrote."
        >
          <ResourceFact label="Prompt" value={formatNumber(model.prompt_tokens)} />
          <ResourceFact label="Completion" value={formatNumber(model.completion_tokens)} />
          <ResourceFact label="Total" value={formatNumber(model.total_tokens)} />
          <ResourceFact
            label="Average per request"
            value={`${formatNumber(Math.round(model.avg_tokens))} tokens`}
          />
        </ResourceDrawerSection>

        <ResourceDrawerSection
          title="Speed"
          description="Prefill is how fast it reads, decode is how fast it writes. Decode is the number a chat feels."
        >
          <ResourceFact label="Prefill" value={tps(model.prefill_tps)} />
          <ResourceFact label="Decode" value={tps(model.generation_tps)} />
          <ResourceFact label="Combined" value={tps(model.tokens_per_sec)} />
          <ResourceFact label="Time to first token" value={formatMs(model.avg_ttft_ms)} />
          <ResourceFact label="Latency p50" value={formatMs(model.p50_latency_ms)} />
          <ResourceFact label="Latency average" value={formatMs(model.avg_latency_ms)} />
          <ResourceFact
            label="Requests"
            value={`${formatNumber(model.successful)} of ${formatNumber(model.requests)} succeeded (${model.success_rate.toFixed(1)}%)`}
          />
        </ResourceDrawerSection>

        <section className="mb-6 last:mb-0">
          <div className="mb-2">
            <h3 className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">Daily trend</h3>
            <p className="mt-0.5 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
              Tokens per day for this model, most recent 45 days. Hover a bar for the exact count.
            </p>
          </div>
          {trend.length > 0 ? (
            <div className="border-y border-(--ui-separator) py-3">
              <UsageBarRow bars={trend} heightClass="h-20" />
              <div className="mt-2 flex justify-between text-[length:var(--fs-xs)] text-(--ui-muted)">
                <span>{trend[0]?.key}</span>
                <span>{trend.at(-1)?.key}</span>
              </div>
            </div>
          ) : (
            <p className="border-y border-(--ui-separator) py-3 text-[length:var(--fs-sm)] text-(--ui-muted)">
              This controller does not report a per-model daily breakdown, so there is nothing to
              plot yet.
            </p>
          )}
        </section>
      </div>
    </ResourceDrawer>
  );
}
