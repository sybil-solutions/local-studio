import type { Backend, RuntimeTarget, ServeRuntime } from "@/lib/types";

const ENGINE_LABEL: Record<Backend, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  exllamav3: "exllamav3",
};

export const runtimeId = (runtime: ServeRuntime): string => `${runtime.kind}:${runtime.ref}`;

/** Engines run in containers; a bare engine-name ref means "the engine's pinned image". */
export const defaultRuntimeForBackend = (backend: Backend): ServeRuntime => ({
  kind: "docker",
  ref: backend,
  label: `${ENGINE_LABEL[backend]} (Docker)`,
});

export const isManagedServeRuntimeTarget = (backend: Backend, target: RuntimeTarget): boolean =>
  target.backend === backend && target.kind === "docker";
