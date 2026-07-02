export const BACKEND_LABELS: Record<string, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  llamacpp: "llama.cpp",
  mlx: "MLX",
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
    case "llamacpp":
      return { bg: "bg-(--color-skill-node)", fg: "text-(--color-skill-node-foreground)" };
    case "mlx":
      return { bg: "bg-(--color-subagent-node)", fg: "text-(--color-subagent-node-foreground)" };
    case "exllamav3":
      return { bg: "bg-(--color-session-node)", fg: "text-(--color-session-node-foreground)" };
    default:
      return { bg: "bg-(--color-command-node)", fg: "text-(--color-command-node-foreground)" };
  }
}
