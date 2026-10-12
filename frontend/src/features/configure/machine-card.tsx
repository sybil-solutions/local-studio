"use client";

import { RIG_HARDWARE_TYPE_LABELS, RIG_NODE_ROLE_LABELS } from "@local-studio/contracts/rigs";
import { ModelButton } from "@/ui";
import type { RigAccelerator, RigNode } from "@/lib/types";
import { StatCell, StatusText } from "@/features/recipes/recipes-content/catalog-table-shell";
import { MachineImage } from "./hardware-image";

/** GPU memory a machine contributes to the pool, in GB. */
export const machineGpuGb = (node: RigNode): number =>
  node.accelerators.reduce(
    (sum, accelerator) => sum + (accelerator.memory_gb ?? 0) * accelerator.count,
    0,
  );

/** How many physical accelerators are installed, across every model. */
const acceleratorUnits = (node: RigNode): number =>
  node.accelerators.reduce((sum, accelerator) => sum + accelerator.count, 0);

/**
 * The part number without its vendor prefix.
 *
 * "NVIDIA RTX PRO 6000 Blackwell Workstation Edition" is 49 characters of which
 * the first seven are already said by the picture beside it, and the truncation
 * lands mid-model without them. The full string stays on the cell's title.
 */
const acceleratorLabel = (accelerator: RigAccelerator): string => {
  const model = accelerator.name.replace(/^(NVIDIA|AMD|Intel)\s+/i, "");
  return accelerator.count > 1 ? `${accelerator.count} × ${model}` : model;
};

const acceleratorSpec = (accelerator: RigAccelerator): string =>
  [
    accelerator.memory_gb ? `${accelerator.memory_gb} GB each` : null,
    accelerator.memory_type,
    accelerator.memory_bandwidth_gbs ? `${accelerator.memory_bandwidth_gbs} GB/s` : null,
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * A machine is an object, not a row.
 *
 * This section was a six-column table, and a table earns its columns by letting
 * you compare many rows down one of them. There are one to four machines here,
 * their most interesting fact is a 45-character part number, and the table was
 * 1001px wide inside a 594px column — so GPU memory, RAM and the add button all
 * lived behind a nested horizontal scrollbar. A card is wider than it is tall,
 * wraps instead of scrolling, and has room for the picture that answers "is
 * this the box under my desk?" before any text is read. The numbers stay
 * tabular inside it, on one baseline grid, so two cards still line up.
 */
/** Which of the three kinds of machine this is, in the operator's words. */
const provenance = (node: RigNode, isLocal: boolean) =>
  isLocal
    ? { tone: "ok" as const, label: "this machine" }
    : node.source === "detected"
      ? { tone: "info" as const, label: "detected" }
      : { tone: "dim" as const, label: "added by hand" };

/** Picture, name, what kind of box it is, and where to reach it. */
function MachineHeader({
  node,
  isLocal,
  onEdit,
  onRemove,
}: {
  node: RigNode;
  isLocal: boolean;
  onEdit: () => void;
  onRemove?: () => void;
}) {
  const endpoint = [node.hostname, node.address].filter(
    (value, index, all) => value && all.indexOf(value) === index,
  );
  const subtitle = [
    RIG_HARDWARE_TYPE_LABELS[node.hardware_type],
    RIG_NODE_ROLE_LABELS[node.role],
    ...endpoint,
  ].join(" · ");
  const source = provenance(node, isLocal);

  return (
    <div className="flex items-start gap-3 sm:gap-4">
      <MachineImage node={node} className="h-16 w-24" />
      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            className="truncate text-[length:var(--fs-lg)] font-medium text-(--fg)"
            title={node.name}
          >
            {node.name}
          </h3>
          <p className="mt-0.5 truncate text-[length:var(--fs-sm)] text-(--dim)" title={subtitle}>
            {subtitle}
          </p>
        </div>
        {/* Always on screen: these are the only way to act on a machine, and a
            card that reveals its controls on hover has none on a phone. */}
        <div className="flex shrink-0 items-center gap-1">
          <StatusText tone={source.tone}>{source.label}</StatusText>
          <ModelButton onClick={onEdit} title={`Edit ${node.name}`}>
            Edit
          </ModelButton>
          {onRemove ? (
            <ModelButton onClick={onRemove} tone="danger" title={`Remove ${node.name}`}>
              Remove
            </ModelButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * What is actually installed, one line per model of card.
 *
 * This is the machine's most interesting fact and also its longest string — 49
 * characters for an RTX PRO 6000 — so it gets the full width of the card rather
 * than a quarter of it. The old table put it in a right-aligned nowrap numeric
 * cell, where it alone made the table 1001px wide.
 */
function MachineAccelerators({ node }: { node: RigNode }) {
  if (node.accelerators.length === 0) {
    return (
      <p className="mt-2.5 border-t border-(--ui-separator) pt-2 text-[length:var(--fs-sm)] text-(--dim)/70">
        No GPUs found on this machine.
      </p>
    );
  }
  return (
    <ul className="mt-2.5 space-y-1 border-t border-(--ui-separator) pt-2">
      {node.accelerators.map((accelerator) => (
        <li
          key={accelerator.name}
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
        >
          <span
            className="min-w-0 truncate text-[length:var(--fs-sm)] text-(--fg)"
            title={accelerator.name}
          >
            {acceleratorLabel(accelerator)}
          </span>
          <span className="text-[length:var(--fs-xs)] tabular-nums text-(--dim)/70">
            {acceleratorSpec(accelerator)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The three numbers a machine is judged on, on one baseline across cards. */
function MachineStats({ node }: { node: RigNode }) {
  const gpuGb = machineGpuGb(node);
  const units = acceleratorUnits(node);
  const cpuModel = node.cpu_model && node.cpu_model !== "unknown" ? node.cpu_model : null;
  const unified = node.accelerators.some((accelerator) => accelerator.unified_memory);

  return (
    <div className="mt-2.5 grid grid-cols-3 gap-x-2 border-t border-(--ui-separator) pt-2">
      <StatCell
        label="GPU memory"
        value={gpuGb ? `${gpuGb} GB` : "—"}
        sub={units ? `${units} ${units === 1 ? "accelerator" : "accelerators"}` : null}
        title="GPU memory this machine adds to the pool"
      />
      <StatCell
        label="System memory"
        value={node.memory_gb ? `${node.memory_gb} GB` : "—"}
        sub={unified ? "shared with the GPU" : null}
      />
      <StatCell
        label="Processor"
        value={node.cpu_cores ? `${node.cpu_cores} cores` : "—"}
        sub={cpuModel}
        title={cpuModel ?? ""}
      />
    </div>
  );
}

export function MachineCard({
  node,
  isLocal,
  onEdit,
  onRemove,
}: {
  node: RigNode;
  isLocal: boolean;
  onEdit: () => void;
  onRemove?: () => void;
}) {
  return (
    <article className="rounded-[var(--rad-lg)] border border-(--ui-border) bg-(--ui-surface) p-3 transition-colors hover:border-(--ui-border)/60 sm:p-4">
      <MachineHeader node={node} isLocal={isLocal} onEdit={onEdit} onRemove={onRemove} />
      <MachineAccelerators node={node} />
      <MachineStats node={node} />

      {node.os || node.notes ? (
        <p className="mt-2 text-[length:var(--fs-xs)] leading-5 text-(--dim)/70">
          {node.os}
          {node.os && node.notes ? " · " : ""}
          {node.notes}
        </p>
      ) : null}
    </article>
  );
}
