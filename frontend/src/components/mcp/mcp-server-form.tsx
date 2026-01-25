// CRITICAL
"use client";

import { useCallback, useState, type SyntheticEvent } from "react";

export interface McpServerFormPayload {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  icon?: string;
}

interface McpServerFormProps {
  onSubmit: (payload: McpServerFormPayload) => Promise<void>;
  submitLabel?: string;
  submittingLabel?: string;
  title?: string;
  testIdPrefix?: string;
  className?: string;
}

const DEFAULT_TITLE = "Add MCP server";

function parseArgs(input: string) {
  return input
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEnv(input: string) {
  const entries = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return entries.reduce<Record<string, string>>((acc, line) => {
    const [key, ...rest] = line.split("=");
    if (!key) return acc;
    const value = rest.join("=").trim();
    if (!value) return acc;
    acc[key.trim()] = value;
    return acc;
  }, {});
}

export function McpServerForm({
  onSubmit,
  submitLabel = "Add server",
  submittingLabel = "Adding…",
  title = DEFAULT_TITLE,
  testIdPrefix = "mcp-server-form",
  className = "",
}: McpServerFormProps) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [icon, setIcon] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setName("");
    setCommand("");
    setArgs("");
    setEnv("");
    setIcon("");
    setEnabled(true);
    setFormError(null);
  }, []);

  const handleSubmit = useCallback(
    async (event: SyntheticEvent) => {
      event.preventDefault();
      setFormError(null);

      const form =
        event.currentTarget instanceof HTMLFormElement
          ? event.currentTarget
          : event.currentTarget instanceof HTMLButtonElement
            ? event.currentTarget.form
            : null;
      const formData = form ? new FormData(form) : null;
      const resolvedName = (formData?.get("name")?.toString() ?? name).trim();
      const resolvedCommandInput = (formData?.get("command")?.toString() ?? command).trim();
      const resolvedArgsInput = (formData?.get("args")?.toString() ?? args).trim();
      const resolvedEnvInput = formData?.get("env")?.toString() ?? env;
      const resolvedIconInput = (formData?.get("icon")?.toString() ?? icon).trim();

      if (!resolvedName || !resolvedCommandInput) {
        setFormError("Name and command are required.");
        return;
      }

      const commandParts = resolvedCommandInput.split(/\s+/).filter(Boolean);
      const resolvedCommand = commandParts[0] || "";
      const resolvedArgs = parseArgs(resolvedArgsInput);
      const finalArgs = resolvedArgs.length === 0 ? commandParts.slice(1) : resolvedArgs;

      setIsSubmitting(true);
      try {
        await onSubmit({
          name: resolvedName,
          command: resolvedCommand,
          args: finalArgs,
          env: parseEnv(resolvedEnvInput),
          icon: resolvedIconInput || undefined,
          enabled,
        });
        resetForm();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Failed to add server.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [name, command, args, env, icon, enabled, onSubmit, resetForm],
  );

  const containerClass =
    `space-y-4 rounded-lg border border-(--border) bg-(--background) p-4 ${className}`.trim();

  return (
    <form onSubmit={handleSubmit} className={containerClass}>
      <div className="text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">
        {title}
      </div>

      <div className="grid gap-3">
        <label className="text-xs text-(--muted-foreground)">
          Name
          <input
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="exa"
            className="mt-1 w-full rounded-md border border-(--border) bg-(--card) px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-(--accent-purple)"
            data-testid={`${testIdPrefix}-name`}
          />
        </label>

        <label className="text-xs text-(--muted-foreground)">
          Command
          <input
            name="command"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="npx -y exa-mcp-server"
            className="mt-1 w-full rounded-md border border-(--border) bg-(--card) px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-(--accent-purple)"
            data-testid={`${testIdPrefix}-command`}
          />
        </label>

        <label className="text-xs text-(--muted-foreground)">
          Args (space-separated)
          <input
            name="args"
            value={args}
            onChange={(event) => setArgs(event.target.value)}
            placeholder="--foo bar"
            className="mt-1 w-full rounded-md border border-(--border) bg-(--card) px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-(--accent-purple)"
            data-testid={`${testIdPrefix}-args`}
          />
        </label>

        <label className="text-xs text-(--muted-foreground)">
          Env (one per line: KEY=VALUE)
          <textarea
            name="env"
            value={env}
            onChange={(event) => setEnv(event.target.value)}
            placeholder="EXA_API_KEY=..."
            rows={3}
            className="mt-1 w-full rounded-md border border-(--border) bg-(--card) px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-(--accent-purple)"
            data-testid={`${testIdPrefix}-env`}
          />
        </label>

        <label className="text-xs text-(--muted-foreground)">
          Icon (optional)
          <input
            name="icon"
            value={icon}
            onChange={(event) => setIcon(event.target.value)}
            placeholder="🔎"
            className="mt-1 w-full rounded-md border border-(--border) bg-(--card) px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-(--accent-purple)"
            data-testid={`${testIdPrefix}-icon`}
          />
        </label>

        <label className="flex items-center gap-2 text-xs text-(--muted-foreground)">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-4 w-4 rounded border-(--border) bg-(--card)"
            data-testid={`${testIdPrefix}-enabled`}
          />
          Enable on add
        </label>
      </div>

      {formError && <p className="text-xs text-(--error)">{formError}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="inline-flex items-center gap-2 rounded-md bg-(--accent-purple) px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-(--card) disabled:opacity-60"
        data-testid={`${testIdPrefix}-submit`}
      >
        {isSubmitting ? submittingLabel : submitLabel}
      </button>
    </form>
  );
}
