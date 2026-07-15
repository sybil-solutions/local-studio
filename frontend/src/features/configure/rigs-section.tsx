"use client";

import { useState } from "react";
import { Button, EmptySafeNotice, UiModal, UiModalHeader } from "@/ui";
import { Plus } from "@/ui/icon-registry";
import { cx } from "@/ui/utils";
import type { Rig, RigNode } from "@/lib/types";
import type { RigNodePayload } from "@/lib/api/rigs";
import type { ConfigureState } from "./use-configure";
import { InlineRename } from "./inline-rename";
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

function RigStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="font-mono text-[length:var(--fs-xl)] font-semibold tabular-nums text-(--ui-fg)">
        {value}
      </div>
      <div className="text-[length:var(--fs-2xs)] uppercase tracking-[0.14em] text-(--ui-muted)">
        {label}
      </div>
    </div>
  );
}

function PooledMemoryBar({ nodes, totalGb }: { nodes: RigNode[]; totalGb: number }) {
  if (totalGb <= 0 || nodes.length < 2) return null;
  const segments = nodes
    .map((node) => ({ node, gb: nodeAcceleratorGb(node) }))
    .filter((segment) => segment.gb > 0);
  if (segments.length < 2) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {segments.map(({ node, gb }) => (
          <div
            key={node.id}
            title={`${node.name} · ${gb} GB`}
            style={{ width: `${(gb / totalGb) * 100}%` }}
            className={cx(
              "h-full transition-[width] duration-300",
              node.role === "head" ? "bg-(--ui-accent)/80" : "bg-(--ui-fg)/30",
            )}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[length:var(--fs-xs)] text-(--ui-muted)">
        {segments.map(({ node, gb }) => (
          <span key={node.id} className="inline-flex items-center gap-1.5">
            <span
              className={cx(
                "h-1.5 w-1.5 rounded-full",
                node.role === "head" ? "bg-(--ui-accent)/80" : "bg-(--ui-fg)/30",
              )}
            />
            <span className="font-mono">{node.name}</span>
            <span className="tabular-nums">{gb} GB</span>
          </span>
        ))}
        <span className="ml-auto">combined accelerator memory across devices</span>
      </div>
    </div>
  );
}

function RigCard({
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
  const head = nodes.find((node) => node.role === "head");
  const workers = nodes.filter((node) => node !== head);
  const totalGb = nodes.reduce((sum, node) => sum + nodeAcceleratorGb(node), 0);
  const containsLocal = rig.nodes.some((node) => node.id === state.localNodeId);
  const displayName = rig.name === "My Rig" ? "Your machines" : rig.name;

  const renderNode = (node: RigNode) => (
    <RigNodeCard
      key={node.id}
      node={node}
      isLocal={node.id === state.localNodeId}
      onRename={(name) => state.updateNode(rig.id, node.id, { name })}
      onEdit={() => onEditNode(node)}
      onDelete={node.id === state.localNodeId ? undefined : () => onDeleteNode(node)}
    />
  );

  return (
    <section className="overflow-hidden rounded-xl border border-(--ui-border) bg-(--ui-surface)">
      <header className="space-y-4 border-b border-(--ui-separator) px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <InlineRename
              value={displayName}
              label={`machine group ${displayName}`}
              onRename={(name) => state.renameRig(rig.id, name)}
              textClassName="text-[length:var(--fs-xl)] font-medium tracking-[-0.01em] text-(--ui-fg)"
            />
            {rig.description ? (
              <p className="mt-0.5 text-[length:var(--fs-sm)] text-(--ui-muted)">
                {rig.description}
              </p>
            ) : null}
          </div>
          <div className="flex items-start gap-6">
            <RigStat
              label={rig.nodes.length === 1 ? "machine" : "machines"}
              value={String(rig.nodes.length)}
            />
            {totalGb > 0 ? <RigStat label="GPU memory" value={`${totalGb} GB`} /> : null}
          </div>
        </div>
        <PooledMemoryBar nodes={nodes} totalGb={totalGb} />
      </header>

      <div className="divide-y divide-(--ui-separator)">
        {head ? renderNode(head) : null}
        {head && workers.length > 0 ? (
          <div className="flex items-center gap-3 px-5 py-2 text-[length:var(--fs-xs)] text-(--ui-muted)/80">
            <span className="ml-6 h-3 w-px bg-(--ui-separator)" />
            {workers.length === 1 ? "1 worker joins" : `${workers.length} workers join`} the head
            over the local network
          </div>
        ) : null}
        {workers.length > 0 ? (
          <div className="divide-y divide-(--ui-separator)">{workers.map(renderNode)}</div>
        ) : null}
        {rig.nodes.length === 0 ? (
          <EmptySafeNotice>
            No devices yet. Add each machine that belongs to this rig — they show up here with
            live-detected hardware where possible.
          </EmptySafeNotice>
        ) : null}
      </div>

      <footer className="flex items-center justify-between border-t border-(--ui-separator) px-5 py-3">
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={onAddNode}
        >
          Add another machine
        </Button>
        {containsLocal ? (
          <span className="text-[length:var(--fs-xs)] text-(--ui-muted)/70">
            Hardware for this machine updates automatically
          </span>
        ) : (
          <Button variant="danger" size="sm" onClick={onDeleteRig}>
            Delete rig
          </Button>
        )}
      </footer>
    </section>
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
    <div className="space-y-5">
      {state.rigs.map((rig) => (
        <RigCard
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
