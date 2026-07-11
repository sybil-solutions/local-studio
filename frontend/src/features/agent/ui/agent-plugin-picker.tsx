"use client";

import { useCallback, useMemo, useState } from "react";
import { Effect, Schema } from "effect";
import {
  PluginRuntimeResponseSchema,
  type PluginRuntimeView,
} from "@local-studio/agent-runtime/plugin-runtime-contract";
import type { ComposerPluginRef } from "@/features/agent/composer-context";
import { Check, Plug } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { cx } from "@/ui/utils";

function isAvailable(plugin: PluginRuntimeView): boolean {
  return plugin.tools.state === "enabled" && (!plugin.account || plugin.account.connected);
}

function pluginRef(plugin: PluginRuntimeView): ComposerPluginRef {
  return {
    id: plugin.id,
    name: plugin.displayName,
    description: plugin.description,
    capabilities: [...plugin.capabilities],
  };
}

export function AgentPluginPicker({
  selected,
  onChange,
}: {
  selected: ComposerPluginRef[];
  onChange: (plugins: ComposerPluginRef[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [plugins, setPlugins] = useState<PluginRuntimeView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(() => {
    if (!open) return;
    let cancelled = false;
    void Effect.runPromise(
      Effect.tryPromise(() => fetch("/api/agent/plugins", { cache: "no-store" })).pipe(
        Effect.flatMap((response) => Effect.tryPromise(() => response.json())),
        Effect.map(Schema.decodeUnknownSync(PluginRuntimeResponseSchema)),
        Effect.catch(() => Effect.succeed({ plugins: [] })),
      ),
    ).then((payload) => {
      if (!cancelled) {
        setPlugins([...payload.plugins]);
        if (!cancelled) setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);
  useMountSubscription(load, [load]);
  const selectedIds = useMemo(() => new Set(selected.map((plugin) => plugin.id)), [selected]);
  const available = plugins.filter(isAvailable);
  const toggle = (plugin: PluginRuntimeView) => {
    onChange(
      selectedIds.has(plugin.id)
        ? selected.filter((item) => item.id !== plugin.id)
        : [...selected, pluginRef(plugin)],
    );
  };

  return (
    <div
      className="relative shrink-0"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Plugins"
        title="Attach connected plugins to this chat"
        className={cx(
          "relative inline-flex !h-7 !min-h-7 !w-7 !min-w-7 items-center justify-center rounded-md text-(--dim)/75 hover:bg-(--hover) hover:text-(--fg)/85",
          (open || selected.length > 0) && "bg-(--hover) text-(--fg)/85",
        )}
      >
        <Plug className="h-3.5 w-3.5" />
        {selected.length > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-(--accent) px-0.5 text-[9px] font-semibold text-(--bg)">
            {selected.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Connected plugins"
          className="absolute bottom-full left-0 z-20 mb-1.5 w-72 rounded-lg border border-(--color-popover-border) bg-(--color-popover) p-1 shadow-[0_12px_32px_rgba(0,0,0,0.48)]"
        >
          <div className="px-2 py-1.5 text-[length:var(--fs-xs)] font-medium text-(--dim)">
            Plugins for this chat
          </div>
          {available.map((plugin) => (
            <button
              key={plugin.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={selectedIds.has(plugin.id)}
              onClick={() => toggle(plugin)}
              className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-(--fg) hover:bg-(--hover)"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-(--hover)">
                <Plug className="h-3.5 w-3.5 text-(--dim)" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{plugin.displayName}</span>
                <span className="block truncate text-[length:var(--fs-xs)] text-(--dim)">
                  {plugin.capabilities.join(" · ") || plugin.description}
                </span>
              </span>
              {selectedIds.has(plugin.id) ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
          ))}
          {loaded && available.length === 0 ? (
            <div className="px-2 py-3 text-[length:var(--fs-sm)] text-(--dim)">
              Connect a plugin in Integrations first.
            </div>
          ) : null}
          {!loaded ? (
            <div className="px-2 py-3 text-[length:var(--fs-sm)] text-(--dim)">Loading…</div>
          ) : null}
          <a
            href="/integrations#plugins"
            className="mt-1 block rounded-md border-t border-(--border) px-2 py-2 text-[length:var(--fs-sm)] text-(--link) hover:bg-(--hover)"
          >
            Manage plugins
          </a>
        </div>
      ) : null}
    </div>
  );
}
