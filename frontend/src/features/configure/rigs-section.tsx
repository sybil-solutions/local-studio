"use client";

import { useState } from "react";
import { Button, EmptySafeNotice, ModelButton, UiModal, UiModalHeader } from "@/ui";
import { Plus, Trash2 } from "@/ui/icon-registry";
import type { Rig, RigNode } from "@/lib/types";
import type { RigNodePayload } from "@/lib/api/rigs";
import { ModelSection, ModelStatus } from "@/features/recipes/recipes-content/model-page";
import type { ConfigureState } from "./use-configure";
import { RigNodeCard } from "./rig-node-card";
import { NodeFormModal, nodeToForm } from "./node-form-modal";

type NodeTarget = { rigId: string; node: RigNode | null };
type DeleteTarget = { kind: "rig"; rig: Rig } | { kind: "node"; rigId: string; node: RigNode };

const nodeAcceleratorGb = (node: RigNode): number =>
  node.accelerators.reduce(
    (sum, accelerator) => sum + (accelerator.memory_gb ?? 0) * accelerator.count,
    0,
  );

const sortHeadFirst = (nodes: RigNode[]): RigNode[] =>
  [...nodes].sort((a, b) => Number(b.role === "head") - Number(a.role === "head"));

function MachineGroup({
  rig,
  state,
  onAddNode,
  onEditNode,
  onDeleteNode,
  onDeleteRig,
}: {
  rig: Rig;
  state: ConfigureState;
  onAddNode: () => void;
  onEditNode: (node: RigNode) => void;
  onDeleteNode: (node: RigNode) => void;
  onDeleteRig: () => void;
}) {
  const nodes = sortHeadFirst(rig.nodes);
  const totalGb = nodes.reduce((sum, node) => sum + nodeAcceleratorGb(node), 0);
  const containsLocal = nodes.some((node) => node.id === state.localNodeId);
  const title = rig.name === "My Rig" ? "Your machines" : rig.name;
  return (
    <ModelSection
      title={title}
      description={
        rig.description || "Hardware available to this controller for local and distributed serves."
      }
      actions={
        <div className="flex items-center gap-2">
          <ModelStatus tone={nodes.length ? "good" : "default"}>
            {nodes.length} {nodes.length === 1 ? "machine" : "machines"}
            {totalGb ? ` · ${totalGb} GB GPU` : ""}
          </ModelStatus>
          <ModelButton onClick={onAddNode} tone="primary">
            <Plus className="h-3 w-3" />
            Add
          </ModelButton>
          {!containsLocal ? (
            <ModelButton onClick={onDeleteRig} tone="danger" title={`Delete ${title}`}>
              <Trash2 className="h-3 w-3" />
            </ModelButton>
          ) : null}
        </div>
      }
    >
      {nodes.length ? (
        nodes.map((node) => (
          <RigNodeCard
            key={node.id}
            node={node}
            isLocal={node.id === state.localNodeId}
            onEdit={() => onEditNode(node)}
            onDelete={node.id === state.localNodeId ? undefined : () => onDeleteNode(node)}
          />
        ))
      ) : (
        <EmptySafeNotice>
          No machines yet. Add each computer that contributes CPU, memory, or GPUs to this group.
        </EmptySafeNotice>
      )}
    </ModelSection>
  );
}

function ConfirmDeleteModal({
  title,
  message,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <UiModal isOpen onClose={onCancel}>
      <UiModalHeader title={title} onClose={onCancel} />
      <div className="space-y-4 p-4">
        <p className="text-[length:var(--fs-base)] text-(--ui-muted)">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(onCancel);
            }}
          >
            Remove
          </Button>
        </div>
      </div>
    </UiModal>
  );
}

export function RigsSection({ state }: { state: ConfigureState }) {
  const [nodeTarget, setNodeTarget] = useState<NodeTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [creatingRig, setCreatingRig] = useState(false);

  const submitNode = async (payload: RigNodePayload & { name: string }) => {
    if (!nodeTarget) return;
    if (nodeTarget.node) {
      await state.updateNode(nodeTarget.rigId, nodeTarget.node.id, payload);
    } else {
      await state.addNode(nodeTarget.rigId, payload);
    }
  };

  return (
    <div className="space-y-7">
      {state.rigs.map((rig) => (
        <MachineGroup
          key={rig.id}
          rig={rig}
          state={state}
          onAddNode={() => setNodeTarget({ rigId: rig.id, node: null })}
          onEditNode={(node) => setNodeTarget({ rigId: rig.id, node })}
          onDeleteNode={(node) => setDeleteTarget({ kind: "node", rigId: rig.id, node })}
          onDeleteRig={() => setDeleteTarget({ kind: "rig", rig })}
        />
      ))}

      <Button
        variant="ghost"
        icon={<Plus className="h-3.5 w-3.5" />}
        loading={creatingRig}
        onClick={() => {
          setCreatingRig(true);
          void state.createRig("New Rig").finally(() => setCreatingRig(false));
        }}
      >
        New machine group
      </Button>

      {nodeTarget ? (
        <NodeFormModal
          title={nodeTarget.node ? `Edit ${nodeTarget.node.name}` : "Add machine"}
          initial={nodeTarget.node ? nodeToForm(nodeTarget.node) : undefined}
          detected={nodeTarget.node?.source === "detected"}
          onClose={() => setNodeTarget(null)}
          onSubmit={submitNode}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDeleteModal
          title={deleteTarget.kind === "rig" ? "Delete rig" : "Remove device"}
          message={
            deleteTarget.kind === "rig"
              ? `Delete "${deleteTarget.rig.name}" and its ${deleteTarget.rig.nodes.length} device(s)? No hardware is touched.`
              : `Remove "${deleteTarget.node.name}" from this rig?`
          }
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() =>
            deleteTarget.kind === "rig"
              ? state.deleteRig(deleteTarget.rig.id)
              : state.deleteNode(deleteTarget.rigId, deleteTarget.node.id)
          }
        />
      ) : null}
    </div>
  );
}
