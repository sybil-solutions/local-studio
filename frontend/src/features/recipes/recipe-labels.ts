export const BACKEND_LABELS: Record<string, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  exllamav3: "exllamav3",
};

export const formatBackendLabel = (backend?: string | null): string => {
  if (!backend) return BACKEND_LABELS.vllm;
  return BACKEND_LABELS[backend] ?? backend;
};

/**
 * ZCode node-taxonomy mapping for serving engines — color-codes each engine
 * type using the `--color-*-node` tokens so engines read as distinct categories
 * at a glance (the same idiom ZCode uses for file/session/skill/subagent nodes).
 * Returns Tailwind class fragments for the badge bg + foreground.
 */
export type EngineNodeStyle = {
  /** Badge background class. */
  bg: string;
  /** Badge text/foreground class. */
  fg: string;
};

export function engineNodeStyle(backend?: string | null): EngineNodeStyle {
  switch (backend) {
    case "vllm":
      return { bg: "bg-(--color-command-node)", fg: "text-(--color-command-node-foreground)" };
    case "sglang":
      return { bg: "bg-(--color-file-node)", fg: "text-(--color-file-node-foreground)" };
    case "exllamav3":
      return { bg: "bg-(--color-skill-node)", fg: "text-(--color-skill-node-foreground)" };
    default:
      return { bg: "bg-(--color-command-node)", fg: "text-(--color-command-node-foreground)" };
  }
}
