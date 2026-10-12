"use client";

import { useState } from "react";
import type { GPU, Metrics, ProcessInfo, RuntimePlatformKind } from "@/lib/types";
import { toGBFromMB } from "@/lib/formatters";
import { writeClipboardText } from "@/lib/clipboard";
import {
  BarCell,
  DataRow,
  EndCell,
  GroupRow,
  HeadCell,
  LeadCell,
  NumCell,
  RowAction,
  StatusText,
  TableFrame,
} from "@/features/recipes/recipes-content/catalog-table-shell";

interface GpuSectionProps {
  metrics: Metrics | null;
  gpus: GPU[];
  currentProcess: ProcessInfo | null;
  platformKind: RuntimePlatformKind | null;
}

type SortKey = "memory" | "util" | "temp";

export function GpuSection({ gpus, platformKind }: GpuSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "memory", desc: true });
  const names = new Set(gpus.map((gpu) => gpu.name).filter(Boolean));
  const sortedGpus = [...gpus].sort((a, b) => {
    const delta = sortValue(a, sort.key) - sortValue(b, sort.key);
    return sort.desc ? -delta : delta;
  });
  const gpuModelLabel = names.size === 1 ? [...names][0].replace(/^NVIDIA\s+/, "") : null;
  const totals = aggregate(sortedGpus);

  if (sortedGpus.length === 0) {
    const metal = platformKind === "metal";
    return (
      <section className="mt-4 border-t border-(--separator) px-2 pt-3 pb-4">
        <div className="flex w-full items-center gap-4 text-left">
          <div className="flex shrink-0 items-baseline gap-2">
            <span className="text-[length:var(--fs-sm)] font-medium text-(--hl2)">
              {metal ? "Metal GPU" : "GPUs"}
            </span>
            <span className="font-mono text-[length:var(--fs-xs)] tabular-nums text-(--dim)/65">
              {metal ? "available" : "0"}
            </span>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="h-[3px] min-w-[5rem] flex-1 max-w-[18rem] overflow-hidden rounded-[var(--rad-2xs)] bg-(--dim)/15" />
            <span className="font-mono text-[length:var(--fs-sm)] tabular-nums text-(--fg)/85">
              —
            </span>
          </div>
          <div className="hidden items-baseline gap-5 font-mono text-[length:var(--fs-sm)] tabular-nums sm:flex">
            <Aggregate label="util" value="—" />
            <Aggregate label="temp" value="—" />
            <Aggregate label="pwr" value="—" />
          </div>
        </div>
      </section>
    );
  }

  const sortHandler = (key: SortKey) => () =>
    setSort((current) =>
      current.key === key ? { key, desc: !current.desc } : { key, desc: true },
    );

  return (
    <section className="mt-4 border-t border-(--separator) px-2 pt-3 pb-5">
      {/* The aggregate stays a button, not a table header: "how much of this rig
          is in use" is one sentence, and it is the thing worth reading when the
          per-device rows are collapsed. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group flex w-full items-center gap-4 text-left"
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-[length:var(--fs-sm)] font-medium text-(--hl2)">GPUs</span>
          <span className="shrink-0 font-mono text-[length:var(--fs-xs)] tabular-nums text-(--dim)/65">
            {sortedGpus.length}
          </span>
          {gpuModelLabel ? (
            <span className="hidden max-w-[14rem] truncate text-[length:var(--fs-xs)] text-(--dim)/60 md:inline">
              {gpuModelLabel}
            </span>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="h-[3px] min-w-[5rem] flex-1 max-w-[18rem] overflow-hidden rounded-[var(--rad-2xs)] bg-(--dim)/15">
            <div
              className="h-full rounded-[var(--rad-2xs)] bg-(--fg)/55 transition-[width] duration-300"
              style={{ width: `${totals.memPct}%` }}
            />
          </div>
          <span className="font-mono text-[length:var(--fs-sm)] tabular-nums text-(--fg)/85">
            {totals.memoryReadable ? totals.used.toFixed(1) : "—"}
            <span className="text-(--dim)/65">
              /{totals.capacity.toFixed(0)}G{totals.shared ? " unified" : ""}
            </span>
          </span>
        </div>

        <div className="hidden items-baseline gap-5 font-mono text-[length:var(--fs-sm)] tabular-nums sm:flex">
          <Aggregate label="util" value={totals.utilLabel} />
          <Aggregate label="temp" value={totals.tempLabel} />
          <Aggregate label="pwr" value={totals.powerLabel} />
        </div>

        <span
          aria-hidden
          className={`ml-1 font-mono text-[length:var(--fs-xs)] text-(--dim)/55 transition-transform group-hover:text-(--dim) ${
            expanded ? "rotate-90" : ""
          }`}
        >
          ›
        </span>
      </button>

      {expanded ? (
        <div className="mt-2">
          <GpuTable
            gpus={sortedGpus}
            capacity={totals.capacity}
            groupByName={names.size > 1}
            sort={sort}
            onSort={sortHandler}
          />
        </div>
      ) : null}
    </section>
  );
}

/**
 * The per-device rows, in the repo's table language rather than a private one.
 *
 * These used to be hand-laid spans with fixed `w-8 / w-32 / w-9 / w-14` widths
 * and no headers at all — the reader had to infer that the bare `72°` column
 * was temperature. Moving onto the shell buys headers, sorting and column
 * alignment that matches every other table in the app for free.
 */
function GpuTable({
  gpus,
  capacity,
  groupByName,
  sort,
  onSort,
}: {
  gpus: GPU[];
  capacity: number;
  groupByName: boolean;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => () => void;
}) {
  const groups = groupByName ? groupGpusByName(gpus) : [{ name: null, gpus }];
  // "25% of pool" on every row of a homogeneous rig is the same number four
  // times; the share is only worth a line when the cards differ.
  const mixedCapacities = new Set(gpus.map((gpu) => Math.round(gpuMemoryTotal(gpu)))).size > 1;
  return (
    <TableFrame minWidthClass="min-w-[38rem]">
      <thead>
        <tr>
          <HeadCell>GPU</HeadCell>
          <HeadCell
            numeric
            active={sort.key === "memory"}
            desc={sort.desc}
            onSort={onSort("memory")}
            title="GPU memory in use on this device"
          >
            Memory
          </HeadCell>
          <HeadCell numeric active={sort.key === "util"} desc={sort.desc} onSort={onSort("util")}>
            Util
          </HeadCell>
          <HeadCell numeric active={sort.key === "temp"} desc={sort.desc} onSort={onSort("temp")}>
            Temp
          </HeadCell>
          <HeadCell numeric>Power</HeadCell>
          <HeadCell numeric>State</HeadCell>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <GpuGroup
            key={group.name ?? "all"}
            name={group.name}
            gpus={group.gpus}
            pool={mixedCapacities ? capacity : 0}
          />
        ))}
      </tbody>
    </TableFrame>
  );
}

