"use client";

import { RIG_HARDWARE_TYPE_LABELS, RIG_NODE_ROLE_LABELS } from "@local-studio/contracts/rigs";
import { ModelButton } from "@/ui";
import { SquarePen, Trash2 } from "@/ui/icon-registry";
import type { RigAccelerator, RigNode } from "@/lib/types";
import { ModelRow, ModelStatus, ModelValue } from "@/features/recipes/recipes-content/model-page";
import { HardwareArt } from "./hardware-art";

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
  onEdit,
  onDelete,
}: {
  node: RigNode;
  isLocal: boolean;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const endpoint = [node.hostname, node.address].filter(
    (value, index, all) => value && all.indexOf(value) === index,
  );

  const hardware = RIG_HARDWARE_TYPE_LABELS[node.hardware_type];
  const description = endpoint.length ? `${hardware} · ${endpoint.join(" · ")}` : hardware;
  const accelerator = node.accelerators.map(acceleratorLine).join(" · ");
  const system = [
    node.memory_gb ? `${node.memory_gb} GB RAM` : null,
    node.cpu_model && node.cpu_model !== "unknown" ? node.cpu_model : null,
    node.cpu_cores ? `${node.cpu_cores} cores` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <ModelRow
      label={node.name}
      description={description}
      leading={
        <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-md border border-(--ui-border) bg-(--surface-3)">
          <HardwareArt type={node.hardware_type} className="h-6 w-full opacity-90" />
        </span>
      }
      value={<ModelValue mono>{accelerator || system || "Hardware discovery pending"}</ModelValue>}
      status={
        <ModelStatus tone={isLocal ? "good" : node.role === "head" ? "info" : "default"}>
          {isLocal ? "this machine" : RIG_NODE_ROLE_LABELS[node.role]}
        </ModelStatus>
      }
      actions={
        <>
          <ModelButton onClick={onEdit} title={`Edit ${node.name}`}>
            <SquarePen className="h-3 w-3" />
          </ModelButton>
          {onDelete ? (
            <ModelButton onClick={onDelete} tone="danger" title={`Remove ${node.name}`}>
              <Trash2 className="h-3 w-3" />
            </ModelButton>
          ) : null}
        </>
      }
      onClick={onEdit}
    >
      {system || node.notes ? (
        <div className="truncate font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
          {[system, node.notes].filter(Boolean).join(" · ")}
        </div>
      ) : null}
    </ModelRow>
  );
}
