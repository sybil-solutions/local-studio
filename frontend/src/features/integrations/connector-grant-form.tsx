"use client";

import type { ConnectorGrantTarget } from "@local-studio/agent-runtime/connector-grants-contract";
import { Button, Checkbox, FormField, Select } from "@/ui";

export const EVERY_MODEL_VALUE = "*";

export type GrantDraft = {
  connectorId: string;
  modelId: string;
  tools: string[] | "all";
};

export function ConnectorGrantForm({
  connectors,
  models,
  draft,
  busy,
  onDraft,
  onSubmit,
}: {
  connectors: ConnectorGrantTarget[];
  models: Array<{ id: string; name: string }>;
  draft: GrantDraft;
  busy: boolean;
  onDraft: (draft: GrantDraft) => void;
  onSubmit: () => void;
}) {
  const connector = connectors.find((entry) => entry.id === draft.connectorId);
  const everyTool = draft.tools === "all";
  const selected = new Set(everyTool ? [] : draft.tools);
  const toggleTool = (tool: string, checked: boolean) => {
    const next = new Set(everyTool ? (connector?.tools ?? []) : draft.tools);
    if (checked) next.add(tool);
    else next.delete(tool);
    onDraft({ ...draft, tools: [...next] });
  };
  return (
    <div className="space-y-3 rounded-lg border border-(--ui-border) p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Connector">
          <Select
            value={draft.connectorId}
            onChange={(event) =>
              onDraft({ ...draft, connectorId: event.target.value, tools: "all" })
            }
            options={connectors.map((entry) => ({ value: entry.id, label: entry.name }))}
            placeholder="Select a connector"
          />
        </FormField>
        <FormField label="Model">
          <Select
            value={draft.modelId}
            onChange={(event) => onDraft({ ...draft, modelId: event.target.value })}
            options={[
              { value: EVERY_MODEL_VALUE, label: "Every model" },
              ...models.map((model) => ({ value: model.id, label: model.name || model.id })),
            ]}
          />
        </FormField>
      </div>
      {connector?.tools.length ? (
        <div className="space-y-2">
          <Checkbox
            checked={everyTool}
            onChange={(checked) =>
              onDraft({ ...draft, tools: checked ? "all" : [...connector.tools] })
            }
            label="Every tool this connector exposes"
          />
          {everyTool ? null : (
            <div className="grid gap-2 sm:grid-cols-2">
              {connector.tools.map((tool) => (
                <Checkbox
                  key={tool}
                  checked={selected.has(tool)}
                  onChange={(checked) => toggleTool(tool, checked)}
                  label={tool}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button
          onClick={onSubmit}
          loading={busy}
          disabled={!draft.connectorId || (draft.tools !== "all" && draft.tools.length === 0)}
        >
          Save access
        </Button>
      </div>
    </div>
  );
}