function GpuGroup({ name, gpus, pool }: { name: string | null; gpus: GPU[]; pool: number }) {
  return (
    <>
      {name ? (
        <GroupRow
          colSpan={6}
          label={name.replace(/^NVIDIA\s+/, "")}
          right={`${gpus.length} ${gpus.length === 1 ? "device" : "devices"}`}
        />
      ) : null}
      {gpus.map((gpu) => (
        <GpuRow key={gpu.uuid ?? gpu.id ?? gpu.index} gpu={gpu} pool={pool} />
      ))}
    </>
  );
}

/** Every reading the controller can decline to report, resolved in one place. */
function gpuCells(gpu: GPU) {
  const memUsed = gpuMemoryUsed(gpu);
  const memTotal = gpuMemoryTotal(gpu);
  const power = gpu.power_draw || 0;
  const powerLimit = gpu.power_limit || 0;
  const utilReadable = gpu.utilization_available !== false;
  const tempReadable = gpu.temperature_available !== false && gpu.temp_c > 0;
  const powerReadable = gpu.power_available !== false && power > 0;
  const busy = utilReadable && gpu.utilization_pct > 5;
  return {
    memUsed,
    memTotal,
    memShare: memTotal > 0 ? Math.min(1, memUsed / memTotal) : 0,
    memText: gpu.memory_usage_available !== false ? memUsed.toFixed(1) : "—",
    utilReadable,
    utilText: utilReadable ? `${Math.round(gpu.utilization_pct)}%` : "—",
    tempText: tempReadable ? `${Math.round(gpu.temp_c)}°` : "—",
    powerText: powerReadable
      ? `${Math.round(power)}${powerLimit > 0 ? `/${Math.round(powerLimit)}` : ""} W`
      : "—",
    stateText: utilReadable ? (busy ? "busy" : "idle") : "unreported",
    stateTone: busy ? ("ok" as const) : ("dim" as const),
  };
}

