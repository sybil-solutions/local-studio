"use client";

import { useMemo, useState } from "react";
import { DownloadCloud } from "@/ui/icon-registry";
import { ModelLogo } from "@/ui/model-logo";
import type { ModelIndexModel, ModelIndexVariant } from "@/lib/api/studio";
import type { ModelDownload } from "@/lib/types";
import { downloadProgressText } from "./downloads-tab";
import { modelBrand } from "./model-brand";
import {
  DataRow,
  EndCell,
  GroupRow,
  HeadCell,
  IdentityCell,
  NumCell,
  RowAction,
  StatusText,
  TableFrame,
} from "./catalog-table-shell";
import { bestFit, formatContextTokens, formatGb, type Fit } from "./model-fit";

export type SortKey = "name" | "index" | "params" | "context" | "memory";

/**
 * The catalog as a table.
 *
 * Six columns, and each one had to earn its width: identity, capability proxy,
 * the real differentiator, the fit-critical number, the fit rule itself, and
 * whether you already have it. Active params ride inside Params rather than
 * taking a column that would be empty for every dense model; format rides under
 * Size because it is how you get that size, not an independent fact; license and
 * the full quantization list live in the drawer.
 *
 * A model that does not fit is dimmed, never reddened — the eye should land on
 * what is usable, not on what is broken.
 */
export type CatalogGroup = {
  id: string;
  label: string;
  blurb: string;
  models: readonly ModelIndexModel[];
};

export function ModelCatalogTable({
  groups,
  poolGb,
  downloadsByModel,
  startingModelIds,
  onOpen,
  onDownload,
}: {
  groups: readonly CatalogGroup[];
  poolGb: number;
  downloadsByModel: Map<string, ModelDownload>;
  startingModelIds: Set<string>;
  onOpen: (model: ModelIndexModel) => void;
  onDownload: (variant: ModelIndexVariant) => void;
}) {
  // Best-first: the index is now the reason to read the table at all.
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "index",
    desc: true,
  });

  // Tier is a real partition of the catalog, so sorting happens inside each
  // group rather than across the whole table — a 9B and a 753B model are not
  // competing for the same slot.
  const sorted = useMemo(() => {
    const direction = sort.desc ? -1 : 1;
    const compare = (
      a: { model: ModelIndexModel; best: ReturnType<typeof bestFit> },
      b: { model: ModelIndexModel; best: ReturnType<typeof bestFit> },
    ) => {
      switch (sort.key) {
        case "name":
          return a.model.name.localeCompare(b.model.name) * direction;
        case "params":
          return ((a.model.total_params_b ?? 0) - (b.model.total_params_b ?? 0)) * direction;
        case "context":
          return (a.model.context_tokens - b.model.context_tokens) * direction;
        case "index":
          return (
            ((a.model.intelligence_index ?? -1) - (b.model.intelligence_index ?? -1)) * direction
          );
        default:
          return ((a.best.fit.sizeGb ?? 0) - (b.best.fit.sizeGb ?? 0)) * direction;
      }
    };
    return groups.map((group) => ({
      ...group,
      rows: group.models.map((model) => ({ model, best: bestFit(model, poolGb) })).sort(compare),
      runnable: group.models.filter((model) => bestFit(model, poolGb).fit.state === "fits").length,
    }));
  }, [groups, poolGb, sort]);

  const toggle = (key: SortKey) =>
    setSort((current) => ({ key, desc: current.key === key ? !current.desc : false }));
  const head = (key: SortKey) => ({
    active: sort.key === key,
    desc: sort.desc,
    onSort: () => toggle(key),
  });

  return (
    <TableFrame>
      <thead>
        <tr>
          <HeadCell {...head("name")}>Model</HeadCell>
          <HeadCell
            {...head("index")}
            numeric
            title="Artificial Analysis Intelligence Index — higher is more capable"
          >
            Index
          </HeadCell>
          <HeadCell {...head("params")} numeric>
            Params
          </HeadCell>
          <HeadCell {...head("context")} numeric>
            Context
          </HeadCell>
          <HeadCell
            {...head("memory")}
            numeric
            title="Memory the weights need, and what share of your pool that is"
          >
            Memory
          </HeadCell>
          <HeadCell numeric>Status</HeadCell>
        </tr>
      </thead>
      {sorted.map((group) => (
        <tbody key={group.id}>
          <GroupRow
            colSpan={6}
            label={group.label}
            blurb={group.blurb}
            right={
              poolGb > 0
                ? `${group.runnable} of ${group.models.length} run here`
                : `${group.models.length} models`
            }
          />
          {group.rows.map(({ model, best }) => (
            <ModelRowCells
              key={model.id}
              model={model}
              best={best}
              poolGb={poolGb}
              download={best.variant ? (downloadsByModel.get(best.variant.repo) ?? null) : null}
              isStarting={best.variant ? startingModelIds.has(best.variant.repo) : false}
              onOpen={() => onOpen(model)}
              onDownload={() => best.variant && onDownload(best.variant)}
            />
          ))}
        </tbody>
      ))}
    </TableFrame>
  );
}

