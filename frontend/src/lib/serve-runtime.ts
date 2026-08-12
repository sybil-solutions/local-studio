import type { Backend, RuntimeTarget, ServeRuntime } from "@/lib/types";

const ENGINE_LABEL: Record<Backend, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  llamacpp: "llama.cpp",
  mlx: "MLX",
};

export const runtimeId = (runtime: ServeRuntime): string => `${runtime.kind}:${runtime.ref}`;

export const defaultRuntimeForBackend = (backend: Backend): ServeRuntime =>
  backend === "llamacpp"
    ? { kind: "binary", ref: "llama-server", label: "Managed llama.cpp" }
    : {
        kind: "managed_venv",
        ref: backend,
        label: `Managed ${ENGINE_LABEL[backend]}`,
      };

export const isManagedServeRuntimeTarget = (backend: Backend, target: RuntimeTarget): boolean =>
  target.backend === backend &&
  target.kind === "venv" &&
  Boolean(target.pythonPath?.replace(/\\/g, "/").includes(`/runtime/venvs/${backend}-latest/`));
