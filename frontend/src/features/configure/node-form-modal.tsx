"use client";

import { useState } from "react";
import {
  RIG_HARDWARE_TYPE_LABELS,
  RIG_HARDWARE_TYPES,
  RIG_NODE_ROLES,
} from "@local-studio/contracts/rigs";
import { Button, Checkbox, FormField, Input, Select, Textarea } from "@/ui";
import { ResourceDrawer } from "@/ui/resource-drawer";
import type { RigHardwareType, RigNode, RigNodeRole } from "@/lib/types";
import type { RigNodePayload } from "@/lib/api/rigs";
import { MachineImage } from "./hardware-image";

/** Sentinel for the "start a new group" option in the group picker. */
const NEW_GROUP = "__new__";

/** Where a newly added machine should live. */
export type NodeGroupChoice = { kind: "existing"; rigId: string } | { kind: "new"; name: string };

export interface NodeFormState {
  name: string;
  hardware_type: RigHardwareType;
  role: RigNodeRole;
  hostname: string;
  address: string;
  memory_gb: string;
  accelerator_name: string;
  accelerator_count: string;
  accelerator_memory_gb: string;
  unified_memory: boolean;
  notes: string;
  group_id: string;
  group_name: string;
}

const EMPTY_FORM: NodeFormState = {
  name: "",
  hardware_type: "dgx-spark",
  role: "worker",
  hostname: "",
  address: "",
  memory_gb: "",
  accelerator_name: "",
  accelerator_count: "1",
  accelerator_memory_gb: "",
  unified_memory: false,
  notes: "",
  group_id: "",
  group_name: "",
};

const ROLE_OPTIONS: Array<{ value: RigNodeRole; label: string }> = [
  { value: "standalone", label: "Standalone — runs models by itself" },
  { value: "head", label: "Head — coordinates other machines" },
  { value: "worker", label: "Worker — lends GPUs to a head" },
];

function isRigNodeRole(value: string): value is RigNodeRole {
  return RIG_NODE_ROLES.some((role) => role === value);
}

export function nodeToForm(node: RigNode): NodeFormState {
  const accelerator = node.accelerators[0];
  return {
    ...EMPTY_FORM,
    name: node.name,
    hardware_type: node.hardware_type,
    role: node.role,
    hostname: node.hostname ?? "",
    address: node.address ?? "",
    memory_gb: node.memory_gb === null ? "" : String(node.memory_gb),
    accelerator_name: accelerator?.name ?? "",
    accelerator_count: String(accelerator?.count ?? 1),
    accelerator_memory_gb: accelerator?.memory_gb == null ? "" : String(accelerator.memory_gb),
    unified_memory: accelerator?.unified_memory ?? false,
    notes: node.notes ?? "",
  };
}

const formToPayload = (form: NodeFormState): RigNodePayload & { name: string } => {
  const acceleratorName = form.accelerator_name.trim();
  return {
    name: form.name.trim(),
    hardware_type: form.hardware_type,
    role: form.role,
    hostname: form.hostname.trim() || null,
    address: form.address.trim() || null,
    memory_gb: form.memory_gb.trim() ? Number(form.memory_gb) : null,
    accelerators: acceleratorName
      ? [
          {
            name: acceleratorName,
            count: Math.max(1, Number(form.accelerator_count) || 1),
            memory_gb: form.accelerator_memory_gb.trim()
              ? Number(form.accelerator_memory_gb)
              : null,
            unified_memory: form.unified_memory,
          },
        ]
      : [],
    notes: form.notes.trim() || null,
  };
};

/**
 * The form's answer to "which machine is this?", drawn the way the card will
 * draw it.
 *
 * The picture is chosen from the accelerator name and the machine type, so
 * typing "NVIDIA GB10" is what turns the tile into a Spark. Showing that here
 * makes the choice self-correcting instead of a surprise after saving.
 */
const previewNode = (form: NodeFormState): RigNode => ({
  id: "preview",
  name: form.name,
  hardware_type: form.hardware_type,
  role: form.role,
  source: "manual",
  hostname: null,
  address: null,
  os: null,
  cpu_model: null,
  cpu_cores: null,
  memory_gb: null,
  accelerators: form.accelerator_name.trim()
    ? [
        {
          name: form.accelerator_name.trim(),
          count: Math.max(1, Number(form.accelerator_count) || 1),
          memory_gb: null,
          memory_type: null,
          memory_bandwidth_gbs: null,
          unified_memory: form.unified_memory,
        },
      ]
    : [],
  notes: null,
});

