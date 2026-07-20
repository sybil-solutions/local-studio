// Derives the composer's presentation state from session facts. Pure TS so the
// state table stays inspectable in one place instead of scattered ternaries.

export type ComposerBanner = {
  id: "compacting";
  label: string;
};

export type ComposerVisual = {
  placeholder: string;
  banner: ComposerBanner | null;
  /** Codex shows a "Choose project" row above the composer on fresh threads. */
  showProjectRow: boolean;
};

export function deriveComposerVisual({
  compacting,
  hasMessages,
}: {
  compacting: boolean;
  hasMessages: boolean;
}): ComposerVisual {
  return {
    placeholder: hasMessages ? "Ask for follow-up changes" : "Do anything",
    banner: compacting ? { id: "compacting", label: "Context compacting" } : null,
    showProjectRow: !hasMessages,
  };
}
