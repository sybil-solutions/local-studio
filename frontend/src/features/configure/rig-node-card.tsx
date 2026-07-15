"use client";

import { RIG_HARDWARE_TYPE_LABELS, RIG_NODE_ROLE_LABELS } from "@local-studio/contracts/rigs";
import { Button, StatusPill } from "@/ui";
import { SquarePen, Trash2 } from "@/ui/icon-registry";
import type { RigAccelerator, RigNode } from "@/lib/types";
import { HardwareArt } from "./hardware-art";
import { InlineRename } from "./inline-rename";

const acceleratorLine = (accelerator: RigAccelerator): string => {
  const memory = accelerator.memory_gb ? ` · ${accelerator.memory_gb} GB` : "";
  const memoryType = accelerator.memory_type ? ` ${accelerator.memory_type}` : "";
  const bandwidth = accelerator.memory_bandwidth_gbs
    ? ` · ${accelerator.memory_bandwidth_gbs} GB/s`
    : "";
  return `${accelerator.count}× ${accelerator.name}${memory}${memoryType}${bandwidth}`;
};

export function RigNodeCard({
  node,
  isLocal,
  onRename,
  onEdit,
  onDelete,
}: {
  node: RigNode;
  isLocal: boolean;
  onRename: (name: string) => Promise<void>;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const endpoint = [node.hostname, node.address].filter(
    (value, index, all) => value && all.indexOf(value) === index,
  );

  return (
    <div className="group relative flex gap-4 px-5 py-4 transition-colors hover:bg-(--ui-hover)/40">
      <div className="flex h-12 w-14 shrink-0 items-center justify-center rounded-lg border border-(--ui-border) bg-(--surface-3)">
        <HardwareArt type={node.hardware_type} className="h-9 w-full opacity-90" />
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <InlineRename
            value={node.name}
            label={`device ${node.name}`}
            onRename={onRename}
            textClassName="text-[length:var(--fs-base)] font-medium text-(--ui-fg)"
          />
          <StatusPill tone={node.role === "head" ? "info" : "default"}>
            {RIG_NODE_ROLE_LABELS[node.role]}
          </StatusPill>
          {isLocal ? <StatusPill tone="good">This machine</StatusPill> : null}
        </div>

        <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">
          {RIG_HARDWARE_TYPE_LABELS[node.hardware_type]}
          {endpoint.length ? <span className="font-mono"> · {endpoint.join(" · ")}</span> : null}
        </p>

        {node.accelerators.map((accelerator) => (
          <p
            key={accelerator.name}
            className="truncate text-[length:var(--fs-sm)] text-(--ui-fg)/90"
          >
            {acceleratorLine(accelerator)}
          </p>
        ))}

        <p className="text-[length:var(--fs-sm)] text-(--ui-muted)/80">
          {[
            node.memory_gb ? `${node.memory_gb} GB RAM` : null,
            node.cpu_model && node.cpu_model !== "unknown" ? node.cpu_model : null,
            node.cpu_cores ? `${node.cpu_cores} cores` : null,
          ]
            .filter(Boolean)
            .join(" · ") || " "}
        </p>

        {node.notes ? (
          <p className="line-clamp-2 border-t border-(--ui-separator)/60 pt-1.5 text-[length:var(--fs-xs)] leading-relaxed text-(--ui-muted)">
            {node.notes}
          </p>
        ) : null}
      </div>

      <div className="absolute right-4 top-3 flex gap-1 opacity-60 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Button
          variant="icon"
          size="sm"
          onClick={onEdit}
          title="Edit device"
          icon={<SquarePen className="h-3.5 w-3.5" />}
        />
        {onDelete ? (
          <Button
            variant="icon"
            size="sm"
            onClick={onDelete}
            title="Remove device"
            icon={<Trash2 className="h-3.5 w-3.5" />}
          />
        ) : null}
      </div>
    </div>
  );
}
