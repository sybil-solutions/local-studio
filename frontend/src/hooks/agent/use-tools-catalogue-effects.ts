// One-shot fetch of the workspace-global plugin and skill catalogues.

import { useCallback, useRef, useSyncExternalStore } from "react";

import type {
  ComposerExtensionRef,
  ComposerPluginRef,
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/lib/agent/composer-context";

type UseToolsCatalogueEffectsOptions = {
  onLoaded: (payload: {
    plugins: ComposerPluginRef[];
    skills: ComposerSkillRef[];
    promptTemplates: ComposerPromptTemplateRef[];
    extensions: ComposerExtensionRef[];
  }) => void;
};

type ExtensionsApiResponse = {
  resources?: {
    extensions?: Array<{
      path: string;
      source: string;
      enabled: boolean;
      origin: "package" | "top-level";
      scope: "user" | "project" | "temporary";
    }>;
  };
};

function deriveExtensionName(source: string, absPath: string): string {
  if (source && source !== "auto") {
    const m = /^(?:npm|git|file|ssh|https?):(.+)$/.exec(source);
    const tail = (m?.[1] ?? source).trim();
    const last = tail.split(/[\\/]/).filter(Boolean).pop();
    if (last) return last;
  }
  const base = absPath.split(/[\\/]/).filter(Boolean).pop() ?? absPath;
  return base.replace(/\.(?:t|j)sx?$/i, "");
}

export function useToolsCatalogueEffects({ onLoaded }: UseToolsCatalogueEffectsOptions): void {
  const onLoadedRef = useRef(onLoaded);
  const subscribe = useCallback((_notify: () => void) => {
    let cancelled = false;
    void loadToolsCatalogue().then((payload) => {
      if (!cancelled) onLoadedRef.current(payload);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useSyncExternalStore(subscribe, getToolsCatalogueSnapshot, getToolsCatalogueSnapshot);
}

async function loadToolsCatalogue(): Promise<{
  plugins: ComposerPluginRef[];
  skills: ComposerSkillRef[];
  promptTemplates: ComposerPromptTemplateRef[];
  extensions: ComposerExtensionRef[];
}> {
  const [plugins, skills, promptTemplates, extensions] = await Promise.all([
    fetch("/api/agent/plugins?includeDisabled=1", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ plugins?: ComposerPluginRef[] }>)
      .then((payload) => payload.plugins ?? [])
      .catch(() => [] as ComposerPluginRef[]),
    fetch("/api/agent/skills", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ skills?: ComposerSkillRef[] }>)
      .then((payload) => payload.skills ?? [])
      .catch(() => [] as ComposerSkillRef[]),
    fetch("/api/agent/prompt-templates", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ templates?: ComposerPromptTemplateRef[] }>)
      .then((payload) => payload.templates ?? [])
      .catch(() => [] as ComposerPromptTemplateRef[]),
    fetch("/api/agent/extensions", { cache: "no-store" })
      .then((res) => res.json() as Promise<ExtensionsApiResponse>)
      .then((payload): ComposerExtensionRef[] =>
        (payload.resources?.extensions ?? []).map((ext) => {
          const id = ext.source && ext.source !== "auto" ? ext.source : ext.path;
          return {
            id,
            name: deriveExtensionName(ext.source, ext.path),
            source: ext.source,
            path: ext.path,
            scope: ext.scope,
            origin: ext.origin,
            enabled: ext.enabled,
          };
        }),
      )
      .catch(() => [] as ComposerExtensionRef[]),
  ]);

  return { plugins, skills, promptTemplates, extensions };
}

const getToolsCatalogueSnapshot = (): number => 0;