function GpuRow({ gpu, pool }: { gpu: GPU; pool: number }) {
  const cells = gpuCells(gpu);
  const { memUsed, memTotal } = cells;
  const label = gpu.id ?? gpu.index ?? "gpu";

  return (
    <DataRow>
      {/* Just the index: the card model is stated once, in the section header
          (or the group row on a mixed rig), not repeated down every row. */}
      <LeadCell>
        <span
          className="font-mono text-[length:var(--fs-sm)] tabular-nums text-(--fg)"
          title={gpu.name}
        >
          G{label}
        </span>
      </LeadCell>
      {/* The share is of this device's own capacity, not of the pool: a bar that
          ranked cards against each other would say nothing about whether any one
          of them is close to OOM, which is the question being asked. */}
      <BarCell
        share={cells.memShare}
        sub={pool > 0 ? `${Math.round((memTotal / pool) * 100)}% of pool` : undefined}
        title={`${memUsed.toFixed(1)} GB of ${memTotal.toFixed(0)} GB in use`}
      >
        {cells.memText}
        <span className="text-(--dim)/55">/{memTotal.toFixed(0)} GB</span>
      </BarCell>
      <NumCell>{cells.utilText}</NumCell>
      <NumCell>{cells.tempText}</NumCell>
      <NumCell>{cells.powerText}</NumCell>
      <EndCell>
        <div className="flex items-center justify-end gap-2">
          <StatusText tone={cells.stateTone}>{cells.stateText}</StatusText>
          {gpu.uuid ? (
            <RowAction
              alwaysVisible
              tone="quiet"
              title={gpu.uuid}
              onClick={() => {
                void writeClipboardText(gpu.uuid ?? "");
              }}
            >
              Copy UUID
            </RowAction>
          ) : null}
        </div>
      </EndCell>
    </DataRow>
  );
}

function groupGpusByName(gpus: GPU[]): Array<{ name: string; gpus: GPU[] }> {
  const byName = new Map<string, GPU[]>();
  for (const gpu of gpus) {
    const key = gpu.name || "Unknown";
    byName.set(key, [...(byName.get(key) ?? []), gpu]);
  }
  return [...byName.entries()].map(([name, entries]) => ({ name, gpus: entries }));
}

function sortValue(gpu: GPU, key: SortKey): number {
  if (key === "util") return gpu.utilization_available === false ? -1 : gpu.utilization_pct;
  if (key === "temp") return gpu.temperature_available === false ? -1 : gpu.temp_c;
  return gpuMemoryTotal(gpu) * 1000 + gpuMemoryUsed(gpu);
}

function aggregate(gpus: GPU[]) {
  const used = gpus.reduce((sum, gpu) => sum + gpuMemoryUsed(gpu), 0);
  const capacity = gpus.reduce((sum, gpu) => sum + gpuMemoryTotal(gpu), 0);
  const power = gpus.reduce((sum, gpu) => sum + (gpu.power_draw || 0), 0);
  const powerLimit = gpus.reduce((sum, gpu) => sum + (gpu.power_limit || 0), 0);
  const utils = gpus
    .filter((gpu) => gpu.utilization_available !== false)
    .map((gpu) => gpu.utilization_pct);
  const temps = gpus.map((gpu) => gpu.temp_c).filter((temp) => temp > 0);
  const avgUtil = utils.length > 0 ? utils.reduce((sum, v) => sum + v, 0) / utils.length : 0;
  const maxTemp = temps.length > 0 ? Math.max(...temps) : 0;
  return {
    used,
    capacity,
    memPct: capacity > 0 ? Math.min(100, Math.max(0, (used / capacity) * 100)) : 0,
    memoryReadable: gpus.some((gpu) => gpu.memory_usage_available !== false),
    shared: gpus.some((gpu) => gpu.memory_shared),
    utilLabel: utils.length > 0 ? `${Math.round(avgUtil)}%` : "—",
    tempLabel: maxTemp > 0 ? `${Math.round(maxTemp)}°` : "—",
    powerLabel: gpus.some((gpu) => gpu.power_available !== false)
      ? `${Math.round(power)}${powerLimit > 0 ? `/${Math.round(powerLimit)}` : ""}W`
      : "—",
  };
}

function Aggregate({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[length:var(--fs-2xs)] text-(--dim)/55">{label}</span>
      <span className="text-(--fg)/85">{value}</span>
    </span>
  );
}

function gpuMemoryUsed(gpu: GPU): number {
  return toGBFromMB(gpu.memory_used_mb);
}

function gpuMemoryTotal(gpu: GPU): number {
  return toGBFromMB(gpu.memory_total_mb);
}
