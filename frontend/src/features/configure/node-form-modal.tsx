"use client";

import { useState } from "react";
import {
  RIG_HARDWARE_TYPE_LABELS,
  RIG_HARDWARE_TYPES,
  RIG_NODE_ROLES,
} from "@local-studio/contracts/rigs";
import { Button, Checkbox, FormField, Input, Select, Textarea } from "@/ui";
import { cx } from "@/ui/utils";
import { ResourceDrawer } from "@/ui/resource-drawer";
import type { RigHardwareType, RigNode, RigNodeRole } from "@/lib/types";
import type { RigNodePayload } from "@/lib/api/rigs";
import { HardwareArt } from "./hardware-art";

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

export function NodeFormModal({
  title,
  initial,
  detected,
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: NodeFormState;
  detected?: boolean;
  onClose: () => void;
  onSubmit: (payload: RigNodePayload & { name: string }) => Promise<void>;
}) {
  const [form, setForm] = useState<NodeFormState>(initial ?? EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof NodeFormState>(key: K, value: NodeFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (!form.name.trim()) {
      setError("Give this device a name");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(formToPayload(form));
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
      status={detected ? "Hardware details synchronize automatically" : "Manual machine profile"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            Save device
          </Button>
        </>
      }
      width={680}
    >
      <div className="space-y-4">
        <div className="rounded-[var(--rad-lg)] bg-(--surface-3) px-3 py-2.5 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
          Only the name and how this machine is used are required.
          {detected
            ? " Hardware details stay synchronized automatically."
            : " Everything else is optional."}
        </div>

        <FormField label="What kind of machine is this?" asGroup>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {RIG_HARDWARE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => set("hardware_type", type)}
                aria-pressed={form.hardware_type === type}
                className={cx(
                  "flex flex-col items-center gap-1 rounded-lg border p-2 transition-colors",
                  form.hardware_type === type
                    ? "border-(--ui-accent)/60 bg-(--ui-accent)/10 text-(--ui-fg)"
                    : "border-(--ui-border) text-(--ui-muted) hover:border-(--ui-separator) hover:text-(--ui-fg)",
                )}
              >
                <HardwareArt type={type} className="h-12 w-full" />
                <span className="text-[length:var(--fs-xs)]">{RIG_HARDWARE_TYPE_LABELS[type]}</span>
              </button>
            ))}
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
        </div>

        {detected ? null : (
          <div className="rounded-[var(--rad-lg)] bg-(--surface-3) p-3">
            <div className="mb-3">
              <h3 className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">
                GPU details
              </h3>
              <p className="mt-0.5 text-[length:var(--fs-xs)] text-(--ui-muted)">
                Optional capacity information for a machine Local Studio cannot detect.
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
