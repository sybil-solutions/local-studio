"use client";

import { useState } from "react";
import { ModelLogo } from "@/ui/model-logo";
import { formatCompactTokens, formatMs, formatNumber } from "@/lib/formatters";
import type { UsageStats } from "@/lib/types";
import {
  BarCell,
  DataRow,
  EndCell,
  HeadCell,
  LeadCell,
  NumCell,
  StatStrip,
  StatusText,
  TableFrame,
  TableNotice,
  type Stat,
} from "@/features/recipes/recipes-content/catalog-table-shell";
import { UsageModelDrawer, modelIdentity, type UsageModel } from "./usage-model-drawer";
import { useSortedRows } from "./usage-sort";

type SortKey =
  "model" | "requests" | "tokens" | "avg" | "prefill" | "decode" | "ttft" | "latency" | "success";

const sortValue = (row: UsageModel, key: SortKey): number | string | null => {
  switch (key) {
    case "model":
      return row.model;
    case "requests":
      return row.requests;
    case "avg":
      return row.avg_tokens;
    case "prefill":
      return row.prefill_tps;
    case "decode":
      return row.generation_tps;
    case "ttft":
      return row.avg_ttft_ms;
    case "latency":
      return row.p50_latency_ms;
    case "success":
      return row.success_rate;
    default:
      return row.total_tokens;
  }
};

const successTone = (rate: number): "ok" | "dim" | "error" =>
  rate >= 99 ? "ok" : rate >= 95 ? "dim" : "error";

/**
 * Decode throughput weighted by the work each model actually did.
 *
 * A plain mean over by_model lets a model that served four requests drag the
 * headline number as hard as one that served forty thousand.
 */
function weightedDecodeTps(models: readonly UsageModel[]): number | null {
  let weight = 0;
  let total = 0;
  for (const model of models) {
    if (model.generation_tps === null || model.completion_tokens <= 0) continue;
    weight += model.completion_tokens;
    total += model.generation_tps * model.completion_tokens;
  }
  return weight > 0 ? total / weight : null;
}

export function UsageModelsTab({ stats }: { stats: UsageStats }) {
  const [selected, setSelected] = useState<UsageModel | null>(null);
  const { sorted, head } = useSortedRows<UsageModel, SortKey>(stats.by_model, sortValue, {
    key: "tokens",
    desc: true,
  });
  const peak = sorted.reduce((max, row) => Math.max(max, row.total_tokens), 0);
  const decode = weightedDecodeTps(stats.by_model);

  // Deliberately NOT a second copy of the page's headline grid. Requests,
  // sessions, success rate and p95 already sit above the tab strip and are true
  // of the whole window; repeating them here made two near-identical stat rows
  // stack. What is left is what only this tab can say.
  const summary: Stat[] = [
    {
      label: "Token mix",
      value: `${formatCompactTokens(stats.totals.prompt_tokens)} in · ${formatCompactTokens(stats.totals.completion_tokens)} out`,
      sub: `${formatNumber(stats.totals.total_tokens)} total`,
      title:
        "How the proxied tokens split between prompt and completion. Prefill-heavy traffic is why cache hit rate matters more here than raw throughput.",
    },
    {
      label: "Cache hit rate",
      value: `${Math.round(stats.cache.hit_rate)}%`,
      sub: `${formatCompactTokens(stats.cache.hit_tokens)} reused`,
      title:
        "Share of prompt tokens served from the prefix cache instead of being recomputed. High values mean prefill is being reused, which is where almost all of this workload's time goes.",
      tone: stats.cache.hit_rate >= 50 ? "ok" : "default",
    },
    {
      label: "Decode",
      value: decode === null ? "—" : `${decode.toFixed(1)} tok/s`,
      sub: "weighted by output",
      title:
        "Generation throughput averaged across models, weighted by completion tokens so a rarely-used model cannot skew it. This is the speed a chat actually feels.",
    },
  ];

  return (
    <div className="space-y-6">
      <StatStrip stats={summary} />

      {stats.by_model.length === 0 ? (
        <TableNotice
          title="No model traffic yet"
          body="Nothing has been proxied through this controller in its retention window. Launch a server and send a request, then refresh."
        />
      ) : (
        <TableFrame minWidthClass="min-w-[64rem]">
          <thead>
            <tr>
              <HeadCell {...head("model")}>Model</HeadCell>
              <HeadCell {...head("requests")} numeric>
                Requests
              </HeadCell>
              <HeadCell {...head("tokens")} numeric title="Prompt and completion tokens combined">
                Tokens
              </HeadCell>
              <HeadCell {...head("avg")} numeric>
                Avg/req
              </HeadCell>
              <HeadCell
                {...head("prefill")}
                numeric
                title="Prompt tokens read per second — how fast this model ingests context"
              >
                Prefill
              </HeadCell>
              <HeadCell
                {...head("decode")}
                numeric
                title="Completion tokens written per second — the speed a chat feels"
              >
                Decode
              </HeadCell>
              <HeadCell {...head("ttft")} numeric title="Average time to the first token">
                TTFT
              </HeadCell>
              <HeadCell
                {...head("latency")}
                numeric
                title="Median request duration, with the average underneath"
              >
                Latency
              </HeadCell>
              <HeadCell {...head("success")} numeric>
                Success
              </HeadCell>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <ModelRow key={row.model} row={row} peak={peak} onOpen={() => setSelected(row)} />
            ))}
          </tbody>
        </TableFrame>
      )}

      {selected ? (
        <UsageModelDrawer
          model={selected}
          dailyByModel={stats.daily_by_model}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function ModelRow({ row, peak, onOpen }: { row: UsageModel; peak: number; onOpen: () => void }) {
  const identity = modelIdentity(row.model);
  return (
    <DataRow onOpen={onOpen} ariaLabel={`Open ${row.model} usage details`}>
      <LeadCell>
        <div className="flex min-w-0 items-center gap-2.5">
          <ModelLogo
            modelId={row.model}
            author={identity.owner || null}
            label={identity.name}
            size="sm"
            className="rounded-md"
          />
          <span
            className="min-w-0 truncate text-[length:var(--fs-md)] font-medium text-(--fg)"
            title={row.model}
          >
            {identity.name}
          </span>
          {identity.owner ? (
            <span className="shrink-0 text-[length:var(--fs-sm)] text-(--dim)/70">
              {identity.owner}
            </span>
          ) : null}
        </div>
      </LeadCell>

      <NumCell>{formatNumber(row.requests)}</NumCell>

      <BarCell
        share={peak > 0 ? row.total_tokens / peak : 0}
        sub={`↑${formatCompactTokens(row.prompt_tokens)} ↓${formatCompactTokens(row.completion_tokens)}`}
        title={`${row.total_tokens.toLocaleString()} tokens`}
      >
        {formatNumber(row.total_tokens)}
      </BarCell>

      <NumCell>{formatNumber(Math.round(row.avg_tokens))}</NumCell>

      <NumCell>{row.prefill_tps === null ? "—" : `${Math.round(row.prefill_tps)} tok/s`}</NumCell>

      <NumCell strong>
        {row.generation_tps === null ? "—" : `${row.generation_tps.toFixed(1)} tok/s`}
      </NumCell>

      <NumCell>{formatMs(row.avg_ttft_ms)}</NumCell>

      <NumCell sub={`avg ${formatMs(row.avg_latency_ms)}`}>{formatMs(row.p50_latency_ms)}</NumCell>

      <EndCell>
        <StatusText tone={successTone(row.success_rate)}>
          {`${row.success_rate.toFixed(1)}%`}
        </StatusText>
      </EndCell>
    </DataRow>
  );
}