function ModelRowCells({
  model,
  best,
  poolGb,
  download,
  isStarting,
  onOpen,
  onDownload,
}: {
  model: ModelIndexModel;
  best: { fit: Fit; variant: ModelIndexVariant | null };
  poolGb: number;
  download: ModelDownload | null;
  isStarting: boolean;
  onOpen: () => void;
  onDownload: () => void;
}) {
  const brand = modelBrand(model);
  const marker = model.role ?? (model.multimodal ? "vision" : model.active_params_b ? "MoE" : null);
  const subtitle = [brand.label, marker].filter(Boolean).join(" · ");

  return (
    <DataRow
      onOpen={onOpen}
      ariaLabel={`Open ${model.name} details`}
      dimmed={best.fit.state === "over"}
    >
      <IdentityCell
        leading={
          <ModelLogo
            modelId={brand.repo}
            author={brand.owner}
            label={model.name}
            size="sm"
            className="rounded-md"
          />
        }
        label={model.name}
        description={subtitle || brand.repo}
        title={model.name}
      />

      <IndexCell model={model} />

      <NumCell>
        {model.total_params_b != null ? `${model.total_params_b}B` : "—"}
        {model.active_params_b != null ? (
          <span className="text-(--dim)/60"> · {model.active_params_b}B active</span>
        ) : null}
      </NumCell>

      <NumCell>{formatContextTokens(model.context_tokens)}</NumCell>

      <NumCell sub={<PoolCell fit={best.fit} poolGb={poolGb} />}>
        <span className="text-(--fg)">{formatGb(best.fit.sizeGb)}</span>
      </NumCell>

      <EndCell>
        <StatusCell
          download={download}
          isStarting={isStarting}
          disabled={!best.variant}
          onDownload={onDownload}
        />
      </EndCell>
    </DataRow>
  );
}

function PoolCell({ fit, poolGb }: { fit: Fit; poolGb: number }) {
  if (poolGb <= 0 || fit.poolShare == null) return <span>—</span>;
  if (fit.state === "over") return <span>over pool</span>;
  const percent = fit.poolShare * 100;
  return <span>{percent < 1 ? "<1% of pool" : `${Math.round(percent)}% of pool`}</span>;
}

/**
 * The index is the only number the table sets in full-strength text: it is the
 * reason to prefer one row over another, and everything else is a constraint on
 * acting for that reason. A missing score reads as "not rated", never as zero.
 */
function IndexCell({ model }: { model: ModelIndexModel }) {
  if (model.intelligence_index == null) {
    return (
      <NumCell>
        <span className="text-(--dim)/50">not rated</span>
      </NumCell>
    );
  }
  return (
    <NumCell
      strong
      sub={model.agentic_index != null ? `${model.agentic_index.toFixed(1)} agentic` : undefined}
    >
      {model.intelligence_index.toFixed(1)}
    </NumCell>
  );
}

/**
 * Status doubles as the row's action: nothing is shown until you hover, so the
 * table stays quiet, and the download button is the only accent on the page.
 */
function StatusCell({
  download,
  isStarting,
  disabled,
  onDownload,
}: {
  download: ModelDownload | null;
  isStarting: boolean;
  disabled: boolean;
  onDownload: () => void;
}) {
  if (isStarting) return <StatusText>starting…</StatusText>;
  if (download?.status === "downloading" || download?.status === "paused") {
    return <StatusText>{downloadProgressText(download)}</StatusText>;
  }
  if (download?.status === "completed") return <StatusText>on disk</StatusText>;
  if (download?.status === "failed") return <StatusText tone="error">failed</StatusText>;
  return (
    <RowAction onClick={onDownload} disabled={disabled}>
      <DownloadCloud className="h-3 w-3" />
      Download
    </RowAction>
  );
}