export function NodeFormModal({
  title,
  initial,
  detected,
  groups,
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: NodeFormState;
  detected?: boolean;
  /**
   * Present only when adding. A machine's group is decided once, when it joins
   * the workspace — the controller has no endpoint for moving a node between
   * groups, so offering the choice again while editing would be a lie.
   */
  groups?: { options: Array<{ id: string; label: string }>; defaultRigId: string | null };
  onClose: () => void;
  onSubmit: (
    payload: RigNodePayload & { name: string },
    group: NodeGroupChoice | null,
  ) => Promise<void>;
}) {
  const [form, setForm] = useState<NodeFormState>(() => ({
    ...(initial ?? EMPTY_FORM),
    group_id: groups?.defaultRigId ?? (groups ? NEW_GROUP : ""),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof NodeFormState>(key: K, value: NodeFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const creatingGroup = form.group_id === NEW_GROUP;

  const groupChoice = (): NodeGroupChoice | null => {
    if (!groups) return null;
    return creatingGroup
      ? { kind: "new", name: form.group_name.trim() }
      : { kind: "existing", rigId: form.group_id };
  };

  const submit = async () => {
    if (!form.name.trim()) {
      setError("Give this machine a name");
      return;
    }
    if (groups && creatingGroup && !form.group_name.trim()) {
      setError("Name the new group");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(formToPayload(form), groupChoice());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <ResourceDrawer
      title={title}
      onClose={onClose}
      status={
        detected
          ? "Detected — hardware details are re-read on every load"
          : "Manual machine profile"
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            Save machine
          </Button>
        </>
      }
      width={680}
    >
      <div className="space-y-4">
        <div className="rounded-[var(--rad-lg)] bg-(--surface-3) px-3 py-2.5 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
          Only the name and how this machine is used are required.
          {detected
            ? " The name, type, role, address and notes are yours; everything else is re-detected."
            : " Everything else is optional."}
        </div>

        {/* A seven-option picker that ate the top third of the sheet as a 4x2
            grid of illustrated cards. It is a one-time choice — it gets one
            row, with the picture alongside as confirmation of the pick. */}
        <FormField label="Machine type">
          <div className="flex items-center gap-3">
            <MachineImage node={previewNode(form)} className="h-11 w-16" />
            <Select
              value={form.hardware_type}
              onChange={(event) => set("hardware_type", event.target.value as RigHardwareType)}
              options={RIG_HARDWARE_TYPES.map((type) => ({
                value: type,
                label: RIG_HARDWARE_TYPE_LABELS[type],
              }))}
              className="min-w-0 flex-1"
            />
          </div>
        </FormField>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            label="Machine name"
            required
            description="A friendly name shown in Local Studio."
          >
            <Input
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder="spark-2384"
            />
          </FormField>
          <FormField label="How is it used?">
            <Select
              value={form.role}
              onChange={(event) => {
                if (isRigNodeRole(event.target.value)) set("role", event.target.value);
              }}
              options={ROLE_OPTIONS}
            />
          </FormField>
          {detected ? null : (
            <FormField label="Hostname (optional)" description="The machine's network hostname.">
              <Input
                value={form.hostname}
                onChange={(event) => set("hostname", event.target.value)}
                placeholder="spark-2384"
              />
            </FormField>
          )}
          <FormField label="Network address (optional)" description="LAN IP or Tailscale name.">
            <Input
              value={form.address}
              onChange={(event) => set("address", event.target.value)}
              placeholder="192.168.1.90"
            />
          </FormField>
          {detected ? null : (
            <FormField label="System memory (GB, optional)">
              <Input
                type="number"
                value={form.memory_gb}
                onChange={(event) => set("memory_gb", event.target.value)}
                placeholder="128"
              />
            </FormField>
          )}
          {groups ? (
            <>
              <FormField
                label="Group"
                description="Machines that serve one model together belong in one group."
              >
                <Select
                  value={form.group_id}
                  onChange={(event) => set("group_id", event.target.value)}
                  options={[
                    ...groups.options.map((option) => ({
                      value: option.id,
                      label: option.label,
                    })),
                    { value: NEW_GROUP, label: "New group…" },
                  ]}
                />
              </FormField>
              {creatingGroup ? (
                <FormField label="New group name" required>
                  <Input
                    value={form.group_name}
                    onChange={(event) => set("group_name", event.target.value)}
                    placeholder="Lab cluster"
                  />
                </FormField>
              ) : null}
            </>
          ) : null}
        </div>

        {detected ? null : (
          <div className="rounded-[var(--rad-lg)] bg-(--surface-3) p-3">
            <div className="mb-3">
              <h3 className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">
                GPU details
              </h3>
              <p className="mt-0.5 text-[length:var(--fs-xs)] text-(--ui-muted)">
                Optional capacity information for a machine Local Studio cannot detect. The name is
                what picks the picture — write it the way the driver reports it.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField label="GPU or accelerator">
                <Input
                  value={form.accelerator_name}
                  onChange={(event) => set("accelerator_name", event.target.value)}
                  placeholder="NVIDIA GB10"
                />
              </FormField>
              <FormField label="Count">
                <Input
                  type="number"
                  value={form.accelerator_count}
                  onChange={(event) => set("accelerator_count", event.target.value)}
                />
              </FormField>
              <FormField label="Memory per unit (GB)">
                <Input
                  type="number"
                  value={form.accelerator_memory_gb}
                  onChange={(event) => set("accelerator_memory_gb", event.target.value)}
                  placeholder="128"
                />
              </FormField>
              <Checkbox
                className="sm:col-span-3"
                checked={form.unified_memory}
                onChange={(checked) => set("unified_memory", checked)}
                label="Unified memory (shared between CPU and GPU)"
              />
            </div>
          </div>
        )}

        <FormField label="Notes (optional)">
          <Textarea
            value={form.notes}
            onChange={(event) => set("notes", event.target.value)}
            rows={2}
            placeholder="Worker rank 1, launched over LAN SSH"
          />
        </FormField>

        {error ? <p className="text-[length:var(--fs-sm)] text-(--ui-danger)">{error}</p> : null}
      </div>
    </ResourceDrawer>
  );
}
