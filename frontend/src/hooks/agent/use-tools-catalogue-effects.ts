// One-shot fetch of the workspace-global plugin and skill catalogues.
//
// This used to live as a `useEffect` inside `ToolsProvider`, but our
// project-wide policy bans `useEffect` in production code; the only
// sanctioned home for genuine side effects is `src/hooks/agent/use-*-effects.ts`.
// `ToolsProvider` now calls this hook with `onLoaded` setters so the effect
// stays exactly where it has always lived (workspace-mounted), but the
// implementation is contained in this dedicated file.

import { useEffect } from "react";

import type { ComposerPluginRef, ComposerSkillRef } from "@/lib/agent/composer-context";

type UseToolsCatalogueEffectsOptions = {
  onLoaded: (payload: { plugins: ComposerPluginRef[]; skills: ComposerSkillRef[] }) => void;
};

export function useToolsCatalogueEffects({ onLoaded }: UseToolsCatalogueEffectsOptions): void {
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/agent/plugins?includeDisabled=1", { cache: "no-store" })
        .then((res) => res.json() as Promise<{ plugins?: ComposerPluginRef[] }>)
        .then((payload) => payload.plugins ?? [])
        .catch(() => [] as ComposerPluginRef[]),
      fetch("/api/agent/skills", { cache: "no-store" })
        .then((res) => res.json() as Promise<{ skills?: ComposerSkillRef[] }>)
        .then((payload) => payload.skills ?? [])
        .catch(() => [] as ComposerSkillRef[]),
    ]).then(([plugins, skills]) => {
      if (cancelled) return;
      onLoaded({ plugins, skills });
    });
    return () => {
      cancelled = true;
    };
    // Mount-once: we intentionally ignore the identity of `onLoaded`.
  }, []);
}
